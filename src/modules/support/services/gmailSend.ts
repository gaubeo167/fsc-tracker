import type { NotifyRecipient } from '../types';

// ===========================================================================
// Gửi email bằng CHÍNH hộp thư của người đang bấm nút, qua Gmail API.
//
// Vì sao không dùng dịch vụ gửi thư (Resend, SendGrid): chủ dự án chốt gửi bằng
// hộp thư @fpt.edu.vn của mình. Điều đó đổi hẳn kiến trúc theo hướng TỐT HƠN
// cho việc này:
//   - Không có khoá API nào phải cất giữ, nên không cần thêm máy chủ.
//   - Người nhận thấy thư đến từ một người thật trong trường, không phải một
//     địa chỉ no-reply lạ hoắc — thứ quyết định thư vào Inbox hay vào Junk.
//   - Mọi thư đã gửi nằm trong mục "Đã gửi" của chính hộp thư đó. Sổ sách kiểm
//     tra có sẵn, không phải dựng thêm.
//
// Cái giá phải trả, phải nói rõ vì nó có thật:
//   - Trình duyệt phải mở trong suốt lượt gửi. Đóng tab là dừng giữa chừng, nên
//     mới có trạng thái PENDING của từng người nhận để gửi tiếp.
//   - Hạn mức Gmail Workspace ~2000 người nhận ngoài tổ chức mỗi ngày.
//   - Google Cloud của dự án phải BẬT Gmail API và cấp scope gmail.send.
// ===========================================================================

/** Scope tối thiểu: chỉ gửi, KHÔNG đọc thư. Không xin quyền đọc hộp thư của ai. */
export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';

const GMAIL_SEND_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send';

/**
 * Bỏ ký tự xuống dòng khỏi một giá trị header.
 *
 * Đây là chốt chặn TIÊM HEADER, không phải việc dọn dẹp cho đẹp. Một cái tên
 * chứa "\r\nBcc: ..." mà lọt vào header nghĩa là người dán danh sách vừa âm
 * thầm thêm người nhận vào mọi thư gửi đi.
 */
