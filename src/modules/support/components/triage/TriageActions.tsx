import {
  AlertTriangle, CalendarClock, Check, ChevronDown, Flag, HelpCircle,
  MessageSquare, UserRound, Users, X,
} from 'lucide-react';
import React, { useState } from 'react';
import { Button, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { acceptTicket, rejectTicket, requestMoreInfo } from '../../repository/ticketRepository';
import { addWorkingMs, type WorkingCalendar } from '../../services/workingTime';
import { findPolicy } from '../../services/slaCalculator';
import { DomainError, type Ticket, type TicketPriority } from '../../types';

// ===========================================================================
// Ba thao tác tiếp nhận một phiếu: TIẾP NHẬN, HỎI THÊM, TỪ CHỐI.
//
// Vì sao đứng riêng thành một file thay vì nằm trong TriageQueue: người trực
// cần làm đúng ba việc này ở HAI nơi — ngay trên hàng đợi (nhanh, không rời
// danh sách) và trong màn chi tiết (sau khi đã đọc kỹ các bước tái hiện, ảnh
// đính kèm, lịch sử trao đổi). Chép form sang màn thứ hai là đảm bảo hai bản
// lệch nhau ngay lần sửa SLA đầu tiên, và lúc đó phiếu tiếp nhận từ hai chỗ
// sẽ mang hai bộ dữ liệu khác nhau.
//
// Mục tiêu §10 giữ nguyên: tiếp nhận một phiếu dưới 30 giây.
//   - hạn xử lý ĐIỀN SẴN theo ma trận SLA của độ ưu tiên đang chọn
//   - đổi độ ưu tiên thì hạn tự tính lại, không phải bấm lịch
//   - người xử lý mặc định là chính đầu mối đang thao tác
//   - mọi thứ nằm tại chỗ, không mở modal
//
// PHÂN CHIA TRẠNG THÁI: component này giữ dữ liệu FORM (bản nháp, lý do, cờ
// bận, lỗi). Còn "khung nào đang mở" do bên gọi giữ, qua cặp mode/onModeChange
// — đó là việc của danh sách, vì chỉ danh sách mới biết luật "mỗi lần một
// dòng". Màn chi tiết chỉ có một phiếu nên tự giữ lấy cũng được.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

export type TriageMode = 'accept' | 'reject' | 'info' | null;

/** Một lớp ô nhập cho MỌI ô trong khung tiếp nhận — cao bằng nhau, viền như nhau. */
// Bo 11px = `button-pearl-capsule` của DESIGN.md — bán kính Apple dành cho ô
// nhỏ. KHÔNG dùng 18px (`rounded-lg`): đó là bán kính của thẻ, đặt lên ô nhập
// cao 42px thì nó tròn gần thành viên nang và đọc nhầm ra nút bấm.
//
// Cố ý BỎ `focus:outline-none` của bản cũ: index.css khai một vòng focus 2px
// Focus Blue dùng chung cho mọi điều khiển, tắt outline ở đây là tự đục một lỗ
// trợ năng ngay giữa form bắt buộc.
const O_NHAP =
  'mt-1.5 w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-[15px] tracking-[-0.016em] text-slate-900 focus:border-indigo-500';

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
    <span className="flex items-center gap-1.5 text-[13px] font-semibold tracking-[-0.016em] text-slate-700">
      <span className="text-slate-400">{icon}</span>
      {children}
      {bat && <span className="text-red-500" aria-hidden>*</span>}
    </span>
  );
}

/** Một ngày làm việc = 08:00-17:00. Bằng WORKDAY trong slaCalculator. */
const PHUT_MOT_NGAY_LAM = 9 * 60;

/** Số ngày dự kiến tối đa nhập được — chặn gõ nhầm 300 thành 3000. */
const NGAY_DU_KIEN_TOI_DA = 180;

