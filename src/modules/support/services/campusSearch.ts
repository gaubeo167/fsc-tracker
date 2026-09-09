import type { Campus } from '../types';

// ===========================================================================
// Tìm trường theo chữ người dùng gõ.
//
// Tách khỏi component vì có HAI màn cần đúng một cách khớp: màn quản lý trường
// của admin, và màn người dùng mới tự chọn đơn vị công tác. Để mỗi bên tự viết
// lại thì một bên tìm được "da nang" còn bên kia thì không, mà không ai biết vì
// sao — cùng một ô tìm kiếm, hai kết quả khác nhau.
// ===========================================================================

/**
 * Bỏ dấu tiếng Việt để gõ không dấu vẫn tìm ra.
 *
 * Phải thay tay đ/Đ: NFD không phân rã được ký tự này (nó không phải d + dấu),
 * bỏ sót là "Đà Nẵng" thành "à nẵng" ở một số phiên bản Unicode.
 */
export function boDau(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
}

/** Chuỗi dùng để khớp: gom mọi thứ người ta có thể nhớ về một cơ sở. */
function kimChiNam(c: Campus): string {
  return boDau(
    `${c.code} ${c.name} ${c.address ?? ''} ${c.province ?? ''} ${c.region ?? ''} ${c.levels ?? ''}`
  );
}

/**
 * Lọc danh sách trường theo từ khoá. Chuỗi rỗng trả về nguyên danh sách.
 *
 * Khớp cả địa chỉ và tỉnh, không chỉ tên: người ở cơ sở Đà Nẵng 3 nhớ đường mình
 * đi làm hằng ngày rõ hơn nhớ mã DN03.
 */
export function filterCampuses(rows: Campus[], q: string): Campus[] {
  const needle = boDau(q.trim());
  if (!needle) return rows;
  return rows.filter((c) => kimChiNam(c).includes(needle));
}
