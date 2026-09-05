import {
  Timestamp,
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import type { UserProfile } from '../../../types';
import {
  COL,
  DomainError,
  MESSAGE_MAX_LENGTH,
  TICKET_COL,
  type SupportRoleAssignment,
  type Ticket,
  type TicketAttachment,
  type TicketMessage,
} from '../types';
import { classifyError, type RepoError } from './campusRepository';

// ===========================================================================
// Trao đổi trên phiếu: support_tickets/{ticketId}/messages
//
// Trước khi có file này, toàn bộ "trao đổi" của hệ thống là MỘT ô chữ duy nhất
// trên phiếu (`needsInfoRequest`). Hỏi câu thứ hai là đè mất câu thứ nhất, và
// câu trả lời của trường không được lưu ở đâu cả — nó nằm trong phần mô tả bị
// sửa đè, hoặc nằm trong Zalo. Nghĩa là mọi cuộc trao đổi thực sự đều diễn ra
// ngoài hệ thống, đúng cái mà hệ thống này sinh ra để thay thế.
//
// Tách thành file riêng thay vì nhét vào ticketRepository: file đó đã hơn 1400
// dòng và đang gánh máy trạng thái, SLA, quét trùng, đồng bộ task. Trao đổi là
// một trục khác hẳn, không dính tới máy trạng thái.
// ===========================================================================

/** Vai trò phía PTUD. Chép từ useSupportRole vì hằng số đó không export. */
const PTUD_SIDE_ROLES = ['MODULE_OWNER', 'DEVELOPER', 'PTUD_MANAGER', 'SYS_ADMIN'];

function messagesRef(ticketId: string) {
  return collection(db, TICKET_COL.tickets, ticketId, TICKET_COL.messages);
}

function toMessage(id: string, d: Record<string, unknown>): TicketMessage {
  return {
    id,
    authorUid: String(d.authorUid ?? ''),
    authorName: String(d.authorName ?? 'Không rõ'),
    authorSide: d.authorSide === 'PTUD' ? 'PTUD' : 'CAMPUS',
    body: String(d.body ?? ''),
    attachments: Array.isArray(d.attachments) ? (d.attachments as TicketAttachment[]) : [],
    isSystem: d.isSystem === true,
    createdAt: Number(d.createdAt ?? 0),
  };
}

/**
 * Lắng nghe cuộc trao đổi của một phiếu, theo thời gian thực.
 *
 * Realtime chứ không phải tải một lần: hai bên thường mở phiếu cùng lúc trong
 * lúc đang gọi điện cho nhau. Bắt người ta F5 để thấy câu trả lời là đủ để họ
 * quay về Zalo.
 */
export function watchTicketMessages(
  ticketId: string,
  onData: (rows: TicketMessage[]) => void,
  onError: (err: RepoError) => void
) {
  const q = query(messagesRef(ticketId), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => toMessage(d.id, d.data()))),
    (error) => onError(classifyError(error))
  );
}

/**
 * Danh tính người đang gõ: tên để hiển thị, và ở phía nào của cuộc trao đổi.
 *
 * Đọc một lần lúc mở phiếu chứ không đọc mỗi lần gửi. Tên được CHÉP vào từng
 * tin nhắn (xem ghi chú ở TicketMessage), nên hàm này chỉ chạy một lượt.
 */
export async function fetchMessageIdentity(uid: string): Promise<{
  name: string;
  side: 'CAMPUS' | 'PTUD';
}> {
  const [userSnap, assignSnap] = await Promise.all([
    getDoc(doc(db, 'users', uid)),
    getDoc(doc(db, COL.roleAssignments, uid)),
  ]);
  const profile = userSnap.exists() ? (userSnap.data() as UserProfile) : null;
  const assignment = assignSnap.exists() ? (assignSnap.data() as SupportRoleAssignment) : null;
  return {
    // Rơi về email rồi mới tới uid: một cuộc trao đổi toàn "Không rõ" thì không
    // ai lần được ai đã nói gì, mà uid thô thì không ai đọc nổi.
    name: profile?.displayName || profile?.email || uid,
    side: assignment && PTUD_SIDE_ROLES.includes(assignment.supportRole) ? 'PTUD' : 'CAMPUS',
  };
}

