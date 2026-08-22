import {
  AlertTriangle, BookOpen, Bug, CheckCircle2, CircleDollarSign, Clock, Globe,
  HeartPulse, HelpCircle, Lightbulb, Loader2, PauseCircle, RotateCcw,
  Smartphone, XCircle, Copy as CopyIcon,
} from 'lucide-react';
import { useSupportModules } from '../hooks/useSupportModules';
import React from 'react';
import { Badge, cn } from '../../../components/ui';
import type { TicketPriority, TicketStatus, TicketType } from '../types';

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

/** Độ ưu tiên: nhãn ngắn + mô tả đầy đủ cho tooltip. */
export const TICKET_PRIORITY: Record<TicketPriority, { label: string; full: string; variant: BadgeVariant }> = {
  P1: { label: 'P1', full: 'P1 — Chặn nghiệp vụ nhiều trường', variant: 'danger' },
  P2: { label: 'P2', full: 'P2 — Chặn nghiệp vụ một trường', variant: 'warning' },
  P3: { label: 'P3', full: 'P3 — Ảnh hưởng cục bộ', variant: 'info' },
  P4: { label: 'P4', full: 'P4 — Hiển thị, không chặn', variant: 'neutral' },
};

/** Loại phiếu: icon + màu. Bug đỏ, đề xuất tím — nhất quán ở mọi màn. */
export const TICKET_TYPE: Record<TicketType, { label: string; Icon: typeof Bug; className: string }> = {
  BUG: { label: 'Báo lỗi', Icon: Bug, className: 'text-red-500' },
  FEATURE_REQUEST: { label: 'Đề xuất', Icon: Lightbulb, className: 'text-indigo-500' },
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
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-600">
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

export function TypeIcon({ type, size = ICON.sm }: { type: TicketType; size?: number }) {
  const t = TICKET_TYPE[type];
  // aria-label bắt buộc: icon đứng một mình không có chữ đi kèm thì trình đọc
  // màn hình không đọc được gì.
  return <t.Icon size={size} className={t.className} aria-label={t.label} />;
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

/** Hạn xử lý kèm trạng thái quá hạn. */
export function DueCell({ dueAt, isOpen }: { dueAt: number | null; isOpen: boolean }) {
  const overdue = !!dueAt && dueAt < Date.now() && isOpen;
  if (!dueAt) return <span className="text-xs text-slate-300">—</span>;
  return (
    <span
      className={cn(
        // Số dùng tabular-nums: cột ngày trong bảng không bị nhảy khi chữ số
        // rộng khác nhau.
        'inline-flex items-center gap-1 text-xs tabular-nums',
        overdue ? 'font-bold text-red-600' : 'text-slate-500'
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
export const TABLE = {
  wrapper: 'w-full text-left',
  headRow: 'border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400',
  headCell: 'px-3 py-2.5 font-medium first:pl-4 last:pr-4',
  row: 'cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50',
  cell: 'px-3 py-3 first:pl-4 last:pr-4',
} as const;
