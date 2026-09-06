import {
  AlertTriangle, BookOpen, Bug, CheckCircle2, ChevronLeft, ChevronRight,
  CircleDollarSign, Clock, Globe, HeartPulse, HelpCircle, Lightbulb, Loader2,
  PauseCircle, RotateCcw, Search, MessagesSquare, Smartphone, Users, X, XCircle,
  Copy as CopyIcon,
} from 'lucide-react';
import { useSupportModules } from '../hooks/useSupportModules';
import React from 'react';
import { Badge, cn } from '../../../components/ui';
import { removeDiacritics } from '../services/textNormalize';
import type { ImpactScale, Ticket, TicketPriority, TicketStatus, TicketType } from '../types';

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

// ===========================================================================
// Mảnh dùng chung của HAI màn danh sách phiếu: hàng đợi chờ tiếp nhận và
// bảng tất cả phiếu.
//
// Gom ở đây vì cùng một lý do sinh ra cả file này: hai màn đó từng tự vẽ lấy ô
// tìm kiếm, phân trang và ô mã trường, và ba bản sao thì lệch nhau ngay lần
// chỉnh nhịp đầu tiên.
// ===========================================================================

/**
 * Phiếu này đã chờ bao lâu rồi.
 *
 * Hàng đợi xếp phiếu cũ lên trước, nhưng thứ tự không nói được KHOẢNG CÁCH: ba
 * phiếu đầu có thể cách nhau ba phút hoặc ba tuần. Một mốc ngày giờ tuyệt đối
 * thì bắt người đọc tự trừ. Con số này trả lời thẳng câu người trực hỏi —
 * "trường đã chờ mình bao lâu rồi".
 */
export function tuoiTuongDoi(ms: number): string {
  const phut = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (phut < 1) return 'vừa xong';
  if (phut < 60) return `${phut} phút trước`;
  const gio = Math.floor(phut / 60);
  if (gio < 24) return `${gio} giờ trước`;
  const ngay = Math.floor(gio / 24);
  return `${ngay} ngày trước`;
}

/**
 * Mức ảnh hưởng do chính người báo khai.
 *
 * ĐỨNG THAY CHO độ ưu tiên ở màn hàng đợi, và đây là một khác biệt có chủ đích
 * so với bản thiết kế: `priority` chỉ tồn tại SAU khi đầu mối tiếp nhận (xem
 * acceptTicket). Vẽ một nhãn "Ưu tiên cao" lên phiếu chưa ai tiếp nhận là bịa
 * ra một quyết định chưa ai đưa. Mức ảnh hưởng thì có thật từ lúc gửi, và nó
 * đúng là thứ người trực dùng để chọn phiếu nào làm trước.
 */
export const TICKET_IMPACT: Record<
  ImpactScale,
  { label: string; full: string; className: string }
> = {
  GT_100: {
    label: 'Trên 100 người',
    full: 'Người báo khai: trên 100 người bị ảnh hưởng',
    className: 'bg-red-50 text-red-700',
  },
  FROM_10_TO_100: {
    label: '10 – 100 người',
    full: 'Người báo khai: 10 đến 100 người bị ảnh hưởng',
    className: 'bg-amber-50 text-amber-800',
  },
  LT_10: {
    label: 'Dưới 10 người',
    full: 'Người báo khai: dưới 10 người bị ảnh hưởng',
    className: 'bg-slate-100 text-slate-600',
  },
};

export function ImpactBadge({ scale }: { scale: ImpactScale }) {
  const m = TICKET_IMPACT[scale];
  return (
    <span
      title={m.full}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5',
        'text-[12px] font-semibold tracking-[-0.01em]',
        m.className
      )}
    >
      <Users size={ICON.xs} aria-hidden />
      {m.label}
    </span>
  );
}

/**
 * Ô vuông mang mã trường, màu suy từ chính mã đó.
 *
 * Không phải trang trí: một cột toàn tên trường viết đầy đủ ("Trường Tiểu học,
 * THCS và THPT FPT Thanh Hoá") thì mọi dòng đều bắt đầu bằng cùng bốn chữ, và
 * mắt phải đọc tới giữa câu mới phân biệt được. Ba chữ viết hoa trên một mảng
 * màu cố định thì nhận ra ở tầm nhìn ngoại vi.
 *
 * Màu suy từ mã bằng một phép băm ổn định, KHÔNG lưu vào dữ liệu: một trường
 * luôn mang đúng một màu ở mọi màn, mọi phiên, mà không cần ai đi gán màu cho
 * 18 trường rồi bảo trì bảng đó.
 */
const MAU_TRUONG = [
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
];

export function CampusAvatar({ code, className }: { code: string; className?: string }) {
  let h = 0;
  for (let i = 0; i < code.length; i += 1) h = (h * 31 + code.charCodeAt(i)) % 100_000;
  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg px-2 py-1.5 font-mono text-[12px] font-semibold tabular-nums',
        MAU_TRUONG[h % MAU_TRUONG.length],
        className
      )}
    >
      {code.slice(0, 4)}
    </span>
  );
}

