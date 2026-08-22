// ===========================================================================
// Số học giờ làm việc — nền của toàn bộ SLA.
//
// Múi giờ: mọi thứ lưu UTC trong DB, tính toán quy về giờ Việt Nam (GMT+7).
// KHÔNG dùng thư viện timezone: `@date-fns/tz` không được duyệt, và Việt Nam
// không có DST nên offset là hằng số +7 quanh năm. Đó là lý do duy nhất khiến
// cách làm thủ công dưới đây an toàn — đừng bê nguyên sang nước có DST.
//
// Bẫy phải tránh: Vercel function chạy ở UTC. Gọi getHours() trên một Date là
// lấy giờ theo múi của MÁY CHỦ, nên trên Vercel sẽ lệch đúng 7 tiếng so với máy
// lập trình viên ở Việt Nam. Vì vậy mọi hàm ở đây tự cộng offset và chỉ dùng
// nhóm getUTC*, không bao giờ dùng getHours/getDate/getDay trần.
// ===========================================================================

export const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const MS_PER_MIN = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Khung giờ làm việc trong một ngày, tính bằng phút kể từ 00:00 giờ VN. */
export interface WorkingWindow {
  /** 0 = Chủ nhật … 6 = Thứ bảy, khớp Date.getUTCDay() */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export interface WorkingCalendar {
  windows: WorkingWindow[];
  /** Ngày nghỉ, dạng 'YYYY-MM-DD' theo lịch Việt Nam. */
  holidays: string[];
  /**
   * Ghi đè theo ngày cụ thể. Dùng cho thứ Bảy làm bù dịp Tết/30-4 — lịch
   * Việt Nam thường xuyên có, và mô hình chỉ-thứ-2-đến-6 không diễn đạt được.
   * isWorking=true biến ngày nghỉ thành ngày làm, false thì ngược lại.
   */
  overrides: Record<string, { isWorking: boolean; startMinute?: number; endMinute?: number }>;
}

/** Lịch mặc định theo §7 spec: T2-T6, 08:00-17:00 giờ VN. */
export const DEFAULT_CALENDAR: WorkingCalendar = {
  windows: [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    startMinute: 8 * 60,
    endMinute: 17 * 60,
  })),
  holidays: [],
  overrides: {},
};