/**
 * Ai cần biết là có tin mới.
 *
 * Báo cho PHÍA BÊN KIA, không báo cho chính người vừa gõ. Một hệ thống tự bắn
 * thông báo về cho người vừa bấm gửi là thứ người ta tắt chuông sau đúng hai
 * ngày.
 *
 * Phía trường gõ -> báo cho người đang xử lý, người đã tiếp nhận, người vừa hỏi
 * thêm thông tin. Phía PTUD gõ -> báo cho người gửi phiếu và đầu mối tại trường.
 *
 * Cố ý KHÔNG báo cho watcherUids (các trường bấm "trường tôi cũng gặp lỗi
 * này"): họ quan tâm tới việc lỗi đã sửa xong chưa, không quan tâm từng câu
 * trao đổi kỹ thuật, và mỗi tin nhắn nhân lên hàng chục thông báo là cách nhanh
 * nhất để cái chuông trở thành thứ không ai bấm nữa.
 */
function nguoiCanBaoTin(ticket: Ticket, authorUid: string, side: 'CAMPUS' | 'PTUD'): string[] {
  const raw =
    side === 'CAMPUS'
      ? [ticket.assigneeUserId, ticket.triagedBy, ticket.needsInfoBy]
      : [ticket.reporterUserId, ticket.campusContactUserId];
  return [...new Set(raw.filter((u): u is string => !!u && u !== authorUid))];
}

/**
 * Gửi một lượt trao đổi.
 *
 * CỐ Ý KHÔNG đụng vào document phiếu (kể cả updatedAt). Hai lý do:
 *   - Rules chỉ cho cán bộ trường sửa đúng vài field nội dung; chạm updatedAt
 *     là cả lượt gửi bị từ chối, mà lỗi hiện ra sẽ là "không có quyền" trên một
 *     thao tác trông chẳng liên quan gì tới quyền.
 *   - Phiếu và cuộc trao đổi là hai vòng đời khác nhau. Gộp chúng vào một lượt
 *     ghi nghĩa là hai người nhắn cùng lúc thì một người mất tin.
 *
 * Đánh đổi đã biết: danh sách phiếu không hiện được "có tin mới". Thông báo qua
 * chuông là đường báo duy nhất, và đó là cái chuông cả hai phía vốn đã nhìn.
 */
export async function postTicketMessage(input: {
  ticket: Ticket;
  body: string;
  attachments?: TicketAttachment[];
  author: { uid: string; name: string; side: 'CAMPUS' | 'PTUD' };
  /** Tin ghi việc do thao tác nghiệp vụ sinh ra (hỏi thêm thông tin…). */
  isSystem?: boolean;
}): Promise<{ ok: boolean; error: RepoError | null }> {
  const body = input.body.trim();
  const attachments = input.attachments ?? [];

  if (!body && attachments.length === 0) {
    throw new DomainError('MESSAGE_EMPTY', 'Chưa có nội dung để gửi');
  }
  if (body.length > MESSAGE_MAX_LENGTH) {
    throw new DomainError(
      'MESSAGE_TOO_LONG',
      `Tin nhắn dài ${body.length} ký tự, vượt giới hạn ${MESSAGE_MAX_LENGTH}. Nội dung dài nên đính kèm thành tài liệu.`,
      { length: body.length }
    );
  }

  const now = Date.now();
  try {
    const batch = writeBatch(db);
    batch.set(doc(messagesRef(input.ticket.id)), {
      authorUid: input.author.uid,
      authorName: input.author.name,
      authorSide: input.author.side,
      body,
      attachments,
      isSystem: input.isSystem === true,
      createdAt: now,
    });

    // Thông báo nằm TRONG cùng batch với tin nhắn. Tách ra thì một lỗi mạng
    // giữa chừng tạo ra tin nhắn không ai được báo — im lặng y như trước khi có
    // tính năng này.
    const message = body
      ? `${input.author.name} nhắn về ${input.ticket.ticketNo}: ${body.slice(0, 140)}`
      : `${input.author.name} gửi ${attachments.length} tệp đính kèm cho ${input.ticket.ticketNo}`;
    for (const uid of nguoiCanBaoTin(input.ticket, input.author.uid, input.author.side)) {
      batch.set(doc(collection(db, 'notifications')), {
        targetUserId: uid,
        message,
        ticketId: input.ticket.id,
        ticketNo: input.ticket.ticketNo,
        read: false,
        time: Timestamp.now(),
      });
    }

    await batch.commit();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: classifyError(error) };
  }
}
