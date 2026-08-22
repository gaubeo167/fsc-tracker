import { collection, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../../firebase';
import { SUPPORT_MODULES } from '../types';

// ===========================================================================
// Danh sách phân hệ, đọc từ Firestore chứ không phải hằng số trong code.
//
// Trước đây 5 phân hệ là một mảng `as const` trong types.ts. Admin tạo thêm
// phân hệ thứ 6 thì nó nằm trong Firestore nhưng KHÔNG hiện ra ở đâu cả — ô
// chọn phân hệ lúc gửi phiếu, cột phân hệ trong bảng, chip gán dự án đều đọc
// mảng hằng. Phân hệ mới thành ra vô hình.
//
// MỘT listener cho cả ứng dụng, không phải một listener mỗi dòng bảng.
// ModuleCell được vẽ ở mọi hàng của mọi bảng phiếu; nếu mỗi lần vẽ mở một
// listener thì một bảng 50 dòng là 50 kết nối. Store nhỏ ở dưới giữ đúng một
// kết nối và phát lại cho mọi component đang dùng.
//
// SUPPORT_MODULES vẫn còn, nhưng đổi vai: từ "danh sách đóng" thành "giá trị
// mặc định lúc chưa tải xong và khi Firestore đọc hỏng". Nhờ vậy màn hình
// không bao giờ hiện mã thô trong một nhịp rồi mới nhảy sang tên.
// ===========================================================================

export interface ModuleBrief {
  code: string;
  name: string;
  isActive: boolean;
}

const MAC_DINH: ModuleBrief[] = SUPPORT_MODULES.map((m) => ({
  code: m.code, name: m.name, isActive: true,
}));

let cache: ModuleBrief[] = MAC_DINH;
let stop: (() => void) | null = null;
const subs = new Set<(v: ModuleBrief[]) => void>();

function batDau() {
  if (stop) return;
  stop = onSnapshot(
    collection(db, 'support_modules'),
    (snap) => {
      const rows = snap.docs
        .map((d) => ({
          code: d.id,
          name: String((d.data() as any).name ?? d.id),
          // Thiếu field thì coi là đang bật: phân hệ seed từ trước khi có cờ
          // này không được biến mất khỏi ô chọn.
          isActive: (d.data() as any).isActive !== false,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
      // Firestore rỗng thì giữ mặc định: nghĩa là dữ liệu tham chiếu chưa được
      // seed, không phải "hệ thống không có phân hệ nào".
      cache = rows.length > 0 ? rows : MAC_DINH;
      subs.forEach((f) => f(cache));
    },
    () => {
      cache = MAC_DINH;
      subs.forEach((f) => f(cache));
    }
  );
}

export function useSupportModules(): {
  /** Mọi phân hệ, kể cả đã tắt — cần để hiện tên phiếu cũ. */
  modules: ModuleBrief[];
  /** Chỉ phân hệ đang bật — dùng cho MỌI ô chọn lúc tạo phiếu. */
  active: ModuleBrief[];
  nameOf: (code: string) => string;
} {
  const [modules, setModules] = useState<ModuleBrief[]>(cache);

  useEffect(() => {
    batDau();
    setModules(cache);
    subs.add(setModules);
    return () => {
      subs.delete(setModules);
      // Không đóng listener khi component cuối rời đi: người dùng chuyển tab
      // qua lại liên tục, đóng rồi mở lại tốn hơn hẳn một kết nối để đó.
    };
  }, []);

  return {
    modules,
    active: modules.filter((m) => m.isActive),
    nameOf: (code: string) => modules.find((m) => m.code === code)?.name ?? code,
  };
}