/** Hạn chốt theo ngày, hay chưa chốt được và chỉ ước lượng số ngày. */
type CheDoHan = 'NGAY' | 'CHUA_XAC_DINH';

interface Draft {
  priority: TicketPriority;
  assigneeUserId: string;
  /** Cách đặt hạn. 'CHUA_XAC_DINH' thì dueAt không được gửi đi. */
  cheDoHan: CheDoHan;
  dueAt: number;
  /** Số ngày làm việc dự kiến, chỉ dùng khi cheDoHan = 'CHUA_XAC_DINH'. */
  soNgayDuKien: number;
  /**
   * Người dùng đã tự sửa hạn / số ngày chưa.
   *
   * Cần một cờ tường minh chứ không so dueAt với giá trị SLA tính lại: SLA tính
   * từ Date.now() nên hai lần gọi cách nhau một mili giây đã ra hai con số khác
   * nhau, và phép so đó lúc đúng lúc sai tuỳ vào máy chạy nhanh hay chậm.
   */
  tuSuaHan: boolean;
  note: string;
  /** Người cần nắm thông tin, không phải người xử lý. */
  cc: string[];
}

/** Ngân sách SLA (phút làm việc) của phiếu ở độ ưu tiên đang chọn. */
function slaMinutes(ticket: Ticket, priority: TicketPriority): number {
  return findPolicy(ticket.type, priority)?.resolutionMinutes ?? 8 * 60;
}

/**
 * Hạn xử lý suy từ ma trận SLA, tính theo giờ làm việc THẬT.
 *
 * Lịch phải truyền vào, không lấy hằng số: DEFAULT_CALENDAR có holidays rỗng,
 * nên hạn của một phiếu mở trước Tết rơi thẳng vào giữa kỳ nghỉ và hệ thống báo
 * quá hạn cho một ngày không ai đi làm.
 */
function defaultDueAt(ticket: Ticket, priority: TicketPriority, cal: WorkingCalendar): number {
  return addWorkingMs(Date.now(), slaMinutes(ticket, priority) * 60_000, cal);
}

/** Số ngày làm việc dự kiến, suy từ CÙNG ngân sách SLA với hạn ở trên. */
function defaultSoNgay(ticket: Ticket, priority: TicketPriority): number {
  return Math.max(1, Math.ceil(slaMinutes(ticket, priority) / PHUT_MOT_NGAY_LAM));
}

