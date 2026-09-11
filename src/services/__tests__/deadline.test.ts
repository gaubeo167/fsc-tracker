import { describe, expect, it } from 'vitest';
import {
  caDoiHan, datCoHoanThanh, hanTheoThoiLuong, homNay, laKeoDaiHan, quaHan,
  soNgayDaKeoDai, taoMocDoiHan,
} from '../deadline';
import type { DeadlineChange } from '../../types';

const NGAY = (s: string) => new Date(`${s}T09:00:00`);

describe('quaHan', () => {
  it('hạn đã qua mà việc chưa xong là quá hạn', () => {
    expect(quaHan({ date: '2026-09-05', status: 'in-progress' }, NGAY('2026-09-11'))).toBe(true);
  });

  it('đúng ngày hết hạn thì CHƯA quá hạn', () => {
    // Hạn là hết ngày hôm đó, không phải đầu ngày.
    expect(quaHan({ date: '2026-09-11', status: 'in-progress' }, NGAY('2026-09-11'))).toBe(false);
  });

  it('⭐ việc chờ nghiệm thu mà lỡ hạn vẫn là quá hạn', () => {
    // Đây là bốn việc đang mắc trên production: 100%, chờ nghiệm thu, đã lỡ hạn.
    expect(quaHan({ date: '2026-09-09', status: 'review' }, NGAY('2026-09-11'))).toBe(true);
  });

  it('việc đã nghiệm thu thì không còn "đang quá hạn"', () => {
    expect(quaHan({ date: '2026-01-01', status: 'done' }, NGAY('2026-09-11'))).toBe(false);
  });

  it('việc chưa có hạn thì không quá hạn', () => {
    expect(quaHan({ date: '', status: 'in-progress' }, NGAY('2026-09-11'))).toBe(false);
  });

  it('không lệch ngày vì múi giờ', () => {
    // Chuỗi 'yyyy-MM-dd' so với giờ ĐỊA PHƯƠNG. Dùng new Date('2026-09-11') là
    // mốc UTC, ở Việt Nam sẽ thành 07:00 cùng ngày — nhưng gần nửa đêm thì phép
    // so lệch hẳn một ngày và việc bị bêu "quá hạn" sớm một hôm.
    expect(homNay(new Date('2026-09-11T23:30:00'))).toBe('2026-09-11');
    expect(homNay(new Date('2026-09-11T00:30:00'))).toBe('2026-09-11');
  });
});

describe('datCoHoanThanh', () => {
  it('⭐ nghiệm thu sau hạn thì đóng dấu trễ', () => {
    expect(datCoHoanThanh({ date: '2026-09-05' }, NGAY('2026-09-11')))
      .toEqual({ doneAt: '2026-09-11', doneLate: true });
  });

  it('nghiệm thu đúng ngày hết hạn thì không trễ', () => {
    expect(datCoHoanThanh({ date: '2026-09-11' }, NGAY('2026-09-11')))
      .toEqual({ doneAt: '2026-09-11', doneLate: false });
  });

  it('việc không có hạn thì không thể trễ', () => {
    expect(datCoHoanThanh({ date: '' }, NGAY('2026-09-11')))
      .toEqual({ doneAt: '2026-09-11', doneLate: false });
  });
});

describe('taoMocDoiHan', () => {
  const moc = { hanCu: '2026-09-05', hanMoi: '2026-09-20', lyDo: '  Chen việc gấp  ', userId: 'u1' };

  it('giữ nguyên hạn cũ và hạn mới', () => {
    const m = taoMocDoiHan(moc);
    expect(m.hanCu).toBe('2026-09-05');
    expect(m.hanMoi).toBe('2026-09-20');
    expect(m.userId).toBe('u1');
  });

  it('cắt khoảng trắng thừa của lý do', () => {
    expect(taoMocDoiHan(moc).lyDo).toBe('Chen việc gấp');
  });

  it('mỗi mốc có id riêng — arrayUnion khử trùng lặp theo giá trị', () => {
    // Hai mốc giống hệt nhau về nội dung mà trùng id thì arrayUnion nuốt mất
    // cái thứ hai, và một lần đổi hạn biến mất khỏi nhật ký.
    expect(taoMocDoiHan(moc).id).not.toBe(taoMocDoiHan(moc).id);
  });

  it('lần đầu đặt hạn cho việc chưa có hạn', () => {
    const m = taoMocDoiHan({ ...moc, hanCu: '', hanMoi: '2026-09-20' });
    expect(m.hanCu).toBe('');
    expect(laKeoDaiHan(m)).toBe(true);
  });
});

