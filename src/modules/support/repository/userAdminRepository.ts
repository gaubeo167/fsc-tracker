import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import type { UserProfile } from '../../../types';
import {
  COL,
  DomainError,
  ROLES_REQUIRING_CAMPUS,
  type SupportModuleConfig,
  type SupportRole,
  type SupportRoleAssignment,
} from '../types';
import { classifyError, type RepoError } from './campusRepository';

// ===========================================================================
// Duyệt tài khoản.
//
// Luồng: đăng nhập lần đầu -> users/{uid}.status = 'pending' -> admin duyệt và
// gán trường -> status = 'active' + tạo support_role_assignments/{uid}.
//
// Hai thao tác đó phải cùng thành công hoặc cùng thất bại. Nếu đổi status trước
// mà tạo bản ghi gán quyền lỗi, ta có một tài khoản 'active' không thuộc trường
// nào — lọt đúng qua cổng mà cổng sinh ra để chặn. Dùng writeBatch.
// ===========================================================================

/** Lắng nghe hàng đợi tài khoản chờ duyệt. */
export function watchPendingUsers(
  onData: (rows: UserProfile[]) => void,
  onError: (err: RepoError) => void
) {
  const q = query(collection(db, 'users'), where('status', '==', 'pending'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => d.data() as UserProfile)),
    (error) => onError(classifyError(error))
  );
}

/** Lắng nghe toàn bộ bản ghi gán quyền, để hiện ai đang thuộc trường nào. */
export function watchRoleAssignments(
  onData: (rows: SupportRoleAssignment[]) => void,
  onError: (err: RepoError) => void
) {
  return onSnapshot(
    collection(db, COL.roleAssignments),
    (snap) => onData(snap.docs.map((d) => d.data() as SupportRoleAssignment)),
    (error) => onError(classifyError(error))
  );
}

/** Đọc quyền hỗ trợ của chính mình. Trả null nếu chưa được gán. */
export async function getMyAssignment(uid: string): Promise<SupportRoleAssignment | null> {
  const snap = await getDoc(doc(db, COL.roleAssignments, uid));
  return snap.exists() ? (snap.data() as SupportRoleAssignment) : null;
}

/**
 * Duyệt một tài khoản: kích hoạt + gán trường + gán vai trò, trong một batch.
 *
 * campusId bắt buộc với vai trò tại trường (REPORTER/FOCAL). Vai trò phía PTUD
 * (MODULE_OWNER, DEVELOPER, PTUD_MANAGER, SYS_ADMIN) không thuộc trường nào nên
 * được phép để trống.
 */
export async function approveUser(input: {
  uid: string;
  supportRole: SupportRole;
  campusId: string | null;
  actorUid: string;
}): Promise<void> {
  const { uid, supportRole, campusId, actorUid } = input;

  if (!supportRole) {
    throw new DomainError('SUPPORT_ROLE_REQUIRED', 'Chưa chọn vai trò');
  }
  if (ROLES_REQUIRING_CAMPUS.includes(supportRole) && !campusId) {
    throw new DomainError(
      'CAMPUS_REQUIRED_FOR_ROLE',
      'Vai trò này bắt buộc phải chọn trường',
      { supportRole }
    );
  }

  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), { status: 'active' });
  batch.set(doc(db, COL.roleAssignments, uid), {
    uid,
    campusId: campusId ?? null,
    supportRole,
    assignedBy: actorUid,
    assignedAt: serverTimestamp(),
  });
  await batch.commit();
}

/**
 * Từ chối tài khoản: chuyển sang 'disabled'.
 *
 * Cố ý KHÔNG xoá document. Xoá đi thì lần đăng nhập kế tiếp app sẽ tự tạo lại hồ
 * sơ 'pending' mới và người đó quay lại hàng đợi vô hạn, còn admin thì mất dấu
 * vết đã từng từ chối ai.
 */
export async function rejectUser(uid: string): Promise<void> {
  const batch = writeBatch(db);
  batch.update(doc(db, 'users', uid), { status: 'disabled' });
  await batch.commit();
}

