import {
  AlertTriangle, Building2, CheckCircle2, ChevronLeft, ChevronRight, Clock,
  Copy, Eye, Globe, HelpCircle, Inbox, Loader2, MoreVertical, Pencil, Plus, Search, Trash2,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, StateBlock, cn } from '../../../components/ui';
import { vi } from '../i18n/vi';
import type { RepoError } from '../repository/campusRepository';
import { canCampusEdit, deleteTicket } from '../repository/ticketRepository';
import { DomainError, type Ticket, type TicketType } from '../types';
import {
  DONE_STATUSES, ICON, ModuleCell, OPEN_STATUSES, StatusBadge, TypeBadge, TypeFilterChips,
  fmtDateFull, fmtTime,
} from '../ui/tokens';

// ===========================================================================
// Màn đầu tiên cán bộ trường nhìn thấy.
//
// Thứ tự trên màn cố ý là: SỐ LIỆU -> CẢNH BÁO -> BỘ LỌC -> BẢNG.
//
// Vì sao số liệu đứng trước: câu hỏi đầu tiên trong đầu người vào đây không
// phải "tôi muốn gửi yêu cầu" mà là "cái tôi gửi hôm trước xong chưa". Đó cũng
// chính là một trong bốn nỗi đau ban đầu — campus không biết lỗi của mình đã
// được xử lý hay chưa. Trả lời câu đó ngay dòng đầu tiên.
//
// Hai dải cảnh báo nằm giữa số liệu và bảng vì chúng là thứ DUY NHẤT trên màn
// đòi hành động ngay. Bấm vào là lọc thẳng xuống đúng nhóm phiếu đó — dải cảnh
// báo mà không bấm được thì người đọc phải tự đi tìm, và phần lớn sẽ không tìm.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

const FILTERS = [
  { id: 'all', label: 'Tất cả', Icon: Inbox },
  { id: 'open', label: 'Đang xử lý', Icon: Loader2 },
  { id: 'needs_info', label: 'Cần bạn bổ sung', Icon: HelpCircle },
  { id: 'done', label: 'Đã xong', Icon: CheckCircle2 },
  { id: 'overdue', label: 'Quá hạn', Icon: Clock },
] as const;

type FilterId = (typeof FILTERS)[number]['id'];

const SORTS = [
  { id: 'newest', label: 'Mới nhất' },
  { id: 'oldest', label: 'Cũ nhất' },
  { id: 'due', label: 'Hạn gần nhất' },
] as const;

type SortId = (typeof SORTS)[number]['id'];

const PAGE_SIZES = [10, 20, 50];

function StatCard({
  label, value, caption, tone, icon,
}: {
  label: string; value: number; caption: string;
  tone: 'indigo' | 'sky' | 'amber' | 'emerald';
  icon: React.ReactNode;
}) {
  const tones = {
    indigo: 'bg-indigo-50 text-indigo-600',
    sky: 'bg-sky-50 text-sky-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className={cn('flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', tones[tone])}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-medium text-slate-500">{label}</p>
          <p className="text-2xl font-bold leading-tight text-slate-900">{value}</p>
          <p className="truncate text-[11px] text-slate-400">{caption}</p>
        </div>
      </div>
    </Card>
  );
}

/** Dải cảnh báo bấm được — bấm là lọc thẳng xuống nhóm phiếu tương ứng. */
function AlertBar({
  tone, icon, children, onClick,
}: {
  tone: 'red' | 'sky'; icon: React.ReactNode; children: React.ReactNode; onClick: () => void;
}) {
  const tones = {
    red: 'border-red-100 bg-red-50 text-red-700 hover:bg-red-100/70',
    sky: 'border-sky-100 bg-sky-50 text-sky-800 hover:bg-sky-100/70',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors',
        tones[tone]
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      <ChevronRight size={ICON.lg} className="shrink-0 opacity-60" />
    </button>
  );
}

