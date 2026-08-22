import {
  addWorkingMs,
  clampForward,
  workingMsBetween,
  type WorkingCalendar,
} from './workingTime';

// ===========================================================================
// Đồng hồ SLA.
//
// LỖI PHẢI TRÁNH BẰNG MỌI GIÁ — lưu thời gian còn lại bằng đồng hồ treo tường:
//
//   P2 (4 giờ làm việc) tạo thứ Sáu 16:30  ->  hạn = thứ Hai 11:30
//   Đặt NEEDS_INFO lúc thứ Sáu 16:45.
//   Cách sai: remaining = hạn - bây giờ = 66,75 GIỜ THẬT.
//   Resume thứ Hai 09:00 -> hạn = 09:00 + 66,75h = THỨ TƯ 03:45.
//   Đáp án đúng: thứ Hai 12:45.
//
//   Mỗi lần tạm dừng nhân hạn chót lên bằng cả cuối tuần. Và bộ test trong §14
//   spec chỉ kiểm lúc TẠO, không có pause — nên nó xanh trong khi bug ship.
//
// Cách đúng, dùng ở đây: không bao giờ lưu "còn lại". Lưu số mili giây LÀM VIỆC
// đã tiêu (`elapsedWorkingMs`) cộng mốc lần cuối chạy lại (`lastResumedAt`),
// rồi tính hạn từ ngân sách trừ đi phần đã tiêu.
// ===========================================================================

export type TicketType = 'BUG' | 'FEATURE_REQUEST';
export type Priority = 'P1' | 'P2' | 'P3' | 'P4';

export interface SlaPolicy {
  id: string;
  type: TicketType;
  priority: Priority | null;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
}

const H = 60;
const WORKDAY = 9 * 60; // 08:00-17:00 = 9 giờ làm việc

/** Ma trận SLA mặc định theo §7 spec. Seed vào support_sla_policies, sửa được qua UI. */
export const DEFAULT_SLA_POLICIES: SlaPolicy[] = [
  { id: 'BUG_P1', type: 'BUG', priority: 'P1', firstResponseMinutes: 1 * H, resolutionMinutes: 4 * H },
  { id: 'BUG_P2', type: 'BUG', priority: 'P2', firstResponseMinutes: 4 * H, resolutionMinutes: 1 * WORKDAY },
  { id: 'BUG_P3', type: 'BUG', priority: 'P3', firstResponseMinutes: 8 * H, resolutionMinutes: 3 * WORKDAY },
  { id: 'BUG_P4', type: 'BUG', priority: 'P4', firstResponseMinutes: 8 * H, resolutionMinutes: 5 * WORKDAY },
  // Đề xuất tính năng chỉ có SLA phản hồi (3 ngày làm việc), không có SLA hoàn thành.
  { id: 'FEATURE_REQUEST', type: 'FEATURE_REQUEST', priority: null, firstResponseMinutes: 3 * WORKDAY, resolutionMinutes: null },
];

export function findPolicy(type: TicketType, priority: Priority | null): SlaPolicy | null {
  if (type === 'FEATURE_REQUEST') {
    return DEFAULT_SLA_POLICIES.find((p) => p.type === 'FEATURE_REQUEST') ?? null;
  }
  return DEFAULT_SLA_POLICIES.find((p) => p.type === 'BUG' && p.priority === priority) ?? null;
}

/**
 * Trạng thái đồng hồ, lưu thẳng trong document ticket.
 * `lastResumedAt` là null khi đồng hồ đang dừng — đó cũng là cờ running.
 */
export interface SlaClock {
  startedAt: number;
  elapsedWorkingMs: number;
  lastResumedAt: number | null;
}

export function startClock(nowUtc: number, cal: WorkingCalendar): SlaClock {
  // clampForward: ticket gửi lúc 22:00 hay ngày nghỉ thì đồng hồ chỉ bắt đầu
  // chạy từ đầu giờ làm việc kế tiếp, không tính vào SLA khoảng ngoài giờ.
  const start = clampForward(nowUtc, cal);
  return { startedAt: start, elapsedWorkingMs: 0, lastResumedAt: start };
}