/** Đổi trường / vai trò cho tài khoản đã được duyệt trước đó. */
export async function reassignUser(input: {
  uid: string;
  supportRole: SupportRole;
  campusId: string | null;
  actorUid: string;
  /**
   * Kích hoạt luôn tài khoản đang chờ duyệt.
   *
   * Gán loại thành viên cho một người mà tài khoản họ vẫn 'pending' thì họ vẫn
   * không vào được — admin gán xong tưởng đã xong việc, còn người kia vẫn thấy
   * màn chờ duyệt. Bên gọi phải nói rõ mình muốn kích hoạt hay không, chứ hàm
   * này không tự đoán.
   */
  alsoActivate?: boolean;
}): Promise<void> {
  if (ROLES_REQUIRING_CAMPUS.includes(input.supportRole) && !input.campusId) {
    throw new DomainError(
      'CAMPUS_REQUIRED_FOR_ROLE',
      'Vai trò này bắt buộc phải chọn trường',
      { supportRole: input.supportRole }
    );
  }
  const batch = writeBatch(db);
  batch.set(doc(db, COL.roleAssignments, input.uid), {
    uid: input.uid,
    campusId: input.campusId ?? null,
    supportRole: input.supportRole,
    assignedBy: input.actorUid,
    assignedAt: serverTimestamp(),
  });
  if (input.alsoActivate) batch.update(doc(db, 'users', input.uid), { status: 'active' });
  await batch.commit();
}

/**
 * Gỡ loại thành viên hỗ trợ.
 *
 * Xoá bản ghi gán chứ không đặt về một vai trò rỗng: mọi chỗ trong code đều
 * kiểm "có bản ghi hay không" (isPtudStaff, myCampusId), một vai trò rỗng sẽ
 * lọt qua các phép kiểm đó.
 *
 * KHÔNG đụng tới users.status: gỡ quyền hỗ trợ không có nghĩa là khoá tài
 * khoản, họ vẫn là thành viên của module Công việc.
 */
export async function clearMemberScope(uid: string): Promise<void> {
  await deleteDoc(doc(db, COL.roleAssignments, uid));
}

/**
 * Danh sách cán bộ PTUD có thể được giao xử lý phiếu.
 *
 * KHÔNG lọc theo thành viên của project. Một nhân viên có thể tham gia nhiều dự
 * án khác nhau, và module Công việc vốn liệt kê task bằng collectionGroup lọc
 * theo `assignees` xuyên toàn bộ project — người được giao vẫn thấy task kể cả
 * khi không phải thành viên của project chứa task đó.
 */
export async function fetchPtudStaff(): Promise<{
  staff: Array<{ uid: string; displayName: string; email: string; supportRole: SupportRole }>;
  /**
   * uid -> tên hiển thị của MỌI người dùng, không chỉ cán bộ PTUD.
   *
   * Cần vì thành viên/quản lý dự án có thể không có bản ghi phân vai hỗ trợ
   * (admin chẳng hạn). Thiếu bảng này thì ô CC hiện ra uid thô của Firebase.
   * Không tốn thêm lần đọc nào: collection users đã được tải sẵn ở dưới.
   */
  directory: Record<string, string>;
  error: RepoError | null;
}> {
  try {
    const [assignSnap, userSnap] = await Promise.all([
      getDocs(collection(db, COL.roleAssignments)),
      getDocs(collection(db, 'users')),
    ]);
    const users = new Map(
      userSnap.docs.map((d) => [d.id, d.data() as UserProfile])
    );
    const staff = assignSnap.docs
      .map((d) => d.data() as SupportRoleAssignment)
      .filter((a) =>
        ['MODULE_OWNER', 'DEVELOPER', 'PTUD_MANAGER', 'SYS_ADMIN'].includes(a.supportRole)
      )
      .map((a) => {
        const u = users.get(a.uid);
        return {
          uid: a.uid,
          displayName: u?.displayName ?? a.uid,
          email: u?.email ?? '',
          supportRole: a.supportRole,
        };
      })
      .sort((x, y) => x.displayName.localeCompare(y.displayName, 'vi'));
    const directory: Record<string, string> = {};
    users.forEach((u, uid) => { directory[uid] = u?.displayName ?? uid; });
    return { staff, directory, error: null };
  } catch (error) {
    return { staff: [], directory: {}, error: classifyError(error) };
  }
}

