import type { TaskStatus } from '../types';

// ===========================================================================
// Hai phép suy ra trạng thái công việc, gom về một chỗ.
//
// Bối cảnh: trạng thái 'todo' ("Sẵn sàng") đã bị bỏ khỏi vòng đời. Vòng đời còn
// lại đúng như chủ dự án chốt: yêu cầu thành công việc -> ĐANG LÀM -> cập nhật
// tiến độ -> hoàn thành, hoặc quá hạn.
//
// Vì sao là file riêng chứ không nằm trong App.tsx: luật "0% cũng là đang làm"
// được áp ở HAI chỗ (thanh kéo ngoài thẻ việc và thanh kéo trong modal), còn
// luật quy đổi 'todo' được áp ở hai nơi đọc dữ liệu khác nhau. Chép tay bốn bản
// là cách chắc chắn nhất để một hôm nào đó chúng lệch nhau. Tách ra đây cũng để
// test được mà không phải nạp cả App.tsx (nó khởi tạo Firebase lúc import).
// ===========================================================================

/**
 * Quy đổi trạng thái đọc từ Firestore.
 *
 * Task tạo TRƯỚC khi bỏ "Sẵn sàng" vẫn mang 'todo' và sẽ mang mãi — dữ liệu
 * lịch sử không được viết lại. Không quy đổi thì chúng rơi vào một trạng thái
 * không còn ô nào hiển thị: mất khỏi mọi bộ lọc, mọi cột bảng, mọi biểu đồ,
 * trông y như bị xoá.
 */
export function chuanHoaTrangThai(status: unknown): TaskStatus {
  return status === 'todo' ? 'in-progress' : (status as TaskStatus);
}

/**
 * Tiến độ quyết định trạng thái.
 *
 * 0% CŨNG là đang làm: bỏ "Sẵn sàng" nghĩa là bỏ luôn khoảng chờ giữa lúc giao
 * việc và lúc bắt tay vào làm. 100% là chờ nghiệm thu, không phải hoàn thành —
 * người làm không tự nghiệm thu cho mình.
 */
export function trangThaiTheoTienDo(progress: number): TaskStatus {
  return progress >= 100 ? 'review' : 'in-progress';
}

/**
 * Nhãn tiếng Việt của trạng thái.
 *
 * Gom về đây vì chuỗi ternary này từng được chép tay ở năm chỗ (thẻ việc, dòng
 * danh sách, bảng, modal chi tiết, đầu cột Kanban). Năm bản chép tay là năm cơ
 * hội để một hôm nào đó chúng nói khác nhau về cùng một việc.
 *
 * KHÔNG có nhãn 'QUÁ HẠN' ở đây, và đó là chủ ý: quá hạn không phải trạng thái
 * mà là nhãn dán thêm, hiện song song. Trước đây nó ĐÈ LÊN nhãn thật, nên một
 * việc đang chờ nghiệm thu mà lỡ hạn thì hiện ra "QUÁ HẠN" — người ta mất dấu
 * việc đang chờ chính mình bấm nghiệm thu, và tưởng việc quá hạn thì hệ thống
 * khoá lại không cho làm gì nữa.
 */
export function nhanTrangThai(status: TaskStatus | string): string {
  switch (chuanHoaTrangThai(status)) {
    case 'pending': return 'CHỜ DUYỆT';
    case 'in-progress': return 'ĐANG LÀM';
    case 'review': return 'CHỜ NGHIỆM THU';
    case 'rejected': return 'BỊ TỪ CHỐI';
    case 'done': return 'HOÀN THÀNH';
    default: return String(status || '').toUpperCase();
  }
}

/**
 * Người thực hiện còn kéo được thanh tiến độ ở trạng thái này không.
 *
 * 'review' CÓ, và đây là thay đổi: việc đã 100% chờ nghiệm thu mà phát sinh
 * thêm thì phải kéo tiến độ xuống được để nói rằng mình đang làm tiếp, thay vì
 * chờ người nghiệm thu từ chối hộ. 'pending' thì chưa duyệt nên chưa bắt đầu,
 * 'done' đã nghiệm thu thì phải mở lại chứ không sửa lén tiến độ.
 */
export function coTheKeoTienDo(status: TaskStatus | string): boolean {
  const s = chuanHoaTrangThai(status);
  return s === 'in-progress' || s === 'rejected' || s === 'review';
}
