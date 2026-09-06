import {
  ChevronDown, ChevronRight, ChevronUp, Clock3, Filter, HelpCircle, Inbox, Mail,
  RotateCcw, UserRound,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, StateBlock, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import { fetchTriageQueueForModules, restoreRejectedTicket } from '../../repository/ticketRepository';
import {
  fetchMyTriageScope, fetchPtudStaff, fetchSupportModules, type ModuleScope,
} from '../../repository/userAdminRepository';
import { useWorkingCalendar } from '../../hooks/useWorkingCalendar';
import {
  CampusAvatar, CopyMaPhieu, ImpactBadge, MessageChip, OTimKiem, PhanTrang, PriorityBadge,
  StatusBadge, TypeBadge, TypeFilterChips, fmtDateTime, khopTimKiem, tuoiTuongDoi,
} from '../../ui/tokens';
import { useSupportModules } from '../../hooks/useSupportModules';
import { useCampuses } from '../../hooks/useCampuses';
import { TicketDetail } from '../TicketDetail';
import { TriageActions, type TriageMode } from './TriageActions';
import {
  DomainError, type SupportModuleCode, type SupportModuleConfig, type Ticket, type TicketType,
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
  // Dòng nào đang mở, và mở để làm gì.
  //
  // Mặc định KHÔNG mở gì: mỗi phiếu chỉ hiện ba lựa chọn. Ô nhập của từng lựa
  // chọn chỉ bung ra sau khi bấm — hàng đợi hàng chục phiếu mà phiếu nào cũng
  // trải sẵn ô ưu tiên, người xử lý, hạn, CC thì không đọc nổi danh sách.
  const [openFor, setOpenFor] =
    useState<{ id: string; mode: Exclude<TriageMode, null> } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  // Phiếu đang xem chi tiết. Hàng đợi chỉ hiện được hai dòng mô tả cắt cụt —
  // không đủ để quyết định tiếp nhận hay từ chối một yêu cầu, vì các trường
  // quan trọng nhất (các bước tái hiện, kết quả mong đợi/thực tế, ảnh đính kèm,
  // lịch sử trao đổi) đều nằm ngoài phần cắt đó.
  const [openDetail, setOpenDetail] = useState<Ticket | null>(null);
  // Khung thao tác đang mở TRONG màn chi tiết. Tách khỏi openFor của danh sách:
  // hai màn không bao giờ hiện cùng lúc, dùng chung một biến thì mở khung ở
  // hàng đợi rồi bấm vào chi tiết sẽ thấy khung tự bung sẵn.
  const [modeChiTiet, setModeChiTiet] = useState<TriageMode>(null);
  // Lọc theo loại yêu cầu. Mặc định 'all' — người trực cần thấy toàn bộ việc
  // tồn trước, rồi mới chủ động thu hẹp.
  const [loaiLoc, setLoaiLoc] = useState<'all' | TicketType>('all');
  const [tuKhoa, setTuKhoa] = useState('');
  const [phanHeLoc, setPhanHeLoc] = useState('');
  /** Phiếu nào đang mở rộng phần mô tả. Theo id để cuộn qua lại không mất. */
  const [moTaMo, setMoTaMo] = useState<Record<string, boolean>>({});
  const [trang, setTrang] = useState(1);
  const [moiTrang, setMoiTrang] = useState(10);
  /**
   * Phiếu vừa bị từ chối trong phiên này, giữ lại để dựng lối HOÀN TÁC.
   *
   * Vì sao phải nằm ở đây chứ không trong TriageActions: từ chối xong là phiếu
   * rời khỏi hàng đợi, dòng của nó bị tháo, và mọi trạng thái nó cầm biến mất
   * đúng cái giây người dùng nhận ra mình bấm nhầm. Danh sách là thứ sống lâu
   * hơn dòng phiếu.
   *
   * Giữ tới khi người dùng tự bỏ qua, không tự tắt sau vài giây: một dải nhắc
   * tự biến mất là thứ chỉ cứu được người phát hiện ra lỗi ngay lập tức, mà
   * phần lớn người ta chỉ nhận ra sau khi đã xử lý xong phiếu kế tiếp.
   */
  const [vuaTuChoi, setVuaTuChoi] = useState<Ticket | null>(null);
  const [dangHoanTac, setDangHoanTac] = useState(false);
  const { nameOf: tenPhanHe } = useSupportModules();
  // Danh bạ đơn vị: đổi mã trường ("FCG") thành tên người đọc hiểu được.
  const { nameOf: tenDonVi, campusOf } = useCampuses();
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

  // Ba trục lọc độc lập: loại yêu cầu, phân hệ, từ khoá. Nhân với nhau chứ
  // không loại trừ nhau — "báo lỗi của phân hệ Web có chữ đăng nhập" là một câu
  // hỏi hợp lệ và hay gặp.
  //
  // Áp phân hệ và từ khoá TRƯỚC, để lại loại yêu cầu cho bước sau: dải nút lọc
  // loại mang số đếm, và số đó phải là số phiếu bấm vào sẽ thấy. Đếm trên toàn
  // bộ hàng đợi thì đang tìm "Hà Nam" mà nút vẫn ghi "Báo lỗi 12", bấm vào ra 2
  // dòng — hai con số cãi nhau ngay trên một màn.
  const truocLoaiLoc = useMemo(
    () => (tickets ?? []).filter((t) => (
      (!phanHeLoc || t.moduleId === phanHeLoc)
      && khopTimKiem(t, tuKhoa, tenDonVi(t.campusId))
    )),
    [tickets, phanHeLoc, tuKhoa, tenDonVi]
  );

  const demTheoLoai = useMemo(() => ({
    all: truocLoaiLoc.length,
    BUG: truocLoaiLoc.filter((t) => t.type === 'BUG').length,
    FEATURE_REQUEST: truocLoaiLoc.filter((t) => t.type === 'FEATURE_REQUEST').length,
  }), [truocLoaiLoc]);

  /**
   * Hàng đợi (chưa lọc) có cả hai loại phiếu không.
   *
   * Dải nút lọc loại hiện/ẩn theo con số NÀY chứ không theo demTheoLoai: nếu
   * theo số đã lọc thì gõ tới ký tự thứ ba làm kết quả chỉ còn báo lỗi là cả
   * dải nút biến mất dưới tay người đang dùng nó.
   */
  const coCaHaiLoai = useMemo(() => {
    const ds = tickets ?? [];
    return ds.some((t) => t.type === 'BUG') && ds.some((t) => t.type === 'FEATURE_REQUEST');
  }, [tickets]);

  const phieuHienThi = useMemo(
    () => truocLoaiLoc.filter((t) => loaiLoc === 'all' || t.type === loaiLoc),
    [truocLoaiLoc, loaiLoc]
  );

  // Về trang 1 mỗi khi bộ lọc đổi. Không có dòng này thì lọc từ 60 phiếu xuống
  // 4 trong lúc đang ở trang 5 sẽ ra một danh sách rỗng, và người dùng kết luận
  // là không tìm thấy gì.
  useEffect(() => { setTrang(1); }, [loaiLoc, phanHeLoc, tuKhoa]);

  const phieuTrang = useMemo(
    () => phieuHienThi.slice((trang - 1) * moiTrang, trang * moiTrang),
    [phieuHienThi, trang, moiTrang]
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

  /** Gỡ lượt từ chối vừa rồi. Đúng một cú bấm — đây là đường sửa lỗi thao tác. */
  async function hoanTacTuChoi(phieu: Ticket) {
    setDangHoanTac(true);
    try {
      const { ok, error: err } = await restoreRejectedTicket({
        ticket: phieu,
        actorUid,
        // Ghi chú mặc định, vì lối này chỉ tồn tại cho đúng một tình huống.
        // Trường đọc được câu này trong thông báo, nên nó phải nói thật.
        note: 'Từ chối nhầm phiếu.',
      });
      if (!ok) {
        onToast(
          err?.kind === 'denied'
            ? 'Bạn không có quyền tiếp nhận lại phiếu này.'
            : `Không tiếp nhận lại được (${err?.message ?? 'lỗi mạng'})`,
          'error'
        );
        return;
      }
      onToast(`Đã tiếp nhận lại ${phieu.ticketNo}. Phiếu quay về hàng đợi.`, 'success');
      setVuaTuChoi(null);
      await reload();
    } catch (e: any) {
      onToast(e instanceof DomainError ? e.message : 'Không tiếp nhận lại được', 'error');
    } finally {
      setDangHoanTac(false);
    }
  }


  // Chi tiết chiếm trọn màn, không phải modal: phiếu có ảnh đính kèm và lịch sử
  // trao đổi dài, nhét vào hộp nổi thì phải cuộn trong cuộn. Quay lại thì nạp
  // lại hàng đợi — người dùng có thể vừa thao tác gì đó bên trong màn chi tiết.
  if (openDetail) {
    const cfg = moduleById[openDetail.moduleId];
    const ms = scope.byModule[openDetail.moduleId];
    const canAssignOthers = isAdmin || !!ms?.isManager;
    const basePeople = ms?.people?.length
      ? ms.people
      : isAdmin ? staff.map((x) => x.uid) : [];
    // Chỉ phiếu CHƯA được tiếp nhận mới còn ba thao tác này. Phiếu đã nhận rồi
    // mà vẫn hiện nút "Tiếp nhận công việc" là mời người ta sinh ra công việc
    // thứ hai cho cùng một yêu cầu.
    //
    // REJECTED có mặt vì lý do ngược lại: ở trạng thái đó TriageActions hiện
    // đường lùi "tiếp nhận lại" chứ không hiện ba nút tiếp nhận.
    const conThaoTacDuoc = ['TRIAGE', 'NEEDS_INFO', 'REJECTED'].includes(openDetail.status);
    return (
      <TicketDetail
        ticket={openDetail}
        campusName={tenDonVi(openDetail.campusId)}
        actorUid={actorUid}
        canResolve
        onChanged={() => { setOpenDetail(null); void reload(); }}
        onBack={() => { setOpenDetail(null); void reload(); }}
        onToast={onToast}
        triageActions={conThaoTacDuoc ? (
          <TriageActions
            ticket={openDetail}
            actorUid={actorUid}
            mode={modeChiTiet}
            onModeChange={setModeChiTiet}
            projectId={cfg?.projectId ?? null}
            canAssignOthers={canAssignOthers}
            people={basePeople}
            nameOf={nameOf}
            calendar={lichLamViec}
            // Xong việc thì đóng màn chi tiết và nạp lại hàng đợi: phiếu vừa
            // được tiếp nhận/từ chối không còn thuộc hàng đợi nữa, đứng lại ở
            // màn chi tiết của nó là nhìn vào dữ liệu đã cũ.
            onDone={async () => { setOpenDetail(null); setModeChiTiet(null); await reload(); }}
            // Từ chối từ trong màn chi tiết cũng phải có lối lùi: onDone bên
            // trên đóng màn này lại và trả người dùng về hàng đợi, nên dải hoàn
            // tác ở hàng đợi là chỗ duy nhất họ còn nhìn thấy.
            onRejected={setVuaTuChoi}
            onToast={onToast}
          />
        ) : undefined}
      />
    );
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
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <Inbox size={ICON.xl} className="mt-1 shrink-0 text-slate-400" />
        <div>
        {/* 21px/600 = token `tagline` của DESIGN.md, vai trò "tên chuyên mục".
            Tracking âm là nhịp tiêu đề đặc trưng — xem @layer base ở index.css. */}
        <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[-0.022em] text-slate-900">
          Chờ tiếp nhận
        </h2>
        <p className="mt-1 text-[14px] leading-[1.43] tracking-[-0.016em] text-slate-500">
          Phụ trách: {myModules.map(tenPhanHe).join(' · ')}
          {scope.projectNames.length > 0 && !isAdmin && (
            <span className="text-slate-400"> · qua dự án {scope.projectNames.join(', ')}</span>
          )}
        </p>
        </div>
      </div>

      {/* ------------------------------------------------------------------
          LỐI HOÀN TÁC sau khi từ chối.

          Đứng trên cùng, trước cả bộ lọc: từ chối là cửa một chiều duy nhất
          trong màn này, và người bấm nhầm cần thấy đường lùi mà không phải đi
          tìm. Không tự tắt sau vài giây — phần lớn người ta chỉ nhận ra bấm
          nhầm sau khi đã xử lý xong phiếu kế tiếp.
          ------------------------------------------------------------------ */}
      {vuaTuChoi && (
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
          <RotateCcw size={ICON.lg} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 text-[15px] font-semibold leading-[1.3] tracking-[-0.016em] text-amber-900">
              Vừa từ chối
              <span className="rounded-xs bg-white/80 px-1.5 py-0.5 font-mono text-[12px] tabular-nums">
                {vuaTuChoi.ticketNo}
              </span>
              <span className="min-w-0 font-normal">{vuaTuChoi.title}</span>
            </p>
            <p className="mt-1 text-[14px] leading-[1.43] tracking-[-0.016em] text-amber-800">
              Nhầm phiếu? Tiếp nhận lại thì phiếu quay về hàng đợi này, giữ nguyên mã phiếu,
              đính kèm và toàn bộ trao đổi.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" disabled={dangHoanTac} onClick={() => void hoanTacTuChoi(vuaTuChoi)}>
              <RotateCcw size={ICON.md} />
              {dangHoanTac ? 'Đang tiếp nhận lại…' : 'Tiếp nhận lại'}
            </Button>
            <Button size="sm" variant="ghost" disabled={dangHoanTac} onClick={() => setVuaTuChoi(null)}>
              Bỏ qua
            </Button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------
          THANH CÔNG CỤ: lọc theo loại, tìm kiếm, lọc theo phân hệ.

          Ô tìm kiếm là thứ thiếu quan trọng nhất của bản cũ. Hàng đợi tới 100
          phiếu mà cách duy nhất tìm một phiếu cụ thể là cuộn — trong khi thứ
          người ta cầm trong tay lúc đi tìm luôn là một mã phiếu hoặc một tên
          trường, do đồng nghiệp vừa đọc qua điện thoại.
          ---------------------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Chỉ hiện khi hàng đợi có CẢ HAI loại: một dải nút mà bấm loại nào
            cũng ra cùng một danh sách là chrome thừa. */}
        {coCaHaiLoai && (
          <TypeFilterChips value={loaiLoc} onChange={setLoaiLoc} counts={demTheoLoai} />
        )}
        <OTimKiem
          value={tuKhoa}
          onChange={setTuKhoa}
          placeholder="Tìm theo tiêu đề, mã phiếu, trường, người gửi…"
          className="ml-auto w-full sm:w-80"
        />
        {/* Lọc phân hệ chỉ có nghĩa khi người này phụ trách nhiều hơn một. */}
        {myModules.length > 1 && (
          <label className="flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white py-2 pl-3 pr-2 text-[14px] tracking-[-0.016em] text-slate-600">
            <Filter size={ICON.sm} className="text-slate-400" aria-hidden />
            <span className="sr-only">Lọc theo phân hệ</span>
            <select
              value={phanHeLoc}
              onChange={(e) => setPhanHeLoc(e.target.value)}
              className="border-none bg-transparent pr-1 text-[14px] text-slate-700 focus:outline-none"
            >
              <option value="">Mọi phân hệ</option>
              {myModules.map((code) => (
                <option key={code} value={code}>{tenPhanHe(code)}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {tickets.length === 0 ? (
        <Card>
          <StateBlock
            kind="empty"
            title="Không có phiếu nào chờ tiếp nhận"
            description="Mọi yêu cầu thuộc phân hệ bạn phụ trách đều đã được xử lý."
          />
        </Card>
      ) : phieuHienThi.length === 0 ? (
        // Rỗng vì BỘ LỌC, không phải vì hết việc — nói rõ, kèm lối thoát.
        // Gộp hai trạng thái này làm người trực tưởng đã xong việc.
        <Card>
          <StateBlock
            kind="empty"
            title={tuKhoa ? `Không có phiếu nào khớp “${tuKhoa}”` : 'Không có phiếu nào khớp bộ lọc'}
            description={`Hàng đợi vẫn còn ${tickets.length} phiếu thuộc nhóm khác.`}
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setLoaiLoc('all'); setTuKhoa(''); setPhanHeLoc(''); }}
              >
                Xoá bộ lọc, xem tất cả {tickets.length} phiếu
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* Thanh tổng, ĐỨNG RIÊNG chứ không còn là đầu một thẻ chung. */}
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5">
            <span className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.016em] text-slate-700">
              <Inbox size={ICON.lg} className="text-slate-400" />
              {phieuHienThi.length} phiếu chờ tiếp nhận
              {(loaiLoc !== 'all' || tuKhoa || phanHeLoc) && (
                <span className="font-normal text-slate-400">· đang lọc</span>
              )}
            </span>
            <Button size="sm" variant="outline" onClick={() => setCollapsed((v) => !v)}>
              {collapsed ? <>Mở rộng <ChevronDown size={ICON.md} /></>
                         : <>Thu gọn <ChevronUp size={ICON.md} /></>}
            </Button>
          </div>

          {/* ----------------------------------------------------------------
              MỘT PHIẾU = MỘT THẺ ĐÓNG KÍN, cách nhau bằng khoảng trắng thật,
              và ba nút thao tác nằm trong CỘT RIÊNG bên phải chính thẻ đó.

              Bản cũ: mọi phiếu nằm trong một thẻ duy nhất, ngăn nhau bằng
              `divide-y` một pixel, và ba nút — trong đó có "Từ chối", một cửa
              một chiều — nằm dưới đáy mỗi dòng. Khoảng cách từ ba nút của phiếu
              N xuống nhãn của phiếu N+1 gần bằng khoảng cách giữa các khối bên
              trong chính phiếu N, nên không có gì nói cho người đọc biết ba nút
              đó thuộc phiếu bên trên hay bên dưới. Cuộn nửa vòng chuột giữa lúc
              nhắm là bấm nhầm phiếu — người dùng báo đúng chuyện đó ngày
              06/09/2026.

              Bốn việc thay đổi, mỗi việc gánh một phần:
                1. Viền khép kín + khoảng trắng giữa các thẻ: ranh giới phiếu
                   trở thành thứ NHÌN THẤY, không phải suy ra.
                2. Vạch màu bên trái theo LOẠI phiếu: hai phiếu liên tiếp khác
                   loại thì khác nhau ngay từ mép trái.
                3. Nút chuyển sang cột đứng bên phải, có vách ngăn: nút và nội
                   dung của cùng một phiếu nằm CẠNH nhau chứ không nối đuôi
                   nhau, nên không còn khoảng nào để hiểu nhầm là của phiếu kế.
                4. Mã phiếu đóng khung ở đầu thẻ, và lặp lại ngay trên khung
                   nhập lý do khi bung ra (xem PhieuDang trong TriageActions).
              ---------------------------------------------------------------- */}
          <ul className={cn('space-y-3', collapsed && 'hidden')}>
            {phieuTrang.map((t) => {
              const cfg = moduleById[t.moduleId];
              const ms = scope.byModule[t.moduleId];
              // Admin và quản lý dự án gán được cho người khác. Thành viên
              // thường chỉ tự nhận việc.
              const canAssignOthers = isAdmin || !!ms?.isManager;
              // Admin đứng ngoài dự án nên byModule không có entry — cho admin
              // chọn trong toàn bộ cán bộ PTUD. Người trong dự án thì bị giới
              // hạn trong dự án đó.
              const basePeople = ms?.people?.length
                ? ms.people
                : isAdmin ? staff.map((x) => x.uid) : [];
              const donVi = campusOf(t.campusId);
              // Tỉnh/thành và cấp học chỉ hiện khi CÓ. Trường nhập trước khi
              // hai ô này ra đời vẫn phải đọc được, và một dấu chấm giữa trông
              // như lỗi hiển thị.
              const phuChuDonVi = [donVi?.province, donVi?.levels].filter(Boolean).join(' · ');
              // Thẻ đang mở khung thao tác. Lúc đó cột nút bên phải nhường chỗ
              // cho khung nhập chạy hết chiều ngang thẻ — ô ưu tiên / người xử
              // lý / hạn là một lưới ba cột, nhét vào cột 248px thì nó xếp
              // chồng thành một cái tháp.
              const dangThaoTac = openFor?.id === t.id;
              const daiDong = t.description.length > 170;
              const moRong = !!moTaMo[t.id];
              const moChiTiet = () => { setOpenDetail(t); setModeChiTiet(null); };
              return (
                <li key={t.id}>
                  <article
                    className={cn(
                      'overflow-hidden rounded-xl border border-l-4 bg-white transition-shadow',
                      // Vạch trái theo loại phiếu, dùng ĐÚNG cặp màu của
                      // TypeBadge — cùng một khái niệm thì cùng một màu ở mọi
                      // nơi, nếu không vạch màu chỉ là trang trí.
                      t.type === 'BUG' ? 'border-l-red-400' : 'border-l-violet-400',
                      'border-y-slate-200 border-r-slate-200',
                      dangThaoTac && 'ring-2 ring-indigo-300'
                    )}
                  >
                    <div className="flex flex-col lg:flex-row">
                      {/* ---------------- CỘT NỘI DUNG ---------------- */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 px-4 pt-3.5">
                          {/* Nhãn CÓ CHỮ. Loại yêu cầu quyết định phiếu có hạn
                              xử lý hay không, nên nó phải đọc được ngay chứ
                              không nằm sau một con bọ 18px. */}
                          <TypeBadge type={t.type} />
                          {/* Mức ảnh hưởng ĐỨNG THAY độ ưu tiên ở màn này:
                              priority chỉ tồn tại sau khi tiếp nhận, vẽ nó lên
                              phiếu chưa ai nhận là bịa ra một quyết định chưa
                              ai đưa. Xem ghi chú ở TICKET_IMPACT. */}
                          {t.priority
                            ? <PriorityBadge priority={t.priority} />
                            : t.impactScale && <ImpactBadge scale={t.impactScale} />}
                          <span
                            className="flex items-center gap-1 text-[12px] tracking-[-0.01em] text-slate-500"
                            title={`Trường gửi lúc ${fmtDateTime(t.createdAt)}`}
                          >
                            <Clock3 size={ICON.xs} className="text-slate-400" aria-hidden />
                            {tuoiTuongDoi(t.createdAt)}
                          </span>
                          <StatusBadge status={t.status} />
                          <MessageChip ticket={t} viewerSide="PTUD" />
                          {/* Mã phiếu ở góc phải, đóng khung — đây là cái neo
                              nhận dạng của cả thẻ, và là thứ người ta chép đi
                              dán sang Zalo hay biên bản họp. */}
                          <span className="ml-auto flex shrink-0 items-center gap-0.5 rounded-md bg-slate-100 py-1 pl-2 pr-1 font-mono text-[12px] font-semibold tabular-nums text-slate-700">
                            {t.ticketNo}
                            <CopyMaPhieu ticketNo={t.ticketNo} onCopied={(m) => onToast(m, 'success')} />
                          </span>
                        </div>

                        {/* Vùng bấm để mở chi tiết. Chỉ bọc phần NỘI DUNG —
                            không bọc cả thẻ. Khung tiếp nhận chứa
                            select/input/textarea; để cả thẻ bắt click thì mỗi
                            lần bấm vào ô ghi chú lại nhảy sang màn chi tiết,
                            mất sạch thứ đang gõ dở. */}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={moChiTiet}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); moChiTiet(); }
                          }}
                          aria-label={`Xem chi tiết phiếu ${t.ticketNo}: ${t.title}`}
                          className="group block w-full cursor-pointer px-4 pt-2.5 text-left"
                        >
                          {/* 17px/600 = token `body-strong`. DESIGN.md §Do's:
                              thân bài chạy 17px chứ không 16px — "the extra
                              pixel defines the brand's reading pace". */}
                          <p className="text-[17px] font-semibold leading-[1.24] tracking-[-0.022em] text-slate-900 group-hover:text-indigo-600">
                            {t.title}
                          </p>
                          {t.description && (
                            <p className={cn(
                              'mt-1 text-[15px] leading-[1.47] tracking-[-0.016em] text-slate-500',
                              !moRong && 'line-clamp-2'
                            )}>
                              {t.description}
                            </p>
                          )}
                        </div>

                        {/* Mở rộng mô tả TẠI CHỖ. Ngưỡng theo độ dài chứ không
                            đo chiều cao thật: đo được thì cần một lượt đọc
                            layout cho mỗi phiếu ở mỗi lần vẽ lại, để lấy về một
                            con số chỉ dùng để bật hay tắt một dòng chữ. */}
                        {t.description && daiDong && (
                          <button
                            type="button"
                            onClick={() => setMoTaMo((cu) => ({ ...cu, [t.id]: !cu[t.id] }))}
                            className="mt-1 flex items-center gap-0.5 px-4 text-[14px] tracking-[-0.016em] text-indigo-600 hover:underline"
                          >
                            {moRong ? 'Thu gọn' : 'Xem thêm'}
                            {moRong ? <ChevronUp size={ICON.sm} /> : <ChevronDown size={ICON.sm} />}
                          </button>
                        )}

                        {/* Phiếu đang chờ trường trả lời: hiện đúng câu đã hỏi,
                            để người tiếp nhận biết đang chờ cái gì mà không
                            phải mở phiếu ra đọc lại. */}
                        {t.status === 'NEEDS_INFO' && (
                          <p className="mx-4 mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3.5 py-2.5 text-[14px] leading-[1.43] tracking-[-0.016em] text-amber-800">
                            <HelpCircle size={ICON.md} className="mt-0.5 shrink-0" />
                            <span>
                              Đang chờ trường bổ sung:{' '}
                              <span className="font-medium">
                                {t.needsInfoRequest || 'thêm thông tin để tiếp nhận và xử lý yêu cầu.'}
                              </span>
                            </span>
                          </p>
                        )}

                        {/* ĐƠN VỊ GỬI + NGƯỜI LIÊN HỆ — một dải trên nền khác,
                            đúng luật "đổi mặt phẳng trước khi thêm khung".
                            Bản cũ chỉ hiện một Badge chứa t.campusId, tức
                            "FCG": người trực nhìn ba chữ đó không biết là cơ sở
                            nào, ở đâu, cấp học gì — mà đó chính là thứ quyết
                            định phiếu này khẩn tới đâu và gọi cho ai. */}
                        <div className="m-4 flex flex-wrap items-center gap-x-5 gap-y-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <CampusAvatar code={donVi?.code ?? t.campusId} />
                            <div className="min-w-0">
                              <p className="truncate text-[14px] font-semibold leading-[1.29] tracking-[-0.016em] text-slate-900">
                                {tenDonVi(t.campusId)}
                              </p>
                              {phuChuDonVi && (
                                <p className="truncate text-[12px] leading-[1.3] tracking-[-0.01em] text-slate-500">
                                  {phuChuDonVi}
                                </p>
                              )}
                            </div>
                          </div>

                          {t.contactName && (
                            <div className="flex min-w-0 items-center gap-2">
                              <UserRound size={ICON.md} className="shrink-0 text-slate-400" aria-hidden />
                              <div className="min-w-0">
                                <p className="truncate text-[14px] leading-[1.29] tracking-[-0.016em] text-slate-800">
                                  {t.contactName}
                                </p>
                                <p className="text-[12px] leading-[1.3] tracking-[-0.01em] text-slate-500">
                                  Đầu mối tại trường
                                </p>
                              </div>
                            </div>
                          )}

                          {t.contactEmail && (
                            <a
                              // mailto: kỹ thuật viên liên hệ được ngay từ hàng
                              // đợi, không phải chép tay địa chỉ sang ứng dụng
                              // mail.
                              href={`mailto:${t.contactEmail}?subject=${encodeURIComponent(`[${t.ticketNo}] ${t.title}`)}`}
                              className="flex min-w-0 items-center gap-2 text-[14px] tracking-[-0.016em] text-indigo-600 underline decoration-indigo-200 underline-offset-2"
                            >
                              <Mail size={ICON.md} className="shrink-0 text-slate-400" aria-hidden />
                              <span className="truncate">{t.contactEmail}</span>
                            </a>
                          )}

                          <button
                            type="button"
                            onClick={moChiTiet}
                            className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-white px-3.5 py-1.5 text-[14px] tracking-[-0.016em] text-indigo-600 ring-1 ring-slate-200 hover:bg-indigo-50"
                          >
                            {t.attachments?.length > 0
                              ? `Xem chi tiết · ${t.attachments.length} đính kèm`
                              : 'Xem chi tiết'}
                            <ChevronRight size={ICON.sm} />
                          </button>
                        </div>
                      </div>

                      {/* ---------------- CỘT THAO TÁC ----------------
                          Vách ngăn dọc + nền riêng: ba nút này thuộc về THẺ
                          NÀY, và nằm ngang tầm nội dung của nó chứ không nối
                          đuôi phía dưới. Trên màn hẹp thì rơi xuống thành một
                          dải ngang, vẫn nằm trong viền thẻ. */}
                      {!dangThaoTac && (
                        <div className="shrink-0 border-t border-slate-200 bg-slate-50/60 p-4 lg:w-[252px] lg:border-l lg:border-t-0">
                          <TriageActions
                            ticket={t}
                            actorUid={actorUid}
                            mode={null}
                            onModeChange={(m) => setOpenFor(m ? { id: t.id, mode: m } : null)}
                            projectId={cfg?.projectId ?? null}
                            canAssignOthers={canAssignOthers}
                            people={basePeople}
                            nameOf={nameOf}
                            calendar={lichLamViec}
                            layout="column"
                            onDone={reload}
                            onRejected={setVuaTuChoi}
                            onToast={onToast}
                          />
                        </div>
                      )}
                    </div>

                    {/* Khung nhập của lựa chọn vừa bấm, chạy hết chiều ngang
                        thẻ. Đây là MỘT thể hiện khác của TriageActions, không
                        phải cái ở cột bên phải: cột 252px không đủ cho lưới ba
                        ô của khung tiếp nhận, và cái đang mở thì cột kia vốn đã
                        rỗng vì bộ nút tự ẩn. */}
                    {dangThaoTac && (
                      <div className="border-t border-slate-200 bg-slate-50/60 px-4 pb-4 pt-3">
                        <TriageActions
                          ticket={t}
                          actorUid={actorUid}
                          mode={openFor?.mode ?? null}
                          onModeChange={(m) => setOpenFor(m ? { id: t.id, mode: m } : null)}
                          projectId={cfg?.projectId ?? null}
                          canAssignOthers={canAssignOthers}
                          people={basePeople}
                          nameOf={nameOf}
                          calendar={lichLamViec}
                          onDone={reload}
                          onRejected={setVuaTuChoi}
                          onToast={onToast}
                        />
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ul>

          <Card className="overflow-hidden">
            <PhanTrang
              tong={phieuHienThi.length}
              trang={trang}
              moiTrang={moiTrang}
              onTrang={setTrang}
              onMoiTrang={setMoiTrang}
            />
          </Card>
        </>
      )}
    </div>
  );
}