function RowMenu({
  ticket, onOpen, onEdit, onDeleted, onToast,
}: {
  ticket: Ticket;
  onOpen: () => void;
  onEdit?: () => void;
  onDeleted?: () => void;
  onToast?: Toast;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // Chỉ phiếu CHƯA được tiếp nhận mới sửa/xoá được. Sau đó đã có người nhận
  // việc và có task chạy trong module Công việc.
  const editable = canCampusEdit(ticket);

  async function remove() {
    setBusy(true);
    try {
      const { ok, error } = await deleteTicket({ ticket });
      if (!ok) {
        onToast?.(
          error?.kind === 'denied' ? 'Bạn không có quyền xoá yêu cầu này.'
                                   : `Không xoá được (${error?.message ?? 'lỗi mạng'})`,
          'error'
        );
        return;
      }
      onToast?.(`Đã xoá yêu cầu ${ticket.ticketNo}`, 'success');
      setConfirming(false);
      setOpen(false);
      onDeleted?.();
    } catch (e: any) {
      onToast?.(e instanceof DomainError ? e.message : 'Không xoá được', 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`Thao tác với ${ticket.ticketNo}`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
      >
        <MoreVertical size={ICON.md} />
      </button>
      {open && (
        <>
          {/* Lớp phủ để bấm ra ngoài là đóng. Không có nó thì menu dính lại. */}
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onOpen(); }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Eye size={ICON.sm} className="text-slate-400" /> Xem chi tiết
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                navigator.clipboard?.writeText(ticket.ticketNo);
                onToast?.(`Đã sao chép ${ticket.ticketNo}`, 'success');
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              <Copy size={ICON.sm} className="text-slate-400" /> Sao chép mã yêu cầu
            </button>

            {/* Sửa và xoá chỉ hiện khi còn sửa được. Hiện rồi báo lỗi lúc bấm
                là bắt người dùng học luật bằng cách va vào nó. */}
            {editable && (
              <>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit?.(); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Pencil size={ICON.sm} className="text-slate-400" /> Sửa yêu cầu
                </button>
                <div className="my-1 border-t border-slate-100" />
                {!confirming ? (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setConfirming(true); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={ICON.sm} /> Xoá yêu cầu
                  </button>
                ) : (
                  <div className="px-3 py-2">
                    <p className="text-xs leading-relaxed text-red-700">
                      Xoá vĩnh viễn {ticket.ticketNo}? Không khôi phục được.
                    </p>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); void remove(); }}
                        className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
                      >
                        {busy ? 'Đang xoá…' : 'Xoá'}
                      </button>
                      <button
                        type="button" disabled={busy}
                        onClick={(e) => { e.stopPropagation(); setConfirming(false); }}
                        className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500"
                      >
                        Giữ lại
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Hạn xử lý: ngày trên, giờ dưới, đỏ đậm khi đã quá hạn.
 *
 * Phiếu đã tiếp nhận nhưng chưa chốt được hạn (estimateDays > 0) nói rõ là chưa
 * xác định kèm số ngày dự kiến. Đây là màn của TRƯỜNG — thấy dấu gạch ở ô hạn
 * thì họ hiểu là chưa ai nhận phiếu, rồi gọi điện hỏi lại đội kỹ thuật.
 */
function DueBlock({
  dueAt, isOpen, estimateDays = 0,
}: { dueAt: number | null; isOpen: boolean; estimateDays?: number }) {
  if (!dueAt) {
    if (estimateDays > 0) {
      return (
        <span className="block text-xs text-slate-600">
          Chưa xác định
          <span className="block font-normal text-slate-400">dự kiến {estimateDays} ngày</span>
        </span>
      );
    }
    return <span className="text-sm text-slate-300">—</span>;
  }
  const overdue = dueAt < Date.now() && isOpen;
  return (
    <span className={cn('block text-xs tabular-nums', overdue ? 'font-bold text-red-600' : 'text-slate-600')}>
      {fmtDateFull(dueAt)}
      <span className={cn('block font-normal', overdue ? 'text-red-500' : 'text-slate-400')}>
        {fmtTime(dueAt)}
      </span>
    </span>
  );
}

export function CampusDashboard({
  tickets, loading, error, campusName, onOpen, onEdit, onDeleted, onNew, onToast,
}: {
  tickets: Ticket[];
  loading: boolean;
  error: RepoError | null;
  campusName: string;
  onOpen: (t: Ticket) => void;
  onEdit?: (t: Ticket) => void;
  onDeleted?: () => void;
  onNew: () => void;
  onToast?: Toast;
}) {
  const [filter, setFilter] = useState<FilterId>('all');
  const [loaiLoc, setLoaiLoc] = useState<'all' | TicketType>('all');
  const [sort, setSort] = useState<SortId>('newest');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const stats = useMemo(() => {
    const now = Date.now();
    return {
      total: tickets.length,
      open: tickets.filter((t) => OPEN_STATUSES.includes(t.status)).length,
      needsInfo: tickets.filter((t) => t.status === 'NEEDS_INFO').length,
      done: tickets.filter((t) => DONE_STATUSES.includes(t.status)).length,
      overdue: tickets.filter((t) => t.dueAt && t.dueAt < now && OPEN_STATUSES.includes(t.status)).length,
      systemWide: tickets.filter((t) => t.scope === 'SYSTEM_WIDE').length,
    };
  }, [tickets]);

  const countOf = (id: FilterId) =>
    id === 'all' ? stats.total
    : id === 'open' ? stats.open
    : id === 'needs_info' ? stats.needsInfo
    : id === 'done' ? stats.done
    : stats.overdue;

  // Đếm theo loại: tính trên kết quả của bộ lọc TRẠNG THÁI, chưa qua ô tìm
  // kiếm. Đưa cả từ khoá vào thì mỗi lần gõ một chữ con số lại nhảy, và người
  // dùng không biết số đó đang nói về cái gì.
  const demTheoLoai = useMemo(() => {
    const now = Date.now();
    let list = tickets;
    switch (filter) {
      case 'open': list = list.filter((t) => OPEN_STATUSES.includes(t.status)); break;
      case 'needs_info': list = list.filter((t) => t.status === 'NEEDS_INFO'); break;
      case 'done': list = list.filter((t) => DONE_STATUSES.includes(t.status)); break;
      case 'overdue':
        list = list.filter((t) => t.dueAt && t.dueAt < now && OPEN_STATUSES.includes(t.status));
        break;
    }
    return {
      all: list.length,
      BUG: list.filter((t) => t.type === 'BUG').length,
      FEATURE_REQUEST: list.filter((t) => t.type === 'FEATURE_REQUEST').length,
    };
  }, [tickets, filter]);

  const shown = useMemo(() => {
    const now = Date.now();
    let list = tickets;
    switch (filter) {
      case 'open': list = list.filter((t) => OPEN_STATUSES.includes(t.status)); break;
      case 'needs_info': list = list.filter((t) => t.status === 'NEEDS_INFO'); break;
      case 'done': list = list.filter((t) => DONE_STATUSES.includes(t.status)); break;
      case 'overdue':
        list = list.filter((t) => t.dueAt && t.dueAt < now && OPEN_STATUSES.includes(t.status));
        break;
    }

    // Lọc theo LOẠI yêu cầu. Đặt sau bộ lọc trạng thái và trước ô tìm kiếm:
    // ba trục độc lập, chồng lên nhau theo đúng thứ tự người dùng thu hẹp dần.
    if (loaiLoc !== 'all') list = list.filter((t) => t.type === loaiLoc);

    // Tìm không dấu: người gõ "khong dang nhap" phải ra được phiếu "Không đăng
    // nhập". Bỏ dấu cả hai vế mới khớp — đây là mặc định của người dùng Việt.
    const needle = boDau(q.trim());
    if (needle) {
      list = list.filter((t) =>
        boDau(`${t.ticketNo} ${t.title} ${t.description ?? ''}`).includes(needle)
      );
    }

    const sorted = [...list];
    if (sort === 'newest') sorted.sort((a, b) => b.createdAt - a.createdAt);
    if (sort === 'oldest') sorted.sort((a, b) => a.createdAt - b.createdAt);
    if (sort === 'due') {
      // Phiếu chưa có hạn xuống cuối: chúng chưa được tiếp nhận nên không có gì
      // để sắp theo, đẩy lên đầu chỉ che mất phiếu đang gấp thật.
      sorted.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
    }
    return sorted;
  }, [tickets, filter, loaiLoc, q, sort]);

  // Đổi bộ lọc / từ khoá mà vẫn đứng ở trang 3 thì màn hình trống trơn.
  useEffect(() => { setPage(1); }, [filter, q, sort, pageSize]);

  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const from = (pageSafe - 1) * pageSize;
  const rows = shown.slice(from, from + pageSize);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Yêu cầu hỗ trợ</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
            <Building2 size={ICON.md} className="text-slate-400" />
            {campusName}
          </p>
        </div>
        <Button onClick={onNew} className="shadow-sm">
          <Plus size={ICON.lg} /> Tạo yêu cầu mới
        </Button>
      </div>

      {/* "Cần bạn bổ sung" tách riêng vì đó là thứ DUY NHẤT ở màn này đang chờ
          hành động của chính người đang xem. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tổng yêu cầu" value={stats.total} caption="Trong hệ thống"
          tone="indigo" icon={<Inbox size={ICON.xl} />} />
        <StatCard label="Đang xử lý" value={stats.open} caption="Chờ xử lý"
          tone="sky" icon={<Loader2 size={ICON.xl} />} />
        <StatCard label="Cần bạn bổ sung" value={stats.needsInfo} caption="Chờ bổ sung thông tin"
          tone="amber" icon={<AlertTriangle size={ICON.xl} />} />
        <StatCard label="Đã xong" value={stats.done} caption="Hoàn thành"
          tone="emerald" icon={<CheckCircle2 size={ICON.xl} />} />
      </div>

      {stats.needsInfo > 0 && (
        <AlertBar tone="red" icon={<HelpCircle size={ICON.lg} />} onClick={() => setFilter('needs_info')}>
          {stats.needsInfo} yêu cầu đang chờ bạn bổ sung thông tin. Đội kỹ thuật không xử lý tiếp được cho tới khi bạn trả lời.
        </AlertBar>
      )}

      {stats.overdue > 0 && (
        <AlertBar tone="red" icon={<AlertTriangle size={ICON.lg} />} onClick={() => setFilter('overdue')}>
          {stats.overdue} yêu cầu đã quá hạn xử lý. Đội kỹ thuật đã được cảnh báo tự động.
        </AlertBar>
      )}

      {stats.systemWide > 0 && (
        <AlertBar tone="sky" icon={<Globe size={ICON.lg} />} onClick={() => setFilter('open')}>
          {vi.list.systemWideBanner(stats.systemWide)}
        </AlertBar>
      )}

      <Card>
        {/* Thanh lọc + tìm + sắp xếp. Tab thay cho chip bo tròn: tab có gạch
            chân chỉ rõ "đang ở đâu", chip đầy màu dễ bị nhìn nhầm thành nút. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 pt-2">
          <div className="-mb-px flex flex-wrap">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  filter === f.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                )}
              >
                <f.Icon size={ICON.sm} />
                {f.label} ({countOf(f.id)})
              </button>
            ))}
          </div>

          {/* Lọc theo loại yêu cầu. Phía trường cũng cần: người gửi phiếu hay
              hỏi "cái đề xuất tôi gửi tháng trước tới đâu rồi" — không tách
              được loại thì phải dò cả danh sách. */}
          {demTheoLoai.BUG > 0 && demTheoLoai.FEATURE_REQUEST > 0 && (
            <TypeFilterChips value={loaiLoc} onChange={setLoaiLoc} counts={demTheoLoai} className="pb-1" />
          )}

          <div className="flex flex-wrap items-center gap-2 pb-2">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortId)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
            >
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
            <div className="relative">
              <Search size={ICON.md} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Tìm trong danh sách..."
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none sm:w-64"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <StateBlock kind="loading" />
        ) : error ? (
          <StateBlock
            kind={error.kind === 'denied' ? 'denied' : 'error'}
            description={
              error.kind === 'denied' ? vi.errors.permissionDeniedHint
                : `${vi.errors.loadFailed} — ${error.message}`
            }
          />
        ) : rows.length === 0 ? (
          <StateBlock
            kind="empty"
            title={
              q.trim() ? 'Không tìm thấy yêu cầu nào'
              : filter === 'all' ? 'Trường bạn chưa gửi yêu cầu nào'
              : 'Không có yêu cầu nào khớp bộ lọc'
            }
            description={
              q.trim() ? `Không có yêu cầu nào chứa “${q.trim()}”. Thử từ khoá ngắn hơn.`
              : filter === 'all' ? 'Bấm "Tạo yêu cầu mới" để gửi yêu cầu đầu tiên.'
              : 'Đổi bộ lọc để xem các yêu cầu khác.'
            }
          />
        ) : (
          <>
            {/* Bảng thật trên máy tính. Cột rộng cố định để hàng nào cũng thẳng
                cột, kể cả khi nội dung dài ngắn khác nhau. */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px] text-left">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3 font-medium">Mã yêu cầu</th>
                    <th className="px-3 py-3 font-medium">Loại</th>
                    <th className="px-3 py-3 font-medium">Nội dung</th>
                    <th className="px-3 py-3 font-medium">Phân hệ</th>
                    <th className="px-3 py-3 font-medium">Trạng thái</th>
                    <th className="px-3 py-3 font-medium">Hạn xử lý</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr
                      key={t.id}
                      onClick={() => onOpen(t)}
                      className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50"
                    >
                      <td className="px-4 py-3 align-top">
                        <span className="block font-mono text-xs font-semibold tabular-nums text-slate-700">
                          {t.ticketNo}
                        </span>
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          Tạo lúc: {fmtDateFull(t.createdAt)} {fmtTime(t.createdAt)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top"><TypeBadge type={t.type} /></td>
                      <td className="max-w-md px-3 py-3 align-top">
                        <span className="line-clamp-1 text-sm font-semibold text-slate-900">{t.title}</span>
                        {t.description && (
                          <span className="mt-0.5 line-clamp-1 block text-xs text-slate-400">
                            {t.description}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top"><ModuleCell code={t.moduleId} /></td>
                      <td className="px-3 py-3 align-top"><StatusBadge status={t.status} /></td>
                      <td className="px-3 py-3 align-top">
                        <DueBlock dueAt={t.dueAt} isOpen={OPEN_STATUSES.includes(t.status)} estimateDays={t.estimateDays} />
                      </td>
                      <td className="px-4 py-3 text-right align-top">
                        <RowMenu
                          ticket={t} onOpen={() => onOpen(t)} onEdit={() => onEdit?.(t)}
                          onDeleted={onDeleted} onToast={onToast}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Bảng 7 cột không đọc nổi trên điện thoại — đổi sang danh sách thẻ. */}
            <ul className="divide-y divide-slate-100 lg:hidden">
              {rows.map((t) => (
                <li key={t.id}>
                  <button onClick={() => onOpen(t)} className="w-full px-4 py-3 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <TypeBadge type={t.type} />
                      <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-600">
                        {t.ticketNo}
                      </span>
                      <StatusBadge status={t.status} />
                    </div>
                    <p className="mt-1.5 text-sm font-semibold text-slate-900">{t.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <ModuleCell code={t.moduleId} />
                      <DueBlock dueAt={t.dueAt} isOpen={OPEN_STATUSES.includes(t.status)} estimateDays={t.estimateDays} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
              <p className="text-xs text-slate-500">
                Hiển thị {from + 1} – {Math.min(from + pageSize, shown.length)} trong {shown.length} yêu cầu
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pageSafe === 1}
                  aria-label="Trang trước"
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40"
                >
                  <ChevronLeft size={ICON.md} />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    onClick={() => setPage(n)}
                    className={cn(
                      'min-w-8 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
                      n === pageSafe ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {n}
                  </button>
                ))}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={pageSafe === totalPages}
                  aria-label="Trang sau"
                  className="rounded-lg border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40"
                >
                  <ChevronRight size={ICON.md} />
                </button>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Hiển thị
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none"
                >
                  {PAGE_SIZES.map((n) => <option key={n} value={n}>{n} / trang</option>)}
                </select>
              </label>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/** Bỏ dấu tiếng Việt để tìm kiếm khớp cả khi người dùng gõ không dấu. */
function boDau(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // đ không phải tổ hợp dấu nên NFD không tách ra được, phải thay tay.
    .replace(/đ/g, 'd');
}
