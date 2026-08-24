import {
  collection, deleteDoc, doc, getDoc, onSnapshot, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { COL, DomainError, ROLES_REQUIRING_CAMPUS, type SupportRole } from '../types';
import { classifyError, type RepoError } from './campusRepository';

// ===========================================================================
// Duyệt trước: admin ghi sẵn quyền cho một địa chỉ email, người đó đăng nhập
// lần đầu là có ngay quyền đó, không phải chờ ai bấm duyệt.
//
// Doc id LÀ email viết thường. Hai lý do:
//   1. firestore.rules KHÔNG truy vấn được, chỉ get() được. Muốn rules kiểm
//      "email này đã được duyệt trước chưa" thì id phải suy ra từ email.
//   2. Mời trùng trở thành GHI ĐÈ thay vì sinh ra hai thư mời mâu thuẫn cho
//      cùng một người, rồi không ai biết cái nào có hiệu lực.
//
// Đây KHÔNG phải tính năng gửi email. Hệ thống không có hạ tầng gửi thư, và
// giao diện nói đúng như vậy: đây là cấp quyền trước, người được cấp vẫn cần
// được báo qua kênh khác.
// ===========================================================================

/** Thư mời hết hạn sau 30 ngày. Để vĩnh viễn là mời nhầm hôm nay, nửa năm sau vẫn lên quyền. */
export const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Invitation {
  email: string;
  /** Quyền trong module Công việc. */
  role: 'user' | 'manager' | 'director' | 'admin';
  /** Loại thành viên trong module Hỗ trợ. Rỗng = không cấp quyền hỗ trợ. */
  supportRole: SupportRole | '';
  campusId: string | null;
  status: 'pending' | 'accepted';
  invitedBy: string;
  invitedAt: number;
  expiresAt: number;
  acceptedUid?: string;
  acceptedAt?: number;
}

/** Chuẩn hoá email thành doc id. Phải khớp CHÍNH XÁC cách rules dựng đường dẫn. */
export function inviteId(email: string): string {
  return email.trim().toLowerCase();
}

export async function createInvitation(input: {
  email: string;
  role: Invitation['role'];
  supportRole: SupportRole | '';
  campusId: string | null;
  actorUid: string;
}): Promise<string> {
  const email = inviteId(input.email);
  if (!email) throw new DomainError('INVITE_EMAIL_REQUIRED', 'Chưa nhập email');
  if (!email.endsWith('@fpt.edu.vn') && !email.endsWith('@fe.edu.vn')) {
    throw new DomainError(
      'INVITE_EMAIL_DOMAIN',
      'Chỉ cấp quyền được cho email @fpt.edu.vn hoặc @fe.edu.vn'
    );
  }
  if (input.supportRole && ROLES_REQUIRING_CAMPUS.includes(input.supportRole) && !input.campusId) {
    throw new DomainError(
      'INVITE_CAMPUS_REQUIRED',
      'Cán bộ nhà trường bắt buộc phải chọn trường, nếu không họ đăng nhập vào sẽ không thấy gì.'
    );
  }

  const now = Date.now();
  const payload: Invitation = {
    email,
    role: input.role,
    supportRole: input.supportRole,
    campusId: input.supportRole ? input.campusId : null,
    status: 'pending',
    invitedBy: input.actorUid,
    invitedAt: now,
    expiresAt: now + INVITE_TTL_MS,
  };
  await setDoc(doc(db, 'invitations', email), payload);
  return email;
}

export function watchInvitations(
  onData: (rows: Array<Invitation & { id: string }>) => void,
  onError: (e: RepoError) => void
) {
  return onSnapshot(
    collection(db, 'invitations'),
    (snap) => onData(
      snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as Invitation) }))
        .sort((a, b) => (b.invitedAt ?? 0) - (a.invitedAt ?? 0))
    ),
    (e) => onError(classifyError(e))
  );
}

export async function deleteInvitation(email: string): Promise<void> {
  await deleteDoc(doc(db, 'invitations', inviteId(email)));
}

/**
 * Đọc thư mời còn dùng được cho email này. KHÔNG ghi gì.
 *
 * Tách khỏi bước ghi vì rules đòi thư mời vẫn đang 'pending' cho CẢ hai lượt
 * ghi phía sau (hồ sơ người dùng và bản gán trường). Đánh dấu "đã dùng" phải là
 * việc CUỐI CÙNG — làm sớm là thư mời bị tiêu trong khi quyền chưa vào đâu cả,
 * và không ai cấp lại được vì hệ thống tưởng người đó đã nhận rồi.
 */
export async function readUsableInvitation(email: string): Promise<Invitation | null> {
  try {
    const id = inviteId(email);
    if (!id) return null;
    const snap = await getDoc(doc(db, 'invitations', id));
    if (!snap.exists()) return null;
    const inv = snap.data() as Invitation;
    if (inv.status !== 'pending') return null;
    if (!inv.expiresAt || inv.expiresAt <= Date.now()) return null;
    return inv;
  } catch (e) {
    // Đọc hỏng KHÔNG được chặn đường đăng nhập: người dùng vẫn vào được với
    // quyền mặc định và admin duyệt tay như trước. Nhưng phải để lại dấu.
    console.error('[hỗ trợ] không đọc được thư mời duyệt trước', e);
    return null;
  }
}

/**
 * Ghi nốt phần hỗ trợ rồi đóng thư mời. Gọi SAU khi hồ sơ người dùng đã ghi xong.
 *
 * Bản gán trường và việc đóng thư mời cố ý KHÔNG gộp thành batch: chúng đi qua
 * hai rule khác nhau, và nếu bản gán bị chặn thì vẫn nên giữ nguyên thư mời để
 * admin thấy nó chưa hoàn tất, thay vì đóng lại và mất dấu.
 */
export async function finishInvitation(input: {
  uid: string;
  email: string;
  invitation: Invitation;
}): Promise<void> {
  const { uid, email, invitation: inv } = input;
  try {
    if (inv.supportRole) {
      await setDoc(doc(db, COL.roleAssignments, uid), {
        uid,
        campusId: inv.campusId ?? null,
        supportRole: inv.supportRole,
        assignedBy: inv.invitedBy,
        assignedAt: serverTimestamp(),
      });
    }
    await updateDoc(doc(db, 'invitations', inviteId(email)), {
      status: 'accepted',
      acceptedUid: uid,
      acceptedAt: Date.now(),
    });
  } catch (e) {
    console.error('[hỗ trợ] không hoàn tất được thư mời duyệt trước', e);
  }
}

/** Thư mời của chính email này, để giao diện nói trước khi tạo trùng. */
export async function fetchInvitation(email: string): Promise<Invitation | null> {
  try {
    const snap = await getDoc(doc(db, 'invitations', inviteId(email)));
    return snap.exists() ? (snap.data() as Invitation) : null;
  } catch {
    return null;
  }
}
