import {
  Timestamp,
  arrayUnion,
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { buildDedupFields, rankCandidates, selectQueryTokens, type ScoredCandidate } from '../services/duplicateScorer';
import { tokenize } from '../services/textNormalize';
import { pauseClock } from '../services/slaCalculator';
import { currentCalendar } from '../hooks/useWorkingCalendar';
import {
  counterShardId,
  formatTicketNo,
  nextCounterState,
  periodKey,
} from '../services/ticketNumber';
import {
  COL,
  DomainError,
  TICKET_COL,
  type SupportModuleCode,
  type Ticket,
  type TicketIndexDoc,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from '../types';
import { classifyError, type RepoError } from './campusRepository';

// ===========================================================================
// Truy cập dữ liệu ticket.
// ===========================================================================

/** 90 ngày theo §6: chỉ quét trùng trong khoảng này. */
const DEDUP_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
/** Số ứng viên tối đa kéo về chấm điểm. */
const DEDUP_CANDIDATE_LIMIT = 200;

export interface CreateTicketInput {
  type: TicketType;
  moduleId: SupportModuleCode;
  subFeature: string;
  campusId: string;
  reporterUserId: string;
  campusContactUserId: string | null;
  title: string;
  description: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  occurredAt?: number | null;
  hasWorkaround?: boolean;
  impactScale?: Ticket['impactScale'];
  affectedUserRef?: string;
  affectedUserRole?: string;
  deviceOs?: string;
  deviceBrowser?: string;
  appVersion?: string;
  networkNote?: string;
  errorCode?: string;
  logExcerpt?: string;
  /** Đầu mối tại trường để kỹ thuật viên liên hệ về lỗi này. */
  contactName?: string;
  contactEmail?: string;
  attachments?: Ticket['attachments'];
}

/**
 * Đầu mối phân hệ và quản lý dự án nhận phiếu của phân hệ này.
 *
 * Trả mảng rỗng nếu đọc hỏng. Không báo được cho ai KHÔNG được làm hỏng việc
 * gửi phiếu — phiếu vẫn nằm trong hàng đợi tiếp nhận, chỉ là không có tiếng
 * chuông.
 */
async function ainhanPhieuMoi(moduleId: string): Promise<string[]> {
  try {
    const modSnap = await getDoc(doc(db, COL.modules, moduleId));
    if (!modSnap.exists()) return [];
    const m = modSnap.data() as Record<string, unknown>;
    const out = new Set<string>();
    if (m.ownerUserId) out.add(String(m.ownerUserId));
    if (m.backupOwnerUserId) out.add(String(m.backupOwnerUserId));
    if (m.projectId) {
      const projSnap = await getDoc(doc(db, 'projects', String(m.projectId)));
      for (const uid of ((projSnap.data()?.managers as string[]) ?? [])) out.add(uid);
    }
    return [...out];
  } catch (e) {
    // Không báo được cho ai KHÔNG được làm hỏng việc gửi phiếu — phiếu vẫn nằm
    // trong hàng đợi tiếp nhận. Nhưng phải để lại DẤU VẾT: im lặng hoàn toàn
    // nghĩa là phiếu vào hệ thống mà không ai hay, đúng cái chờ đợi mơ hồ mà
    // module này sinh ra để xoá bỏ, và không ai có cách nào phát hiện.
    console.error('[hỗ trợ] không xác định được người nhận thông báo phiếu mới', e);
    return [];
  }
}

/**
 * Tạo ticket.
 *
 * Bốn lượt ghi trong MỘT transaction:
 *   1. mảnh counter        — cấp số thứ tự
 *   2. document ticket     — dữ liệu đầy đủ
 *   3. bản gương index     — bản mỏng cho quét trùng
 *   4. document khoá mã    — bảo đảm mã phiếu duy nhất
 *
 * Về (4): counter KHÔNG tự bảo đảm tính duy nhất. Client ghi được `ticketNo`
 * bất kỳ giá trị nào nó muốn, và firestore.rules không có cách nào kiểm chứng
 * một giá trị suy ra từ counter. Document khoá tạo-mới-hoặc-thất-bại mới là thứ
 * biến tính duy nhất thành ràng buộc ở TẦNG DỮ LIỆU.
 */
export async function createTicket(input: CreateTicketInput): Promise<Ticket> {
  const title = input.title.trim();
  if (title.length < 10) {
    throw new DomainError(
      'TICKET_TITLE_TOO_SHORT',
      'Tiêu đề cần ít nhất 10 ký tự để mô tả được lỗi',
      { length: title.length }
    );
  }
  if (!input.campusId) {
    throw new DomainError('TICKET_CAMPUS_REQUIRED', 'Chưa xác định được trường của bạn');
  }

  const now = Date.now();
  const period = periodKey(now);
  const shardRef = doc(db, TICKET_COL.counters, counterShardId(input.moduleId, period));
  const dedup = buildDedupFields(title, input.description ?? '');

  // Ai cần biết có phiếu mới, đọc TRƯỚC transaction.
  //
  // Web SDK không truy vấn được bên trong transaction, và getDoc thường ở giữa
  // transaction sẽ không nằm trong ảnh chụp nhất quán. Hai lượt đọc ở đây rẻ và
  // không ảnh hưởng tính đúng đắn: xấu nhất là danh sách người nhận hơi cũ, chứ
  // không sinh ra phiếu sai.
  //
  // Không báo cho TOÀN BỘ thành viên dự án: họ đã có hàng đợi tiếp nhận để nhìn.
  // Chỉ báo cho người CHỊU TRÁCH NHIỆM phân loại — đầu mối phân hệ và quản lý
  // dự án. Báo cho tất cả thì thông báo thành nhiễu và không ai đọc nữa.
  const nguoiNhan = await ainhanPhieuMoi(input.moduleId);

  return runTransaction(db, async (tx) => {
    const shardSnap = await tx.get(shardRef);
    const current = shardSnap.exists()
      ? (shardSnap.data() as { period: string; seq: number })
      : null;
    // Counter và thực tế có thể lệch nhau (dữ liệu nhập tay, khôi phục sao lưu).
    // Khi đó phải TỰ ĐI TỚI số trống, không được ném lỗi.
    //
    // Ném DomainError ở đây không làm transaction chạy lại: Firestore chỉ thử
    // lại với lỗi mang name === 'FirebaseError', còn DomainError đặt name là
    // 'DomainError'. Transaction huỷ ngay lần đầu, lượt ghi counter bị bỏ, nên
    // shard không bao giờ vượt qua được con số đang kẹt — phân hệ đó tắc vĩnh
    // viễn. Dò tới tối đa 5 số rồi mới chịu thua.
    let next = nextCounterState(current, period);
    let ticketNo = formatTicketNo(input.moduleId, next.period, next.seq);
    let lockRef = doc(db, 'support_ticket_numbers', ticketNo);
    let lockSnap = await tx.get(lockRef);
    for (let i = 0; i < 5 && lockSnap.exists(); i++) {
      next = { period: next.period, seq: next.seq + 1 };
      ticketNo = formatTicketNo(input.moduleId, next.period, next.seq);
      lockRef = doc(db, 'support_ticket_numbers', ticketNo);
      lockSnap = await tx.get(lockRef);
    }
    if (lockSnap.exists()) {
      throw new DomainError(
        'TICKET_NO_COLLISION',
        'Không cấp được mã phiếu mới. Báo quản trị viên kiểm tra bộ đếm của phân hệ này.',
        { ticketNo }
      );
    }

    const ticketRef = doc(collection(db, TICKET_COL.tickets));
    const ticket: Ticket = {
      id: ticketRef.id,
      ticketNo,
      type: input.type,
      moduleId: input.moduleId,
      subFeature: input.subFeature ?? '',
      campusId: input.campusId,
      reporterUserId: input.reporterUserId,
      campusContactUserId: input.campusContactUserId ?? null,
      title,
      description: input.description ?? '',
      stepsToReproduce: input.stepsToReproduce ?? '',
      expectedResult: input.expectedResult ?? '',
      actualResult: input.actualResult ?? '',
      occurredAt: input.occurredAt ?? null,
      hasWorkaround: input.hasWorkaround ?? false,
      impactScale: input.impactScale ?? null,
      affectedUserRef: input.affectedUserRef ?? '',
      affectedUserRole: input.affectedUserRole ?? '',
      deviceOs: input.deviceOs ?? '',
      deviceBrowser: input.deviceBrowser ?? '',
      appVersion: input.appVersion ?? '',
      networkNote: input.networkNote ?? '',
      errorCode: input.errorCode ?? '',
      logExcerpt: input.logExcerpt ?? '',
      // Vào thẳng TRIAGE, không dừng ở NEW: §14 yêu cầu ticket tự định tuyến về
      // đầu mối phân hệ ngay khi tạo. NEW chỉ tồn tại trên sơ đồ, không có ai
      // hay tiến trình nào đứng giữa NEW và TRIAGE để làm gì cả.
      status: 'TRIAGE',
      // Mặc định CAMPUS_LOCAL: đầu mối phân hệ mới là người xác định phạm vi ở
      // bước triage (§2). Đoán SYSTEM_WIDE ngay từ đầu là gửi thông báo cho 18
      // trường về một lỗi có thể chỉ của một trường.
      scope: 'CAMPUS_LOCAL',
      priority: null,
      assigneeUserId: null,
      triagedBy: null,
      triagedAt: null,
      dueAt: null,
      estimateDays: 0,
      slaPolicyId: null,
      firstResponseAt: null,
      resolvedAt: null,
      closedAt: null,
      duplicateOfTicketId: null,
      reopenCount: 0,
      linkedProjectId: null,
      linkedTaskId: null,
      rejectionReason: '',
      needsInfoRequest: '',
      contactName: (input.contactName ?? '').trim(),
      contactEmail: (input.contactEmail ?? '').trim().toLowerCase(),
      attachments: input.attachments ?? [],
      affectedCampusIds: [input.campusId],
      watcherUids: [
        input.reporterUserId,
        ...(input.campusContactUserId ? [input.campusContactUserId] : []),
      ],
      ...dedup,
      slaStartedAt: now,
      slaElapsedWorkingMs: 0,
      slaLastResumedAt: now,
      slaBreachNotifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    const indexDoc: TicketIndexDoc = {
      ticketNo,
      moduleId: ticket.moduleId,
      campusId: ticket.campusId,
      status: ticket.status,
      title: ticket.title,
      type: ticket.type,
      normalizedTitle: ticket.normalizedTitle,
      titleTokens: ticket.titleTokens,
      bodyTokens: ticket.bodyTokens,
      createdAt: now,
    };

    tx.set(shardRef, { ...next, updatedAt: serverTimestamp() });
    tx.set(lockRef, { ticketId: ticketRef.id, createdAt: now });
    tx.set(ticketRef, ticket);
    tx.set(doc(db, TICKET_COL.ticketIndex, ticketRef.id), indexDoc);

    for (const uid of nguoiNhan) {
      if (uid === input.reporterUserId) continue;
      tx.set(doc(collection(db, 'notifications')), {
        targetUserId: uid,
        message: `Yêu cầu mới ${ticketNo} từ ${input.campusId}: ${title}`,
        ticketId: ticketRef.id,
        ticketNo,
        read: false,
        time: Timestamp.now(),
      });
    }

    return ticket;
  });
}

/**
 * Vá các mảng thiếu trên phiếu đọc từ Firestore.
 *
 * Cùng một lớp lỗi đã từng làm sập màn Công việc: một document thiếu field mà
 * giao diện gọi thẳng `.length` là cả màn hình trắng, và ErrorBoundary nuốt
 * mất nguyên nhân. Phiếu do createTicket sinh ra luôn đủ field, nhưng phiếu
 * nhập tay, phiếu seed, và phiếu tạo trước khi thêm field mới thì không.
 *
 * Vá ở ĐÚNG một chỗ — ranh giới đọc dữ liệu — thay vì rải `?.` khắp giao diện,
 * vì rải thì luôn sót đúng chỗ chưa ai mở tới.
 */
function normalizeTicket(id: string, raw: unknown): Ticket {
  const d = (raw ?? {}) as Record<string, unknown>;
  return {
    ...(d as unknown as Ticket),
    id,
    affectedCampusIds: (d.affectedCampusIds as string[]) ?? [],
    watcherUids: (d.watcherUids as string[]) ?? [],
    attachments: (d.attachments as Ticket['attachments']) ?? [],
    titleTokens: (d.titleTokens as string[]) ?? [],
    bodyTokens: (d.bodyTokens as string[]) ?? [],
    reopenCount: Number(d.reopenCount ?? 0),
    // Phiếu tạo trước khi có tính năng "chưa xác định hạn" không mang field này.
    estimateDays: Number(d.estimateDays ?? 0),
    needsInfoRequest: String(d.needsInfoRequest ?? ''),
    rejectionReason: String(d.rejectionReason ?? ''),
  };
}

/**
 * Tìm ticket có khả năng trùng.
 *
 * Đọc từ support_ticket_index chứ KHÔNG phải support_tickets: Web SDK không hỗ
 * trợ select(), nên đọc bảng chính là kéo về cả document đầy đủ — 200 ticket
 * khoảng 800KB mỗi lần gõ.
 *
 * Truy vấn dùng token HIẾM NHẤT. Xem ghi chú dài trong duplicateScorer.ts:
 * array-contains-any không xếp hạng theo số token khớp, nên truy vấn bằng token
 * phổ biến sẽ trả về 200 document ngẫu nhiên và bỏ sót đúng ticket trùng thật.
 */
export async function findDuplicateCandidates(input: {
  moduleId: SupportModuleCode;
  title: string;
  description?: string;
  tokenFrequency?: Record<string, number> | null;
}): Promise<ScoredCandidate<TicketIndexDoc & { id: string }>[]> {
  const tokens = tokenize(input.title);
  if (tokens.length === 0) return [];

  const queryTokens = selectQueryTokens(tokens, input.tokenFrequency ?? null);
  const since = Date.now() - DEDUP_WINDOW_MS;

  // Chỉ dùng mệnh đề BẰNG cùng array-contains-any. Thêm `status in [...]` vào
  // đây là 10 × 3 = 30 disjunction sau khai triển DNF, chạm đúng trần của
  // Firestore và query bị từ chối LÚC CHẠY — tsc không bao giờ bắt được.
  // Lọc trạng thái và cửa sổ 90 ngày làm ở phía client trên tập đã thu hẹp.
  const q = query(
    collection(db, TICKET_COL.ticketIndex),
    where('moduleId', '==', input.moduleId),
    where('titleTokens', 'array-contains-any', queryTokens),
    fsLimit(DEDUP_CANDIDATE_LIMIT)
  );

  const snap = await getDocs(q);
  const candidates = snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as TicketIndexDoc) }))
    .filter((c) => c.createdAt >= since)
    // §6: bỏ qua ticket đã đóng / bị từ chối / đã đánh dấu trùng.
    .filter((c) => !['CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status));

  return rankCandidates({ title: input.title, description: input.description }, candidates);
}

/**
 * Ticket mà một campus được phép xem.
 *
 * PHẢI là hai truy vấn tách rời rồi gộp ở client. Firestore không lọc kết quả
 * theo rules — nó TỪ CHỐI cả truy vấn trừ khi chính ràng buộc của truy vấn
 * chứng minh mọi kết quả đều đọc được. Nên "ticket của trường tôi" và "ticket
 * toàn hệ thống có ảnh hưởng trường tôi" là hai hình dạng index khác nhau, và
 * không viết gộp thành một truy vấn được.
 *
 * Đánh đổi: không phân trang bằng một con trỏ duy nhất trên cả hai tập. Chấp
 * nhận được ở quy mô một trường; nếu sau này cần thì phải denormalize.
 */
export async function fetchTicketsForCampus(
  campusId: string,
  opts: { limit?: number } = {}
): Promise<{ tickets: Ticket[]; error: RepoError | null }> {
  const max = opts.limit ?? 50;
  try {
    const [mine, systemWide] = await Promise.all([
      getDocs(
        query(
          collection(db, TICKET_COL.tickets),
          where('campusId', '==', campusId),
          orderBy('createdAt', 'desc'),
          fsLimit(max)
        )
      ),
      getDocs(
        query(
          collection(db, TICKET_COL.tickets),
          where('scope', '==', 'SYSTEM_WIDE'),
          where('affectedCampusIds', 'array-contains', campusId),
          orderBy('createdAt', 'desc'),
          fsLimit(max)
        )
      ),
    ]);

    const byId = new Map<string, Ticket>();
    for (const d of [...mine.docs, ...systemWide.docs]) {
      byId.set(d.id, normalizeTicket(d.id, d.data()));
    }
    const tickets = [...byId.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, max);
    return { tickets, error: null };
  } catch (error) {
    return { tickets: [], error: classifyError(error) };
  }
}

/** Tra ticket theo mã phiếu, phục vụ deep link ?ticket=FSC-... */
export async function fetchTicketByNo(
  ticketNo: string
): Promise<{ ticket: Ticket | null; error: RepoError | null }> {
  try {
    const snap = await getDocs(
      query(collection(db, TICKET_COL.tickets), where('ticketNo', '==', ticketNo), fsLimit(1))
    );
    if (snap.empty) return { ticket: null, error: null };
    const d = snap.docs[0];
    return { ticket: normalizeTicket(d.id, d.data()), error: null };
  } catch (error) {
    return { ticket: null, error: classifyError(error) };
  }
}

/** Hàng đợi triage của một phân hệ. */
export async function fetchTriageQueue(
  moduleId: SupportModuleCode,
  opts: { limit?: number } = {}
): Promise<{ tickets: Ticket[]; error: RepoError | null }> {
  try {
    const snap = await getDocs(
      query(
        collection(db, TICKET_COL.tickets),
        where('moduleId', '==', moduleId),
        where('status', 'in', ['TRIAGE', 'NEEDS_INFO']),
        orderBy('createdAt', 'asc'),
        fsLimit(opts.limit ?? 50)
      )
    );
    return {
      tickets: snap.docs.map((d) => (normalizeTicket(d.id, d.data()))),
      error: null,
    };
  } catch (error) {
    return { tickets: [], error: classifyError(error) };
  }
}

export { documentId };

/**
 * "Trường tôi cũng gặp lỗi này" (§6).
 *
 * KHÔNG tạo phiếu mới. Thêm trường của người gọi vào danh sách bị ảnh hưởng và
 * thêm chính họ vào danh sách theo dõi của phiếu CHA.
 *
 * Dùng arrayUnion chứ không đọc-rồi-ghi: hai trường bấm cùng lúc mà đọc-rồi-ghi
 * thì trường bấm sau ghi đè mất trường bấm trước. arrayUnion là thao tác gộp ở
 * phía máy chủ nên không mất dữ liệu.
 *
 * Lưu ý về quyền: firestore.rules cho phép đúng thao tác này mà KHÔNG kèm quyền
 * đọc nội dung phiếu. Trường B báo "cũng gặp" trên phiếu nội bộ của trường A vẫn
 * không xem được phiếu đó, cho tới khi đầu mối phân hệ chuyển sang SYSTEM_WIDE.
 */
export async function markMeToo(input: {
  ticketId: string;
  campusId: string;
  userId: string;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  try {
    await updateDoc(doc(db, TICKET_COL.tickets, input.ticketId), {
      affectedCampusIds: arrayUnion(input.campusId),
      watcherUids: arrayUnion(input.userId),
      updatedAt: Date.now(),
    });
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Toàn bộ phiếu của mọi trường — dành cho admin và nhân sự PTUD.
 *
 * Truy vấn này KHÔNG mang ràng buộc campus, nên nó chỉ chạy được với tài khoản
 * mà firestore.rules cho đọc mọi phiếu (isAdmin hoặc isPtudStaff). Với tài
 * khoản tại trường, Firestore từ chối nguyên khối — đó là hành vi đúng, không
 * phải lỗi cần bắt riêng.
 */
export async function fetchAllTickets(
  opts: { limit?: number; status?: TicketStatus[] } = {}
): Promise<{ tickets: Ticket[]; error: RepoError | null }> {
  try {
    const clauses = [orderBy('createdAt', 'desc'), fsLimit(opts.limit ?? 100)];
    const q =
      opts.status && opts.status.length > 0
        ? query(collection(db, TICKET_COL.tickets), where('status', 'in', opts.status), ...clauses)
        : query(collection(db, TICKET_COL.tickets), ...clauses);
    const snap = await getDocs(q);
    return {
      tickets: snap.docs.map((d) => (normalizeTicket(d.id, d.data()))),
      error: null,
    };
  } catch (error) {
    return { tickets: [], error: classifyError(error) };
  }
}

/**
 * Danh sách field mà TRƯỜNG được phép sửa khi phiếu còn chờ tiếp nhận.
 *
 * Khai ở đây và lặp lại y hệt trong firestore.rules. Hai nơi phải khớp nhau:
 * repository quyết định gửi gì, rules quyết định nhận gì. Lệch nhau thì hoặc
 * người dùng bị permission-denied không rõ lý do, hoặc rules để lọt field không
 * được phép sửa.
 */
export const CAMPUS_EDITABLE_FIELDS = [
  'title', 'description', 'stepsToReproduce', 'expectedResult', 'actualResult',
  'impactScale', 'hasWorkaround', 'affectedUserRef', 'errorCode',
  'contactName', 'contactEmail', 'attachments',
  // Ba field dẫn xuất từ title/description, buộc phải đi kèm khi sửa nội dung.
  'normalizedTitle', 'titleTokens', 'bodyTokens',
  'updatedAt',
] as const;

/** Chỉ còn sửa được khi phiếu CHƯA được tiếp nhận. */
export function canCampusEdit(ticket: Ticket): boolean {
  return ticket.status === 'TRIAGE' || ticket.status === 'NEEDS_INFO';
}

export interface EditTicketInput {
  title?: string;
  description?: string;
  stepsToReproduce?: string;
  expectedResult?: string;
  actualResult?: string;
  impactScale?: Ticket['impactScale'];
  hasWorkaround?: boolean;
  affectedUserRef?: string;
  errorCode?: string;
  contactName?: string;
  contactEmail?: string;
  attachments?: Ticket['attachments'];
}

/**
 * Trường sửa nội dung phiếu của mình khi còn chờ tiếp nhận.
 *
 * Ghi vào HAI document trong một batch:
 *   support_tickets/{id}        — nội dung đầy đủ
 *   support_ticket_index/{id}   — bản gương, phải đồng bộ token quét trùng
 *
 * Nếu chỉ ghi cái đầu, người dùng sửa tiêu đề xong thì quét trùng vẫn so khớp
 * theo tiêu đề CŨ — phiếu trùng thật sẽ không còn được phát hiện.
 */
export async function updateTicketContent(
  ticket: Ticket,
  patch: EditTicketInput
): Promise<{ ok: boolean; error: RepoError | null }> {
  if (!canCampusEdit(ticket)) {
    throw new DomainError(
      'TICKET_LOCKED',
      'Phiếu đã được tiếp nhận nên không sửa được nữa. Gửi thêm thông tin qua đầu mối xử lý.',
      { status: ticket.status }
    );
  }

  const title = (patch.title ?? ticket.title).trim();
  if (title.length < 10) {
    throw new DomainError('TICKET_TITLE_TOO_SHORT', 'Tiêu đề cần ít nhất 10 ký tự');
  }

  const description = patch.description ?? ticket.description;
  const dedup = buildDedupFields(title, description);
  const now = Date.now();

  const ticketPatch: Record<string, unknown> = { ...patch, title, description, ...dedup, updatedAt: now };

  // Trường bổ sung xong thì phiếu quay lại hàng đợi để đầu mối xem lại, và đồng
  // hồ SLA chạy tiếp. Không làm bước này thì NEEDS_INFO là ngõ cụt: trường sửa
  // xong, phiếu nằm im, và không ai biết đã có thông tin mới.
  if (ticket.status === 'NEEDS_INFO') {
    ticketPatch.status = 'TRIAGE';
    ticketPatch.slaLastResumedAt = now;
    ticketPatch.needsInfoRequest = '';
  }
  // Bỏ key undefined: Firestore từ chối giá trị undefined, và một field không
  // sửa thì không nên xuất hiện trong affectedKeys mà rules kiểm.
  Object.keys(ticketPatch).forEach((k) => ticketPatch[k] === undefined && delete ticketPatch[k]);

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, TICKET_COL.tickets, ticket.id), ticketPatch);
    batch.update(doc(db, TICKET_COL.ticketIndex, ticket.id), {
      ...dedup,
      title,
      ...(ticket.status === 'NEEDS_INFO' ? { status: 'TRIAGE' } : {}),
    });
    // Khép vòng: người đã hỏi phải biết câu trả lời đã tới. Thiếu bước này thì
    // phiếu lặng lẽ quay về hàng đợi và người hỏi chỉ tình cờ thấy khi mở lại
    // danh sách — chính là kiểu chờ mơ hồ mà module này sinh ra để xoá bỏ.
    if (ticket.status === 'NEEDS_INFO' && ticket.needsInfoBy) {
      queueTicketNotice(batch, {
        ticket,
        targets: [ticket.needsInfoBy],
        message: `Trường đã bổ sung thông tin cho yêu cầu ${ticket.ticketNo}. Phiếu quay lại hàng đợi chờ tiếp nhận.`,
      });
    }
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Xoá phiếu khi CHƯA được tiếp nhận.
 *
 * Xoá hẳn chứ không đánh dấu đã huỷ: phiếu chưa ai đọc thì không có gì để lưu
 * vết, và một danh sách đầy phiếu "đã huỷ" làm người dùng khó tìm phiếu thật.
 * Từ lúc ACCEPTED trở đi thì ngược lại — đã có người đọc và bắt đầu làm, xoá
 * lúc đó là xoá mất việc của người khác, nên rules chặn cứng.
 *
 * KHÔNG xoá bản khoá mã phiếu (support_ticket_numbers). Mã đã cấp là mã đã
 * chết: trường có thể đã nhắn mã đó cho ai đó qua Zalo, cấp lại cho phiếu khác
 * là hai phiếu khác nhau cùng một mã.
 *
 * Ảnh đính kèm nằm lại trong Storage. Rules Storage cấm xoá có chủ đích để
 * không ai xoá được bằng chứng; file mồ côi nằm trong bucket private, không có
 * phiếu thì không đường nào tới được.
 */
export async function deleteTicket(input: {
  ticket: Ticket;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  if (!canCampusEdit(input.ticket)) {
    throw new DomainError(
      'TICKET_LOCKED',
      'Phiếu đã được tiếp nhận nên không xoá được nữa. Liên hệ đầu mối xử lý nếu cần dừng việc này.',
      { status: input.ticket.status }
    );
  }
  try {
    const batch = writeBatch(db);
    batch.delete(doc(db, TICKET_COL.tickets, input.ticket.id));
    batch.delete(doc(db, TICKET_COL.ticketIndex, input.ticket.id));
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

// ===========================================================================
// TIẾP NHẬN PHIẾU -> SINH TASK
// ===========================================================================

export interface AcceptTicketInput {
  ticket: Ticket;
  projectId: string;
  priority: TicketPriority;
  assigneeUserId: string;
  /**
   * Hạn chốt, hoặc null khi đầu mối tiếp nhận mà chưa xác định được hạn.
   *
   * null KHÔNG phải "quên điền": nhiều phiếu phải họp hoặc phải chờ phân hệ khác
   * mới biết bao giờ xong. Ép chọn đại một ngày ở bước tiếp nhận thì cả báo cáo
   * quá hạn về sau chạy trên một con số bịa. Đi cùng null là estimateDays.
   */
  dueAt: number | null;
  /**
   * Số ngày làm việc dự kiến. BẮT BUỘC khi dueAt = null.
   *
   * Ghi vào estimatedDuration của task. Hạn thật hình thành bên module Công việc
   * lúc người xử lý chọn ngày bắt đầu: ngày bắt đầu + số ngày này.
   */
  estimateDays?: number;
  actorUid: string;
  /** Ghi chú của đầu mối, đưa vào phần mô tả của task. */
  note?: string;
  /** Người cần nắm thông tin, không phải người xử lý. */
  ccUserIds?: string[];
}

/**
 * Đầu mối tiếp nhận phiếu: đặt hạn, giao người xử lý, và SINH TASK trong module
 * Công việc.
 *
 * Ghi vào BA document trong một batch:
 *   projects/{projectId}/tasks/{taskId}  — task mới cho người xử lý
 *   support_tickets/{id}                 — trạng thái ACCEPTED + link tới task
 *   support_ticket_index/{id}            — bản gương đồng bộ trạng thái
 *
 * Ba lượt ghi này phải cùng thành công. Nếu task tạo được mà ticket không cập
 * nhật, ta có một task mồ côi không ai biết nó thuộc phiếu nào; ngược lại thì
 * phiếu báo đã tiếp nhận nhưng người xử lý không thấy việc.
 *
 * KHÔNG sao chép tiến độ sang phiếu. Màn chi tiết đọc thẳng task để lấy tiến độ
 * (xem fetchLinkedTask). Sao chép thì phải đồng bộ hai chiều, và mọi lỗi đồng bộ
 * đều biểu hiện thành "campus thấy tiến độ sai" mà không ai phát hiện.
 */
export async function acceptTicket(
  input: AcceptTicketInput
): Promise<{ ok: boolean; taskId: string | null; error: RepoError | null }> {
  const { ticket, projectId, priority, assigneeUserId, dueAt, actorUid, note } = input;
  // Số ngày dự kiến chỉ có nghĩa khi chưa chốt được hạn. Có hạn rồi mà vẫn ghi
  // estimatedDuration thì màn chi tiết công việc tự tính lại hạn = ngày bắt đầu
  // + số ngày, và đè mất cái hạn hai bên vừa thống nhất.
  const estimateDays = dueAt === null ? Math.max(1, Math.round(input.estimateDays ?? 0)) : 0;

  if (dueAt === null && !input.estimateDays) {
    throw new DomainError(
      'ESTIMATE_DAYS_REQUIRED',
      'Chưa xác định hạn thì phải cho biết số ngày dự kiến hoàn thành.'
    );
  }

  if (ticket.status !== 'TRIAGE' && ticket.status !== 'NEEDS_INFO') {
    throw new DomainError(
      'TICKET_NOT_TRIAGEABLE',
      'Phiếu này đã được tiếp nhận hoặc đã đóng.',
      { status: ticket.status }
    );
  }
  if (!projectId) {
    throw new DomainError(
      'MODULE_PROJECT_MISSING',
      'Phân hệ này chưa được gán vào dự án nào. Vào Hỗ trợ > Phân hệ để gán trước.',
      { moduleId: ticket.moduleId }
    );
  }
  if (!assigneeUserId) {
    throw new DomainError('ASSIGNEE_REQUIRED', 'Chưa chọn người xử lý');
  }

  const now = Date.now();
  const taskRef = doc(collection(db, `projects/${projectId}/tasks`));

  // Ánh xạ độ ưu tiên phiếu (P1..P4) sang thang của module Công việc.
  const taskPriority =
    priority === 'P1' ? 'critical' : priority === 'P2' ? 'high' : priority === 'P3' ? 'medium' : 'low';

  const description = [
    `Phiếu hỗ trợ ${ticket.ticketNo} — ${ticket.campusId}`,
    '',
    ticket.description,
    ticket.stepsToReproduce && `\nCác bước tái hiện:\n${ticket.stepsToReproduce}`,
    ticket.contactEmail && `\nĐầu mối tại trường: ${ticket.contactName} <${ticket.contactEmail}>`,
    note && `\nGhi chú tiếp nhận: ${note}`,
  ].filter(Boolean).join('\n');

  try {
    // Transaction chứ không phải batch.
    //
    // Điều kiện "phiếu đang chờ tiếp nhận" ở trên kiểm trên bản phiếu mà máy
    // người dùng đang giữ, và hàng đợi tiếp nhận chỉ nạp một lần lúc mở màn.
    // Đầu mối phân hệ, người dự phòng và quản lý dự án đều nhận thông báo cùng
    // một phiếu mới, nên hai người mở hai danh sách cũ và cùng bấm tiếp nhận là
    // chuyện bình thường. Không kiểm lại ở phía máy chủ thì sinh ra HAI công
    // việc cho một phiếu, phiếu chỉ nhớ được cái sau, còn cái trước vẫn mang
    // supportTicketId nên tiến độ của nó vẫn kéo trạng thái phiếu đi.
    return await runTransaction(db, async (tx) => {
      const moi = await tx.get(doc(db, TICKET_COL.tickets, ticket.id));
      const trangThai = String(moi.data()?.status ?? '');
      if (trangThai !== 'TRIAGE' && trangThai !== 'NEEDS_INFO') {
        throw new DomainError(
          'TICKET_ALREADY_TAKEN',
          'Phiếu này vừa được người khác tiếp nhận. Tải lại danh sách để xem trạng thái mới.',
          { status: trangThai }
        );
      }

    tx.set(taskRef, {
      id: taskRef.id,
      projectId,
      title: `[${ticket.ticketNo}] ${ticket.title}`,
      description,
      category: ticket.type === 'BUG' ? 'Sửa lỗi' : 'Tính năng mới',
      priority: taskPriority,
      // 'todo' chứ không phải 'pending': phiếu đã được đầu mối duyệt rồi, không
      // cần thêm một vòng duyệt nữa ở module Công việc.
      status: 'todo',
      progress: 0,
      // Chưa chốt hạn thì để RỖNG, không bịa một ngày.
      //
      // Module Công việc coi date rỗng là "chưa có hạn": không tô đỏ, không tính
      // quá hạn. Còn estimatedDuration là thứ biến nó thành hạn thật — người xử
      // lý chọn ngày bắt đầu, màn chi tiết tự cộng ra hạn.
      date: dueAt === null ? '' : new Date(dueAt).toISOString().slice(0, 10),
      startDate: '',
      estimatedDuration: estimateDays,
      estimatedDeadline: '',
      assignees: [assigneeUserId],
      // Đầu mối tiếp nhận là người nghiệm thu — họ biết phiếu gốc yêu cầu gì.
      reviewers: [actorUid],
      // CC: người cần nắm thông tin nhưng không xử lý. Module Công việc đã có
      // sẵn khái niệm này và gửi thông báo cho họ khi trạng thái đổi.
      cc: (input.ccUserIds ?? []).filter((u) => u !== assigneeUserId && u !== actorUid),
      tags: ['ho-tro', ticket.moduleId, ticket.campusId],
      // Đường tra NGƯỢC từ task về phiếu. Phiếu vốn đã có linkedTaskId, nhưng
      // đồng bộ trạng thái xuất phát từ phía task nên phải đi được chiều này.
      supportTicketId: ticket.id,
      supportTicketNo: ticket.ticketNo,
      attachedImages: [],
      subtasks: [],
      comments: [],
      createdAt: serverTimestamp(),
    });

    tx.update(doc(db, TICKET_COL.tickets, ticket.id), {
      status: 'ACCEPTED',
      priority,
      assigneeUserId,
      dueAt,
      // Ghi cả khi có hạn (bằng 0): field luôn tồn tại thì màn hiển thị không
      // phải phân biệt "chưa xác định" với "phiếu cũ chưa có field".
      estimateDays,
      triagedBy: actorUid,
      triagedAt: now,
      linkedProjectId: projectId,
      linkedTaskId: taskRef.id,
      updatedAt: now,
    });

    tx.update(doc(db, TICKET_COL.ticketIndex, ticket.id), { status: 'ACCEPTED' });

    const baoCho = (uid: string, message: string) => tx.set(doc(collection(db, 'notifications')), {
      targetUserId: uid, message, ticketId: ticket.id, ticketNo: ticket.ticketNo,
      read: false, time: Timestamp.now(),
    });
    for (const uid of new Set(
      [ticket.reporterUserId, ticket.campusContactUserId ?? ''].filter(Boolean)
    )) {
      baoCho(
        uid,
        dueAt === null
          // Nói thẳng là chưa có hạn kèm ước lượng, thay vì im lặng bỏ câu hạn.
          // Trường đọc thông báo không thấy hạn sẽ hiểu là hệ thống lỗi, rồi gọi
          // điện hỏi lại đúng thứ mà thông báo đáng lẽ phải nói.
          ? `Yêu cầu ${ticket.ticketNo} đã được tiếp nhận. Hạn hoàn thành chưa chốt, dự kiến ${estimateDays} ngày làm việc kể từ khi bắt đầu xử lý.`
          : `Yêu cầu ${ticket.ticketNo} đã được tiếp nhận và đang được xử lý. Hạn dự kiến ${new Date(dueAt).toLocaleDateString('vi-VN')}.`
      );
    }

    // Báo cho NGƯỜI XỬ LÝ và những người được CC rằng có công việc mới.
    //
    // Thông báo này mang taskId chứ không phải ticketId, nên nó rơi vào ô đếm
    // của mục "Công việc" trên thanh điều hướng — đúng chỗ người ta sẽ mở ra
    // làm. Thiếu nó thì tiếp nhận xong task xuất hiện im lặng, không có dấu
    // hiệu nào trên menu, và người được giao chỉ biết nếu tự đi mở danh sách.
    //
    // Có báo cho cả chính người vừa tiếp nhận nếu họ tự nhận việc: con số biến
    // mất ngay khi họ mở mục Công việc, còn nếu bỏ qua thì trường hợp tự nhận
    // việc — trường hợp phổ biến nhất — lại không có tín hiệu gì.
    const nhanViec = [...new Set([assigneeUserId, ...(input.ccUserIds ?? [])])].filter(Boolean);
    for (const uid of nhanViec) {
      tx.set(doc(collection(db, 'notifications')), {
        targetUserId: uid,
        message: uid === assigneeUserId
          ? `Công việc mới: [${ticket.ticketNo}] ${ticket.title}`
          : `Bạn được CC công việc: [${ticket.ticketNo}] ${ticket.title}`,
        taskId: taskRef.id,
        projectId,
        read: false,
        time: Timestamp.now(),
      });
    }

      return { ok: true, taskId: taskRef.id, error: null };
    });
  } catch (error) {
    // DomainError ném ra từ TRONG transaction phải đi tiếp nguyên vẹn: nó mang
    // câu tiếng Việt viết sẵn cho người dùng ("phiếu vừa được người khác tiếp
    // nhận"). Nuốt vào classifyError sẽ biến nó thành một mã lỗi vô nghĩa.
    if (error instanceof DomainError) throw error;
    return { ok: false, taskId: null, error: classifyError(error) };
  }
}

/**
 * Đọc task đã gắn với phiếu, để hiện tiến độ cho người tạo yêu cầu.
 *
 * Đọc trực tiếp thay vì sao chép tiến độ sang phiếu: task là nguồn sự thật duy
 * nhất, nên không bao giờ có chuyện campus nhìn thấy con số cũ.
 */
export async function fetchLinkedTask(
  ticket: Ticket
): Promise<{ task: LinkedTask | null; error: RepoError | null }> {
  if (!ticket.linkedProjectId || !ticket.linkedTaskId) return { task: null, error: null };
  try {
    const snap = await getDoc(
      doc(db, `projects/${ticket.linkedProjectId}/tasks`, ticket.linkedTaskId)
    );
    if (!snap.exists()) return { task: null, error: null };
    const d = snap.data() as Record<string, unknown>;
    return {
      task: {
        id: snap.id,
        title: String(d.title ?? ''),
        status: String(d.status ?? ''),
        progress: Number(d.progress ?? 0),
        date: String(d.date ?? ''),
        assignees: (d.assignees as string[]) ?? [],
      },
      error: null,
    };
  } catch (error) {
    return { task: null, error: classifyError(error) };
  }
}

export interface LinkedTask {
  id: string;
  title: string;
  status: string;
  progress: number;
  date: string;
  assignees: string[];
}

/** Phiếu chờ tiếp nhận của các phân hệ mà người dùng phụ trách. */
export async function fetchTriageQueueForModules(
  moduleIds: SupportModuleCode[]
): Promise<{ tickets: Ticket[]; error: RepoError | null }> {
  if (moduleIds.length === 0) return { tickets: [], error: null };
  try {
    const snap = await getDocs(
      query(
        collection(db, TICKET_COL.tickets),
        where('moduleId', 'in', moduleIds.slice(0, 10)),
        where('status', 'in', ['TRIAGE', 'NEEDS_INFO']),
        fsLimit(100)
      )
    );
    const tickets = snap.docs
      .map((d) => (normalizeTicket(d.id, d.data())))
      // Sắp xếp ở client: thêm orderBy vào truy vấn đã có hai mệnh đề `in` sẽ
      // đẩy số disjunction sau khai triển DNF lên rất nhanh và cần index riêng.
      .sort((a, b) => a.createdAt - b.createdAt);
    return { tickets, error: null };
  } catch (error) {
    return { tickets: [], error: classifyError(error) };
  }
}

/**
 * Từ chối phiếu. §5: REJECTED là trạng thái KẾT THÚC và bắt buộc có lý do.
 *
 * Ghi hai document trong một batch: phiếu và bản gương.
 * Lý do là BẮT BUỘC ở tầng này, không chỉ ở giao diện — một phiếu bị từ chối
 * không kèm lý do là thứ campus không có cách nào phản hồi lại, và họ sẽ quay
 * về nhắn Zalo đúng như trước khi có hệ thống này.
 */
/**
 * Báo cho người tạo yêu cầu biết phiếu của họ vừa có chuyển động.
 *
 * Ghi thẳng vào collection `notifications` mà chuông ở đầu trang đang lắng nghe
 * sẵn, thay vì dựng cơ chế riêng cho module hỗ trợ: cán bộ trường và cán bộ
 * PTUD dùng chung một cái chuông, thêm cơ chế thứ hai nghĩa là có người phải
 * nhớ nhìn hai chỗ.
 *
 * Nằm TRONG batch cùng lệnh đổi trạng thái. Nếu tách ra ngoài, một lỗi mạng
 * giữa chừng sẽ tạo ra phiếu đã đổi trạng thái mà người tạo không hề biết —
 * đúng cái tình trạng mà tính năng này sinh ra để xoá bỏ.
 */
function queueTicketNotice(
  batch: ReturnType<typeof writeBatch>,
  input: { ticket: Ticket; message: string; targets?: string[] }
) {
  const targets = new Set(
    (input.targets ?? [input.ticket.reporterUserId, input.ticket.campusContactUserId ?? ''])
      .filter(Boolean)
  );
  for (const uid of targets) {
    batch.set(doc(collection(db, 'notifications')), {
      targetUserId: uid,
      message: input.message,
      // Để chuông và màn danh sách chỉ đúng phiếu cần mở.
      ticketId: input.ticket.id,
      ticketNo: input.ticket.ticketNo,
      read: false,
      time: Timestamp.now(),
    });
  }
}

export async function rejectTicket(input: {
  ticket: Ticket;
  reason: string;
  actorUid: string;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new DomainError(
      'REJECT_REASON_REQUIRED',
      'Cần nêu lý do từ chối, ít nhất 10 ký tự. Trường sẽ đọc được lý do này.',
      { length: reason.length }
    );
  }
  if (input.ticket.status !== 'TRIAGE' && input.ticket.status !== 'NEEDS_INFO') {
    throw new DomainError(
      'TICKET_NOT_TRIAGEABLE',
      'Phiếu này đã được tiếp nhận hoặc đã đóng, không từ chối được nữa.',
      { status: input.ticket.status }
    );
  }

  const now = Date.now();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, TICKET_COL.tickets, input.ticket.id), {
      status: 'REJECTED',
      rejectionReason: reason,
      triagedBy: input.actorUid,
      triagedAt: now,
      closedAt: now,
      updatedAt: now,
    });
    batch.update(doc(db, TICKET_COL.ticketIndex, input.ticket.id), { status: 'REJECTED' });
    queueTicketNotice(batch, {
      ticket: input.ticket,
      message: `Yêu cầu ${input.ticket.ticketNo} đã bị từ chối. Lý do: ${reason}`,
    });
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Yêu cầu trường bổ sung thông tin.
 *
 * KHÔNG phải từ chối: phiếu vẫn sống, và §7 quy định đồng hồ SLA TẠM DỪNG ở
 * trạng thái này — thời gian chờ trường trả lời không tính vào hạn của đội xử lý.
 *
 * Đây cũng là trạng thái duy nhất ngoài TRIAGE mà trường còn sửa được nội dung
 * phiếu (xem canCampusEdit) — đúng nghĩa "chúng tôi cần bạn bổ sung".
 */
/**
 * Đầu mối báo đã xử lý xong.
 *
 * Dừng ở RESOLVED chứ KHÔNG đóng luôn: người sửa lỗi không phải người biết lỗi
 * đã hết hay chưa. Trường xác nhận thì mới CLOSED, không được thì mở lại. Đóng
 * thẳng là cách chắc chắn nhất để một lỗi chưa hết bị coi là đã xong.
 */
export async function resolveTicket(input: {
  ticket: Ticket;
  actorUid: string;
  note?: string;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  if (!['ACCEPTED', 'IN_PROGRESS', 'REOPENED', 'ON_HOLD'].includes(input.ticket.status)) {
    throw new DomainError(
      'TICKET_NOT_RESOLVABLE',
      'Chỉ đánh dấu xử lý xong khi phiếu đã được tiếp nhận.',
      { status: input.ticket.status }
    );
  }
  const now = Date.now();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, TICKET_COL.tickets, input.ticket.id), {
      status: 'RESOLVED',
      resolvedAt: now,
      // Dừng đồng hồ SLA: từ đây là thời gian chờ trường xác nhận.
      slaLastResumedAt: null,
      slaElapsedWorkingMs: dungDongHo(input.ticket, now),
      updatedAt: now,
    });
    batch.update(doc(db, TICKET_COL.ticketIndex, input.ticket.id), { status: 'RESOLVED' });
    queueTicketNotice(batch, {
      ticket: input.ticket,
      message: `Yêu cầu ${input.ticket.ticketNo} đã được xử lý xong.`
        + (input.note ? ` ${input.note}` : '')
        + ' Vào phiếu xác nhận giúp đội kỹ thuật.',
    });
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Trường xác nhận đã hết lỗi -> đóng phiếu.
 */
export async function confirmTicketClosed(input: {
  ticket: Ticket;
  actorUid: string;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  if (input.ticket.status !== 'RESOLVED') {
    throw new DomainError('TICKET_NOT_CLOSABLE', 'Chỉ đóng được phiếu đã báo xử lý xong.');
  }
  const now = Date.now();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, TICKET_COL.tickets, input.ticket.id), {
      status: 'CLOSED', closedAt: now, updatedAt: now,
    });
    batch.update(doc(db, TICKET_COL.ticketIndex, input.ticket.id), { status: 'CLOSED' });
    // Báo NGƯỢC cho phía kỹ thuật: họ cần biết việc đã được nghiệm thu.
    queueTicketNotice(batch, {
      ticket: input.ticket,
      targets: [input.ticket.assigneeUserId ?? '', input.ticket.triagedBy ?? ''].filter(Boolean),
      message: `Trường đã xác nhận yêu cầu ${input.ticket.ticketNo} hết lỗi. Phiếu đã đóng.`,
    });
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Trường báo vẫn còn lỗi -> mở lại phiếu.
 *
 * Đếm số lần mở lại: một phiếu bị mở lại nhiều lần là dấu hiệu chẩn đoán sai,
 * không phải người báo khó tính.
 */
export async function reopenTicket(input: {
  ticket: Ticket;
  actorUid: string;
  reason: string;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  const reason = input.reason.trim();
  if (reason.length < 10) {
    throw new DomainError(
      'REOPEN_REASON_REQUIRED',
      'Cần nói rõ còn lỗi ở đâu, ít nhất 10 ký tự. Đội kỹ thuật sẽ đọc phần này.'
    );
  }
  if (input.ticket.status !== 'RESOLVED') {
    throw new DomainError('TICKET_NOT_REOPENABLE', 'Chỉ mở lại được phiếu đã báo xử lý xong.');
  }
  const now = Date.now();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, TICKET_COL.tickets, input.ticket.id), {
      status: 'REOPENED',
      reopenCount: (input.ticket.reopenCount ?? 0) + 1,
      needsInfoRequest: reason,
      resolvedAt: null,
      slaLastResumedAt: now,
      updatedAt: now,
    });
    batch.update(doc(db, TICKET_COL.ticketIndex, input.ticket.id), { status: 'REOPENED' });
    queueTicketNotice(batch, {
      ticket: input.ticket,
      targets: [input.ticket.assigneeUserId ?? '', input.ticket.triagedBy ?? ''].filter(Boolean),
      message: `Trường báo yêu cầu ${input.ticket.ticketNo} VẪN CÒN LỖI: ${reason}`,
    });
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}

/**
 * Đưa trạng thái phiếu chạy theo công việc đã sinh ra từ nó.
 *
 * Ánh xạ, theo đúng cách người vận hành nói:
 *   tiến độ > 0        -> ĐANG XỬ LÝ
 *   tiến độ 100%       -> ĐÃ KHẮC PHỤC   (chờ nghiệm thu)
 *   task status 'done' -> HOÀN TẤT       (đã nghiệm thu xong)
 *
 * CHỈ ĐI TỚI, không lùi. Không có ràng buộc này thì mỗi lần ai đó sửa vặt một
 * task đã xong, phiếu lại tụt về "đang xử lý" và campus nhận một thông báo sai.
 *
 * Bỏ qua phiếu đang MỞ LẠI ở mức 100%: trường vừa nói "vẫn còn lỗi", đẩy nó về
 * "đã khắc phục" ngay là phủ nhận điều họ vừa nói. Chỉ khi tiến độ tụt xuống
 * dưới 100 — tức người xử lý thật sự làm lại — thì mới chạy tiếp.
 *
 * Chạy theo kiểu BEST-EFFORT: mọi lỗi đều nuốt. Đây là việc phụ chạy kèm sau
 * khi cập nhật task; hỏng ở đây KHÔNG được làm hỏng thao tác chính của người
 * dùng, và cũng không được ném lỗi ra màn hình công việc.
 */
/**
 * Số giờ làm việc đã trôi qua, tính tới lúc DỪNG đồng hồ.
 *
 * Trước đây mọi chỗ dừng đồng hồ chỉ ghi `slaLastResumedAt: null` rồi chép lại
 * nguyên `slaElapsedWorkingMs` cũ — tức là quãng thời gian vừa chạy bị XOÁ SẠCH.
 * Field đó được ghi 0 lúc tạo phiếu và ở nguyên 0 mãi mãi. pauseClock() sinh ra
 * để làm đúng việc này thì lại chỉ được gọi trong test.
 *
 * Hậu quả: một phiếu chạy 3 giờ rồi bị hỏi thêm thông tin, sau đó được tính lại
 * hạn như thể chưa tốn phút nào — hạn lùi ra thêm nguyên một ngân sách SLA, và
 * cảnh báo quá hạn không bao giờ bắn đúng lúc.
 */
function dungDongHo(ticket: Ticket, now: number): number {
  return pauseClock(
    {
      startedAt: ticket.slaStartedAt ?? now,
      elapsedWorkingMs: ticket.slaElapsedWorkingMs ?? 0,
      lastResumedAt: ticket.slaLastResumedAt ?? null,
    },
    now,
    // Lịch THẬT đã tải, không phải hằng số holidays rỗng — nếu không thì quãng
    // nghỉ Tết bị tính là giờ làm việc và phiếu nào cũng thành quá hạn.
    currentCalendar()
  ).elapsedWorkingMs;
}

const THU_TU: Record<string, number> = {
  TRIAGE: 0, NEEDS_INFO: 0,
  ACCEPTED: 1,
  IN_PROGRESS: 2, REOPENED: 2,
  RESOLVED: 3, CLOSED: 4,
};

/**
 * Trạng thái phiếu suy từ công việc. Hàm THUẦN, tách ra để test được.
 *
 * Trả null nghĩa là không đổi gì.
 */
export function ticketStatusFromTask(
  taskStatus: string,
  progress: number,
  current: TicketStatus
): TicketStatus | null {
  let target: TicketStatus | null = null;
  if (taskStatus === 'done') target = 'CLOSED';
  else if (progress >= 100) target = 'RESOLVED';
  else if (progress > 0) target = 'IN_PROGRESS';
  if (!target) return null;

  // Trường vừa nói "vẫn còn lỗi" mà công việc vẫn đứng ở 100% -> chưa ai làm
  // lại gì cả. Đẩy về "đã khắc phục" ngay là phủ nhận điều họ vừa nói.
  //
  // KHÔNG có ngoại lệ cho taskStatus === 'done'. Đường đi từng lọt qua đây:
  // trường bấm "vẫn còn lỗi", nhưng công việc vẫn nằm ở 100% chờ nghiệm thu;
  // người nghiệm thu duyệt công việc cũ đó, phiếu nhảy thẳng sang HOÀN TẤT và
  // trường nhận đúng câu "đã hoàn tất và được nghiệm thu" ngay sau khi họ vừa
  // báo là chưa xong. Tệ hơn: HOÀN TẤT là trạng thái cuối, reopenTicket và
  // rules đều đòi RESOLVED, nên phiếu đó không mở lại được nữa.
  //
  // Muốn phiếu chạy tiếp thì phải có người LÀM LẠI THẬT — tiến độ tụt xuống
  // dưới 100 rồi lên lại. Hoặc đầu mối bấm tay "Đã xử lý xong" (resolveTicket
  // nhận cả trạng thái mở lại), tức là có người chịu trách nhiệm nói đã sửa.
  if (current === 'REOPENED' && progress >= 100) return null;

  // Phiếu bị từ chối hoặc đánh dấu trùng thì công việc không kéo nó sống lại.
  if (current === 'REJECTED' || current === 'DUPLICATE') return null;

  // CHỈ ĐI TỚI. Không có ràng buộc này thì mỗi lần ai đó sửa vặt một task đã
  // xong, phiếu lại tụt về "đang xử lý" và trường nhận một thông báo sai.
  if ((THU_TU[target] ?? 0) <= (THU_TU[current] ?? 0)) return null;
  return target;
}

/**
 * Hạn của task ('yyyy-mm-dd') đổi sang mốc hạn của phiếu.
 *
 * 17:00 giờ VN của ngày đó — cuối giờ làm việc, đúng nghĩa "hạn trong ngày", và
 * đúng công thức màn tiếp nhận dùng khi đầu mối tự chọn ngày. Hai chỗ lệch nhau
 * thì mỗi lượt đồng bộ lại ghi đè hạn bằng một mốc chênh vài tiếng.
 */
function hanTuNgayTask(raw: unknown): number | null {
  const ngay = String(raw ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return null;
  const ms = Date.parse(`${ngay}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms + 17 * 3600_000 - 7 * 3600_000;
}

/**
 * Task nào đang có một lượt đồng bộ chạy dở.
 *
 * Thanh kéo tiến độ trong module Công việc là <input type="range"> ghi thẳng
 * theo từng sự kiện onChange — kéo một lần là hàng chục lượt ghi. Nếu mỗi lượt
 * sinh một lượt đồng bộ thì hàng chục lượt cùng đọc phiếu ở trạng thái cũ,
 * cùng kết luận "đang xử lý" và cùng gửi thông báo. Trường nhận một tràng
 * thông báo giống hệt nhau cho đúng một cú kéo chuột.
 *
 * Bỏ qua lượt mới khi còn lượt cũ đang chạy, và chạy lại đúng MỘT lần ở cuối
 * để không mất giá trị sau cùng.
 */
const dangDongBo = new Map<string, boolean>();

export async function syncTicketFromTask(
  projectId: string,
  taskId: string
): Promise<{ changed: boolean; to?: TicketStatus }> {
  const khoa = `${projectId}/${taskId}`;
  if (dangDongBo.has(khoa)) {
    // Đánh dấu "có việc tới sau" để lượt đang chạy tự chạy lại một lần nữa.
    dangDongBo.set(khoa, true);
    return { changed: false };
  }
  dangDongBo.set(khoa, false);
  try {
    return await dongBoMotLuot(projectId, taskId);
  } finally {
    const conViec = dangDongBo.get(khoa);
    dangDongBo.delete(khoa);
    if (conViec) await syncTicketFromTask(projectId, taskId);
  }
}

async function dongBoMotLuot(
  projectId: string,
  taskId: string
): Promise<{ changed: boolean; to?: TicketStatus }> {
  try {
    const taskSnap = await getDoc(doc(db, `projects/${projectId}/tasks`, taskId));
    if (!taskSnap.exists()) return { changed: false };
    const task = taskSnap.data() as Record<string, unknown>;

    // Task tạo trước khi có field này thì tra ngược bằng linkedTaskId.
    let ticketId = task.supportTicketId ? String(task.supportTicketId) : '';
    if (!ticketId) {
      if (!(task.tags as string[] | undefined)?.includes('ho-tro')) return { changed: false };
      const q = query(
        collection(db, TICKET_COL.tickets),
        where('linkedTaskId', '==', taskId),
        fsLimit(1)
      );
      const found = await getDocs(q);
      if (found.empty) return { changed: false };
      ticketId = found.docs[0].id;
    }

    // Đọc phiếu và ghi phiếu phải nằm TRONG cùng một transaction.
    //
    // Trước đây là getDoc rồi writeBatch: hai lượt đồng bộ chạy song song cùng
    // đọc được trạng thái cũ, cùng qua được phép kiểm "chỉ đi tới", rồi lượt
    // ghi sau đè lượt trước bất kể thứ hạng. Phiếu có thể mắc lại ở "đang xử
    // lý" trong khi công việc đã 100% — và màn chi tiết chỉ hiện ô xác nhận
    // khi phiếu ở "đã khắc phục", nên trường không bao giờ được hỏi.
    const ref = doc(db, TICKET_COL.tickets, ticketId);
    return await runTransaction(db, async (tx) => {
      const tSnap = await tx.get(ref);
      if (!tSnap.exists()) return { changed: false };
      const ticket = normalizeTicket(tSnap.id, tSnap.data());

      const target = ticketStatusFromTask(
        String(task.status ?? ''), Number(task.progress ?? 0), ticket.status
      );

      // Hạn của phiếu đi theo hạn của công việc.
      //
      // Phiếu tiếp nhận ở chế độ "chưa xác định" có dueAt = null: hạn thật chỉ
      // hình thành khi người xử lý chọn ngày bắt đầu bên module Công việc, và
      // chỗ đó tự tính hạn = ngày bắt đầu + số ngày dự kiến. Không kéo ngược về
      // đây thì trường mãi mãi nhìn thấy "chưa xác định" trong khi đội kỹ thuật
      // đã chốt ngày từ lâu — và toàn bộ cảnh báo quá hạn im lặng theo.
      //
      // Chạy cả khi trạng thái không đổi: người xử lý sửa hạn mà chưa động vào
      // tiến độ là chuyện thường.
      const hanTask = hanTuNgayTask(task.date);
      const doiHan = hanTask !== null && hanTask !== ticket.dueAt;
      if (!target && !doiHan) return { changed: false };

      const now = Date.now();
      const patch: Record<string, unknown> = { updatedAt: now };
      if (doiHan) patch.dueAt = hanTask;
      if (!target) {
        tx.update(ref, patch);
        return { changed: true };
      }
      patch.status = target;
      if (target === 'RESOLVED' || target === 'CLOSED') {
        patch.slaLastResumedAt = null;
        patch.slaElapsedWorkingMs = dungDongHo(ticket, now);
      }
      if (target === 'RESOLVED') patch.resolvedAt = now;
      if (target === 'CLOSED') patch.closedAt = now;

      tx.update(ref, patch);
      tx.update(doc(db, TICKET_COL.ticketIndex, ticket.id), { status: target });

      const loi: Record<string, string> = {
        IN_PROGRESS: `Yêu cầu ${ticket.ticketNo} đang được xử lý.`,
        RESOLVED: `Yêu cầu ${ticket.ticketNo} đã được khắc phục. Vào phiếu kiểm tra và xác nhận giúp đội kỹ thuật.`,
        CLOSED: `Yêu cầu ${ticket.ticketNo} đã hoàn tất và được nghiệm thu.`,
      };
      // Thông báo nằm TRONG transaction: transaction chạy lại thì thông báo
      // cũng bị bỏ theo, không có chuyện gửi hai lần cho một lần đổi trạng thái.
      for (const uid of new Set(
        [ticket.reporterUserId, ticket.campusContactUserId ?? ''].filter(Boolean)
      )) {
        tx.set(doc(collection(db, 'notifications')), {
          targetUserId: uid,
          message: loi[target],
          ticketId: ticket.id,
          ticketNo: ticket.ticketNo,
          read: false,
          time: Timestamp.now(),
        });
      }
      return { changed: true, to: target };
    });
  } catch {
    return { changed: false };
  }
}

export async function requestMoreInfo(input: {
  ticket: Ticket;
  request: string;
  actorUid: string;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  const request = input.request.trim();
  if (request.length < 10) {
    throw new DomainError(
      'NEEDS_INFO_REQUEST_REQUIRED',
      'Cần nói rõ cần bổ sung thông tin gì, ít nhất 10 ký tự.',
      { length: request.length }
    );
  }
  if (input.ticket.status !== 'TRIAGE') {
    throw new DomainError('TICKET_NOT_TRIAGEABLE', 'Chỉ hỏi thêm được khi phiếu đang chờ tiếp nhận.');
  }

  const now = Date.now();
  try {
    const batch = writeBatch(db);
    batch.update(doc(db, TICKET_COL.tickets, input.ticket.id), {
      status: 'NEEDS_INFO',
      needsInfoRequest: request,
      // Nhớ ai hỏi, để lúc trường trả lời còn biết báo cho đúng người.
      needsInfoBy: input.actorUid,
      // Dừng đồng hồ SLA: thời gian chờ trường trả lời không phải lỗi của đội
      // xử lý. Nhưng quãng vừa chạy phải được CỘNG DỒN lại, không thì nó biến mất.
      slaLastResumedAt: null,
      slaElapsedWorkingMs: dungDongHo(input.ticket, now),
      updatedAt: now,
    });
    batch.update(doc(db, TICKET_COL.ticketIndex, input.ticket.id), { status: 'NEEDS_INFO' });
    // Câu hỏi đưa NGUYÊN VĂN vào thông báo, không phải "phiếu cần bổ sung thông
    // tin". Người đọc phải biết cần bổ sung GÌ ngay tại chuông, nếu không họ mở
    // phiếu ra rồi mới biết, và phần lớn sẽ không mở.
    queueTicketNotice(batch, {
      ticket: input.ticket,
      message: `Yêu cầu ${input.ticket.ticketNo} cần bạn bổ sung thông tin: ${request}`,
    });
    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}
