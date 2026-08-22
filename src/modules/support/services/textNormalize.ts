// ===========================================================================
// Chuẩn hoá văn bản tiếng Việt cho việc quét trùng.
//
// Bài toán thật: người báo lỗi ở 18 trường gõ cả có dấu lẫn không dấu, cùng một
// lỗi. "Không đăng nhập được", "khong dang nhap duoc", "Ko đăng nhập đc" phải
// quy về cùng một dạng thì mới so khớp được.
//
// Firestore không có `unaccent`, không có `tsvector`, không có trigram index —
// những thứ spec §6 giả định là có sẵn vì spec viết cho PostgreSQL. Toàn bộ
// phần này phải tự làm bằng TypeScript và chạy được ở cả trình duyệt lẫn Node.
// ===========================================================================

/**
 * Stopword theo §6 spec, viết ở dạng ĐÃ BỎ DẤU vì việc lọc diễn ra sau khi
 * chuẩn hoá. Danh sách cố ý ngắn: cắt quá tay sẽ xoá mất từ mang nghĩa
 * ("không đăng nhập được" mà bỏ "không" thì đảo ngược ý nghĩa câu).
 */
export const VI_STOPWORDS = new Set([
  'cua', 'va', 'bi', 'khong', 'khi', 'thi', 'la', 'cho', 'cac', 'mot',
]);

/**
 * Viết tắt phổ biến trong tin nhắn công việc tiếng Việt. Không có bảng này thì
 * "ko dang nhap dc" và "khong dang nhap duoc" bị coi là hai lỗi khác nhau, dù
 * đó là cách gõ thường gặp nhất trên điện thoại.
 *
 * ⚠️ Vế phải PHẢI viết đúng như dạng đầy đủ, kể cả khoảng trắng. Nếu để
 * hs -> 'hocsinh' (dính liền) trong khi "học sinh" tách thành hai token
 * 'hoc' + 'sinh', thì bảng viết tắt lại TẠO RA chỗ không khớp thay vì xoá nó:
 * người gõ "hs" và người gõ "học sinh" báo cùng một lỗi mà không bao giờ khớp.
 */
const ABBREVIATIONS: Record<string, string> = {
  ko: 'khong',
  k: 'khong',
  kh: 'khong',
  dc: 'duoc',
  bik: 'biet',
  hs: 'hoc sinh',
  gv: 'giao vien',
  ph: 'phu huynh',
  dk: 'dang ky',
  // Đánh đổi đã cân nhắc: 'ĐN' trần cũng là cách viết tắt Đà Nẵng. Nhưng mã
  // trường trong hệ thống là DN01 (token 'dn01', không chạm bảng này), còn 'dn'
  // trong câu tiếng Việt viết tắt gần như luôn là đăng nhập. Giữ lại, và nhớ
  // rằng quét trùng chỉ GỢI Ý — người gửi vẫn là người quyết định.
  dn: 'dang nhap',
};

/**
 * Bỏ dấu tiếng Việt.
 *
 * NFD tách nguyên âm khỏi dấu thanh/dấu mũ rồi xoá các ký tự tổ hợp.
 * Riêng đ/Đ KHÔNG phân rã được bằng NFD (nó là một ký tự độc lập, không phải
 * d + dấu), nên phải thay tay — bỏ sót là "đăng nhập" thành "đang nhap" ở máy
 * này và "ăng nhập" ở máy khác tuỳ phiên bản Unicode.
 */
export function removeDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Chuẩn hoá một chuỗi về dạng lưu trữ / so khớp:
 * thường hoá -> bỏ dấu -> bỏ ký tự đặc biệt -> gộp khoảng trắng.
 *
 * ⚠️ Mất thông tin có chủ đích: sửa / sữa / sưa đều thành "sua". Đây là đánh đổi
 * bắt buộc để khớp được văn bản không dấu, và là nguồn dương tính giả đã biết.
 * Vì vậy quét trùng chỉ GỢI Ý, quyết định gộp luôn thuộc về người (§6).
 */
export function normalizeText(input: string): string {
  return removeDiacritics(input.toLowerCase())
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tách chuỗi đã chuẩn hoá thành tập token dùng để so khớp.
 * Bỏ stopword, bỏ token 1 ký tự, khử trùng lặp.
 */
export function tokenize(input: string): string[] {
  const seen = new Set<string>();
  for (const raw of normalizeText(input).split(' ')) {
    if (!raw) continue;
    // Viết tắt nở ra có thể thành NHIỀU từ ("hs" -> "hoc sinh"), nên phải tách
    // tiếp rồi thêm từng token. Thêm nguyên chuỗi là tạo ra token 'hoc sinh'
    // không bao giờ khớp với gì.
    for (const word of (ABBREVIATIONS[raw] ?? raw).split(' ')) {
      // Bỏ token một ký tự, TRỪ chữ số.
      //
      // "lớp 6" và "lớp 7" mà cùng ra ['lop'] thì hai phiếu về hai lớp khác
      // nhau bị chấm là trùng nhau — mà số lớp lại đúng là thứ phân biệt rõ
      // nhất trong phiếu của một trường học.
      if (word.length < 2 && !/^[0-9]$/.test(word)) continue;
      if (VI_STOPWORDS.has(word)) continue;
      seen.add(word);
    }
  }
  return [...seen];
}

/**
 * Tập trigram ký tự của chuỗi đã chuẩn hoá.
 * Bắt được lỗi gõ sai và biến thể mà so khớp theo từ bỏ lỡ
 * ("dang nhap" vs "dangnhap").
 */
export function trigrams(input: string): Set<string> {
  const s = `  ${normalizeText(input)} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

/** Hệ số Dice trên hai tập. 1 = trùng khớp hoàn toàn, 0 = không chung phần tử. */
export function diceCoefficient<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  return (2 * shared) / (a.size + b.size);
}