function locHeader(v: string): string {
  return v.replace(/[\r\n]+/g, ' ').trim();
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** base64url cho trường `raw` của Gmail API: +/ đổi thành -_, bỏ dấu = ở cuối. */
export function base64Url(s: string): string {
  return base64(new TextEncoder().encode(s)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mã hoá một giá trị header có dấu tiếng Việt theo RFC 2047.
 *
 * ASCII thuần thì để nguyên — dễ đọc khi soi thư gốc. Có dấu thì phải mã hoá,
 * không thì tiêu đề "Thông báo tính năng mới" hiện ra thành ký tự rác ở một số
 * ứng dụng thư.
 *
 * Cắt thành nhiều mẩu <= 45 byte và nối bằng ngắt dòng có thụt đầu: header dài
 * quá 78 ký tự là sai chuẩn, và một số máy chủ cắt cụt nó. Cắt theo KÝ TỰ chứ
 * không theo byte, vì cắt giữa một ký tự UTF-8 nhiều byte là hỏng chữ đó.
 */
export function maHoaHeader(raw: string): string {
  const v = locHeader(raw);
  if (!v) return '';
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(v)) return v;

  const enc = new TextEncoder();
  const mau: string[] = [];
  let hienTai = '';
  let soByte = 0;
  for (const ch of v) {
    const n = enc.encode(ch).length;
    if (soByte + n > 45) {
      mau.push(hienTai);
      hienTai = '';
      soByte = 0;
    }
    hienTai += ch;
    soByte += n;
  }
  if (hienTai) mau.push(hienTai);
  return mau.map((m) => `=?UTF-8?B?${base64(enc.encode(m))}?=`).join('\r\n ');
}

/** `Tên <email>`, tên đã mã hoá và bọc nháy khi cần. */
export function diaChiHeader(email: string, name: string): string {
  const e = locHeader(email);
  const n = locHeader(name);
  if (!n) return e;
  const daMa = maHoaHeader(n);
  // Chỉ bọc nháy khi tên còn là ASCII thuần. Bọc nháy quanh một encoded-word là
  // sai chuẩn: ứng dụng thư sẽ hiện nguyên chuỗi =?UTF-8?B?... ra màn hình.
  const canNhay = daMa === n && /[",;:<>@()\[\]\\.]/.test(n);
  return `${canNhay ? `"${n.replace(/"/g, '')}"` : daMa} <${e}>`;
}

export interface ThuGui {
  from: { email: string; name: string };
  to: NotifyRecipient;
  subject: string;
  /** Thân thư dạng chữ thuần. Xem ghi chú trong taoThuMIME. */
  body: string;
}

/**
 * Dựng thư ở dạng MIME thô.
 *
 * Chữ THUẦN chứ không phải HTML, cố ý. Thư nội bộ dạng chữ thuần đọc được ở mọi
 * ứng dụng, không có gì để hỏng bố cục, không có gì phải khử độc, và Gmail tự
 * biến địa chỉ web thành liên kết. Đổi sang HTML là nhận thêm nghĩa vụ khử độc
 * nội dung admin gõ, cho một thứ không ai đòi.
 */
export function taoThuMIME(t: ThuGui): string {
  const body = t.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  return [
    `From: ${diaChiHeader(t.from.email, t.from.name)}`,
    `To: ${diaChiHeader(t.to.email, t.to.name)}`,
    `Subject: ${maHoaHeader(t.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64(new TextEncoder().encode(body)),
  ].join('\r\n');
}

export class GmailError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** true khi gửi lại có thể thành công (mạng chập, quá nhanh). */
    public readonly thuLaiDuoc: boolean
  ) {
    super(message);
    this.name = 'GmailError';
  }
}

/**
 * Dịch lỗi của Gmail sang câu người dùng làm được gì với nó.
 *
 * Nguyên văn tiếng Anh của Google nói đúng chuyện đang xảy ra nhưng không nói
 * phải làm gì, mà người bấm nút ở đây là cán bộ nghiệp vụ. Giữ lại mã lỗi để
 * ảnh chụp màn hình vẫn đủ dùng khi phải hỏi kỹ thuật.
 */
export function dichLoiGmail(status: number, raw: string): GmailError {
  if (status === 401) {
    return new GmailError('GMAIL_TOKEN', 'Phiên gửi thư đã hết hạn. Bấm "Kết nối Gmail" rồi gửi tiếp.', false);
  }
  if (status === 403 && /has not been used|is disabled|SERVICE_DISABLED/i.test(raw)) {
    return new GmailError(
      'GMAIL_API_TAT',
      'Gmail API chưa được bật cho dự án này. Bật trong Google Cloud Console rồi thử lại.',
      false
    );
  }
  if (status === 403) {
    return new GmailError(
      'GMAIL_TU_CHOI',
      'Google từ chối lượt gửi. Thường là chưa cấp quyền gửi thư, hoặc đã chạm hạn mức gửi trong ngày.',
      false
    );
  }
  if (status === 429 || status === 500 || status === 503) {
    return new GmailError('GMAIL_CHAM_LAI', 'Google đang chặn vì gửi quá nhanh. Sẽ tự thử lại.', true);
  }
  return new GmailError('GMAIL_LOI', `Gmail báo lỗi ${status}: ${raw.slice(0, 200)}`, false);
}

/** Gửi đúng MỘT thư. Ném GmailError khi hỏng. */
export async function guiMotThu(accessToken: string, thu: ThuGui): Promise<void> {
  const res = await fetch(GMAIL_SEND_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: base64Url(taoThuMIME(thu)) }),
  });
  if (!res.ok) {
    throw dichLoiGmail(res.status, await res.text().catch(() => ''));
  }
}
