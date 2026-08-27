import { Filter, Inbox } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Card, StateBlock, cn } from '../../../../components/ui';
import {
  DueCell, ICON, ModuleCell, OPEN_STATUSES, PriorityBadge, StatusBadge, TABLE, TypeBadge,
  TypeFilterChips,
} from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import { watchCampuses, type RepoError } from '../../repository/campusRepository';
import { fetchAllTickets } from '../../repository/ticketRepository';
import { TicketDetail } from '../TicketDetail';
import type { Campus, Ticket, TicketStatus, TicketType } from '../../types';
import { useSupportModules } from '../../hooks/useSupportModules';
import { useOpenTicketEvent } from '../../hooks/useOpenTicketEvent';

// ===========================================================================
// Toàn bộ phiếu của mọi trường — màn làm việc chính của admin.
//
// Mô hình nghiệp vụ đã chốt: trường CHỈ là bên gửi yêu cầu; admin nhìn thấy
// toàn bộ và quản trị toàn bộ. Nên admin không cần "màn của một trường" — admin
// cần đúng cái này: mọi phiếu, mọi trường, một chỗ.
//
// firestore.rules cho phép truy vấn không ràng buộc campus CHỈ với admin và
// nhân sự PTUD. Cùng đoạn code này chạy bằng tài khoản tại trường sẽ bị
// Firestore từ chối nguyên khối — đó là hành vi đúng.
// ===========================================================================


/** Nhóm lọc nhanh. "Đang mở" là mặc định vì đó là việc cần làm hôm nay. */
const FILTERS: Array<{ id: string; label: string; statuses: TicketStatus[] | null }> = [
  { id: 'open', label: 'Đang mở', statuses: ['TRIAGE', 'NEEDS_INFO', 'ACCEPTED', 'IN_PROGRESS', 'REOPENED', 'ON_HOLD'] },
  { id: 'triage', label: 'Chờ phân loại', statuses: ['TRIAGE'] },
  { id: 'done', label: 'Đã xong', statuses: ['RESOLVED', 'PENDING_VERIFICATION', 'CLOSED'] },
  { id: 'all', label: 'Tất cả', statuses: null },
];

