import { describe, expect, it } from 'vitest';
import { chuanHoaTrangThai, trangThaiTheoTienDo } from '../taskStatus';

// Trạng thái 'todo' ("Sẵn sàng") đã bị bỏ khỏi vòng đời công việc. Hai điều
// phải đúng sau khi bỏ, và đây là chỗ chốt chúng:
//   1. Việc CŨ mang 'todo' không được biến mất khỏi giao diện.
//   2. Việc MỚI ở 0% phải là "đang làm", không rơi lại vào một trạng thái chờ.

describe('chuanHoaTrangThai', () => {
  it('việc cũ mang todo được quy về đang làm, không biến mất', () => {
    // Không quy đổi thì task cũ lọt khỏi mọi bộ lọc và mọi cột bảng — nhìn vào
    // giống hệt như bị xoá mất.
    expect(chuanHoaTrangThai('todo')).toBe('in-progress');
  });

  it.each(['pending', 'in-progress', 'review', 'rejected', 'done'])(
    'giữ nguyên %s',
    (tt) => {
      expect(chuanHoaTrangThai(tt)).toBe(tt);
    }
  );

  it('giá trị lạ được giữ nguyên chứ không bị nuốt thành đang làm', () => {
    // Nuốt hết thành 'in-progress' là che mất dữ liệu hỏng: một task ghi sai
    // trạng thái sẽ trông như bình thường và không ai đi sửa.
    expect(chuanHoaTrangThai('mot-gia-tri-la')).toBe('mot-gia-tri-la');
    expect(chuanHoaTrangThai(undefined)).toBe(undefined);
  });
});

describe('trangThaiTheoTienDo', () => {
  it('0% là ĐANG LÀM, không phải chờ', () => {
    // Đây là chốt của cả thay đổi: giao việc là bắt đầu làm.
    expect(trangThaiTheoTienDo(0)).toBe('in-progress');
  });

  it.each([1, 50, 99])('%s%% là đang làm', (p) => {
    expect(trangThaiTheoTienDo(p)).toBe('in-progress');
  });

  it('100% là CHỜ NGHIỆM THU, không phải hoàn thành', () => {
    // Người làm không tự nghiệm thu cho mình.
    expect(trangThaiTheoTienDo(100)).toBe('review');
  });

  it('vượt quá 100 vẫn là chờ nghiệm thu', () => {
    expect(trangThaiTheoTienDo(120)).toBe('review');
  });
});