/**
 * Tạm dừng. Idempotent: gọi khi đồng hồ đã dừng thì không làm gì.
 *
 * Vì sao cần idempotent: chuyển NEEDS_INFO -> ON_HOLD không đi qua trạng thái
 * đang chạy. Nếu pause cứ cộng dồn vô điều kiện thì lần thứ hai cộng trùng.
 */
export function pauseClock(clock: SlaClock, nowUtc: number, cal: WorkingCalendar): SlaClock {
  if (clock.lastResumedAt === null) return clock;
  return {
    ...clock,
    elapsedWorkingMs:
      clock.elapsedWorkingMs + workingMsBetween(clock.lastResumedAt, nowUtc, cal),
    lastResumedAt: null,
  };
}

/**
 * Chạy lại. Idempotent: gọi khi đang chạy thì không đặt lại mốc.
 *
 * Vì sao cần: resume vô điều kiện sẽ ghi đè lastResumedAt = bây giờ, xoá sạch
 * khoảng thời gian đã trôi kể từ lần resume trước mà chưa được cộng dồn.
 */
export function resumeClock(clock: SlaClock, nowUtc: number, cal: WorkingCalendar): SlaClock {
  if (clock.lastResumedAt !== null) return clock;
  return { ...clock, lastResumedAt: clampForward(nowUtc, cal) };
}

/** Tổng thời gian làm việc đã tiêu tính tới `nowUtc`. */
export function elapsedWorkingMs(clock: SlaClock, nowUtc: number, cal: WorkingCalendar): number {
  const live =
    clock.lastResumedAt === null ? 0 : workingMsBetween(clock.lastResumedAt, nowUtc, cal);
  return clock.elapsedWorkingMs + live;
}

/**
 * Hạn chót hiện tại.
 *
 * Tính lại từ ngân sách mỗi lần gọi thay vì lưu sẵn một giá trị: sau mỗi lần
 * tạm dừng, hạn chót ĐÚNG sẽ dịch ra sau, và cách duy nhất để không sai là
 * suy ra từ (đã tiêu, còn lại) chứ không phải cộng dồn vào giá trị cũ.
 *
 * Đồng hồ đang dừng -> mốc tính là `nowUtc` (hạn trôi cùng thời gian dừng).
 * Đồng hồ đang chạy -> mốc tính là lần resume gần nhất.
 */
export function computeDueAt(
  clock: SlaClock,
  budgetMs: number,
  nowUtc: number,
  cal: WorkingCalendar
): number {
  const spent = elapsedWorkingMs(clock, nowUtc, cal);
  const remaining = Math.max(0, budgetMs - spent);
  const anchor = clock.lastResumedAt === null ? nowUtc : Math.max(clock.lastResumedAt, nowUtc);
  return addWorkingMs(anchor, remaining, cal);
}

/** Hạn chót ban đầu lúc tạo ticket, dùng để hiện "SLA phản hồi dự kiến" cho campus. */
export function initialDueAt(
  createdAtUtc: number,
  budgetMinutes: number,
  cal: WorkingCalendar
): number {
  return addWorkingMs(createdAtUtc, budgetMinutes * 60 * 1000, cal);
}

export function isBreached(
  clock: SlaClock,
  budgetMs: number,
  nowUtc: number,
  cal: WorkingCalendar
): boolean {
  return elapsedWorkingMs(clock, nowUtc, cal) > budgetMs;
}

/** Đã tiêu bao nhiêu phần trăm ngân sách. Job cảnh báo dùng ngưỡng 0.75 (§7). */
export function budgetUsedRatio(
  clock: SlaClock,
  budgetMs: number,
  nowUtc: number,
  cal: WorkingCalendar
): number {
  if (budgetMs <= 0) return 0;
  return elapsedWorkingMs(clock, nowUtc, cal) / budgetMs;
}