export function AllTicketsView({
  actorUid, onToast,
}: {
  actorUid: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<RepoError | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [filter, setFilter] = useState('open');
  const [moduleFilter, setModuleFilter] = useState('');
  const [loaiLoc, setLoaiLoc] = useState<'all' | TicketType>('all');
  // Kể cả phân hệ đã tắt: phiếu cũ của nó vẫn phải lọc ra xem được.
  const phanHe = useSupportModules().modules;
  const [open, setOpen] = useState<Ticket | null>(null);
  // Tăng lên để buộc nạp lại sau khi đổi trạng thái phiếu.
  const [refreshKey, setRefreshKey] = useState(0);
  // Bấm mã phiếu trong màn Công việc thì mở thẳng phiếu đó ở đây.
  useOpenTicketEvent(setOpen);

  useEffect(() => watchCampuses(setCampuses, () => setCampuses([])), []);

  useEffect(() => {
    let alive = true;
    const statuses = FILTERS.find((f) => f.id === filter)?.statuses ?? undefined;
    setTickets(null);
    void fetchAllTickets({ status: statuses ?? undefined }).then((r) => {
      if (!alive) return;
      setTickets(r.tickets);
      setError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [filter, refreshKey]);

  const campusNames = useMemo(
    () => Object.fromEntries(campuses.map((c) => [c.id, c.name])),
    [campuses]
  );

  // Đếm theo loại tính SAU bộ lọc phân hệ, TRƯỚC bộ lọc loại: admin đang xem
  // riêng một phân hệ thì con số phải là của phân hệ đó, không phải của toàn hệ
  // thống — nếu không, bấm "Báo lỗi (12)" mà chỉ ra 3 dòng.
  const theoPhanHe = useMemo(
    () => (tickets ?? []).filter((t) => !moduleFilter || t.moduleId === moduleFilter),
    [tickets, moduleFilter]
  );

  const demTheoLoai = useMemo(() => ({
    all: theoPhanHe.length,
    BUG: theoPhanHe.filter((t) => t.type === 'BUG').length,
    FEATURE_REQUEST: theoPhanHe.filter((t) => t.type === 'FEATURE_REQUEST').length,
  }), [theoPhanHe]);

  const shown = useMemo(
    () => theoPhanHe.filter((t) => loaiLoc === 'all' || t.type === loaiLoc),
    [theoPhanHe, loaiLoc]
  );

  if (open) {
    return (
      <TicketDetail
        ticket={open}
        campusName={campusNames[open.campusId] ?? open.campusId}
        actorUid={actorUid}
        canResolve
        onChanged={() => { setOpen(null); setRefreshKey((k) => k + 1); }}
        onBack={() => setOpen(null)}
        onToast={onToast}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
            )}
          >
            {f.label}
          </button>
        ))}
        <select
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value)}
          className="ml-auto rounded-lg border border-slate-300 px-2 py-1.5 text-xs"
        >
          <option value="">Mọi phân hệ</option>
          {phanHe.map((m) => (
            <option key={m.code} value={m.code}>{m.name}</option>
          ))}
        </select>
      </div>

      {/* Lọc theo loại yêu cầu — trục độc lập với trạng thái và phân hệ. */}
      {demTheoLoai.BUG > 0 && demTheoLoai.FEATURE_REQUEST > 0 && (
        <TypeFilterChips value={loaiLoc} onChange={setLoaiLoc} counts={demTheoLoai} />
      )}

      <Card>
        {tickets === null ? (
          <StateBlock kind="loading" />
        ) : error ? (
          <StateBlock
            kind={error.kind === 'denied' ? 'denied' : 'error'}
            description={
              error.kind === 'denied'
                ? vi.errors.permissionDeniedHint
                : `${vi.errors.loadFailed} — ${error.message}`
            }
          />
        ) : shown.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Không có phiếu nào"
            description={
              filter === 'open'
                ? 'Chưa có phiếu nào đang mở. Đổi bộ lọc để xem phiếu đã đóng.'
                : 'Chưa có phiếu nào khớp bộ lọc.'
            }
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5 text-xs text-slate-500">
              <Inbox size={ICON.sm} />
              {shown.length} phiếu
              {moduleFilter && <Filter size={ICON.sm} className="ml-1" />}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className={TABLE.headRow}>
                  <th className={TABLE.headCell}>Mã</th>
                  <th className={TABLE.headCell}>Loại</th>
                  <th className={TABLE.headCell}>Trường</th>
                  <th className={TABLE.headCell}>Phân hệ</th>
                  <th className={TABLE.headCell}>Nội dung</th>
                  <th className={TABLE.headCell}>Trạng thái</th>
                  <th className={TABLE.headCell}>Ưu tiên</th>
                  <th className={cn(TABLE.headCell, 'text-right')}>Hạn</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} onClick={() => setOpen(t)} className={TABLE.row}>
                    <td className={cn(TABLE.cell, 'whitespace-nowrap font-mono text-[11px] tabular-nums text-slate-500')}>
                      {t.ticketNo}
                    </td>
                    <td className={TABLE.cell}><TypeBadge type={t.type} /></td>
                    {/* Cột trường là thứ admin cần nhất: nhìn ra ngay lỗi nào
                        đang lan ra nhiều trường. */}
                    <td className={cn(TABLE.cell, 'whitespace-nowrap')}>
                      <Badge variant="neutral">{campusNames[t.campusId] ?? t.campusId}</Badge>
                      {t.scope === 'SYSTEM_WIDE' && (
                        <Badge variant="sky" className="ml-1">+{(t.affectedCampusIds ?? []).length - 1}</Badge>
                      )}
                    </td>
                    {/* Phân hệ có icon riêng: năm dòng chữ xám giống nhau thì
                        phải đọc từng chữ, còn icon thì quét mắt là nhận ra. */}
                    <td className={cn(TABLE.cell, 'whitespace-nowrap')}>
                      <ModuleCell code={t.moduleId} />
                    </td>
                    <td className={cn(TABLE.cell, 'max-w-sm')}>
                      <span className="line-clamp-1 text-slate-800">{t.title}</span>
                    </td>
                    <td className={TABLE.cell}><StatusBadge status={t.status} /></td>
                    <td className={TABLE.cell}>
                      {t.priority ? <PriorityBadge priority={t.priority} /> : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className={cn(TABLE.cell, 'text-right')}>
                      <DueCell dueAt={t.dueAt} isOpen={OPEN_STATUSES.includes(t.status)} estimateDays={t.estimateDays} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}