function toDateInput(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

function fromDateInput(value: string): number {
  // 17:00 giờ VN của ngày được chọn — cuối giờ làm việc, đúng nghĩa "hạn trong ngày".
  return Date.parse(`${value}T00:00:00Z`) + 17 * 3600_000 - 7 * 3600_000;
}

export function TriageActions({
  ticket: t, actorUid, mode, onModeChange, projectId, canAssignOthers, people,
  nameOf, calendar, onDone, onToast,
}: {
  ticket: Ticket;
  actorUid: string;
  /** Khung đang mở. null = chỉ hiện ba nút. */
  mode: TriageMode;
  onModeChange: (m: TriageMode) => void;
  /** Dự án của phân hệ. Rỗng thì không sinh được công việc. */
  projectId: string | null;
  /** Được gán việc cho người khác, hay chỉ tự nhận. */
  canAssignOthers: boolean;
  /** uid những người có thể nhận việc / được CC. */
  people: string[];
  nameOf: (uid: string) => string;
  calendar: WorkingCalendar;
  /** Thao tác xong — bên gọi nạp lại dữ liệu. */
  onDone: () => void | Promise<void>;
  onToast: Toast;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [loi, setLoi] = useState('');
  const [reason, setReason] = useState('');

  const setMode = (m: TriageMode) => { setLoi(''); onModeChange(m); };

  const noProject = !projectId;

  // Bản nháp dựng LƯỜI, ở lần đọc đầu tiên: dựng sẵn cho mọi phiếu trong hàng
  // đợi là tính hạn SLA cho hàng chục phiếu mà người dùng sẽ không mở tới.
  const d: Draft = draft ?? {
    // P3 là mặc định trung dung: không thổi phồng mọi phiếu thành P1, cũng
    // không hạ thấp thành P4 rồi quên.
    priority: 'P3',
    assigneeUserId: actorUid,
    // Mặc định vẫn là hạn theo ngày. "Chưa xác định" là lối thoát cho phiếu
    // phải họp mới chốt được, không phải đường mặc định — để mặc định thì mọi
    // phiếu đều trôi ra khỏi hàng đợi mà không ai chịu trách nhiệm về hạn.
    cheDoHan: 'NGAY',
    dueAt: defaultDueAt(t, 'P3', calendar),
    soNgayDuKien: defaultSoNgay(t, 'P3'),
    tuSuaHan: false,
    note: '',
    cc: [],
  };

  // Luôn có mình trong danh sách: đầu mối phân hệ có thể không nằm trong
  // managers/members của dự án, khi đó value mặc định (actorUid) sẽ không khớp
  // option nào và select hiển thị sai người.
  const projectPeople = people.includes(actorUid) ? people : [actorUid, ...people];

  function patch(p: Partial<Draft>) {
    const cur = draft ?? d;
    const next = { ...cur, ...p };
    // Sửa hạn hoặc số ngày là quyết định của người tiếp nhận — ghim lại.
    if (p.dueAt !== undefined || p.soNgayDuKien !== undefined) next.tuSuaHan = true;
    // Đổi độ ưu tiên thì hạn VÀ số ngày cùng tính lại theo SLA, TRỪ KHI người
    // dùng đã tự sửa — không được ghi đè lựa chọn của họ.
    //
    // Đổi chế độ hạn không tính là "tự sửa": người ta mới chỉ nói cách đặt hạn,
    // chưa nói hạn là bao nhiêu.
    if (p.priority && !next.tuSuaHan) {
      next.dueAt = defaultDueAt(t, p.priority, calendar);
      next.soNgayDuKien = defaultSoNgay(t, p.priority);
    }
    setDraft(next);
    setLoi('');
  }

  /** Từ chối hoặc hỏi thêm — dùng chung một ô nhập lý do. */
  async function submitReason(m: 'reject' | 'info') {
    setBusy(true);
    try {
      const fn = m === 'reject'
        ? rejectTicket({ ticket: t, reason, actorUid })
        : requestMoreInfo({ ticket: t, request: reason, actorUid });
      const { ok, error: err } = await fn;
      if (!ok) {
        setLoi(err?.kind === 'denied'
          ? 'Bạn không có quyền thao tác trên phiếu này.'
          : `Không lưu được (${err?.message ?? 'lỗi mạng'})`);
        return;
      }
      onToast(
        m === 'reject' ? `Đã từ chối ${t.ticketNo}` : `Đã gửi yêu cầu bổ sung cho ${t.ticketNo}`,
        m === 'reject' ? 'info' : 'success'
      );
      onModeChange(null);
      setReason('');
      await onDone();
    } catch (e: any) {
      setLoi(e instanceof DomainError ? e.message : 'Không lưu được');
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    const chuaChotHan = d.cheDoHan === 'CHUA_XAC_DINH';
    // Chặn ở đây thay vì để repository ném: số ngày là thứ DUY NHẤT phiếu chưa
    // chốt hạn còn mang theo, gửi đi con số rỗng thì công việc sinh ra không có
    // hạn lẫn không có ước lượng.
    if (chuaChotHan && (!Number.isFinite(d.soNgayDuKien) || d.soNgayDuKien < 1)) {
      setLoi('Nhập số ngày dự kiến hoàn thành (ít nhất 1 ngày).');
      return;
    }
    // max của <input type="number"> chỉ chặn nút tăng/giảm, gõ tay vẫn qua.
    if (chuaChotHan && d.soNgayDuKien > NGAY_DU_KIEN_TOI_DA) {
      setLoi(`Số ngày dự kiến tối đa ${NGAY_DU_KIEN_TOI_DA} ngày. Dài hơn thế thì nên tách thành nhiều yêu cầu.`);
      return;
    }
    setBusy(true);
    try {
      const { ok, error: err } = await acceptTicket({
        ticket: t,
        projectId: projectId ?? '',
        priority: d.priority,
        assigneeUserId: d.assigneeUserId,
        dueAt: chuaChotHan ? null : d.dueAt,
        estimateDays: chuaChotHan ? Math.round(d.soNgayDuKien) : undefined,
        actorUid,
        note: d.note,
        ccUserIds: d.cc,
      });
      if (!ok) {
        setLoi(err?.kind === 'denied'
          ? 'Bạn không có quyền tiếp nhận phiếu của phân hệ này.'
          : `Không tiếp nhận được (${err?.message ?? 'lỗi mạng'})`);
        return;
      }
      onToast(`Đã tiếp nhận ${t.ticketNo} và tạo công việc`, 'success');
      onModeChange(null);
      await onDone();
    } catch (e: any) {
      setLoi(e instanceof DomainError ? e.message : 'Không tiếp nhận được');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* Phân hệ chưa gán dự án thì không sinh task được — nói ngay thay vì để
          họ bấm rồi mới báo lỗi. */}
      {noProject && (
        <p className="mt-2.5 flex items-center gap-2 rounded-md bg-amber-50 px-3.5 py-2.5 text-[14px] leading-[1.43] tracking-[-0.016em] text-amber-800">
          <AlertTriangle size={ICON.sm} className="shrink-0" />
          Phân hệ này chưa được gán dự án. Vào tab Phân hệ để gán trước khi tiếp nhận.
        </p>
      )}

      {loi && (
        <p className="mt-2.5 rounded-md bg-red-50 px-3.5 py-2.5 text-[15px] leading-[1.4] tracking-[-0.016em] text-red-600">
          {loi}
        </p>
      )}

      {/* Ba lựa chọn. Không mở modal: hàng đợi nhiều dòng, mở/đóng
          modal từng cái phá mục tiêu dưới 30 giây mỗi phiếu. */}
      {mode === null && (
        <div className="mt-3.5 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || noProject}
            onClick={() => { setMode('accept'); setReason(''); }}
            className={cn(noProject && 'opacity-50')}
          >
            <Check size={ICON.md} /> Tiếp nhận công việc
          </Button>
          {/* Hỏi thêm đứng TRƯỚC từ chối: phần lớn phiếu thiếu
              thông tin chứ không phải sai, và từ chối là cửa một
              chiều nên không nên là lựa chọn dễ bấm nhất. */}
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => { setMode('info'); setReason(''); }}>
            <HelpCircle size={ICON.md} /> Hỏi thêm thông tin
          </Button>
          <Button size="sm" variant="danger" disabled={busy}
            onClick={() => { setMode('reject'); setReason(''); }}>
            <X size={ICON.md} /> Từ chối
          </Button>
        </div>
      )}

      {/* Chọn "Tiếp nhận" rồi mới phải điền: ưu tiên, người xử lý,
          hạn hoàn thành, CC. */}
      {mode === 'accept' && (
        <div className="mt-3.5 rounded-xl border border-indigo-200 bg-indigo-50/40 p-5">
          {/* Chữ thường, cân 600 — bỏ `uppercase tracking-wider`
              của bản cũ. Chữ hoa giãn ly không nằm trong hệ Apple,
              và nhãn tiếng Việt có dấu bị ép hoa thì khó đọc. */}
          <div className="flex items-center gap-1.5 text-[14px] font-semibold tracking-[-0.016em] text-indigo-700">
            <ChevronDown size={ICON.md} />
            Thông tin tiếp nhận
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <label className="block">
              <Nhan icon={<Flag size={ICON.sm} />} bat>Độ ưu tiên</Nhan>
              <select
                value={d.priority}
                onChange={(e) => patch({ priority: e.target.value as TicketPriority })}
                className={O_NHAP}
              >
                {/* Thang ưu tiên chuẩn phát triển phần mềm, khớp
                    với module Công việc. Phạm vi ảnh hưởng đã có
                    trường riêng — không mô tả lại ở đây. */}
                <option value="P1">P1 — Khẩn cấp</option>
                <option value="P2">P2 — Cao</option>
                <option value="P3">P3 — Trung bình</option>
                <option value="P4">P4 — Thấp</option>
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
                  onChange={(e) => patch({ assigneeUserId: e.target.value })}
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
                  <span className="mt-1.5 block text-[12px] leading-[1.3] tracking-[-0.01em] text-slate-400">
                    Bạn là thành viên dự án nên chỉ tự nhận việc. Quản lý dự án mới giao được cho người khác.
                  </span>
                </>
              )}
            </label>

            {/* Hạn hoàn thành, hai chế độ.
                Rất nhiều phiếu được tiếp nhận trước khi ai biết
                bao giờ làm xong — phải họp, phải chờ phân hệ khác.
                Ép chọn một ngày cụ thể ở thời điểm đó chỉ sinh ra
                một con số bịa, rồi cả hệ thống báo quá hạn theo
                con số bịa đó. Cho khai thẳng "chưa xác định" kèm
                số ngày dự kiến thì hạn thật hình thành lúc người
                xử lý chọn được ngày bắt đầu. */}
            <div className="block">
              <Nhan icon={<CalendarClock size={ICON.sm} />} bat>Hạn hoàn thành</Nhan>
              <select
                value={d.cheDoHan}
                onChange={(e) => patch({ cheDoHan: e.target.value as CheDoHan })}
                className={O_NHAP}
                aria-label="Cách đặt hạn hoàn thành"
              >
                <option value="NGAY">Chốt ngày cụ thể</option>
                <option value="CHUA_XAC_DINH">Chưa xác định — chỉ ước lượng số ngày</option>
              </select>

              {d.cheDoHan === 'NGAY' ? (
                <>
                  <input
                    type="date"
                    value={toDateInput(d.dueAt)}
                    onChange={(e) => patch({ dueAt: fromDateInput(e.target.value) })}
                    className={cn(O_NHAP, 'mt-2')}
                    aria-label="Ngày hết hạn"
                  />
                  <span className="mt-1.5 block text-[12px] tracking-[-0.01em] text-slate-400">
                    Điền sẵn theo SLA của {d.priority}
                  </span>
                </>
              ) : (
                <>
                  <div className={cn(O_NHAP, 'mt-2 flex items-center gap-2 py-0 pr-0')}>
                    <input
                      type="number"
                      min={1}
                      max={NGAY_DU_KIEN_TOI_DA}
                      step={1}
                      value={Number.isFinite(d.soNgayDuKien) ? d.soNgayDuKien : ''}
                      onChange={(e) => patch({ soNgayDuKien: Number(e.target.value) })}
                      className="w-full border-none bg-transparent py-2.5 text-[15px] tracking-[-0.016em] text-slate-900 focus:outline-none"
                      aria-label="Số ngày dự kiến hoàn thành"
                    />
                    <span className="shrink-0 pr-3.5 text-[14px] tracking-[-0.016em] text-slate-500">ngày làm việc</span>
                  </div>
                  <span className="mt-1.5 block text-[12px] tracking-[-0.01em] text-slate-400">
                    Hạn sẽ tự chốt khi người xử lý chọn ngày bắt đầu bên Công việc.
                  </span>
                </>
              )}
            </div>
          </div>

          <label className="mt-3 block">
            <Nhan icon={<MessageSquare size={ICON.sm} />}>
              Ghi chú cho người xử lý (không bắt buộc)
            </Nhan>
            <textarea
              rows={3}
              maxLength={GHI_CHU_TOI_DA}
              value={d.note}
              onChange={(e) => patch({ note: e.target.value })}
              placeholder="Nhập ghi chú, mô tả thêm thông tin hỗ trợ xử lý..."
              className={cn(O_NHAP, 'resize-y')}
            />
            {/* Đếm ký tự để người viết biết còn bao nhiêu chỗ, thay
                vì gõ tới giới hạn rồi bàn phím im lặng không nhận. */}
            <span className="mt-1.5 block text-right text-[12px] tabular-nums tracking-[-0.01em] text-slate-400">
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
            <div className="mt-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-2">
              {d.cc.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {d.cc.map((uid) => (
                    <span
                      key={uid}
                      className="inline-flex items-center gap-1 rounded-full bg-indigo-50 py-1 pl-2.5 pr-1 text-[13px] font-semibold tracking-[-0.01em] text-indigo-700"
                    >
                      {nameOf(uid)}
                      <button
                        type="button"
                        aria-label={`Bỏ ${nameOf(uid)} khỏi CC`}
                        onClick={() => patch({ cc: d.cc.filter((x) => x !== uid) })}
                        className="rounded-full p-0.5 text-indigo-400 hover:bg-indigo-100 hover:text-indigo-700"
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
                  if (e.target.value) patch({ cc: [...d.cc, e.target.value] });
                }}
                className="w-full border-none bg-transparent px-1 text-[15px] tracking-[-0.016em] text-slate-500 focus:outline-none"
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

          <div className="mt-5 flex items-center gap-3">
            <Button size="sm" disabled={busy || noProject} onClick={() => accept()}>
              <Check size={ICON.md} />
              {busy ? 'Đang tiếp nhận…' : 'Xác nhận và tạo công việc'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
              Huỷ
            </Button>
          </div>
        </div>
      )}

      {/* Từ chối và hỏi thêm dùng chung một ô lý do. */}
      {mode !== null && mode !== 'accept' && (
        <div className={cn(
          'mt-3.5 rounded-xl border p-4',
          mode === 'reject' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'
        )}>
          <label className="block">
            <Nhan icon={mode === 'reject' ? <X size={ICON.sm} /> : <HelpCircle size={ICON.sm} />} bat>
              {mode === 'reject'
                ? 'Lý do từ chối — trường sẽ đọc được nội dung này'
                : 'Cần trường bổ sung thông tin gì?'}
            </Nhan>
            <textarea
              rows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={mode === 'reject'
                ? 'Ví dụ: Đây là thao tác đúng theo quy trình, không phải lỗi hệ thống. Trường liên hệ phòng đào tạo để được hướng dẫn.'
                : 'Ví dụ: Gửi giúp ảnh chụp màn hình lúc gặp lỗi và mã lớp bị ảnh hưởng.'}
              className={cn(O_NHAP, 'resize-y')}
            />
            <span className="mt-1.5 block text-[12px] leading-[1.35] tracking-[-0.01em] text-slate-500">
              {reason.trim().length < 10
                ? `Còn thiếu ${10 - reason.trim().length} ký tự`
                : mode === 'reject'
                  ? 'Phiếu sẽ đóng lại. Trường không gửi lại được phiếu này, chỉ tạo phiếu mới.'
                  : 'Phiếu quay về trường để bổ sung. Đồng hồ SLA tạm dừng trong lúc chờ.'}
            </span>
          </label>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant={mode === 'reject' ? 'danger' : 'primary'}
              disabled={busy || reason.trim().length < 10}
              onClick={() => submitReason(mode as 'reject' | 'info')}
            >
              {busy ? 'Đang gửi…'
                : mode === 'reject' ? 'Xác nhận từ chối' : 'Gửi yêu cầu bổ sung'}
            </Button>
            <Button size="sm" variant="ghost"
              onClick={() => { setMode(null); setReason(''); }}>
              Huỷ
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
