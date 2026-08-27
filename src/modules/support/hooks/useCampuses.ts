import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from '../../../firebase';
import { COL } from '../types';

// ===========================================================================
// Danh bạ đơn vị (trường / cơ sở), đọc một lần cho cả ứng dụng.
//
// Vì sao có file này: phiếu chỉ mang theo `campusId` — một mã ba chữ như "FCG",
// "FTH". Người trực hàng đợi nhìn "FCG" KHÔNG biết đó là cơ sở nào, ở tỉnh nào,
// cấp học gì. Trước đây chỉ hai màn (Tất cả phiếu, Gửi phiếu) tự nạp danh sách
// campus rồi tự dựng map id → tên; hàng đợi tiếp nhận và màn Đơn yêu cầu thì
// không, nên chúng hiện mã thô. Cùng một phiếu, ba màn, hai cách gọi tên.
//
// Gom về một store nhỏ theo đúng khuôn useSupportModules: MỘT listener cho cả
// app, không phải một listener mỗi bảng. Không thì một danh sách 50 dòng là 50
// kết nối Firestore.
//
// Không có giá trị mặc định như SUPPORT_MODULES: danh sách trường thay đổi theo
// năm học và không thể đoán trong code. Lúc chưa tải xong, `nameOf` trả lại
// chính mã — hiện mã thô vẫn hơn hiện chuỗi rỗng.
// ===========================================================================

export interface CampusBrief {
  id: string;
  code: string;
  name: string;
  region: string;
  province: string;
  /** Cấp học: "TH", "THCS", "THPT" hoặc tổ hợp. */
  levels: string;
  isActive: boolean;
}

let cache: CampusBrief[] = [];
let stop: (() => void) | null = null;
const subs = new Set<(v: CampusBrief[]) => void>();

function batDau() {
  if (stop) return;
  stop = onSnapshot(
    query(collection(db, COL.campuses), orderBy('code')),
    (snap) => {
      cache = snap.docs.map((d) => {
        const x = d.data() as Record<string, unknown>;
        return {
          id: d.id,
          code: String(x.code ?? d.id),
          name: String(x.name ?? d.id),
          region: String(x.region ?? ''),
          province: String(x.province ?? ''),
          levels: String(x.levels ?? ''),
          // Thiếu field thì coi là đang hoạt động: trường seed từ trước khi có
          // cờ này không được biến mất khỏi danh bạ.
          isActive: x.isActive !== false,
        };
      });
      subs.forEach((f) => f(cache));
    },
    // Đọc hỏng (thường là rules chặn) thì để danh bạ rỗng và `nameOf` trả về
    // mã. KHÔNG dựng màn lỗi ở đây: tên đơn vị là thông tin phụ trợ, mất nó
    // không đáng để cả hàng đợi phiếu ngừng hiện.
    () => {
      cache = [];
      subs.forEach((f) => f(cache));
    }
  );
}

export function useCampuses(): {
  campuses: CampusBrief[];
  /** Tên đầy đủ của đơn vị. Chưa tải xong hoặc không tìm thấy thì trả lại mã. */
  nameOf: (id: string) => string;
  /** Bản ghi đầy đủ, để hiện thêm tỉnh/thành và cấp học. */
  campusOf: (id: string) => CampusBrief | undefined;
  /** Map id → tên, cho các component đang nhận sẵn dạng này. */
  namesById: Record<string, string>;
} {
  const [campuses, setCampuses] = useState<CampusBrief[]>(cache);

  useEffect(() => {
    batDau();
    setCampuses(cache);
    subs.add(setCampuses);
    return () => {
      subs.delete(setCampuses);
      // Không đóng listener khi component cuối rời đi — xem lý do ở
      // useSupportModules: người dùng chuyển tab liên tục, mở lại tốn hơn.
    };
  }, []);

  return {
    campuses,
    nameOf: (id: string) => campuses.find((c) => c.id === id)?.name ?? id,
    campusOf: (id: string) => campuses.find((c) => c.id === id),
    namesById: Object.fromEntries(campuses.map((c) => [c.id, c.name])),
  };
}
