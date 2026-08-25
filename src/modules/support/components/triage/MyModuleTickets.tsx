import { ClipboardList, Inbox } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Card, StateBlock, cn } from '../../../../components/ui';
import {
  DONE_STATUSES as DONE, DueCell, ICON, ModuleCell, OPEN_STATUSES as OPEN, PriorityBadge,
  StatusBadge, TABLE, TypeIcon,
} from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import { fetchAllTickets } from '../../repository/ticketRepository';
import { fetchMyTriageScope } from '../../repository/userAdminRepository';
import { TicketDetail } from '../TicketDetail';
import type { Ticket } from '../../types';
import { useSupportModules } from '../../hooks/useSupportModules';
import { useOpenTicketEvent } from '../../hooks/useOpenTicketEvent';

// ===========================================================================
// Đơn yêu cầu thuộc các phân hệ TÔI phụ trách.
//
// Khác màn "Tất cả phiếu" của admin ở đúng một điểm: lọc theo phân hệ mình là
// đầu mối. Cán bộ phụ trách hệ thống A không cần nhìn phiếu của hệ thống B —
// hiện ra chỉ làm loãng thứ họ phải xử lý.
// ===========================================================================



const FILTERS = [
  { id: 'open', label: 'Đang mở', match: (t: Ticket) => OPEN.includes(t.status) },
  { id: 'triage', label: 'Chờ tiếp nhận', match: (t: Ticket) => t.status === 'TRIAGE' },
  { id: 'done', label: 'Đã xong', match: (t: Ticket) => DONE.includes(t.status) },
  { id: 'all', label: 'Tất cả', match: () => true },
] as const;

export function MyModuleTickets({
  actorUid, onToast,
}: {
  actorUid: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [scope, setScope] = useState<{ moduleCodes: string[]; projectNames: string[] }>({
    moduleCodes: [], projectNames: [],
  });
  const [error, setError] = useState<RepoError | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('open');
  const [open, setOpen] = useState<Ticket | null>(null);

  const load = useCallback(async () => {
    const [sc, all] = await Promise.all([
      fetchMyTriageScope(actorUid), fetchAllTickets({ limit: 200 }),
    ]);
    setScope({ moduleCodes: sc.moduleCodes, projectNames: sc.projectNames });
    setTickets(all.tickets);
    setError(sc.error ?? all.error);
  }, [actorUid]);

  useEffect(() => { void load(); }, [load]);

  // Phạm vi giống hệt hàng đợi tiếp nhận: phân hệ mình là đầu mối, HOẶC phân hệ
  // đổ vào dự án mình phụ trách.
  const myModuleCodes = scope.moduleCodes;
  const { nameOf: tenPhanHe } = useSupportModules();
  useOpenTicketEvent(setOpen);

  const mine = useMemo(
    () => (tickets ?? []).filter((t) => myModuleCodes.includes(t.moduleId)),
    [tickets, myModuleCodes]
  );

  const shown = useMemo(
    () => mine.filter(FILTERS.find((f) => f.id === filter)!.match),
    [mine, filter]
  );

  if (open) {
    return (
      <TicketDetail
        ticket={open}
        campusName={open.campusId}
        actorUid={actorUid}
        canResolve
        onChanged={() => { setOpen(null); void load(); }}
        onBack={() => { setOpen(null); void load(); }}
        onToast={onToast}
      />
    );
  }

  if (tickets === null) return <StateBlock kind="loading" />;

  if (error) {
    return (
      <Card>
        <StateBlock
          kind={error.kind === 'denied' ? 'denied' : 'error'}
          description={error.kind === 'denied' ? vi.errors.permissionDeniedHint : error.message}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <ClipboardList size={ICON.xl} className="mt-0.5 shrink-0 text-slate-400" />
        <div>
        <h2 className="text-lg font-bold text-slate-900">Đơn yêu cầu theo hệ thống</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          {myModuleCodes.length > 0
            ? `Phụ trách: ${myModuleCodes.map(tenPhanHe).join(' · ')}`
            : 'Bạn chưa phụ trách hệ thống nào'}
        </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
              filter === f.id ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {f.label} <span className="opacity-70">({mine.filter(f.match).length})</span>
          </button>
        ))}
      </div>

      <Card>
        {shown.length === 0 ? (
          <StateBlock
            kind="empty"
            title={myModuleCodes.length === 0 ? 'Chưa phụ trách hệ thống nào' : 'Không có yêu cầu nào'}
            description={
              myModuleCodes.length === 0
                ? 'Quản trị viên cần thêm bạn vào một dự án (Hỗ trợ > Dự án) hoặc gán bạn làm đầu mối phân hệ.'
                : 'Đổi bộ lọc để xem các yêu cầu khác.'
            }
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              <Inbox size={ICON.sm} /> {shown.length} yêu cầu
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
                  <th className={TABLE.headCell}>Công việc</th>
                  <th className={cn(TABLE.headCell, 'text-right')}>Hạn</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => (
                  <tr key={t.id} onClick={() => setOpen(t)} className={TABLE.row}>
                    <td className={cn(TABLE.cell, 'whitespace-nowrap font-mono text-[11px] tabular-nums text-slate-500')}>
                      {t.ticketNo}
                    </td>
                    <td className={TABLE.cell}><TypeIcon type={t.type} size={ICON.md} /></td>
                    <td className={cn(TABLE.cell, 'whitespace-nowrap')}>
                      <Badge variant="neutral">{t.campusId}</Badge>
                    </td>
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
                    <td className={cn(TABLE.cell, 'whitespace-nowrap')}>
                      {t.linkedTaskId
                        ? <Badge variant="success">Đã tạo</Badge>
                        : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className={cn(TABLE.cell, 'text-right')}>
                      <DueCell dueAt={t.dueAt} isOpen={OPEN.includes(t.status)} estimateDays={t.estimateDays} />
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
