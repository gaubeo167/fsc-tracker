import {
  AlertTriangle, BookOpen, Bug, CheckCircle2, CircleDollarSign, Clock, Globe,
  HeartPulse, HelpCircle, Lightbulb, Loader2, PauseCircle, RotateCcw,
  MessagesSquare, Smartphone, XCircle, Copy as CopyIcon,
} from 'lucide-react';
import { useSupportModules } from '../hooks/useSupportModules';
import React from 'react';
import { Badge, cn } from '../../../components/ui';
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '../types';

// ===========================================================================
// Token giao diện của module hỗ trợ.
//
// Vì sao tồn tại: audit repo đếm được 11 giá trị kích thước icon khác nhau
// (11,12,13,14,15,16,17,18,22,24,26) và bảng ánh xạ trạng thái bị COPY 3 BẢN ở
// CampusDashboard, AllTicketsView, MyModuleTickets. Ba bản sao chắc chắn lệch
// nhau — chỉ cần thêm một trạng thái là hai chỗ hiện đúng, một chỗ hiện mã thô.
//
// Mọi thứ liên quan tới cách TRÌNH BÀY trạng thái/ưu tiên/loại phiếu khai ở đây
// và chỉ ở đây.
// ===========================================================================

/**
 * Thang kích thước icon — 4 mức, không hơn.
 *
 * Trước đây có 11 giá trị rải rác. Mắt không phân biệt được 14 với 15, nhưng
 * cảm nhận được sự thiếu nhịp khi cả hai đứng cạnh nhau.
 */
export const ICON = {
  /** Trong dòng chữ nhỏ, meta, badge */
  xs: 12,
  /** Mặc định cho nhãn và nút nhỏ */
  sm: 14,
  /** Mặc định cho nút và hành động */
  md: 16,
  /** Tiêu đề khối, icon dẫn */
  lg: 18,
  /** Icon minh hoạ lớn ở màn trống / trạng thái */
  xl: 22,
} as const;

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'primary' | 'sky';

/**
 * Trạng thái phiếu: nhãn tiếng Việt + màu + icon.
 *
 * Có ICON cho từng trạng thái vì màu KHÔNG được là kênh truyền tin duy nhất —
 * khoảng 8% nam giới bị mù màu đỏ/lục, và "đã xong" (lục) với "bị từ chối" (đỏ)
 * là đúng cặp màu họ không phân biệt được.
 */
export const TICKET_STATUS: Record<
  TicketStatus,
  { label: string; variant: BadgeVariant; Icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  NEW: { label: 'Mới', variant: 'neutral', Icon: Clock },
  TRIAGE: { label: 'Chờ tiếp nhận', variant: 'warning', Icon: Clock },
  NEEDS_INFO: { label: 'Cần bổ sung', variant: 'warning', Icon: HelpCircle },
  ACCEPTED: { label: 'Đã tiếp nhận', variant: 'info', Icon: CheckCircle2 },
  IN_PROGRESS: { label: 'Đang xử lý', variant: 'info', Icon: Loader2 },
  ON_HOLD: { label: 'Tạm dừng', variant: 'neutral', Icon: PauseCircle },
  RESOLVED: { label: 'Đã khắc phục', variant: 'sky', Icon: CheckCircle2 },
  PENDING_VERIFICATION: { label: 'Chờ xác nhận', variant: 'sky', Icon: HelpCircle },
  REOPENED: { label: 'Mở lại', variant: 'danger', Icon: RotateCcw },
  CLOSED: { label: 'Hoàn tất', variant: 'success', Icon: CheckCircle2 },
  DUPLICATE: { label: 'Trùng phiếu', variant: 'neutral', Icon: CopyIcon },
  REJECTED: { label: 'Từ chối', variant: 'danger', Icon: XCircle },
};

/**
 * Độ ưu tiên: nhãn ngắn + tên mức cho tooltip.
 *
 * Dùng thẳng thang ưu tiên chuẩn của phát triển phần mềm — Critical / High /
 * Medium / Low — chứ không mô tả phạm vi ảnh hưởng ("chặn nhiều trường", "chặn
 * một trường"). Hai lý do:
 *
 *   - Phạm vi ảnh hưởng đã có trường riêng của nó (scope, affectedCampusIds,
 *     impactScale). Nhét thêm vào nhãn ưu tiên là nói cùng một điều ở hai chỗ,
 *     và hai chỗ đó lệch nhau ngay lần đầu có phiếu chặn một trường nhưng chặn
 *     cả kỳ thu học phí.
 *   - Ưu tiên là mức độ KHẨN, không phải số trường bị ảnh hưởng. Đầu mối cần
 *     nâng được một phiếu một trường lên Khẩn cấp mà không thấy nhãn cãi lại
 *     lựa chọn của mình.
 *
 * Đúng thang mà module Công việc đang dùng (Thấp / Trung bình / Cao / Khẩn cấp),
 * nên P1..P4 ánh xạ thẳng sang priority của task, không phải dịch lại.
 */
