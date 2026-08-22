import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import { COL, DomainError, type Campus } from '../types';

// ===========================================================================
// Truy cập dữ liệu campus.
//
// Vì sao lỗi được phân loại ở đây thay vì để component tự đoán: trong codebase
// này, rules chặn / thiếu biến môi trường / thiếu composite index / sai database
// đều hiện ra thành một danh sách rỗng giống hệt nhau. Repository phải nói rõ
// "bị chặn" khác "không có gì", nếu không người dùng lẫn lập trình viên đều đi
// tìm nhầm chỗ hàng giờ.
// ===========================================================================

export type RepoError = { kind: 'denied' | 'error'; message: string };

export function classifyError(error: any): RepoError {
  if (error?.code === 'permission-denied') {
    return { kind: 'denied', message: error?.message ?? 'permission-denied' };
  }
  return { kind: 'error', message: error?.message ?? 'unknown' };
}

const CODE_PATTERN = /^[A-Z0-9_]+$/;

/** Chuẩn hoá mã trường về dạng lưu trữ: in hoa, bỏ khoảng trắng thừa. */
export function normalizeCampusCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '_');
}

export function validateCampusCode(code: string): void {
  if (!code) throw new DomainError('CAMPUS_CODE_REQUIRED', 'Chưa nhập mã trường');
  if (!CODE_PATTERN.test(code)) {
    throw new DomainError(
      'CAMPUS_CODE_FORMAT',
      'Mã trường chỉ gồm chữ in hoa, số và dấu gạch dưới',
      { code }
    );
  }
}

/**
 * Lắng nghe danh sách campus theo thời gian thực.
 * Trả về hàm huỷ đăng ký. onError nhận lỗi ĐÃ PHÂN LOẠI, không phải lỗi thô.
 */
export function watchCampuses(
  onData: (rows: Campus[]) => void,
  onError: (err: RepoError) => void
) {
  const q = query(collection(db, COL.campuses), orderBy('code'));
  return onSnapshot(
    q,
    (snap) => onData(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Campus)),
    (error) => onError(classifyError(error))
  );
}

/**
 * Tạo campus mới. Doc id chính là mã trường nên tính duy nhất do Firestore
 * đảm bảo ở tầng dữ liệu.
 *
 * Kiểm-rồi-ghi bằng getDoc + setDoc KHÔNG đủ: hai admin tạo cùng mã cùng lúc
 * thì cả hai đều qua được phép kiểm, và setDoc thứ hai (không merge) đè lên
 * bản ghi thứ nhất — mất createdAt, createdBy, và cả address/officialCode mà
 * script nhập trường đã ghi. Nên dùng transaction: lượt đọc trở thành điều
 * kiện tiên quyết của lượt ghi.
 */
export async function createCampus(
  input: {
    code: string; name: string; region: string;
    address?: string; province?: string; levels?: string;
  },
  actorUid: string
): Promise<Campus> {
  const code = normalizeCampusCode(input.code);
  validateCampusCode(code);

  const name = input.name.trim();
  if (!name) throw new DomainError('CAMPUS_NAME_REQUIRED', 'Chưa nhập tên trường');

  const ref = doc(db, COL.campuses, code);
  const payload = {
    id: code,
    code,
    name,
    region: input.region.trim(),
    address: (input.address ?? '').trim(),
    province: (input.province ?? '').trim(),
    levels: (input.levels ?? '').trim(),
    isActive: true,
    createdAt: serverTimestamp(),
    createdBy: actorUid,
  };
  await runTransaction(db, async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists()) {
      throw new DomainError('CAMPUS_CODE_DUPLICATE', 'Mã trường này đã tồn tại', { code });
    }
    tx.set(ref, payload);
  });
  return payload as unknown as Campus;
}

/**
 * Bật/tắt campus. Cố ý KHÔNG có hàm xoá: campus đã tắt vẫn còn ticket lịch sử
 * trỏ tới nó, xoá đi là để lại tham chiếu mồ côi không truy vết được.
 */
export async function setCampusActive(campusId: string, isActive: boolean): Promise<void> {
  await updateDoc(doc(db, COL.campuses, campusId), { isActive });
}

export async function updateCampus(
  campusId: string,
  patch: {
    name?: string; region?: string;
    address?: string; province?: string; levels?: string;
  }
): Promise<void> {
  const clean: Record<string, string> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name) throw new DomainError('CAMPUS_NAME_REQUIRED', 'Chưa nhập tên trường');
    clean.name = name;
  }
  if (patch.region !== undefined) clean.region = patch.region.trim();
  if (patch.address !== undefined) clean.address = patch.address.trim();
  if (patch.province !== undefined) clean.province = patch.province.trim();
  if (patch.levels !== undefined) clean.levels = patch.levels.trim();
  if (Object.keys(clean).length === 0) return;
  await updateDoc(doc(db, COL.campuses, campusId), clean);
}
