import { describe, expect, it } from 'vitest';
import {
  computeDueAt,
  elapsedWorkingMs,
  findPolicy,
  isBreached,
  pauseClock,
  resumeClock,
  startClock,
} from '../services/slaCalculator';
import {
  DEFAULT_CALENDAR,
  addWorkingMs,
  clampForward,
  workingMsBetween,
  type WorkingCalendar,
} from '../services/workingTime';

// ===========================================================================
// Mọi mốc thời gian viết theo GIỜ VIỆT NAM rồi đổi sang UTC bằng vn().
// Test phải cho cùng kết quả dù chạy ở máy nào — trên Vercel process.env.TZ là
// UTC, trên máy lập trình viên là Asia/Ho_Chi_Minh. Vì hàm chỉ dùng getUTC* và
// tự cộng offset nên kết quả không phụ thuộc múi giờ máy chủ.
// ===========================================================================

/** Đổi giờ Việt Nam sang mốc UTC. vn('2026-08-21', 16, 30) = thứ Sáu 16:30 VN */
function vn(date: string, hour: number, minute = 0): number {
  return Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute) * 60_000 - 7 * 3600_000;
}

/** In lại một mốc UTC dưới dạng giờ Việt Nam, để thông báo lỗi test đọc được. */
function showVn(utcMs: number): string {
  return new Date(utcMs + 7 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) + ' (giờ VN)';
}

const CAL = DEFAULT_CALENDAR;
const FOUR_WORKING_HOURS = 4 * 60 * 60_000;

describe('workingTime — nền tảng', () => {
  it('bỏ qua ngoài giờ làm việc: 22:00 thứ Sáu -> 08:00 thứ Hai', () => {
    expect(showVn(clampForward(vn('2026-08-21', 22), CAL))).toBe('2026-08-24 08:00 (giờ VN)');
  });

  it('đúng 17:00:00 là ĐÃ HẾT giờ làm, đẩy sang ngày kế tiếp', () => {
    // Off-by-one kinh điển: nếu dùng <= thì 17:00:00 vẫn tính là trong giờ làm.
    expect(showVn(clampForward(vn('2026-08-21', 17, 0), CAL))).toBe('2026-08-24 08:00 (giờ VN)');
  });

  it('07:59 thứ Hai bị đẩy tới 08:00 cùng ngày', () => {
    expect(showVn(clampForward(vn('2026-08-24', 7, 59), CAL))).toBe('2026-08-24 08:00 (giờ VN)');
  });

  it('thứ Bảy bị đẩy sang thứ Hai', () => {
    expect(showVn(clampForward(vn('2026-08-22', 10), CAL))).toBe('2026-08-24 08:00 (giờ VN)');
  });

  it('không đếm cuối tuần: 16:00 thứ Sáu -> 09:00 thứ Hai là 2 giờ làm việc', () => {
    const ms = workingMsBetween(vn('2026-08-21', 16), vn('2026-08-24', 9), CAL);
    expect(ms / 3600_000).toBe(2);
  });

  it('ngày lễ bị loại, kể cả khi mốc UTC rơi sang ngày hôm trước', () => {
    // 2026-09-02 06:00 giờ VN có mốc UTC là 2026-09-01T23:00Z. So sánh ngày lễ
    // bằng toISOString() của mốc UTC sẽ ra '2026-09-01' và TRƯỢT mất ngày lễ.
    const withHoliday: WorkingCalendar = { ...CAL, holidays: ['2026-09-02'] };
    expect(showVn(clampForward(vn('2026-09-02', 6), withHoliday))).toBe('2026-09-03 08:00 (giờ VN)');
  });

  it('thứ Bảy làm bù được tính là ngày làm việc', () => {
    // Lịch Tết/30-4 Việt Nam thường có ngày làm bù. Mô hình chỉ T2-T6 không
    // diễn đạt được, phải có overrides.
    const withMakeup: WorkingCalendar = {
      ...CAL,
      overrides: { '2026-08-22': { isWorking: true } },
    };
    expect(showVn(clampForward(vn('2026-08-22', 10), withMakeup))).toBe('2026-08-22 10:00 (giờ VN)');
  });
});

describe('due_at lúc tạo ticket', () => {
  it('§14: P2 (4 giờ làm việc) tạo thứ Sáu 16:30 -> hạn thứ Hai 11:30', () => {
    const due = addWorkingMs(vn('2026-08-21', 16, 30), FOUR_WORKING_HOURS, CAL);
    // 16:30->17:00 hết 30 phút thứ Sáu, còn 3h30 chuyển sang thứ Hai từ 08:00.
    expect(showVn(due)).toBe('2026-08-24 11:30 (giờ VN)');
  });

  it('ma trận SLA khớp §7', () => {
    expect(findPolicy('BUG', 'P1')?.resolutionMinutes).toBe(240);
    expect(findPolicy('BUG', 'P2')?.resolutionMinutes).toBe(540); // 1 ngày làm việc = 9h
    expect(findPolicy('BUG', 'P4')?.resolutionMinutes).toBe(2700); // 5 ngày = 45h
    // Đề xuất tính năng không có SLA hoàn thành, chỉ có SLA triage.
    expect(findPolicy('FEATURE_REQUEST', null)?.resolutionMinutes).toBeNull();
  });
});