/** Nút chép mã phiếu. Mã là thứ người ta dán vào Zalo, mail, biên bản họp. */
export function CopyMaPhieu({
  ticketNo, onCopied,
}: {
  ticketNo: string;
  onCopied?: (m: string) => void;
}) {
  return (
    <button
      type="button"
      title={`Chép mã ${ticketNo}`}
      aria-label={`Chép mã phiếu ${ticketNo}`}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(ticketNo);
        onCopied?.(`Đã chép mã ${ticketNo}`);
      }}
      className="rounded p-1 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
    >
      <CopyIcon size={ICON.sm} />
    </button>
  );
}

/**
 * Ô tìm kiếm phiếu.
 *
 * Bỏ dấu ở CẢ hai vế (xem khopTimKiem): người trực gõ "dang nhap" phải ra
 * "đăng nhập". Không có vế đó thì ô tìm kiếm im lặng trả về rỗng và người dùng
 * kết luận phiếu không tồn tại.
 */
export function OTimKiem({
  value, onChange, placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        size={ICON.md}
        className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
        aria-hidden
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Tìm theo tiêu đề, mã phiếu, trường, người gửi…'}
        aria-label="Tìm kiếm phiếu"
        className="w-full rounded-full border border-slate-200 bg-white py-2.5 pl-10 pr-9 text-[14px] tracking-[-0.016em] text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
      />
      {value && (
        <button
          type="button"
          aria-label="Xoá từ khoá tìm kiếm"
          onClick={() => onChange('')}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
        >
          <X size={ICON.sm} />
        </button>
      )}
    </div>
  );
}

/**
 * Phiếu có khớp từ khoá không. Bỏ dấu hai vế, khớp trên mọi ô người ta nhớ.
 *
 * Cố ý KHÔNG quét mô tả: mô tả là chỗ dễ lẫn thông tin cá nhân nhất (§12) và là
 * nơi duy nhất dài tới mức một từ khoá bất kỳ cũng khớp — quét nó vào thì gõ
 * "lỗi" ra gần như toàn bộ hàng đợi.
 */
export function khopTimKiem(
  t: Pick<Ticket, 'ticketNo' | 'title' | 'campusId' | 'contactName' | 'contactEmail'>,
  tuKhoa: string,
  tenTruong?: string
): boolean {
  const q = removeDiacritics(tuKhoa).trim().toLowerCase();
  if (!q) return true;
  const kho = removeDiacritics(
    [t.ticketNo, t.title, t.campusId, tenTruong ?? '', t.contactName, t.contactEmail].join(' ')
  ).toLowerCase();
  // Mọi từ đều phải có mặt, không cần liền nhau: gõ "ha nam dang nhap" vẫn ra
  // phiếu đăng nhập của Hà Nam dù hai cụm nằm ở hai ô khác nhau.
  return q.split(/\s+/).every((tu) => kho.includes(tu));
}

const MOI_TRANG = [10, 20, 50] as const;

/**
 * Chân danh sách: đang xem tới đâu, và đi trang khác.
 *
 * Câu "Hiển thị 1 – 10 trong 128 phiếu" quan trọng hơn cả dãy số trang. Không
 * có nó thì một danh sách bị cắt ở 10 dòng trông y hệt một danh sách chỉ có 10
 * phiếu, và người dùng kết luận sai về khối lượng việc đang tồn.
 */
export function PhanTrang({
  tong, trang, moiTrang, onTrang, onMoiTrang, donVi = 'phiếu',
}: {
  tong: number;
  /** Số trang, đếm từ 1. */
  trang: number;
  moiTrang: number;
  onTrang: (t: number) => void;
  onMoiTrang: (n: number) => void;
  donVi?: string;
}) {
  const soTrang = Math.max(1, Math.ceil(tong / moiTrang));
  const tu = tong === 0 ? 0 : (trang - 1) * moiTrang + 1;
  const den = Math.min(tong, trang * moiTrang);
  // Cửa sổ trượt tối đa 5 số quanh trang hiện tại: 16 trang mà in hết 16 nút
  // thì hàng nút dài hơn cả nội dung nó điều khiển.
  const dau = Math.max(1, Math.min(trang - 2, soTrang - 4));
  const cacTrang = Array.from({ length: Math.min(5, soTrang) }, (_, i) => dau + i);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-[13px] tracking-[-0.016em] text-slate-500">
      <span className="tabular-nums">
        Hiển thị {tu} – {den} trong {tong} {donVi}
      </span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={trang <= 1}
          onClick={() => onTrang(trang - 1)}
          aria-label="Trang trước"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronLeft size={ICON.md} />
        </button>
        {cacTrang.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onTrang(n)}
            aria-current={n === trang ? 'page' : undefined}
            className={cn(
              'min-w-8 rounded-md px-2 py-1 text-[13px] tabular-nums transition-colors',
              n === trang
                ? 'bg-indigo-50 font-semibold text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100'
            )}
          >
            {n}
          </button>
        ))}
        <button
          type="button"
          disabled={trang >= soTrang}
          onClick={() => onTrang(trang + 1)}
          aria-label="Trang sau"
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <ChevronRight size={ICON.md} />
        </button>
        <label className="ml-1.5 flex items-center gap-1.5">
          <span className="sr-only">Số {donVi} mỗi trang</span>
          <select
            value={moiTrang}
            onChange={(e) => { onMoiTrang(Number(e.target.value)); onTrang(1); }}
            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[13px] tabular-nums text-slate-700"
          >
            {MOI_TRANG.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="whitespace-nowrap">{donVi}/trang</span>
        </label>
      </div>
    </div>
  );
}