/**
 * Tạo phân hệ mới.
 *
 * Mã phân hệ là doc id và là thứ mọi phiếu, mọi bộ đếm số phiếu
 * (support_counters/{MA}_{kỳ}) và mọi mã phiếu (FSC-{MA}-...) trỏ về. Nên nó
 * phải duy nhất, và sau khi tạo thì KHÔNG đổi được — đổi mã là mất dấu toàn bộ
 * phiếu cũ của phân hệ đó.
 */
export async function createSupportModule(input: {
  code: string;
  name: string;
}): Promise<string> {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, '_');
  if (!code) throw new DomainError('MODULE_CODE_REQUIRED', 'Chưa nhập mã phân hệ');
  if (!/^[A-Z0-9_]+$/.test(code)) {
    throw new DomainError(
      'MODULE_CODE_FORMAT',
      'Mã phân hệ chỉ gồm chữ in hoa, số và dấu gạch dưới',
      { code }
    );
  }
  const name = input.name.trim();
  if (!name) throw new DomainError('MODULE_NAME_REQUIRED', 'Chưa nhập tên phân hệ');

  const ref = doc(db, COL.modules, code);
  // Kiểm tồn tại rồi mới ghi. Không phải khoá tuyệt đối như document khoá mã
  // phiếu, nhưng ở đây chỉ có admin thao tác và tần suất là vài lần một năm —
  // đánh đổi chấp nhận được so với việc dựng thêm một cơ chế khoá.
  if ((await getDoc(ref)).exists()) {
    throw new DomainError('MODULE_CODE_DUPLICATE', 'Mã phân hệ này đã tồn tại', { code });
  }

  await setDoc(ref, {
    code,
    name,
    ownerUserId: null,
    backupOwnerUserId: null,
    // Chưa gán dự án thì chưa tiếp nhận phiếu được. Gán ở tab Dự án.
    projectId: null,
    isActive: true,
  });
  return code;
}

/**
 * Đổi tên phân hệ. CHỈ tên — mã giữ nguyên vĩnh viễn.
 */
export async function renameSupportModule(code: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) throw new DomainError('MODULE_NAME_REQUIRED', 'Chưa nhập tên phân hệ');
  // merge: phân hệ mặc định có thể chưa có document, đổi tên là lúc tạo nó.
  await setDoc(doc(db, COL.modules, code), { code, name: clean }, { merge: true });
}

/**
 * Bật/tắt phân hệ.
 *
 * Cố ý KHÔNG có hàm xoá: phiếu lịch sử trỏ về mã phân hệ, xoá là để lại tham
 * chiếu mồ côi và mã phiếu FSC-{MA}-... không tra ngược được nữa.
 */
export async function setSupportModuleActive(code: string, isActive: boolean): Promise<void> {
  await setDoc(doc(db, COL.modules, code), { code, isActive }, { merge: true });
}

/** Cấu hình các phân hệ, gồm ánh xạ tới dự án. */
export async function fetchSupportModules(): Promise<{
  modules: SupportModuleConfig[];
  error: RepoError | null;
}> {
  try {
    const snap = await getDocs(collection(db, COL.modules));
    return {
      modules: snap.docs.map((d) => d.data() as SupportModuleConfig),
      error: null,
    };
  } catch (error) {
    return { modules: [], error: classifyError(error) };
  }
}

/**
 * Phân hệ mà một người được phép TIẾP NHẬN phiếu.
 *
 * Hai đường vào, hợp nhất:
 *   1. Là đầu mối chính / dự phòng của phân hệ đó
 *   2. Là cán bộ phụ trách DỰ ÁN mà phân hệ đó trỏ tới
 *
 * Đường thứ hai mới là đường thường gặp. Chủ dự án nói rõ: cán bộ được add vào
 * dự án là người quản lý dự án đó, nên họ phải thấy hàng đợi chờ duyệt của các
 * phân hệ đổ vào dự án ấy — không cần ai gán riêng làm "đầu mối phân hệ".
 *
 * Trả về cả danh sách dự án phụ trách để giao diện nói được lý do vì sao thấy
 * hoặc không thấy gì.
 */
export interface ModuleScope {
  /** Dự án mà phân hệ này đổ công việc vào. */
  projectId: string | null;
  projectName: string;
  /** Tôi có phải QUẢN LÝ dự án đó không — quyết định có được gán việc cho người khác. */
  isManager: boolean;
  /** Người trong dự án: quản lý + thành viên. Dùng cho ô người xử lý và CC. */
  people: string[];
}