export const TICKET_PRIORITY: Record<TicketPriority, { label: string; full: string; variant: BadgeVariant }> = {
  P1: { label: 'P1', full: 'P1 — Khẩn cấp (Critical)', variant: 'danger' },
  P2: { label: 'P2', full: 'P2 — Cao (High)', variant: 'warning' },
  P3: { label: 'P3', full: 'P3 — Trung bình (Medium)', variant: 'info' },
  P4: { label: 'P4', full: 'P4 — Thấp (Low)', variant: 'neutral' },
};

/**
 * Loại phiếu: nhãn + icon + màu.
 *
 * Hai loại này KHÁC NHAU VỀ NGHIỆP VỤ, không chỉ khác nhãn:
 *
 *   BÁO LỖI  — hệ thống đang chạy sai. Có SLA hoàn thành theo mức ưu tiên,
 *              có hạn xử lý, đo được là trễ hay đúng hạn.
 *   ĐỀ XUẤT  — hệ thống chạy đúng, người dùng muốn thêm chức năng. §7 spec:
 *              KHÔNG có SLA hoàn thành, chỉ có SLA phản hồi 3 ngày làm việc,
 *              rồi xếp vào kế hoạch theo quý.
 *
 * Trộn hai loại vào cùng một hàng đợi mà không phân biệt được bằng mắt dẫn tới
 * hai hậu quả ngược nhau: đề xuất bị hối như lỗi, và lỗi bị hoãn như đề xuất.
 *
 * `full` là nhãn đầy đủ cho màn chi tiết và tooltip; `label` là bản ngắn cho
 * danh sách, nơi chiều ngang là thứ đắt nhất.
 */
export const TICKET_TYPE: Record<
  TicketType,
  { label: string; full: string; Icon: typeof Bug; className: string; badge: string }
> = {
  BUG: {
    label: 'Báo lỗi',
    full: 'Báo lỗi — hệ thống đang chạy sai',
    Icon: Bug,
    className: 'text-red-500',
    badge: 'bg-red-50 text-red-600',
  },
  FEATURE_REQUEST: {
    label: 'Đề xuất tính năng',
    full: 'Đề xuất tính năng mới — không có hạn hoàn thành theo SLA',
    Icon: Lightbulb,
    // Tím hệ thống Apple. KHÔNG dùng indigo: sau khi áp DESIGN.md, indigo-*
    // chính là Action Blue của mọi nút và link — icon sẽ chìm vào chrome.
    className: 'text-violet-500',
    badge: 'bg-violet-50 text-violet-700',
  },
};

/**
 * Icon cho từng phân hệ.
 *
 * Trong bảng, tên phân hệ đứng một mình là năm dòng chữ xám giống hệt nhau —
 * mắt phải đọc từng chữ mới phân biệt được. Có icon thì quét mắt xuống cột là
 * nhận ra ngay nhóm nào là nhóm nào.
 */
export const MODULE_ICON: Record<string, { Icon: typeof Bug; className: string }> = {
  WEB_FSB: { Icon: Globe, className: 'text-sky-500' },
  APP_MY_FPT_SCHOOL: { Icon: Smartphone, className: 'text-indigo-500' },
  FINANCE: { Icon: CircleDollarSign, className: 'text-emerald-500' },
  FEEN: { Icon: BookOpen, className: 'text-violet-500' },
  HEALTH_SYSTEM: { Icon: HeartPulse, className: 'text-rose-500' },
};

