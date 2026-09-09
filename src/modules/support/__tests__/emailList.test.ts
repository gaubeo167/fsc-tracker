import { describe, expect, it } from 'vitest';
import {
  catTheoTran,
  chuanHoaEmail,
  docDanhSachNguoiNhan,
  gopNguoiNhan,
  laEmailHopLe,
} from '../services/emailList';
import { MAX_RECIPIENTS_PER_GROUP } from '../types';

describe('docDanhSachNguoiNhan', () => {
  it('đọc được cột email dán thẳng từ Excel', () => {
    const { recipients, invalid } = docDanhSachNguoiNhan('a@fpt.edu.vn\nb@fpt.edu.vn\n\nc@fpt.edu.vn');
    expect(recipients.map((r) => r.email)).toEqual(['a@fpt.edu.vn', 'b@fpt.edu.vn', 'c@fpt.edu.vn']);
    expect(invalid).toEqual([]);
  });

  it('đọc được dạng "Tên <email>" chép từ ô Đến của một thư cũ', () => {
    const { recipients } = docDanhSachNguoiNhan('Nguyen Van A <a@fpt.edu.vn>, "Tran Thi B" <b@fpt.edu.vn>');
    expect(recipients).toEqual([
      { email: 'a@fpt.edu.vn', name: 'Nguyen Van A' },
      { email: 'b@fpt.edu.vn', name: 'Tran Thi B' },
    ]);
  });

  it('viết hoa thành viết thường, để khử trùng đúng', () => {
    const { recipients } = docDanhSachNguoiNhan('HieuTruong.HN@FPT.EDU.VN');
    expect(recipients[0].email).toBe('hieutruong.hn@fpt.edu.vn');
  });

  it('trả lại dòng KHÔNG đọc được thay vì lặng lẽ bỏ qua', () => {
    // Bỏ qua im lặng nghĩa là một người không nhận được thông báo và không ai biết.
    const { recipients, invalid } = docDanhSachNguoiNhan('a@fpt.edu.vn\nkhong-phai-email\nb@@x');
    expect(recipients).toHaveLength(1);
    expect(invalid).toEqual(['khong-phai-email', 'b@@x']);
  });
});

describe('laEmailHopLe', () => {
  it.each(['a@fpt.edu.vn', 'nguyen.van.a@fe.edu.vn', 'a+tag@fpt.edu.vn'])('nhận %s', (e) => {
    expect(laEmailHopLe(e)).toBe(true);
  });

  it.each(['a@fpt', 'a fpt.edu.vn', '@fpt.edu.vn', 'a@ fpt.edu.vn', ''])('loại %s', (e) => {
    expect(laEmailHopLe(e)).toBe(false);
  });
});

describe('gopNguoiNhan', () => {
  it('một người ở HAI nhóm chỉ nhận MỘT thư', () => {
    // Nhận hai thư giống hệt nhau cách nhau ba giây là thứ khiến người ta tắt
    // thông báo. Đây là hàm quyết định điều đó.
    const nhomA = [{ email: 'a@fpt.edu.vn', name: 'A' }, { email: 'b@fpt.edu.vn', name: '' }];
    const nhomB = [{ email: 'A@fpt.edu.vn', name: 'A' }, { email: 'c@fpt.edu.vn', name: 'C' }];
    expect(gopNguoiNhan([nhomA, nhomB]).map((r) => r.email)).toEqual([
      'a@fpt.edu.vn', 'b@fpt.edu.vn', 'c@fpt.edu.vn',
    ]);
  });

  it('lấy được tên từ nhóm sau khi nhóm trước để trống', () => {
    const g = gopNguoiNhan([[{ email: 'a@fpt.edu.vn', name: '' }], [{ email: 'a@fpt.edu.vn', name: 'Nguyen Van A' }]]);
    expect(g).toEqual([{ email: 'a@fpt.edu.vn', name: 'Nguyen Van A' }]);
  });
});

describe('catTheoTran', () => {
  it('dưới trần thì giữ nguyên', () => {
    const r = catTheoTran([{ email: 'a@fpt.edu.vn', name: '' }]);
    expect(r).toEqual({ recipients: [{ email: 'a@fpt.edu.vn', name: '' }], daCat: 0 });
  });

  it('quá trần thì cắt và NÓI RÕ cắt bao nhiêu', () => {
    const nhieu = Array.from({ length: MAX_RECIPIENTS_PER_GROUP + 7 }, (_, i) => ({
      email: `u${i}@fpt.edu.vn`, name: '',
    }));
    const r = catTheoTran(nhieu);
    expect(r.recipients).toHaveLength(MAX_RECIPIENTS_PER_GROUP);
    expect(r.daCat).toBe(7);
  });
});

describe('chuanHoaEmail', () => {
  it('bỏ khoảng trắng thừa hai đầu', () => {
    expect(chuanHoaEmail('  A@FPT.edu.vn \n')).toBe('a@fpt.edu.vn');
  });
});