export async function fetchMyTriageScope(uid: string): Promise<{
  moduleCodes: string[];
  projectNames: string[];
  /** Chi tiết theo từng phân hệ — ai được gán việc cho ai. */
  byModule: Record<string, ModuleScope>;
  isPtud: boolean;
  error: RepoError | null;
}> {
  try {
    const [mod, assignSnap, projSnap, allAssign] = await Promise.all([
      fetchSupportModules(),
      getDoc(doc(db, COL.roleAssignments, uid)),
      getDocs(collection(db, 'projects')),
      // Toàn bộ bản gán, để lọc danh sách người có thể nhận việc. Cán bộ PTUD
      // liệt kê được collection này (xem rules); người của trường thì không —
      // nhưng họ cũng không bao giờ chạy tới hàm này.
      getDocs(collection(db, COL.roleAssignments)).catch(() => null),
    ]);

    const mine = assignSnap.exists() ? (assignSnap.data() as SupportRoleAssignment) : null;
    const isPtud = !!mine && ['MODULE_OWNER', 'DEVELOPER', 'PTUD_MANAGER', 'SYS_ADMIN'].includes(mine.supportRole);

    const myProjects = projSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((p) =>
        (p.managers ?? []).includes(uid) || (p.members ?? []).includes(uid)
      );
    const myProjectIds = new Set(myProjects.map((p) => p.id));

    const allProjects = projSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    // Ai là cán bộ PTUD — dùng để lọc danh sách người có thể nhận việc.
    const ptudUids = new Set(
      (allAssign?.docs ?? [])
        .map((d) => d.data() as SupportRoleAssignment)
        .filter((a) => ['MODULE_OWNER', 'DEVELOPER', 'PTUD_MANAGER', 'SYS_ADMIN'].includes(a.supportRole))
        .map((a) => a.uid)
    );
    const codes = new Set<string>();
    const byModule: Record<string, ModuleScope> = {};

    for (const m of mod.modules) {
      const isOwner = m.ownerUserId === uid || m.backupOwnerUserId === uid;
      const inProject = !!m.projectId && myProjectIds.has(m.projectId);
      if (!isOwner && !inProject) continue;
      codes.add(m.code);

      const proj = allProjects.find((p) => p.id === m.projectId);
      const managers: string[] = proj?.managers ?? [];
      const members: string[] = proj?.members ?? [];
      byModule[m.code] = {
        projectId: m.projectId ?? null,
        projectName: String(proj?.name ?? ''),
        // CHỈ người có tên trong project.managers. Cố ý KHÔNG tính đầu mối
        // phân hệ: firestore.rules chốt quyền gán việc đúng bằng danh sách này,
        // nếu UI rộng hơn rules thì người dùng bấm xong mới ăn permission-denied.
        isManager: managers.includes(uid),
        // LỌC theo phân vai hỗ trợ.
        //
        // Thành viên dự án không đương nhiên là cán bộ PTUD. Giao việc cho một
        // người không có phân vai hỗ trợ thì mọi lượt cập nhật trạng thái phiếu
        // sau đó đều bị rules chặn (support_tickets đòi isAdmin/isPtudStaff),
        // mà lượt đồng bộ lại nuốt lỗi — nên phiếu đứng im ở "đã tiếp nhận" mãi
        // mãi và trường không bao giờ được báo tiến độ. Không ai thấy lỗi ở đâu.
        people: allAssign
          ? [...new Set([...managers, ...members])].filter((u) => ptudUids.has(u))
          // Không đọc được bảng phân vai thì giữ nguyên danh sách cũ còn hơn
          // trả về rỗng — rỗng nghĩa là không ai giao việc được cho ai.
          : [...new Set([...managers, ...members])],
      };
    }

    return {
      moduleCodes: [...codes],
      projectNames: myProjects.map((p) => String(p.name ?? p.id)),
      byModule,
      isPtud,
      error: mod.error,
    };
  } catch (error) {
    return { moduleCodes: [], projectNames: [], byModule: {}, isPtud: false, error: classifyError(error) };
  }
}
