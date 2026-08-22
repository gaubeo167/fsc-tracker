import { describe, expect, it } from 'vitest';
import {
  counterShardId,
  formatTicketNo,
  isValidTicketNo,
  nextCounterState,
  parseTicketNo,
  periodKey,
} from '../services/ticketNumber';

/** Đổi giờ Việt Nam sang mốc UTC. */
function vn(date: string, hour: number, minute = 0): number {
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - 7 * 3600_000;
}

describe('kỳ của mã phiếu', () => {
  it('lấy theo lịch Việt Nam, không phải UTC', () => {
    // 23:30 ngày 31/08 giờ VN có mốc UTC là 16:30 ngày 31/08 — cùng tháng, dễ.
    expect(periodKey(vn('2026-08-31', 23, 30))).toBe('2608');
  });

  it('phiếu nộp sáng sớm ngày 1 vẫn thuộc tháng MỚI', () => {
    // 06:00 ngày 01/09 giờ VN có mốc UTC là 23:00 ngày 31/08.
    // Lấy kỳ theo UTC sẽ ra '2608' và mã phiếu mang tháng SAI.
    expect(periodKey(vn('2026-09-01', 6))).toBe('2609');
  });

  it('sang năm mới thì đổi cả phần năm', () => {
    expect(periodKey(vn('2027-01-01', 9))).toBe('2701');
  });
});

describe('chia mảnh counter', () => {
  it('mỗi module × mỗi kỳ là một mảnh riêng', () => {
    expect(counterShardId('WEB_FSB', '2608')).toBe('WEB_FSB_2608');
    expect(counterShardId('FINANCE', '2608')).toBe('FINANCE_2608');
    // Hai module khác nhau KHÔNG dùng chung mảnh — đó là điểm giảm tranh chấp.
    expect(counterShardId('WEB_FSB', '2608')).not.toBe(counterShardId('FINANCE', '2608'));
  });
});

describe('đảo kỳ', () => {
  it('mảnh chưa tồn tại thì bắt đầu từ 1', () => {
    expect(nextCounterState(null, '2608')).toEqual({ period: '2608', seq: 1 });
  });

  it('cùng kỳ thì tăng dần', () => {
    expect(nextCounterState({ period: '2608', seq: 41 }, '2608')).toEqual({
      period: '2608',
      seq: 42,
    });
  });

  it('sang kỳ mới thì reset về 1, KHÔNG cần cron', () => {
    // Đây là lý do đảo kỳ nằm trong transaction. Một cron "reset seq ngày 1"
    // sẽ chạy đua với phiếu đang bay và sinh mã trùng.
    expect(nextCounterState({ period: '2608', seq: 137 }, '2609')).toEqual({
      period: '2609',
      seq: 1,
    });
  });
});

describe('định dạng mã phiếu', () => {
  it('đệm số thứ tự đủ 4 chữ số để sắp xếp theo chuỗi vẫn đúng', () => {
    expect(formatTicketNo('WEB_FSB', '2608', 7)).toBe('FSC-WEB_FSB-2608-0007');
    expect(formatTicketNo('WEB_FSB', '2608', 42)).toBe('FSC-WEB_FSB-2608-0042');
    // Không đệm thì '10' < '9' khi sắp theo chuỗi, và danh sách hiện sai thứ tự.
    expect('FSC-X-2608-0009' < 'FSC-X-2608-0010').toBe(true);
  });

  it('vượt 9999 phiếu một tháng vẫn không vỡ định dạng', () => {
    expect(formatTicketNo('WEB_FSB', '2608', 12345)).toBe('FSC-WEB_FSB-2608-12345');
    expect(isValidTicketNo('FSC-WEB_FSB-2608-12345')).toBe(true);
  });

  it('nhận diện mã hợp lệ và loại mã rác', () => {
    expect(isValidTicketNo('FSC-HEALTH_SYSTEM-2608-0001')).toBe(true);
    expect(isValidTicketNo('FSC-WEB_FSB-2608-1')).toBe(false); // thiếu đệm
    expect(isValidTicketNo('WEB_FSB-2608-0001')).toBe(false); // thiếu tiền tố
    expect(isValidTicketNo('')).toBe(false);
    expect(isValidTicketNo('../../etc/passwd')).toBe(false);
  });

  it('tách ngược được, kể cả mã module có dấu gạch dưới', () => {
    expect(parseTicketNo('FSC-APP_MY_FPT_SCHOOL-2608-0042')).toEqual({
      moduleCode: 'APP_MY_FPT_SCHOOL',
      period: '2608',
      seq: 42,
    });
  });

  it('tách mã sai định dạng thì trả null, không ném lỗi', () => {
    // Mã phiếu đến từ URL (?ticket=...) nên phải coi là dữ liệu người lạ nhập.
    expect(parseTicketNo('rác')).toBeNull();
    expect(parseTicketNo('FSC--2608-0001')).toBeNull();
  });
});
