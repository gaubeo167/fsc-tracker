import {
  AlertTriangle, CalendarClock, Check, ChevronDown, ChevronUp, Flag, HelpCircle,
  Inbox, Mail, MessageSquare, UserRound, Users, X,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, StateBlock, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import { acceptTicket, fetchTriageQueueForModules, rejectTicket, requestMoreInfo } from '../../repository/ticketRepository';
import {
  fetchMyTriageScope, fetchPtudStaff, fetchSupportModules, type ModuleScope,
} from '../../repository/userAdminRepository';
import { addWorkingMs, type WorkingCalendar } from '../../services/workingTime';
import { useWorkingCalendar } from '../../hooks/useWorkingCalendar';
import { StatusBadge, TypeIcon } from '../../ui/tokens';
import { findPolicy } from '../../services/slaCalculator';
import { useSupportModules } from '../../hooks/useSupportModules';
import {
  DomainError,
  type SupportModuleCode, type SupportModuleConfig, type Ticket, type TicketPriority,
} from '../../types';

// ===========================================================================
// Hàng đợi tiếp nhận, dành cho đầu mối phân hệ và admin.
//
// Mục tiêu §10: tiếp nhận một phiếu trong dưới 30 giây. Cách đạt được:
//   - hạn xử lý ĐIỀN SẴN theo ma trận SLA của độ ưu tiên đang chọn
//   - đổi độ ưu tiên thì hạn tự tính lại, không phải bấm lịch
//   - người xử lý mặc định là chính đầu mối đang thao tác
//   - mọi thứ nằm trên một hàng, không mở modal
//
// Nếu bắt người ta chọn tay từng thứ thì 30 giây là điều không thể.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

/** Một lớp ô nhập cho MỌI ô trong khung tiếp nhận — cao bằng nhau, viền như nhau. */
const O_NHAP =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-indigo-500 focus:outline-none';

const GHI_CHU_TOI_DA = 500;

/**
 * Nhãn ô nhập: icon + chữ + dấu sao nếu bắt buộc.
 *
 * Icon không phải trang trí — nó là thứ cho phép quét mắt tìm đúng ô mà không
 * phải đọc hết nhãn. Dấu sao đỏ phải có: ba ô đầu bắt buộc, không đánh dấu thì
 * người dùng bấm gửi rồi mới biết.
 */
function Nhan({ icon, children, bat }: { icon: React.ReactNode; children: React.ReactNode; bat?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
      <span className="text-slate-400">{icon}</span>
      {children}
      {bat && <span className="text-red-500" aria-hidden>*</span>}
    </span>
  );
}

interface Draft {
  priority: TicketPriority;
  assigneeUserId: string;
  dueAt: number;
  note: string;
  /** Người cần nắm thông tin, không phải người xử lý. */
  cc: string[];
}

/**
 * Hạn xử lý suy từ ma trận SLA, tính theo giờ làm việc THẬT.
 *
 * Lịch phải truyền vào, không lấy hằng số: DEFAULT_CALENDAR có holidays rỗng,
 * nên hạn của một phiếu mở trước Tết rơi thẳng vào giữa kỳ nghỉ và hệ thống báo
 * quá hạn cho một ngày không ai đi làm.
 */
function defaultDueAt(ticket: Ticket, priority: TicketPriority, cal: WorkingCalendar): number {
  const policy = findPolicy(ticket.type, priority);
  const minutes = policy?.resolutionMinutes ?? 8 * 60;
  return addWorkingMs(Date.now(), minutes * 60_000, cal);
}

function toDateInput(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

function fromDateInput(value: string): number {
  // 17:00 giờ VN của ngày được chọn — cuối giờ làm việc, đúng nghĩa "hạn trong ngày".
  return Date.parse(`${value}T00:00:00Z`) + 17 * 3600_000 - 7 * 3600_000;
}

export function TriageQueue({
  actorUid, isAdmin, onToast, onCount,
}: {
  actorUid: string;
  /** Admin thấy hàng đợi của MỌI phân hệ, đầu mối chỉ thấy phân hệ mình phụ trách. */
  isAdmin: boolean;
  onToast: Toast;
  /** Báo số phiếu đang chờ ra ngoài, để tab hiện được con số. */
  onCount?: (n: number) => void;
}) {
  const [modules, setModules] = useState<SupportModuleConfig[] | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [staff, setStaff] = useState<Array<{ uid: string; displayName: string; supportRole: string }>>([]);
  /** uid -> tên hiển thị, phủ cả người không có phân vai hỗ trợ (vd admin). */
  const [directory, setDirectory] = useState<Record<string, string>>({});
  const [error, setError] = useState<RepoError | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  // Dòng nào đang mở, và mở để làm gì.
  //
  // Mặc định KHÔNG mở gì: mỗi phiếu chỉ hiện ba lựa chọn. Ô nhập của từng lựa
  // chọn chỉ bung ra sau khi bấm — hàng đợi hàng chục phiếu mà phiếu nào cũng
  // trải sẵn ô ưu tiên, người xử lý, hạn, CC thì không đọc nổi danh sách.
  const [openFor, setOpenFor] =
    useState<{ id: string; mode: 'accept' | 'reject' | 'info' } | null>(null);
  const [reason, setReason] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const { nameOf: tenPhanHe } = useSupportModules();
  const lichLamViec = useWorkingCalendar();
  const [scope, setScope] = useState<{
    moduleCodes: string[]; projectNames: string[]; byModule: Record<string, ModuleScope>;
  }>({ moduleCodes: [], projectNames: [], byModule: {} });

  // Admin thấy mọi phân hệ. Cán bộ PTUD thấy phân hệ mình là đầu mối HOẶC
  // phân hệ đổ vào dự án mình phụ trách — xem fetchMyTriageScope.
  const myModules = useMemo(
    () => (isAdmin ? (modules ?? []).map((m) => m.code) : scope.moduleCodes),
    [modules, isAdmin, scope.moduleCodes]
  );

  const moduleById = useMemo(
    () => Object.fromEntries((modules ?? []).map((m) => [m.code, m])),
    [modules]
  );

  const reload = useCallback(async () => {
    const [mod, st, sc] = await Promise.all([
      fetchSupportModules(), fetchPtudStaff(), fetchMyTriageScope(actorUid),
    ]);
    setModules(mod.modules);
    setStaff(st.staff);
    setDirectory(st.directory);
    setScope({ moduleCodes: sc.moduleCodes, projectNames: sc.projectNames, byModule: sc.byModule });
    const codes = (isAdmin ? mod.modules.map((m) => m.code) : sc.moduleCodes) as SupportModuleCode[];
    const q = await fetchTriageQueueForModules(codes);
    setTickets(q.tickets);
    setError(mod.error ?? st.error ?? sc.error ?? q.error);
  }, [actorUid, isAdmin]);

  useEffect(() => { void reload(); }, [reload]);

  // Báo số phiếu ra ngoài cho tab. Chỉ đếm khi đã tải xong, không thì tab nháy
  // số 0 rồi mới nhảy lên số thật.
  useEffect(() => { if (tickets) onCount?.(tickets.length); }, [tickets, onCount]);

  const nameOf = useCallback(
    (uid: string) => directory[uid] ?? staff.find((x) => x.uid === uid)?.displayName ?? uid,
    [directory, staff]
  );

  function draftOf(t: Ticket): Draft {
    return drafts[t.id] ?? {
      // P3 là mặc định trung dung: không thổi phồng mọi phiếu thành P1, cũng
      // không hạ thấp thành P4 rồi quên.
      priority: 'P3',
      assigneeUserId: actorUid,
      dueAt: defaultDueAt(t, 'P3', lichLamViec),
      note: '',
      cc: [],
    };
  }

  function patch(t: Ticket, p: Partial<Draft>) {
    setDrafts((d) => {
      const cur = d[t.id] ?? draftOf(t);
      const next = { ...cur, ...p };
      // Đổi độ ưu tiên thì hạn tính lại theo SLA, TRỪ KHI người dùng đã tự sửa
      // hạn — không được ghi đè lựa chọn của họ.
      if (p.priority && p.dueAt === undefined && cur.dueAt === defaultDueAt(t, cur.priority, lichLamViec)) {
        next.dueAt = defaultDueAt(t, p.priority, lichLamViec);
      }
      return { ...d, [t.id]: next };
    });
    setRowError((e) => ({ ...e, [t.id]: '' }));
  }

  /** Từ chối hoặc hỏi thêm — dùng chung một ô nhập lý do. */
  async function submitReason(t: Ticket, mode: 'reject' | 'info') {
    setBusy(t.id);
    try {
      const fn = mode === 'reject'
        ? rejectTicket({ ticket: t, reason, actorUid })
        : requestMoreInfo({ ticket: t, request: reason, actorUid });
      const { ok, error: err } = await fn;
      if (!ok) {
        setRowError((e) => ({
          ...e,
          [t.id]: err?.kind === 'denied' ? 'Bạn không có quyền thao tác trên phiếu này.'
                                         : `Không lưu được (${err?.message ?? 'lỗi mạng'})`,
        }));
        return;
      }
      onToast(
        mode === 'reject' ? `Đã từ chối ${t.ticketNo}` : `Đã gửi yêu cầu bổ sung cho ${t.ticketNo}`,
        mode === 'reject' ? 'info' : 'success'
      );
      setOpenFor(null);
      setReason('');
      await reload();
    } catch (e: any) {
      setRowError((x) => ({ ...x, [t.id]: e instanceof DomainError ? e.message : 'Không lưu được' }));
    } finally {
      setBusy(null);
    }
  }

  async function accept(t: Ticket) {
    const d = draftOf(t);
    const cfg = moduleById[t.moduleId];
    setBusy(t.id);
    try {
      const { ok, error: err } = await acceptTicket({
        ticket: t,
        projectId: cfg?.projectId ?? '',
        priority: d.priority,
        assigneeUserId: d.assigneeUserId,
        dueAt: d.dueAt,
        actorUid,
        note: d.note,
        ccUserIds: d.cc,
      });
      if (!ok) {
        setRowError((e) => ({
          ...e,
          [t.id]: err?.kind === 'denied'
            ? 'Bạn không có quyền tiếp nhận phiếu của phân hệ này.'
            : `Không tiếp nhận được (${err?.message ?? 'lỗi mạng'})`,
        }));
        return;
      }
      onToast(`Đã tiếp nhận ${t.ticketNo} và tạo công việc`, 'success');
      setOpenFor(null);
      await reload();
    } catch (e: any) {
      setRowError((x) => ({
        ...x,
        [t.id]: e instanceof DomainError ? e.message : 'Không tiếp nhận được',
      }));
    } finally {
      setBusy(null);
    }
  }

  if (tickets === null || modules === null) return <StateBlock kind="loading" />;

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

  if (myModules.length === 0) {
    return (
      <Card>
        <StateBlock
          kind="empty"
          title="Bạn chưa phụ trách hệ thống nào"
          description={
            scope.projectNames.length > 0
              ? `Bạn đang ở dự án ${scope.projectNames.join(', ')}, nhưng chưa dự án nào được gán phân hệ. Quản trị viên gán phân hệ cho dự án ở Hỗ trợ > Dự án.`
              : 'Quản trị viên cần thêm bạn vào một dự án (Hỗ trợ > Dự án) hoặc gán bạn làm đầu mối phân hệ. Sau đó yêu cầu của hệ thống đó sẽ hiện ở đây.'
          }
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <Inbox size={ICON.xl} className="mt-0.5 shrink-0 text-slate-400" />
        <div>
        <h2 className="text-lg font-bold text-slate-900">Chờ tiếp nhận</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Phụ trách: {myModules.map(tenPhanHe).join(' · ')}
          {scope.projectNames.length > 0 && !isAdmin && (
            <span className="text-slate-400"> · qua dự án {scope.projectNames.join(', ')}</span>
          )}
        </p>
        </div>
      </div>

      <Card>
        {tickets.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Không có phiếu nào chờ tiếp nhận"
            description="Mọi yêu cầu thuộc phân hệ bạn phụ trách đều đã được xử lý."
          />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
              <span className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <Inbox size={ICON.lg} className="text-slate-400" />
                {tickets.length} phiếu chờ tiếp nhận
              </span>
              <Button size="sm" variant="outline" onClick={() => setCollapsed((v) => !v)}>
                {collapsed ? <>Mở rộng <ChevronDown size={ICON.md} /></>
                           : <>Thu gọn <ChevronUp size={ICON.md} /></>}
              </Button>
            </div>
            <ul className={cn('divide-y divide-slate-100', collapsed && 'hidden')}>
              {tickets.map((t) => {
                const d = draftOf(t);
                const cfg = moduleById[t.moduleId];
                const noProject = !cfg?.projectId;
                const ms = scope.byModule[t.moduleId];
                // Admin và quản lý dự án gán được cho người khác. Thành viên thường
                // chỉ tự nhận việc.
                const canAssignOthers = isAdmin || !!ms?.isManager;
                // Admin đứng ngoài dự án nên byModule không có entry — cho admin
                // chọn trong toàn bộ cán bộ PTUD. Người trong dự án thì bị giới
                // hạn trong dự án đó.
                const basePeople = ms?.people?.length
                  ? ms.people
                  : isAdmin ? staff.map((x) => x.uid) : [];
                // Luôn có mình trong danh sách: đầu mối phân hệ có thể không nằm
                // trong managers/members của dự án, khi đó value mặc định
                // (actorUid) sẽ không khớp option nào và select hiển thị sai người.
                const projectPeople = basePeople.includes(actorUid)
                  ? basePeople
                  : [actorUid, ...basePeople];
                return (
                  <li key={t.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <TypeIcon type={t.type} size={ICON.lg} />
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] font-bold tabular-nums text-slate-600">
                        {t.ticketNo}
                      </span>
                      <Badge variant="neutral">{t.campusId}</Badge>
                      <StatusBadge status={t.status} />
                      {t.attachments?.length > 0 && (
                        <span className="text-[10px] text-slate-400">{t.attachments.length} đính kèm</span>
                      )}
                    </div>
                    <p className="mt-1.5 text-base font-bold leading-snug text-slate-900">{t.title}</p>
                    {t.description && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{t.description}</p>
                    )}
                    {t.contactEmail && (
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <Mail size={ICON.xs} className="shrink-0" />
                        Đầu mối: {t.contactName}
                        <span aria-hidden>·</span>
                        {/* mailto: kỹ thuật viên liên hệ được ngay từ hàng đợi,
                            không phải chép tay địa chỉ sang ứng dụng mail. */}
                        <a
                          href={`mailto:${t.contactEmail}?subject=${encodeURIComponent(`[${t.ticketNo}] ${t.title}`)}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-medium text-indigo-600 underline decoration-indigo-200 underline-offset-2"
                        >
                          {t.contactEmail}
                        </a>
                      </p>
                    )}

                    {/* Phiếu đang chờ trường trả lời: hiện đúng câu đã hỏi, để
                        người tiếp nhận biết đang chờ cái gì mà không phải mở
                        phiếu ra đọc lại. */}
                    {t.status === 'NEEDS_INFO' && (
                      <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700">
                        <HelpCircle size={ICON.md} className="mt-0.5 shrink-0" />
                        <span>
                          Đang chờ trường bổ sung:{' '}
                          <span className="font-medium">
                            {t.needsInfoRequest || 'thêm thông tin để tiếp nhận và xử lý yêu cầu.'}
                          </span>
                        </span>
                      </p>
                    )}

                    {/* Phân hệ chưa gán dự án thì không sinh task được — nói ngay
                        thay vì để họ bấm rồi mới báo lỗi. */}
                    {noProject && (
                      <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        <AlertTriangle size={ICON.sm} className="shrink-0" />
                        Phân hệ này chưa được gán dự án. Vào tab Phân hệ để gán trước khi tiếp nhận.
                      </p>
                    )}

                    {rowError[t.id] && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                        {rowError[t.id]}
                      </p>
                    )}

                    {/* Ba lựa chọn. Không mở modal: hàng đợi nhiều dòng, mở/đóng
                        modal từng cái phá mục tiêu dưới 30 giây mỗi phiếu. */}
                    {openFor?.id !== t.id && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busy === t.id || noProject}
                          onClick={() => { setOpenFor({ id: t.id, mode: 'accept' }); setReason(''); }}
                          className={cn(noProject && 'opacity-50')}
                        >
                          <Check size={ICON.md} /> Tiếp nhận công việc
                        </Button>
                        {/* Hỏi thêm đứng TRƯỚC từ chối: phần lớn phiếu thiếu
                            thông tin chứ không phải sai, và từ chối là cửa một
                            chiều nên không nên là lựa chọn dễ bấm nhất. */}
                        <Button size="sm" variant="outline" disabled={busy === t.id}
                          onClick={() => { setOpenFor({ id: t.id, mode: 'info' }); setReason(''); }}>
                          <HelpCircle size={ICON.md} /> Hỏi thêm thông tin
                        </Button>
                        <Button size="sm" variant="danger" disabled={busy === t.id}
                          onClick={() => { setOpenFor({ id: t.id, mode: 'reject' }); setReason(''); }}>
                          <X size={ICON.md} /> Từ chối
                        </Button>
                      </div>
                    )}

                    {/* Chọn "Tiếp nhận" rồi mới phải điền: ưu tiên, người xử lý,
                        hạn hoàn thành, CC. */}
                    {openFor?.id === t.id && openFor.mode === 'accept' && (
                      <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-4">
                        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-700">
                          <ChevronDown size={ICON.md} />
                          Thông tin tiếp nhận
                        </div>

                        <div className="mt-3 grid gap-3 lg:grid-cols-3">
                          <label className="block">
                            <Nhan icon={<Flag size={ICON.sm} />} bat>Độ ưu tiên</Nhan>
                            <select
                              value={d.priority}
                              onChange={(e) => patch(t, { priority: e.target.value as TicketPriority })}
                              className={O_NHAP}
                            >
                              <option value="P1">P1 — Chặn nhiều trường</option>
                              <option value="P2">P2 — Chặn một trường</option>
                              <option value="P3">P3 — Ảnh hưởng cục bộ</option>
                              <option value="P4">P4 — Hiển thị, không chặn</option>
                            </select>
                          </label>

                          <label className="block">
                            <Nhan icon={<UserRound size={ICON.sm} />} bat>Người xử lý</Nhan>
                            {/* Quản lý dự án gán được cho người khác trong dự án.
                                Nhân viên chỉ TỰ NHẬN việc về mình — không có quyền
                                giao việc cho đồng nghiệp. */}
                            {canAssignOthers ? (
                              <select
                                value={d.assigneeUserId}
                                onChange={(e) => patch(t, { assigneeUserId: e.target.value })}
                                className={O_NHAP}
                              >
                                {projectPeople.map((uid) => (
                                  <option key={uid} value={uid}>
                                    {nameOf(uid)}{uid === actorUid ? ' (tôi)' : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <>
                                <div className={cn(O_NHAP, 'bg-slate-50 text-slate-700')}>
                                  {nameOf(actorUid)} (tôi)
                                </div>
                                <span className="mt-1 block text-[11px] text-slate-400">
                                  Bạn là thành viên dự án nên chỉ tự nhận việc. Quản lý dự án mới giao được cho người khác.
                                </span>
                              </>
                            )}
                          </label>

                          <label className="block">
                            <Nhan icon={<CalendarClock size={ICON.sm} />} bat>Hạn hoàn thành</Nhan>
                            <input
                              type="date"
                              value={toDateInput(d.dueAt)}
                              onChange={(e) => patch(t, { dueAt: fromDateInput(e.target.value) })}
                              className={O_NHAP}
                            />
                            <span className="mt-1 block text-[11px] text-slate-400">
                              Điền sẵn theo SLA của {d.priority}
                            </span>
                          </label>
                        </div>

                        <label className="mt-3 block">
                          <Nhan icon={<MessageSquare size={ICON.sm} />}>
                            Ghi chú cho người xử lý (không bắt buộc)
                          </Nhan>
                          <textarea
                            rows={3}
                            maxLength={GHI_CHU_TOI_DA}
                            value={d.note}
                            onChange={(e) => patch(t, { note: e.target.value })}
                            placeholder="Nhập ghi chú, mô tả thêm thông tin hỗ trợ xử lý..."
                            className={cn(O_NHAP, 'resize-y')}
                          />
                          {/* Đếm ký tự để người viết biết còn bao nhiêu chỗ, thay
                              vì gõ tới giới hạn rồi bàn phím im lặng không nhận. */}
                          <span className="mt-1 block text-right text-[11px] tabular-nums text-slate-400">
                            {d.note.length}/{GHI_CHU_TOI_DA}
                          </span>
                        </label>

                        {/* CC — người cần NẮM thông tin, không xử lý. Module Công
                            việc đã có sẵn khái niệm cc và gửi thông báo cho họ khi
                            trạng thái đổi, nên chỉ cần truyền vào là chạy. */}
                        <div className="mt-1">
                          <Nhan icon={<Users size={ICON.sm} />}>
                            CC — người cần nắm thông tin (không bắt buộc)
                          </Nhan>
                          <div className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-2">
                            {d.cc.length > 0 && (
                              <div className="mb-1.5 flex flex-wrap gap-1.5">
                                {d.cc.map((uid) => (
                                  <span
                                    key={uid}
                                    className="inline-flex items-center gap-1 rounded-md bg-indigo-50 py-1 pl-2 pr-1 text-xs font-medium text-indigo-700"
                                  >
                                    {nameOf(uid)}
                                    <button
                                      type="button"
                                      aria-label={`Bỏ ${nameOf(uid)} khỏi CC`}
                                      onClick={() => patch(t, { cc: d.cc.filter((x) => x !== uid) })}
                                      className="rounded p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
                                    >
                                      <X size={ICON.xs} />
                                    </button>
                                  </span>
                                ))}
                              </div>
                            )}
                            {/* Chọn để THÊM, rồi tự trả về rỗng. Danh sách chọn
                                chỉ còn người chưa được thêm và không phải người
                                xử lý — CC cho chính người làm là thừa. */}
                            <select
                              value=""
                              onChange={(e) => {
                                if (e.target.value) patch(t, { cc: [...d.cc, e.target.value] });
                              }}
                              className="w-full border-none bg-transparent px-1 text-sm text-slate-500 focus:outline-none"
                            >
                              <option value="">Chọn thêm người (nếu có)…</option>
                              {projectPeople
                                .filter((u) => u !== d.assigneeUserId && !d.cc.includes(u))
                                .map((uid) => (
                                  <option key={uid} value={uid}>{nameOf(uid)}</option>
                                ))}
                            </select>
                          </div>
                        </div>

                        <div className="mt-4 flex items-center gap-3">
                          <Button size="sm" disabled={busy === t.id || noProject} onClick={() => accept(t)}>
                            <Check size={ICON.md} />
                            {busy === t.id ? 'Đang tiếp nhận…' : 'Xác nhận và tạo công việc'}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setOpenFor(null)}>
                            Huỷ
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Từ chối và hỏi thêm dùng chung một ô lý do. */}
                    {openFor?.id === t.id && openFor.mode !== 'accept' && (
                      <div className={cn(
                        'mt-3 rounded-lg border p-3',
                        openFor.mode === 'reject' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
                      )}>
                        <label className="block">
                          <Nhan icon={openFor.mode === 'reject' ? <X size={ICON.sm} /> : <HelpCircle size={ICON.sm} />} bat>
                            {openFor.mode === 'reject'
                              ? 'Lý do từ chối — trường sẽ đọc được nội dung này'
                              : 'Cần trường bổ sung thông tin gì?'}
                          </Nhan>
                          <textarea
                            rows={2}
                            autoFocus
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder={openFor.mode === 'reject'
                              ? 'Ví dụ: Đây là thao tác đúng theo quy trình, không phải lỗi hệ thống. Trường liên hệ phòng đào tạo để được hướng dẫn.'
                              : 'Ví dụ: Gửi giúp ảnh chụp màn hình lúc gặp lỗi và mã lớp bị ảnh hưởng.'}
                            className={cn(O_NHAP, 'resize-y')}
                          />
                          <span className="mt-1 block text-[11px] text-slate-500">
                            {reason.trim().length < 10
                              ? `Còn thiếu ${10 - reason.trim().length} ký tự`
                              : openFor.mode === 'reject'
                                ? 'Phiếu sẽ đóng lại. Trường không gửi lại được phiếu này, chỉ tạo phiếu mới.'
                                : 'Phiếu quay về trường để bổ sung. Đồng hồ SLA tạm dừng trong lúc chờ.'}
                          </span>
                        </label>
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            variant={openFor.mode === 'reject' ? 'danger' : 'primary'}
                            disabled={busy === t.id || reason.trim().length < 10}
                            onClick={() => submitReason(t, openFor.mode as 'reject' | 'info')}
                          >
                            {busy === t.id ? 'Đang gửi…'
                              : openFor.mode === 'reject' ? 'Xác nhận từ chối' : 'Gửi yêu cầu bổ sung'}
                          </Button>
                          <Button size="sm" variant="ghost"
                            onClick={() => { setOpenFor(null); setReason(''); }}>
                            Huỷ
                          </Button>
                        </div>
                      </div>
                    )}

                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
