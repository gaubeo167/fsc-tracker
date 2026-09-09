import { describe, expect, it } from 'vitest';
import { boDau, filterCampuses } from '../services/campusSearch';
import type { Campus } from '../types';

// ===========================================================================
// Ô tìm trường xuất hiện ở hai màn: admin quản lý trường, và người mới tự chọn
// đơn vị công tác. Người gõ không dấu trên điện thoại là trường hợp THƯỜNG GẶP
// nhất, không phải ngoại lệ — nên nó là thứ đáng test nhất ở đây.
// ===========================================================================

function campus(over: Partial<Campus>): Campus {
  return {
    id: 'DN01',
    code: 'DN01',
    name: 'FPT Schools Đà Nẵng 1',
    region: 'Miền Trung',
    isActive: true,
    ...over,
  } as Campus;
}

const ROWS: Campus[] = [
  campus({}),
  campus({
    id: 'HN02',
    code: 'HN02',
    name: 'FPT Schools Hà Nội',
    region: 'Miền Bắc',
    province: 'Hà Nội',
    address: 'Khu Công nghệ cao Hoà Lạc',
  }),
  campus({ id: 'HCM01', code: 'HCM01', name: 'FPT Schools TP. Hồ Chí Minh', region: 'Miền Nam' }),
];

describe('boDau', () => {
  it('bỏ dấu thanh và dấu mũ', () => {
    expect(boDau('Đà Nẵng')).toBe('da nang');
  });

  it('xử lý được chữ đ — NFD không tách được ký tự này', () => {
    expect(boDau('Đại học')).toBe('dai hoc');
  });
});

describe('filterCampuses', () => {
  it('chuỗi rỗng trả về nguyên danh sách', () => {
    expect(filterCampuses(ROWS, '   ')).toHaveLength(3);
  });

  it('gõ KHÔNG DẤU vẫn tìm ra trường có dấu', () => {
    expect(filterCampuses(ROWS, 'da nang').map((c) => c.code)).toEqual(['DN01']);
  });

  it('tìm được theo mã trường', () => {
    expect(filterCampuses(ROWS, 'hcm').map((c) => c.code)).toEqual(['HCM01']);
  });

  it('tìm được theo địa chỉ — thứ người ta nhớ rõ hơn mã trường', () => {
    expect(filterCampuses(ROWS, 'hoa lac').map((c) => c.code)).toEqual(['HN02']);
  });

  it('không khớp thì trả về rỗng, không phải trả về tất cả', () => {
    // Trả về tất cả khi không khớp là kiểu hỏng âm thầm tệ nhất của một ô tìm
    // kiếm: người dùng tưởng trường mình có trong danh sách và chọn nhầm.
    expect(filterCampuses(ROWS, 'khong-co-truong-nay')).toEqual([]);
  });
});
