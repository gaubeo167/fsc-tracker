import type { NotifyRecipient } from '../types';

// ===========================================================================
// Chỗ điền động trong mẫu email.
//
// Cố ý CHỈ có bốn chỗ, và cố ý không có vòng lặp, không có điều kiện, không có
// biểu thức. Một ngôn ngữ mẫu đầy đủ nghĩa là admin gõ sai một dấu ngoặc thì
// 300 người nhận được email hỏng, và không có ai review giữa hai việc đó.
//
// Chỗ điền viết bằng TIẾNG VIỆT không dấu ({{ten}} chứ không phải {{name}}):
// người soạn mẫu là cán bộ nghiệp vụ, không phải lập trình viên.
// ===========================================================================

export interface NguCanh {
  recipient: NotifyRecipient;
  senderName: string;
}

export const CHO_DIEN = [
  { key: 'ten', label: 'Tên người nhận', vd: 'Nguyễn Văn A' },
  { key: 'email', label: 'Email người nhận', vd: 'a@fpt.edu.vn' },
  { key: 'ngay', label: 'Ngày gửi', vd: '09/09/2026' },
  { key: 'nguoigui', label: 'Tên người gửi', vd: 'Phòng Phát triển ứng dụng' },
] as const;

/** Ngày theo định dạng Việt Nam, giờ Việt Nam. */
function ngayVN(d: Date): string {
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
  }).format(d);
}

/**
 * Điền chỗ trống trong mẫu.
 *
 * Chỗ điền KHÔNG biết tên thì giữ nguyên chữ `{{...}}` thay vì thay bằng rỗng.
 * Xoá đi thì một lỗi gõ ({{tên}} có dấu) biến thành một câu cụt nghĩa mà không
 * ai phát hiện; giữ nguyên thì nó đập vào mắt ngay ở khung xem trước.
 *
 * `{{ten}}` khi người nhận không có tên sẽ rơi về phần trước dấu @ của email —
 * "Kính gửi ," là lỗi hiển nhiên nhất mà một email hàng loạt có thể mắc.
 */
export function dienMau(mau: string, nc: NguCanh, now: Date = new Date()): string {
  const ten = nc.recipient.name.trim() || nc.recipient.email.split('@')[0];
  const giaTri: Record<string, string> = {
    ten,
    email: nc.recipient.email,
    ngay: ngayVN(now),
    nguoigui: nc.senderName,
  };
  return mau.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (nguyenVan, key: string) =>
    key in giaTri ? giaTri[key] : nguyenVan
  );
}

/** Những chỗ điền KHÔNG hợp lệ có trong mẫu, để cảnh báo trước khi gửi. */
export function choDienLa(mau: string): string[] {
  const biet = new Set<string>(CHO_DIEN.map((c) => c.key));
  const thay = new Set<string>();
  for (const m of mau.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)) {
    if (!biet.has(m[1])) thay.add(m[1]);
  }
  return [...thay];
}
