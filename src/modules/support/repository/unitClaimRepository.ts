import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { COL, type SupportUnitClaim } from '../types';
import { classifyError, type RepoError } from './campusRepository';

// ===========================================================================
// Bản khai đơn vị công tác.
//
// Bài toán: mỗi tài khoản mới, admin phải tự đi hỏi hoặc đoán xem người đó ở
// trường nào rồi mới chọn được trong ô "Gán vào trường". Với 18 cơ sở và một
// đợt tuyển vài chục người, đó là vài chục lần tra cứu thủ công cho một thông
// tin mà chính người dùng biết rõ nhất.
//
// Cách sửa: người dùng tự khai lúc đăng nhập lần đầu, admin chỉ xác nhận.
//
// Ranh giới phải giữ: bản khai KHÔNG cấp quyền. Nó nằm ở collection riêng, và
// bảng phân quyền thật (support_role_assignments) vẫn chỉ admin ghi được. Nếu
// một ngày nào đó có người định cho luồng duyệt tự đọc bản khai rồi tự tạo bản
// gán, hãy dừng lại: lúc đó ai cũng tự gán mình vào trường bất kỳ.
// ===========================================================================

/** Đọc bản khai của chính mình. null = chưa khai. */
export async function getMyUnitClaim(uid: string): Promise<SupportUnitClaim | null> {
  const snap = await getDoc(doc(db, COL.unitClaims, uid));
  return snap.exists() ? (snap.data() as SupportUnitClaim) : null;
}

/**
 * Lưu bản khai của chính mình. Gọi lại lần nữa là sửa bản cũ.
 *
 * claimedAt chỉ ghi ở lần đầu: nó trả lời "người này khai từ bao giờ", còn
 * updatedAt trả lời "lần sửa gần nhất". Ghi đè claimedAt mỗi lần sửa thì mất
 * luôn mốc đầu tiên, và không ai biết bản khai đã nằm chờ duyệt bao lâu.
 */
export async function saveMyUnitClaim(input: {
  uid: string;
  campusId: string | null;
  jobTitle?: string;
}): Promise<void> {
  const ref = doc(db, COL.unitClaims, input.uid);
  const existing = await getDoc(ref);
  await setDoc(
    ref,
    {
      uid: input.uid,
      campusId: input.campusId,
      // Luôn ghi một chuỗi, kể cả rỗng: để hình dạng document ổn định, khỏi phải
      // phân biệt "không có field" với "để trống" ở mọi chỗ đọc.
      jobTitle: (input.jobTitle ?? '').trim().slice(0, 100),
      ...(existing.exists() ? {} : { claimedAt: serverTimestamp() }),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Lắng nghe toàn bộ bản khai — dành cho hàng đợi duyệt tài khoản của admin.
 *
 * Trả về map uid -> bản khai chứ không phải mảng: nơi gọi luôn tra theo uid của
 * từng dòng đang chờ duyệt, và một map bỏ đi được vòng find() lồng trong render.
 */
export function watchUnitClaims(
  onData: (byUid: Record<string, SupportUnitClaim>) => void,
  onError: (err: RepoError) => void
) {
  return onSnapshot(
    collection(db, COL.unitClaims),
    (snap) => {
      const byUid: Record<string, SupportUnitClaim> = {};
      snap.docs.forEach((d) => {
        byUid[d.id] = d.data() as SupportUnitClaim;
      });
      onData(byUid);
    },
    (error) => onError(classifyError(error))
  );
}