/** Chuỗi ngày 'YYYY-MM-DD' theo lịch Việt Nam của một mốc thời gian UTC. */
export function vnDateKey(utcMs: number): string {
  return new Date(utcMs + VN_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Khung giờ làm việc áp dụng cho một ngày, hoặc null nếu là ngày nghỉ.
 * Thứ tự ưu tiên: overrides > holidays > windows theo thứ trong tuần.
 */
export function windowForDay(utcMs: number, cal: WorkingCalendar): WorkingWindow | null {
  const key = vnDateKey(utcMs);
  const weekday = new Date(utcMs + VN_OFFSET_MS).getUTCDay();
  const base = cal.windows.find((w) => w.weekday === weekday) ?? null;

  const ov = cal.overrides[key];
  if (ov) {
    if (!ov.isWorking) return null;
    return {
      weekday,
      startMinute: ov.startMinute ?? base?.startMinute ?? 8 * 60,
      endMinute: ov.endMinute ?? base?.endMinute ?? 17 * 60,
    };
  }

  // So sánh ngày lễ bằng vnDateKey chứ không phải toISOString() của mốc UTC:
  // ticket tạo 2026-09-02 06:00 giờ VN có mốc UTC rơi vào 2026-09-01, nên so
  // theo UTC sẽ trượt mất ngày lễ 02/09.
  if (cal.holidays.includes(key)) return null;

  return base;
}

/** Nửa đêm giờ VN của ngày chứa mốc utcMs, trả về mốc UTC. */
function vnMidnightUtc(utcMs: number): number {
  const shifted = utcMs + VN_OFFSET_MS;
  return Math.floor(shifted / MS_PER_DAY) * MS_PER_DAY - VN_OFFSET_MS;
}

/** [bắt đầu, kết thúc) của khung làm việc trong ngày, theo mốc UTC. */
function dayBounds(utcMs: number, cal: WorkingCalendar): { start: number; end: number } | null {
  const w = windowForDay(utcMs, cal);
  if (!w) return null;
  const midnight = vnMidnightUtc(utcMs);
  return {
    start: midnight + w.startMinute * MS_PER_MIN,
    end: midnight + w.endMinute * MS_PER_MIN,
  };
}

/**
 * Đẩy một mốc thời gian tới thời điểm làm việc gần nhất KHÔNG SỚM HƠN nó.
 * Ticket tạo lúc 22:00 thứ Sáu, hay đúng 17:00:00, hay thứ Bảy — đồng hồ SLA
 * phải bắt đầu chạy từ 08:00 ngày làm việc kế tiếp, không phải ngay lập tức.
 */
export function clampForward(utcMs: number, cal: WorkingCalendar): number {
  let cursor = utcMs;
  // 366 ngày là chặn chạy vô hạn: nếu lịch cấu hình sai thành không có ngày làm
  // việc nào, thà ném lỗi còn hơn treo tiến trình.
  for (let i = 0; i < 366; i++) {
    const b = dayBounds(cursor, cal);
    if (b) {
      if (cursor < b.start) return b.start;
      if (cursor < b.end) return cursor;
    }
    // Sang 00:00 ngày hôm sau (giờ VN)
    cursor = vnMidnightUtc(cursor) + MS_PER_DAY;
  }
  throw new Error('WORKING_CALENDAR_EMPTY: không tìm thấy ngày làm việc nào trong 366 ngày');
}

/** Tổng số mili giây LÀM VIỆC nằm giữa hai mốc. Trả 0 nếu to <= from. */
export function workingMsBetween(fromUtc: number, toUtc: number, cal: WorkingCalendar): number {
  if (toUtc <= fromUtc) return 0;
  let total = 0;
  let cursor = fromUtc;
  let xong = false;
  for (let i = 0; i < 366 * 3; i++) {
    if (cursor >= toUtc) { xong = true; break; }
    const b = dayBounds(cursor, cal);
    if (b) {
      const segStart = Math.max(cursor, b.start);
      const segEnd = Math.min(toUtc, b.end);
      if (segEnd > segStart) total += segEnd - segStart;
    }
    cursor = vnMidnightUtc(cursor) + MS_PER_DAY;
  }
  // Hết vòng lặp mà chưa tới đích thì con số trả về là một tổng CỤT.
  //
  // Người anh em addWorkingMs ném lỗi ở đúng tình huống này; hàm này trước đây
  // im lặng trả về tổng dở dang. Một đồng hồ chạy nhiều năm (phiếu bị treo, hoặc
  // slaLastResumedAt hỏng) sẽ báo thời gian ít hơn thực tế mà không ai biết —
  // và SLA thì chỉ có ý nghĩa khi con số của nó đúng.
  if (!xong) {
    throw new Error(
      'WORKING_RANGE_TOO_LONG: khoảng thời gian vượt quá 3 năm, không tính hết được giờ làm việc'
    );
  }
  return total;
}

/**
 * Cộng `budgetMs` giờ LÀM VIỆC vào một mốc, trả về hạn chót.
 *
 * Đây là hàm tính due_at. Điểm bắt đầu luôn được clampForward trước, nên tạo
 * ticket lúc 22:00 thứ Sáu vẫn cho hạn đúng như tạo lúc 08:00 thứ Hai.
 */
export function addWorkingMs(startUtc: number, budgetMs: number, cal: WorkingCalendar): number {
  if (budgetMs <= 0) return clampForward(startUtc, cal);
  let remaining = budgetMs;
  let cursor = clampForward(startUtc, cal);

  for (let i = 0; i < 366 * 3; i++) {
    const b = dayBounds(cursor, cal);
    if (b) {
      const available = b.end - Math.max(cursor, b.start);
      if (available >= remaining) {
        return Math.max(cursor, b.start) + remaining;
      }
      if (available > 0) remaining -= available;
    }
    cursor = clampForward(vnMidnightUtc(cursor) + MS_PER_DAY, cal);
  }
  throw new Error('WORKING_CALENDAR_EMPTY: không đủ ngày làm việc để cộng hết ngân sách SLA');
}
