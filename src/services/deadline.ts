import { Timestamp } from 'firebase/firestore';
import type { DeadlineChange, Task, TaskStatus } from '../types';

// ===========================================================================
// Hạn hoàn thành: quá hạn, đổi hạn, và trễ hạn.
//
// Ba khái niệm khác nhau, trước đây bị gộp làm một và chỉ tồn tại trong đầu
// người dùng:
//
//   quá hạn  — HÔM NAY đã qua hạn mà việc chưa xong. Suy ra, không lưu.
//   đổi hạn  — hạn bị dời. Phải LƯU, kèm lý do, vì không suy lại được.
//   trễ hạn  — lúc nghiệm thu thì đã qua hạn. Phải LƯU vì "quá hạn" tắt ngay
//              khi việc xong, mang theo cả dấu vết là nó từng muộn.
//
// Quá hạn KHÔNG phải một trạng thái. Nó là một cái nhãn dán thêm lên việc đang
// làm dở. Việc quá hạn vẫn kéo tiến độ được, vẫn nghiệm thu được — chặn lại thì
// người ta chỉ bỏ mặc nó ngoài hệ thống, và con số thống kê sai theo.
// ===========================================================================

/** So ngày theo múi giờ máy, bỏ giờ phút. 'yyyy-MM-dd' so sánh chuỗi là đủ. */
export function homNay(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * Việc này có đang quá hạn không.
 *
 * Việc đã nghiệm thu thì không bao giờ "đang quá hạn" nữa — nó đã xong, muộn
 * hay không thì hỏi doneLate. Việc chưa có hạn cũng không quá hạn được.
 */
export function quaHan(
  task: Pick<Task, 'date' | 'status'> & { status: TaskStatus | string },
  now: Date = new Date()
): boolean {
  if (task.status === 'done') return false;
  if (!task.date) return false;
  return task.date < homNay(now);
}

/**
 * Dấu vết trễ hạn để ghi lại lúc nghiệm thu.
 *
 * Gọi ở MỌI chỗ đặt status = 'done'. Thiếu một chỗ thì việc đó xong mà không
 * ai biết nó muộn, và bảng thống kê đếm thiếu.
 */
export function datCoHoanThanh(
  task: Pick<Task, 'date'>,
  now: Date = new Date()
): { doneAt: string; doneLate: boolean } {
  const ngay = homNay(now);
  return { doneAt: ngay, doneLate: !!task.date && ngay > task.date };
}

/** Hạn có thật sự đổi không. Rỗng và undefined là cùng một thứ: chưa có hạn. */
export function caDoiHan(hanCu: string | undefined, hanMoi: string | undefined): boolean {
  return (hanCu || '') !== (hanMoi || '');
}

/**
 * Một mốc đổi hạn mới, để ghi bằng arrayUnion.
 *
 * Trả về MỘT phần tử chứ không phải cả mảng, và đó là chủ ý: lượt ghi ở
 * App.tsx dùng arrayUnion để máy chủ tự nối vào cuối. Đọc-rồi-ghi cả mảng thì
 * hai người đổi hạn cùng lúc sẽ ghi đè lên nhau — người ghi sau nối mốc của
 * mình vào bản mảng đã đọc từ trước, và mốc của người ghi trước biến mất. Số
 * phần tử vẫn tăng nên rules không bắt được, và nhật ký im lặng mất một dòng.
 *
 * Người gọi phải tự kiểm caDoiHan() trước: hạn không đổi thì không có mốc nào
 * để ghi, và một dòng "đổi hạn từ X sang X" làm nhật ký thành rác.
 */
export function taoMocDoiHan(
  moc: { hanCu: string; hanMoi: string; lyDo: string; userId: string; time?: Timestamp }
): DeadlineChange {
  return {
    id: Math.random().toString(36).slice(2, 11),
    hanCu: moc.hanCu || '',
    hanMoi: moc.hanMoi || '',
    lyDo: moc.lyDo.trim(),
    userId: moc.userId,
    time: moc.time ?? Timestamp.now(),
  };
}

/**
 * Ngày bắt đầu + số ngày dự kiến => hạn.
 *
 * Trả về null khi chưa đủ dữ kiện, để người gọi biết mà ĐỪNG đụng vào hạn hiện
 * có. Trước đây phép này nằm trong một useEffect: effect chạy cả lúc mở modal
 * nên chỉ xem một việc thôi là hạn đã bị tính lại đè lên hạn người ta chốt tay,
 * và StrictMode của bản dev còn chạy hai lần nên mọi cách chặn "lần đầu" đều
 * hỏng. Giờ nó chỉ chạy khi người dùng thật sự sửa hai ô đó.
 */
export function hanTheoThoiLuong(
  startDate: string | undefined,
  soNgay: number | undefined
): { estimatedDeadline: string; date: string } | null {
  if (!startDate || !soNgay || soNgay <= 0) return null;
  const d = new Date(`${startDate}T00:00:00`);
  d.setDate(d.getDate() + soNgay);
  const han = homNay(d);
  return { estimatedDeadline: han, date: han };
}

/** Hạn bị đẩy lùi (kéo dài) hay kéo lên sớm hơn — để hiện mũi tên đúng chiều. */
export function laKeoDaiHan(moc: Pick<DeadlineChange, 'hanCu' | 'hanMoi'>): boolean {
  return !moc.hanCu || moc.hanMoi > moc.hanCu;
}

/** Tổng số ngày đã kéo dài so với hạn đầu tiên từng đặt. */
export function soNgayDaKeoDai(task: Pick<Task, 'date' | 'deadlineHistory'>): number {
  const lichSu = task.deadlineHistory ?? [];
  const hanDau = lichSu.find((m) => m.hanCu)?.hanCu;
  if (!hanDau || !task.date) return 0;
  const ms = new Date(task.date).getTime() - new Date(hanDau).getTime();
  return Math.round(ms / 86_400_000);
}