/** Tên + icon của phân hệ, dùng chung ở mọi bảng. */
export function ModuleCell({ code }: { code: string }) {
  const m = MODULE_ICON[code] ?? { Icon: Globe, className: 'text-slate-400' };
  // Tên đọc từ Firestore: phân hệ admin mới tạo phải hiện đúng tên, không phải
  // mã thô.
  const name = useSupportModules().nameOf(code);
  return (
    <span className="inline-flex items-center gap-1.5 text-[14px] tracking-[-0.016em] text-slate-600">
      <m.Icon size={ICON.md} className={cn('shrink-0', m.className)} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

/** Badge trạng thái có icon. Dùng ở MỌI danh sách phiếu. */
export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
  const s = TICKET_STATUS[status];
  return (
    <Badge variant={s.variant} className={cn('inline-flex items-center gap-1', className)}>
      <s.Icon size={ICON.xs} className={status === 'IN_PROGRESS' ? 'animate-spin' : undefined} />
      {s.label}
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const p = TICKET_PRIORITY[priority];
  // title thay cho việc hiện cả câu dài: bảng không đủ chỗ, nhưng người dùng
  // vẫn cần biết P2 nghĩa là gì.
  return <span title={p.full}><Badge variant={p.variant}>{p.label}</Badge></span>;
}

/**
 * Nhãn loại phiếu CÓ CHỮ. Cách DUY NHẤT để hiện loại phiếu.
 *
 * Thay cho TypeIcon (icon trần) vốn dùng ở mọi danh sách trước đây. Icon trần
 * bắt người đọc phải BIẾT TRƯỚC quy ước "con bọ đỏ = lỗi, bóng đèn = đề xuất".
 * Người mới vào ca trực không biết quy ước đó, và ngay cả người biết rồi thì ở
 * cỡ 16px con bọ với bóng đèn là hai đốm màu na ná nhau. Trong khi loại phiếu
 * quyết định phiếu CÓ HẠN XỬ LÝ HAY KHÔNG — quá quan trọng để phó mặc cho một
 * đốm màu.
 *
 * TypeIcon đã bị xoá thay vì để đó: giữ lại một lối tắt "chỉ hiện icon" là
 * đảm bảo màn tiếp theo ai đó viết sẽ lại dùng nó, và vấn đề quay lại.
 */
export function TypeBadge({ type, className }: { type: TicketType; className?: string }) {
  const t = TICKET_TYPE[type];
  return (
    <span
      title={t.full}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5',
        'text-[12px] font-semibold tracking-[-0.01em]',
        t.badge,
        className
      )}
    >
      <t.Icon size={ICON.xs} aria-hidden />
      {t.label}
    </span>
  );
}

/** Thứ tự cố định của bộ lọc loại. Khai một chỗ để mọi màn lọc giống nhau. */
export const TYPE_FILTERS: Array<{ id: 'all' | TicketType; label: string }> = [
  { id: 'all', label: 'Tất cả loại' },
  { id: 'BUG', label: 'Báo lỗi' },
  { id: 'FEATURE_REQUEST', label: 'Đề xuất tính năng' },
];

/**
 * Dải nút lọc theo loại phiếu, kèm số đếm.
 *
 * Có nhãn rồi vẫn cần lọc: nhãn trả lời "phiếu NÀY là loại gì", còn lọc trả
 * lời "hôm nay còn bao nhiêu lỗi chưa xử lý" — hai câu hỏi khác nhau, và câu
 * thứ hai là câu người trực hỏi mỗi sáng. Số đếm nằm ngay trên nút để trả lời
 * mà không phải bấm.
 */