describe('caDoiHan', () => {
  it('⭐ hạn không đổi thì không sinh bản ghi', () => {
    // Bấm lưu mà không đụng vào ô ngày là chuyện xảy ra suốt. Mỗi lần như vậy
    // đẻ ra một dòng "đổi hạn từ X sang X" thì nhật ký thành rác trong một tuần.
    expect(caDoiHan('2026-09-20', '2026-09-20')).toBe(false);
  });

  it('rỗng và undefined là cùng một thứ: chưa có hạn', () => {
    expect(caDoiHan(undefined, '')).toBe(false);
    expect(caDoiHan('', '2026-09-20')).toBe(true);
    expect(caDoiHan('2026-09-20', '')).toBe(true);
  });
});

describe('soNgayDaKeoDai', () => {
  const lichSu = (...cap: Array<[string, string]>): DeadlineChange[] =>
    cap.map(([hanCu, hanMoi], i) => ({
      id: `m${i}`, hanCu, hanMoi, lyDo: 'lý do', userId: 'u1', time: null as never,
    }));

  it('cộng dồn qua nhiều lần đổi, tính từ hạn đầu tiên', () => {
    expect(soNgayDaKeoDai({
      date: '2026-09-25',
      deadlineHistory: lichSu(['2026-09-05', '2026-09-15'], ['2026-09-15', '2026-09-25']),
    })).toBe(20);
  });

  it('kéo lên sớm hơn thì ra số âm', () => {
    expect(soNgayDaKeoDai({
      date: '2026-09-01', deadlineHistory: lichSu(['2026-09-05', '2026-09-01']),
    })).toBe(-4);
  });

  it('việc chưa từng đổi hạn thì bằng 0', () => {
    expect(soNgayDaKeoDai({ date: '2026-09-05', deadlineHistory: [] })).toBe(0);
  });

  it('bỏ qua mốc đầu tiên nếu trước đó chưa có hạn', () => {
    // Phiếu hỗ trợ tiếp nhận ở chế độ "chưa xác định hạn": mốc đầu là lần ĐẶT
    // hạn chứ không phải lần kéo dài, lấy nó làm gốc thì ra một con số vô nghĩa.
    expect(soNgayDaKeoDai({
      date: '2026-09-20', deadlineHistory: lichSu(['', '2026-09-10'], ['2026-09-10', '2026-09-20']),
    })).toBe(10);
  });
});

describe('hanTheoThoiLuong', () => {
  it('cộng số ngày dự kiến vào ngày bắt đầu', () => {
    expect(hanTheoThoiLuong('2026-09-10', 5))
      .toEqual({ estimatedDeadline: '2026-09-15', date: '2026-09-15' });
  });

  it('⭐ thiếu dữ kiện thì KHÔNG đụng vào hạn đang có', () => {
    // Trả null chứ không trả hôm nay: việc tiếp nhận ở chế độ "chưa xác định
    // hạn" có startDate mà chưa có số ngày, tính bừa là nó có một cái hạn
    // chưa ai đặt.
    expect(hanTheoThoiLuong('2026-09-10', 0)).toBeNull();
    expect(hanTheoThoiLuong('', 5)).toBeNull();
    expect(hanTheoThoiLuong(undefined, undefined)).toBeNull();
  });

  it('không lệch ngày khi cộng qua đầu tháng', () => {
    expect(hanTheoThoiLuong('2026-09-28', 5)?.date).toBe('2026-10-03');
  });
});
