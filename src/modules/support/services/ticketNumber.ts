import { VN_OFFSET_MS } from './workingTime';

// ===========================================================================
// Sinh mã phiếu: FSC-<MODULE>-<YYMM>-<seq>
//
// Counter được CHIA MẢNH theo module + tháng thay vì dùng một document duy nhất.
//
// Vì sao: Firestore chịu khoảng 1 lượt ghi mỗi giây trên MỖI document. Một
// counter chung sẽ tuần tự hoá toàn bộ 5 phân hệ × 18 trường. Ngày thường thì
// không sao — vài phiếu một phút. Nhưng chế độ hỏng rơi đúng vào lúc tệ nhất:
// sự cố SYSTEM_WIDE khiến 18 trường nộp phiếu cùng lúc, transaction phía client
// thử lại ~5 lần rồi ném ABORTED, và người dùng thấy form lỗi SAU KHI đã điền
// xong. Chia theo module giảm tranh chấp 5 lần và làm việc reset đầu tháng trở
// nên tự nhiên.
//
// Việc đảo kỳ (sang tháng mới) PHẢI nằm trong cùng transaction. Dùng một cron
// "reset seq vào ngày 1" sẽ chạy đua với các phiếu đang bay và sinh ra mã trùng.
// ===========================================================================

/** 'YYMM' theo lịch Việt Nam. Phiếu nộp 23:30 ngày 31/08 giờ VN thuộc kỳ 2608. */
export function periodKey(nowUtcMs: number): string {
  const d = new Date(nowUtcMs + VN_OFFSET_MS);
  const yy = String(d.getUTCFullYear()).slice(-2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yy}${mm}`;
}

/** Id document của mảnh counter cho một module trong một kỳ. */
export function counterShardId(moduleCode: string, period: string): string {
  return `${moduleCode}_${period}`;
}

export function formatTicketNo(moduleCode: string, period: string, seq: number): string {
  return `FSC-${moduleCode}-${period}-${String(seq).padStart(4, '0')}`;
}

/**
 * Tính trạng thái counter kế tiếp. Tách thành hàm thuần để test được toàn bộ
 * logic đảo kỳ mà không cần Firestore.
 */
export function nextCounterState(
  current: { period: string; seq: number } | null,
  period: string
): { period: string; seq: number } {
  // Kỳ mới (hoặc mảnh chưa tồn tại) thì bắt đầu lại từ 1.
  if (!current || current.period !== period) return { period, seq: 1 };
  return { period, seq: current.seq + 1 };
}

const TICKET_NO_PATTERN = /^FSC-[A-Z0-9_]+-\d{4}-\d{4,}$/;

export function isValidTicketNo(value: string): boolean {
  return TICKET_NO_PATTERN.test(value);
}

/** Tách mã phiếu ngược lại thành các thành phần. Trả null nếu sai định dạng. */
export function parseTicketNo(
  value: string
): { moduleCode: string; period: string; seq: number } | null {
  if (!isValidTicketNo(value)) return null;
  const parts = value.split('-');
  const seq = Number(parts[parts.length - 1]);
  const period = parts[parts.length - 2];
  // Mã module có thể chứa dấu gạch dưới nhưng không chứa gạch ngang, nên phần
  // giữa luôn ghép lại được từ các đoạn còn lại.
  const moduleCode = parts.slice(1, parts.length - 2).join('-');
  return { moduleCode, period, seq };
}