export function TypeFilterChips({
  value, onChange, counts, className,
}: {
  value: 'all' | TicketType;
  onChange: (v: 'all' | TicketType) => void;
  /** Số phiếu mỗi loại, tính TRƯỚC khi lọc theo loại. */
  counts: { all: number; BUG: number; FEATURE_REQUEST: number };
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} role="group" aria-label="Lọc theo loại yêu cầu">
      {TYPE_FILTERS.map((f) => {
        const dang = value === f.id;
        const mau = f.id === 'BUG' ? 'text-red-600' : f.id === 'FEATURE_REQUEST' ? 'text-violet-700' : 'text-slate-600';
        return (
          <button
            key={f.id}
            type="button"
            onClick={() => onChange(f.id)}
            aria-pressed={dang}
            className={cn(
              // Viên nang — trong ngữ pháp Apple, bo tròn hoàn toàn LÀ tín hiệu
              // "bấm được". Xem DESIGN.md §Shapes.
              'rounded-full px-3.5 py-1.5 text-[14px] tracking-[-0.016em] transition-colors active:scale-95',
              dang
                ? 'bg-slate-900 font-semibold text-white'
                : cn('bg-white border border-slate-200 hover:bg-slate-50', mau)
            )}
          >
            {f.label}
            <span className={cn('ml-1.5 tabular-nums', dang ? 'text-white/70' : 'text-slate-400')}>
              {counts[f.id]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Ngày giờ theo giờ Việt Nam. Gom một chỗ để mọi màn hiện cùng định dạng. */
export function fmtDate(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms + 7 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function fmtDateTime(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms + 7 * 3600_000);
  return `${fmtDate(ms)}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function fmtDateFull(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms + 7 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

export function fmtTime(ms: number | null): string {
  if (!ms) return '';
  const d = new Date(ms + 7 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Hạn xử lý kèm trạng thái quá hạn.
 *
 * `estimateDays > 0` là phiếu được tiếp nhận với hạn CHƯA xác định — khác hẳn
 * phiếu chưa ai tiếp nhận nên chưa có hạn. Cùng hiện dấu gạch thì đầu mối không
 * phân biệt được "chưa ai nhận" với "đã nhận, đang chờ chốt lịch".
 */
export function DueCell({
  dueAt, isOpen, estimateDays = 0,
}: { dueAt: number | null; isOpen: boolean; estimateDays?: number }) {
  const overdue = !!dueAt && dueAt < Date.now() && isOpen;
  if (!dueAt) {
    return estimateDays > 0
      ? (
        <span className="text-[14px] tracking-[-0.016em] text-slate-500" title={`Dự kiến ${estimateDays} ngày làm việc kể từ khi bắt đầu xử lý`}>
          Chưa xác định
        </span>
      )
      : <span className="text-[14px] text-slate-300">—</span>;
  }
  return (
    <span
      className={cn(
        // Số dùng tabular-nums: cột ngày trong bảng không bị nhảy khi chữ số
        // rộng khác nhau.
        'inline-flex items-center gap-1 text-[14px] tabular-nums tracking-[-0.016em]',
        // Cân 600, không phải 700: thang cân của Apple là 300/400/600/700 và
        // 700 dành riêng cho tagline. Quá hạn đã có màu đỏ + icon cảnh báo,
        // không cần cân đậm nhất hệ để nói thêm lần thứ ba.
        overdue ? 'font-semibold text-red-600' : 'text-slate-500'
      )}
    >
      {overdue && <AlertTriangle size={ICON.xs} />}
      {fmtDate(dueAt)}
    </span>
  );
}

/** Trạng thái nào còn được coi là "đang mở". */
export const OPEN_STATUSES: TicketStatus[] = [
  'TRIAGE', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS', 'REOPENED', 'ON_HOLD',
];
export const DONE_STATUSES: TicketStatus[] = ['RESOLVED', 'PENDING_VERIFICATION', 'CLOSED'];

/** Lớp dùng chung cho bảng danh sách — giữ mọi bảng giống hệt nhau. */
// Hàng tiêu đề bỏ `uppercase tracking-wide`: chữ hoa giãn ly không thuộc hệ
// Apple, và nhãn cột tiếng Việt có dấu bị ép hoa thì mất dấu, khó đọc. Thay
// bằng 13px cân 600 tracking âm — vẫn tách khỏi thân bảng, nhưng bằng cân chữ
// chứ không bằng cách bóp méo chữ.
export const TABLE = {
  wrapper: 'w-full text-left',
  headRow: 'border-b border-slate-200 text-[13px] font-semibold tracking-[-0.016em] text-slate-500',
  headCell: 'px-3.5 py-3 first:pl-5 last:pr-5',
  row: 'cursor-pointer border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50',
  cell: 'px-3.5 py-3.5 first:pl-5 last:pr-5',
} as const;

/**
 * Dấu hiệu "phiếu này đang có trao đổi", hiện trong các màn danh sách.
 *
 * Vì sao cần: cuộc trao đổi nằm ở subcollection, mà danh sách phiếu không đọc
 * subcollection được (Firestore không join). Không có con chip này thì một câu
 * hỏi đang chờ trả lời là VÔ HÌNH cho tới khi ai đó tình cờ mở phiếu ra — người
 * dùng báo đúng chuyện đó ngày 06/09/2026: "cần có note tại yêu cầu để người
 * dùng biết là đang có sự trao đổi và vào trả lời".
 *
 * Nổi bật khi lượt cuối là của PHÍA BÊN KIA: đó mới là thứ cần hành động. Tin
 * cuối là của chính mình thì chỉ hiện mờ, vì nó nghĩa là đang chờ người ta.
 */
export function MessageChip({
  ticket,
  viewerSide,
  className,
}: {
  ticket: Pick<Ticket, 'lastMessageAt' | 'lastMessageSide'>;
  /** Người đang nhìn danh sách đứng ở phía nào. */
  viewerSide: 'CAMPUS' | 'PTUD';
  className?: string;
}) {
  if (!ticket.lastMessageAt) return null;
  const cuaBenKia = !!ticket.lastMessageSide && ticket.lastMessageSide !== viewerSide;
  const d = new Date(ticket.lastMessageAt + 7 * 3600_000);
  const khi = `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] tracking-[-0.01em]',
        cuaBenKia
          ? 'bg-amber-50 font-medium text-amber-800'
          : 'bg-slate-100 text-slate-500',
        className
      )}
      title={`Lượt trao đổi gần nhất: ${khi}`}
    >
      <MessagesSquare size={ICON.sm} className="shrink-0" />
      {cuaBenKia
        ? ticket.lastMessageSide === 'CAMPUS' ? 'Trường vừa nhắn' : 'Kỹ thuật vừa nhắn'
        : 'Đang chờ trả lời'}
      <span className="font-normal opacity-70">· {khi}</span>
    </span>
  );
}