describe('tạm dừng và chạy lại — bug mà bộ test của spec bỏ lọt', () => {
  it('pause qua cuối tuần KHÔNG được nhân hạn chót lên', () => {
    // Đây là test quan trọng nhất trong file này.
    // Cách lưu sai (remaining = hạn - bây giờ, tính bằng giờ thật) sẽ cho
    // thứ Tư 03:45. Đáp án đúng là thứ Hai 12:45.
    let clock = startClock(vn('2026-08-21', 16, 30), CAL);
    clock = pauseClock(clock, vn('2026-08-21', 16, 45), CAL);
    clock = resumeClock(clock, vn('2026-08-24', 9), CAL);

    const due = computeDueAt(clock, FOUR_WORKING_HOURS, vn('2026-08-24', 9), CAL);
    expect(showVn(due)).toBe('2026-08-24 12:45 (giờ VN)');
  });

  it('chỉ tiêu đúng 15 phút trong khoảng bị tạm dừng', () => {
    let clock = startClock(vn('2026-08-21', 16, 30), CAL);
    clock = pauseClock(clock, vn('2026-08-21', 16, 45), CAL);
    expect(clock.elapsedWorkingMs / 60_000).toBe(15);
  });

  it('thời gian trôi trong lúc DỪNG không bị tính vào SLA', () => {
    let clock = startClock(vn('2026-08-24', 8), CAL);
    clock = pauseClock(clock, vn('2026-08-24', 9), CAL); // tiêu 1 giờ
    // Cả ngày thứ Ba trôi qua trong lúc dừng
    expect(elapsedWorkingMs(clock, vn('2026-08-25', 16), CAL) / 3600_000).toBe(1);
  });

  it('pause hai lần liên tiếp KHÔNG cộng dồn trùng', () => {
    // NEEDS_INFO -> ON_HOLD không đi qua trạng thái đang chạy.
    let clock = startClock(vn('2026-08-24', 8), CAL);
    clock = pauseClock(clock, vn('2026-08-24', 9), CAL);
    const afterFirst = clock.elapsedWorkingMs;
    clock = pauseClock(clock, vn('2026-08-24', 11), CAL);
    expect(clock.elapsedWorkingMs).toBe(afterFirst);
  });

  it('resume hai lần liên tiếp KHÔNG xoá thời gian đã trôi', () => {
    // resume vô điều kiện sẽ ghi đè lastResumedAt và mất 2 giờ đã chạy.
    let clock = startClock(vn('2026-08-24', 8), CAL);
    clock = resumeClock(clock, vn('2026-08-24', 10), CAL);
    expect(elapsedWorkingMs(clock, vn('2026-08-24', 10), CAL) / 3600_000).toBe(2);
  });

  it('nhiều chu kỳ dừng/chạy cộng dồn đúng', () => {
    let clock = startClock(vn('2026-08-24', 8), CAL); // bắt đầu T2 08:00
    clock = pauseClock(clock, vn('2026-08-24', 9), CAL); // +1h  = 1h
    clock = resumeClock(clock, vn('2026-08-25', 8), CAL);
    clock = pauseClock(clock, vn('2026-08-25', 10), CAL); // +2h = 3h
    clock = resumeClock(clock, vn('2026-08-26', 8), CAL);
    expect(elapsedWorkingMs(clock, vn('2026-08-26', 8, 30), CAL) / 60_000).toBe(3 * 60 + 30);
  });
});

describe('phát hiện vượt hạn', () => {
  it('chưa vượt khi còn trong ngân sách', () => {
    const clock = startClock(vn('2026-08-24', 8), CAL);
    expect(isBreached(clock, FOUR_WORKING_HOURS, vn('2026-08-24', 11), CAL)).toBe(false);
  });

  it('vượt hạn khi tiêu quá ngân sách', () => {
    const clock = startClock(vn('2026-08-24', 8), CAL);
    expect(isBreached(clock, FOUR_WORKING_HOURS, vn('2026-08-24', 13), CAL)).toBe(true);
  });

  it('KHÔNG vượt hạn nếu cuối tuần trôi qua trong lúc dừng', () => {
    // Không có ngữ nghĩa tạm dừng thì ticket nào để qua cuối tuần cũng bị báo
    // vượt hạn oan, và job SLA sẽ spam PTUD_MANAGER mỗi sáng thứ Hai.
    let clock = startClock(vn('2026-08-21', 15), CAL);
    clock = pauseClock(clock, vn('2026-08-21', 16), CAL); // tiêu 1h
    expect(isBreached(clock, FOUR_WORKING_HOURS, vn('2026-08-24', 8), CAL)).toBe(false);
  });
});
