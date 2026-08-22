import { collection, onSnapshot, query, where, writeBatch, doc } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../../../firebase';

// ===========================================================================
// Số đếm trên thanh điều hướng: "có gì mới ở mục này".
//
// Nguồn dữ liệu là collection `notifications` VỐN ĐÃ CÓ, không dựng thêm cơ chế
// thứ hai. Lý do:
//
//   - Nó đã ghi sẵn mọi việc cần đếm: công việc đổi trạng thái (module Công
//     việc ghi từ trước), yêu cầu mới, yêu cầu được tiếp nhận / từ chối / cần
//     bổ sung (module Hỗ trợ ghi).
//   - Chuông ở đầu trang cũng đọc đúng collection này, nên hai chỗ KHÔNG BAO
//     GIỜ lệch nhau. Đếm bằng hai nguồn khác nhau thì sớm muộn chuông báo 3 mà
//     thanh bên báo 5, và không ai biết cái nào đúng.
//   - "Xem rồi mới giảm" có sẵn: đó chính là cờ `read`.
//
// Phân loại về mục nào thì SUY RA từ nội dung thông báo, không cần thêm field:
// có ticketId là việc của mục Hỗ trợ, có taskId là việc của mục Công việc. Nhờ
// vậy hàng nghìn thông báo cũ do module Công việc ghi từ trước vẫn đếm đúng mà
// không phải chạy migration nào.
// ===========================================================================

export type NavSection = 'support' | 'tasks';

export interface NavBadges {
  support: number;
  tasks: number;
  /** Đánh dấu đã đọc mọi thông báo thuộc một mục — gọi khi người dùng mở mục đó. */
  markSeen: (section: NavSection) => Promise<void>;
}

interface NotiRow {
  id: string;
  section: NavSection | null;
}

function sectionOf(d: Record<string, unknown>): NavSection | null {
  if (d.ticketId) return 'support';
  if (d.taskId) return 'tasks';
  return null;
}

/**
 * Firestore giới hạn 500 lượt ghi mỗi batch. Mở một mục có 900 thông báo chưa
 * đọc mà gửi một batch là hỏng cả lượt đánh dấu.
 */
const BATCH_TOI_DA = 400;

export function useNavBadges(uid: string | null | undefined): NavBadges {
  const [rows, setRows] = useState<NotiRow[]>([]);
  /**
   * Thông báo đang trong một lượt ghi "đã đọc" chưa xong.
   *
   * Nơi gọi đặt markSeen trong useEffect, và effect đó chạy lại mỗi lần
   * component vẽ lại. Từ lúc batch được gửi tới lúc onSnapshot trả về, `rows`
   * vẫn còn nguyên số cũ — nên mỗi lần vẽ lại trong khoảng đó lại gửi thêm một
   * batch y hệt. Mạng chậm thì thành hàng chục lượt ghi thừa cho cùng một việc.
   */
  const dangGhi = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!uid) {
      setRows([]);
      return;
    }
    // Không orderBy: thêm orderBy vào truy vấn có hai mệnh đề where là cần
    // composite index, mà ở đây chỉ cần ĐẾM chứ không cần thứ tự.
    const q = query(
      collection(db, 'notifications'),
      where('targetUserId', '==', uid),
      where('read', '==', false)
    );
    return onSnapshot(
      q,
      (snap) => setRows(snap.docs.map((d) => ({ id: d.id, section: sectionOf(d.data()) }))),
      // Đếm hỏng thì im lặng về 0. Thanh điều hướng không được vỡ vì một con số.
      () => setRows([])
    );
  }, [uid]);

  const markSeen = useCallback(async (section: NavSection) => {
    const ids = rows
      .filter((r) => r.section === section && !dangGhi.current.has(r.id))
      .map((r) => r.id)
      .slice(0, BATCH_TOI_DA);
    if (ids.length === 0) return;
    ids.forEach((id) => dangGhi.current.add(id));
    const batch = writeBatch(db);
    for (const id of ids) batch.update(doc(db, 'notifications', id), { read: true });
    try {
      await batch.commit();
    } catch {
      // Ghi hỏng thì bỏ khoá để lần mở sau thử lại. Không báo lỗi ra người
      // dùng: họ vừa bấm vào một mục điều hướng, không phải vừa bấm "lưu".
      ids.forEach((id) => dangGhi.current.delete(id));
    }
  }, [rows]);

  // Object mới mỗi lần vẽ sẽ làm effect ở nơi gọi chạy lại mỗi lần vẽ, kể cả
  // khi hai con số không đổi. useMemo giữ tham chiếu ổn định theo đúng những
  // thứ thật sự thay đổi.
  const support = rows.filter((r) => r.section === 'support').length;
  const tasks = rows.filter((r) => r.section === 'tasks').length;
  return useMemo(() => ({ support, tasks, markSeen }), [support, tasks, markSeen]);
}
