import { MAX_RECIPIENTS_PER_GROUP, type NotifyRecipient } from '../types';

// ===========================================================================
// Đọc danh sách người nhận từ thứ người ta THẬT SỰ dán vào.
//
// Không ai gõ tay 18 địa chỉ. Họ bôi một cột trong Excel rồi dán, hoặc chép từ
// ô "Đến" của một mail cũ. Nghĩa là đầu vào có đủ dạng trong cùng một lần dán:
//
//   hieutruong.hn@fpt.edu.vn
//   Nguyen Van A <a@fpt.edu.vn>, b@fpt.edu.vn; c@fpt.edu.vn
//   "Tran Thi B" <b2@fpt.edu.vn>
//
// Bắt người dùng tự dọn cho khớp một định dạng là cách chắc chắn nhất khiến họ
// quay lại dán thẳng vào Gmail. Nên phần này nhận tất, rồi NÓI RÕ dòng nào
// không đọc được thay vì lặng lẽ bỏ qua — bỏ qua im lặng nghĩa là một hiệu
// trưởng không nhận được thông báo và không ai biết.
// ===========================================================================

/**
 * Kiểm email ở mức "có gửi được không", cố ý KHÔNG chặt hơn.
 *
 * Regex email chặt theo RFC là một cái bẫy: nó dài, khó đọc, và vẫn từ chối
 * những địa chỉ hợp lệ có thật. Ở đây chỉ cần loại những thứ chắc chắn sai —
 * thiếu @, có khoảng trắng, thiếu chấm ở phần tên miền.
 */
export function laEmailHopLe(email: string): boolean {
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/.test(email);
}

/** Chuẩn hoá về dạng lưu trữ: bỏ khoảng trắng thừa, viết thường. */
export function chuanHoaEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Tách một mẩu văn bản thành người nhận.
 *
 * Trả về CẢ phần không đọc được. Bên gọi phải hiện chúng ra cho người dùng sửa.
 */
export function docDanhSachNguoiNhan(text: string): {
  recipients: NotifyRecipient[];
  invalid: string[];
} {
  const recipients: NotifyRecipient[] = [];
  const invalid: string[] = [];
  // Xuống dòng, phẩy, chấm phẩy, tab đều là dấu ngăn. Dấu phẩy nằm TRONG tên
  // ("Nguyen Van A, Hieu truong") sẽ bị cắt thành hai mẩu — chấp nhận, vì mẩu
  // thừa không có @ nên rơi vào invalid và người dùng nhìn thấy ngay.
  const mau = text.split(/[\n,;\t]+/);

  for (const raw of mau) {
    const s = raw.trim();
    if (!s) continue;

    // Dạng: Tên <email> hoặc "Tên" <email>
    const khop = s.match(/^(.*?)[<]([^>]+)[>]$/);
    const email = chuanHoaEmail(khop ? khop[2] : s);
    const name = khop ? khop[1].trim().replace(/^"|"$/g, '').trim() : '';

    if (!laEmailHopLe(email)) {
      invalid.push(s);
      continue;
    }
    recipients.push({ email, name });
  }
  return { recipients, invalid };
}

/**
 * Gộp nhiều danh sách và khử trùng theo email.
 *
 * Đây là hàm quyết định "gửi đúng một lần cho mỗi người". Một người vừa nằm ở
 * nhóm "Hiệu trưởng" vừa ở nhóm "Đầu mối CNTT" là chuyện thường; nhận hai email
 * giống hệt nhau cách nhau ba giây là thứ khiến người ta tắt thông báo.
 *
 * Giữ TÊN của lần gặp đầu tiên có tên. Bản ghi trước không tên mà bản sau có
 * thì lấy tên đó — thà xưng hô đúng còn hơn giữ nguyên một ô trống.
 */
export function gopNguoiNhan(danhSach: NotifyRecipient[][]): NotifyRecipient[] {
  const theoEmail = new Map<string, NotifyRecipient>();
  for (const ds of danhSach) {
    for (const r of ds) {
      const email = chuanHoaEmail(r.email);
      if (!email) continue;
      const cu = theoEmail.get(email);
      if (!cu) {
        theoEmail.set(email, { email, name: r.name.trim() });
      } else if (!cu.name && r.name.trim()) {
        theoEmail.set(email, { email, name: r.name.trim() });
      }
    }
  }
  return [...theoEmail.values()];
}

/** Quá trần thì cắt và nói rõ đã cắt bao nhiêu. Xem MAX_RECIPIENTS_PER_GROUP. */
export function catTheoTran(recipients: NotifyRecipient[]): {
  recipients: NotifyRecipient[];
  daCat: number;
} {
  if (recipients.length <= MAX_RECIPIENTS_PER_GROUP) {
    return { recipients, daCat: 0 };
  }
  return {
    recipients: recipients.slice(0, MAX_RECIPIENTS_PER_GROUP),
    daCat: recipients.length - MAX_RECIPIENTS_PER_GROUP,
  };
}

/** Viết một người nhận ra dạng người đọc được: `Tên <email>` hoặc `email`. */
export function moTaNguoiNhan(r: NotifyRecipient): string {
  return r.name ? `${r.name} <${r.email}>` : r.email;
}
