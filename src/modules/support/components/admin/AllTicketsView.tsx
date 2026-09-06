import {
  CheckCircle2, ChevronsUpDown, ClipboardList, Clock, Filter, HelpCircle,
  Inbox, Loader2, XCircle,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Card, StateBlock, cn } from '../../../../components/ui';
import {
  CampusAvatar, CopyMaPhieu, DueCell, ICON, MessageChip, ModuleCell, OPEN_STATUSES, OTimKiem,
  PhanTrang, PriorityBadge, StatusBadge, TABLE, TypeBadge, TypeFilterChips, fmtDateFull, fmtTime,
  khopTimKiem,
} from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import { watchCampuses, type RepoError } from '../../repository/campusRepository';
import { fetchAllTickets } from '../../repository/ticketRepository';
import { TicketDetail } from '../TicketDetail';
import { TriageActionsFor } from '../triage/TriageActionsFor';
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

/**
 * Trần số phiếu kéo về MỘT LẦN, rồi lọc/đếm/sắp xếp toàn bộ ở client.
 *
 * Bản cũ gọi lại Firestore mỗi lần đổi bộ lọc, mỗi lần chỉ lấy đúng nhóm trạng
 * thái đang xem. Cách đó không dựng được dãy ô thống kê ở đầu màn: muốn biết
 * "12 phiếu bị từ chối" trong khi đang xem nhóm "đang mở" thì phải có cả hai
 * nhóm trong tay cùng lúc, tức là bảy truy vấn song song cho bảy con số.
 *
 * Đổi lại là một trần cứng. Vượt trần thì mọi con số trên màn đều nói về "N
 * phiếu gần nhất" chứ không phải toàn bộ — và màn hình PHẢI nói ra điều đó
 * (xem dòng cảnh báo dưới dãy ô thống kê). Một con số thống kê sai mà trông như
 * đúng thì tệ hơn hẳn không có con số nào.
 */
const TRAN_TAI = 500;

/**
 * Bảy nhóm trạng thái, PHỦ KÍN cả 12 trạng thái và không nhóm nào chồng nhóm nào.
 *
 * Phải phủ kín vì mỗi ô thống kê hiện một tỉ lệ phần trăm: bỏ sót một trạng
 * thái là tổng các phần trăm không ra 100, và người đọc mất niềm tin vào cả dãy
 * số mà không biết mình mất vì cái gì.
 *
 * Vì sao "Từ chối" gộp cả DUPLICATE: cả hai đều là "phiếu này không đi tiếp",
 * và tách DUPLICATE thành ô thứ tám cho một con số gần như luôn bằng 0 là làm
 * loãng bảy ô còn lại.
 */
const NHOM: Array<{
  id: string;
  label: string;
  statuses: TicketStatus[] | null;
  Icon: typeof Clock;
  /** Màu của ô thống kê: nền icon, chữ số, và thanh tỉ lệ. */
  mau: string;
  thanh: string;
}> = [
  { id: 'all', label: 'Tất cả phiếu', statuses: null, Icon: ClipboardList, mau: 'bg-indigo-50 text-indigo-600', thanh: 'bg-indigo-500' },
  { id: 'triage', label: 'Chờ tiếp nhận', statuses: ['NEW', 'TRIAGE'], Icon: Clock, mau: 'bg-amber-50 text-amber-600', thanh: 'bg-amber-500' },
  { id: 'accepted', label: 'Đã tiếp nhận', statuses: ['ACCEPTED'], Icon: CheckCircle2, mau: 'bg-sky-50 text-sky-600', thanh: 'bg-sky-500' },
  { id: 'progress', label: 'Đang xử lý', statuses: ['IN_PROGRESS', 'REOPENED', 'ON_HOLD'], Icon: Loader2, mau: 'bg-violet-50 text-violet-600', thanh: 'bg-violet-500' },
  { id: 'done', label: 'Đã hoàn thành', statuses: ['RESOLVED', 'PENDING_VERIFICATION', 'CLOSED'], Icon: CheckCircle2, mau: 'bg-emerald-50 text-emerald-600', thanh: 'bg-emerald-500' },
  { id: 'rejected', label: 'Từ chối', statuses: ['REJECTED', 'DUPLICATE'], Icon: XCircle, mau: 'bg-red-50 text-red-600', thanh: 'bg-red-500' },
  { id: 'needs', label: 'Cần bổ sung', statuses: ['NEEDS_INFO'], Icon: HelpCircle, mau: 'bg-slate-100 text-slate-600', thanh: 'bg-slate-400' },
];

/** Cột nào sắp xếp được. Chỉ hai — xem ghi chú ở nút sắp xếp. */
type KhoaSap = 'ticketNo' | 'createdAt';

export function AllTicketsView({
  actorUid, onToast,
}: {
  actorUid: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState<RepoError | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [nhom, setNhom] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('');
  const [loaiLoc, setLoaiLoc] = useState<'all' | TicketType>('all');
  const [tuKhoa, setTuKhoa] = useState('');
  const [sap, setSap] = useState<{ khoa: KhoaSap; giam: boolean }>({ khoa: 'createdAt', giam: true });
  const [trang, setTrang] = useState(1);
  const [moiTrang, setMoiTrang] = useState(10);
  // Kể cả phân hệ đã tắt: phiếu cũ của nó vẫn phải lọc ra xem được.
  const phanHe = useSupportModules().modules;
  const [open, setOpen] = useState<Ticket | null>(null);
  // Tăng lên để buộc nạp lại sau khi đổi trạng thái phiếu.
  const [refreshKey, setRefreshKey] = useState(0);
  // Bấm mã phiếu trong màn Công việc thì mở thẳng phiếu đó ở đây.
  useOpenTicketEvent(setOpen);

  useEffect(() => watchCampuses(setCampuses, () => setCampuses([])), []);

  // MỘT lượt đọc cho cả màn. Đổi bộ lọc không gọi lại Firestore nữa — xem
  // ghi chú ở TRAN_TAI.
  useEffect(() => {
    let alive = true;
    setTickets(null);
    void fetchAllTickets({ limit: TRAN_TAI }).then((r) => {
      if (!alive) return;
      setTickets(r.tickets);
      setError(r.error);
    });
    return () => { alive = false; };
  }, [refreshKey]);

  const campusNames = useMemo(
    () => Object.fromEntries(campuses.map((c) => [c.id, c.name])),
    [campuses]
  );
  const campusById = useMemo(
    () => Object.fromEntries(campuses.map((c) => [c.id, c])),
    [campuses]
  );
  const tenTruong = (id: string) => campusNames[id] ?? id;

  const tatCa = tickets ?? [];

  // Đếm cho dãy ô thống kê: tính trên TOÀN BỘ phiếu đã tải, KHÔNG theo bộ lọc
  // đang chọn. Đếm sau khi lọc thì bấm vào ô "Từ chối" xong cả bảy ô đổi số, và
  // dãy thống kê mất hẳn ý nghĩa "bức tranh chung".
  const demNhom = useMemo(() => Object.fromEntries(
    NHOM.map((n) => [n.id, n.statuses ? tatCa.filter((t) => n.statuses!.includes(t.status)).length : tatCa.length])
  ) as Record<string, number>, [tatCa]);

  // Lọc theo nhóm trạng thái -> phân hệ -> từ khoá. Ba trục độc lập.
  const theoNhom = useMemo(() => {
    const st = NHOM.find((n) => n.id === nhom)?.statuses;
    return tatCa.filter((t) => (
      (!st || st.includes(t.status))
      && (!moduleFilter || t.moduleId === moduleFilter)
      && khopTimKiem(t, tuKhoa, tenTruong(t.campusId))
    ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tatCa, nhom, moduleFilter, tuKhoa, campusNames]);

  // Đếm theo loại tính SAU các bộ lọc trên, TRƯỚC bộ lọc loại: đang xem riêng
  // một phân hệ thì con số phải là của phân hệ đó — nếu không, bấm "Báo lỗi
  // (12)" mà chỉ ra 3 dòng.
  const demTheoLoai = useMemo(() => ({
    all: theoNhom.length,
    BUG: theoNhom.filter((t) => t.type === 'BUG').length,
    FEATURE_REQUEST: theoNhom.filter((t) => t.type === 'FEATURE_REQUEST').length,
  }), [theoNhom]);

  /**
   * Toàn bộ phiếu đã tải có cả hai loại không.
   *
   * Dải nút lọc loại hiện/ẩn theo con số NÀY chứ không theo demTheoLoai ở trên:
   * nếu theo số đã lọc thì gõ tới ký tự thứ ba làm kết quả chỉ còn báo lỗi là
   * cả dải nút biến mất dưới tay người đang dùng nó.
   */
  const coCaHaiLoai = useMemo(
    () => tatCa.some((t) => t.type === 'BUG') && tatCa.some((t) => t.type === 'FEATURE_REQUEST'),
    [tatCa]
  );

  const daLoc = useMemo(
    () => theoNhom.filter((t) => loaiLoc === 'all' || t.type === loaiLoc),
    [theoNhom, loaiLoc]
  );

  const daSap = useMemo(() => {
    const ds = [...daLoc];
    ds.sort((a, b) => {
      const r = sap.khoa === 'ticketNo'
        ? a.ticketNo.localeCompare(b.ticketNo)
        : a.createdAt - b.createdAt;
      return sap.giam ? -r : r;
    });
    return ds;
  }, [daLoc, sap]);

  // Về trang 1 mỗi khi tập kết quả đổi. Không có dòng này thì lọc từ 128 phiếu
  // xuống 4 trong lúc đang ở trang 9 sẽ ra một bảng rỗng.
  useEffect(() => { setTrang(1); }, [nhom, moduleFilter, loaiLoc, tuKhoa]);

  const hienThi = useMemo(
    () => daSap.slice((trang - 1) * moiTrang, trang * moiTrang),
    [daSap, trang, moiTrang]
  );

  function doiSap(khoa: KhoaSap) {
    setSap((cu) => (cu.khoa === khoa ? { khoa, giam: !cu.giam } : { khoa, giam: true }));
  }

  if (open) {
    return (
      <TicketDetail
        ticket={open}
        campusName={tenTruong(open.campusId)}
        actorUid={actorUid}
        canResolve
        onChanged={() => { setOpen(null); setRefreshKey((k) => k + 1); }}
        onBack={() => setOpen(null)}
        onToast={onToast}
        // Phiếu chưa ai tiếp nhận thì mở từ đây cũng phải tiếp nhận / hỏi thêm /
        // từ chối được, và phiếu bị từ chối nhầm phải tiếp nhận lại được. Thiếu
        // dòng này, người đọc xong cuộc trao đổi phải sang tab khác tìm lại đúng
        // phiếu đó mới thao tác được.
        triageActions={(
          <TriageActionsFor
            ticket={open}
            actorUid={actorUid}
            isAdmin
            onDone={() => { setOpen(null); setRefreshKey((k) => k + 1); }}
            onToast={onToast}
          />
        )}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <ClipboardList size={ICON.xl} className="mt-1 shrink-0 text-slate-400" />
        <div className="min-w-0">
          <h2 className="text-[21px] font-semibold leading-[1.19] tracking-[-0.022em] text-slate-900">
            Tất cả phiếu
          </h2>
          <p className="mt-1 text-[14px] leading-[1.43] tracking-[-0.016em] text-slate-500">
            Quản lý và theo dõi toàn bộ yêu cầu, đề xuất từ các trường
          </p>
        </div>
        <OTimKiem
          value={tuKhoa}
          onChange={setTuKhoa}
          placeholder="Tìm theo mã phiếu, tiêu đề, trường, người gửi…"
          className="ml-auto w-full sm:w-80"
        />
      </div>

      {/* ------------------------------------------------------------------
          DÃY Ô THỐNG KÊ.

          Không phải trang trí: đây là câu trả lời cho "tình hình chung đang thế
          nào" mà trước đây admin chỉ có được bằng cách bấm lần lượt từng bộ lọc
          rồi tự nhớ bốn con số. Mỗi ô cũng là một nút — bấm là lọc luôn, nên
          con số và danh sách nó dẫn tới không bao giờ lệch nhau.
          ------------------------------------------------------------------ */}
      {tickets !== null && !error && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {NHOM.map((n) => {
              const so = demNhom[n.id] ?? 0;
              const phanTram = tatCa.length === 0 ? 0 : Math.round((so / tatCa.length) * 100);
              const dang = nhom === n.id;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => setNhom(n.id)}
                  aria-pressed={dang}
                  className={cn(
                    'rounded-xl border bg-white p-3.5 text-left transition-colors',
                    dang ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200 hover:border-slate-300'
                  )}
                >
                  {/* Nhãn nằm DƯỚI, chiếm trọn chiều ngang thẻ — không đứng
                      cạnh icon. Bảy thẻ trên khung 1088px là mỗi thẻ ~140px;
                      trừ icon 36px và khoảng cách thì nhãn chỉ còn ~90px, và
                      "Chờ tiếp nhận" hiện ra thành "Chờ tiếp nh...". Nhãn LÀ
                      thứ nói ô này đếm cái gì, cắt nó đi thì con số mất nghĩa. */}
                  <div className="flex items-center gap-2.5">
                    <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', n.mau)}>
                      <n.Icon size={ICON.lg} aria-hidden />
                    </span>
                    <p className="text-[20px] font-semibold leading-[1.1] tabular-nums tracking-[-0.022em] text-slate-900">
                      {so}
                    </p>
                  </div>
                  <p className="mt-1.5 truncate text-[12px] leading-[1.3] tracking-[-0.01em] text-slate-500" title={n.label}>
                    {n.label}
                  </p>
                  {/* Thanh tỉ lệ. Ô "Tất cả" không có thanh: một thanh luôn đầy
                      100% không nói thêm điều gì. */}
                  {n.id !== 'all' && (
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-[11px] tabular-nums text-slate-400">{phanTram}%</span>
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span className={cn('block h-full rounded-full', n.thanh)} style={{ width: `${phanTram}%` }} />
                      </span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Vượt trần tải thì mọi con số bên trên nói về N phiếu gần nhất, và
              màn hình phải nói ra điều đó. Xem ghi chú ở TRAN_TAI. */}
          {tatCa.length >= TRAN_TAI && (
            <p className="text-[12px] leading-[1.4] tracking-[-0.01em] text-amber-700">
              Đang thống kê trên {TRAN_TAI} phiếu mới nhất. Hệ thống đã có nhiều hơn thế —
              các con số ở trên không phải toàn bộ lịch sử.
            </p>
          )}
        </>
      )}

      {/* Bộ lọc phụ: loại yêu cầu và phân hệ. Hai trục độc lập với nhóm trạng
          thái ở trên, nên đứng riêng một hàng. */}
      <div className="flex flex-wrap items-center gap-3">
        {coCaHaiLoai && (
          <TypeFilterChips value={loaiLoc} onChange={setLoaiLoc} counts={demTheoLoai} />
        )}
        <label className="ml-auto flex shrink-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white py-2 pl-3 pr-2 text-[14px] tracking-[-0.016em] text-slate-600">
          <Filter size={ICON.sm} className="text-slate-400" aria-hidden />
          <span className="sr-only">Lọc theo phân hệ</span>
          <select
            value={moduleFilter}
            onChange={(e) => setModuleFilter(e.target.value)}
            className="border-none bg-transparent pr-1 text-[14px] text-slate-700 focus:outline-none"
          >
            <option value="">Mọi phân hệ</option>
            {phanHe.map((m) => (
              <option key={m.code} value={m.code}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>

      <Card className="overflow-hidden">
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
        ) : daSap.length === 0 ? (
          <StateBlock
            kind="empty"
            title={tuKhoa ? `Không có phiếu nào khớp “${tuKhoa}”` : 'Không có phiếu nào'}
            description={
              nhom === 'rejected'
                ? 'Chưa có phiếu nào bị từ chối. Phiếu từ chối nhầm sẽ hiện ở đây để tiếp nhận lại.'
                : 'Đổi nhóm trạng thái hoặc xoá từ khoá để xem các phiếu khác.'
            }
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-[13px] tracking-[-0.016em] text-slate-500">
              <Inbox size={ICON.sm} />
              {daSap.length} phiếu
              {(moduleFilter || loaiLoc !== 'all' || tuKhoa || nhom !== 'all') && (
                <span className="text-slate-400">· đang lọc</span>
              )}
            </div>
            {/* Bảng rộng hơn màn hình trên laptop 13" — cho cuộn ngang TRONG
                thẻ, không để cả trang trượt ngang. */}
            <div className="overflow-x-auto">
              {/*
                table-fixed + colgroup, KHÔNG để bảng tự chia cột.

                Với bố cục tự động, cột "Mã phiếu" đòi 277px vì mã dài nhất
                (FSC-APP_MY_FPT_SCHOOL-2608-0001) là một chuỗi mono không ngắt
                được, còn cột "Tiêu đề / Nội dung" co lại còn 70px — đo được
                trên máy thật. Tức là cột quan trọng nhất của bảng bị bóp đến
                mức chỉ hiện "Khô...", trong khi cột mã — thứ người ta chỉ liếc
                — chiếm một phần tư chiều ngang.

                Bố cục cố định đảo lại thứ tự ưu tiên đó: mỗi cột nhận đúng
                phần đã khai, và mã phiếu dài thì xuống dòng (break-all) thay
                vì đẩy cả bảng.
              */}
              <table className="w-full min-w-[1180px] table-fixed text-left">
                <colgroup>
                  <col className="w-[150px]" />
                  <col className="w-[240px]" />
                  <col className="w-[104px]" />
                  <col className="w-[158px]" />
                  <col className="w-[132px]" />
                  <col className="w-[148px]" />
                  <col className="w-[96px]" />
                  <col className="w-[118px]" />
                  <col className="w-[74px]" />
                </colgroup>
                <thead>
                  <tr className={TABLE.headRow}>
                    <th className={TABLE.headCell}>
                      <SapTheo nhan="Mã phiếu" dang={sap.khoa === 'ticketNo'} onClick={() => doiSap('ticketNo')} />
                    </th>
                    <th className={TABLE.headCell}>Tiêu đề / Nội dung</th>
                    <th className={TABLE.headCell}>Loại</th>
                    <th className={TABLE.headCell}>Trường</th>
                    <th className={TABLE.headCell}>Phân hệ</th>
                    <th className={TABLE.headCell}>Người gửi</th>
                    <th className={TABLE.headCell}>
                      <SapTheo nhan="Ngày gửi" dang={sap.khoa === 'createdAt'} onClick={() => doiSap('createdAt')} />
                    </th>
                    <th className={TABLE.headCell}>Trạng thái</th>
                    <th className={cn(TABLE.headCell, 'text-right')}>Hạn</th>
                  </tr>
                </thead>
                <tbody>
                  {hienThi.map((t) => {
                    const dv = campusById[t.campusId];
                    return (
                      <tr key={t.id} onClick={() => setOpen(t)} className={TABLE.row}>
                        <td className={TABLE.cell}>
                          <span className="flex items-start gap-0.5">
                            <span className="min-w-0 break-all font-mono text-[12px] font-semibold tabular-nums text-slate-700">
                              {t.ticketNo}
                            </span>
                            <CopyMaPhieu ticketNo={t.ticketNo} onCopied={(m) => onToast(m, 'success')} />
                          </span>
                        </td>
                        <td className={TABLE.cell}>
                          <span className="line-clamp-1 text-[14px] font-medium tracking-[-0.016em] text-slate-900" title={t.title}>
                            {t.title}
                          </span>
                          {t.description && (
                            <span className="line-clamp-1 text-[13px] tracking-[-0.01em] text-slate-500">
                              {t.description}
                            </span>
                          )}
                          <MessageChip ticket={t} viewerSide="PTUD" className="mt-1" />
                        </td>
                        <td className={TABLE.cell}><TypeBadge type={t.type} /></td>
                        {/* Cột trường là thứ admin cần nhất: nhìn ra ngay lỗi
                            nào đang lan ra nhiều trường. */}
                        {/* Tên trường ĐỨNG TRÊN, mã đứng dưới — không xếp
                            ngang cạnh ô mã. Xếp ngang thì trong cột 158px, ô
                            mã ăn mất 46px và tên còn lại đúng "FPT...", tức là
                            phân biệt được 0 trong 18 trường. Xuống dòng thì tên
                            được trọn chiều ngang cột. */}
                        <td className={TABLE.cell}>
                          <span className="block truncate text-[14px] tracking-[-0.016em] text-slate-800" title={tenTruong(t.campusId)}>
                            {tenTruong(t.campusId)}
                          </span>
                          <span className="mt-1 flex items-center gap-1.5">
                            <CampusAvatar code={dv?.code ?? t.campusId} className="px-1.5 py-0.5" />
                            {t.scope === 'SYSTEM_WIDE' && (
                              <span
                                className="truncate text-[12px] text-sky-600"
                                title={`Sự cố toàn hệ thống, ${(t.affectedCampusIds ?? []).length} trường bị ảnh hưởng`}
                              >
                                +{Math.max(0, (t.affectedCampusIds ?? []).length - 1)} trường
                              </span>
                            )}
                          </span>
                        </td>
                        {/* Phân hệ có icon riêng: năm dòng chữ xám giống nhau
                            thì phải đọc từng chữ, còn icon thì quét mắt là nhận
                            ra. */}
                        <td className={TABLE.cell}>
                          <ModuleCell code={t.moduleId} />
                        </td>
                        <td className={TABLE.cell}>
                          <span className="block truncate text-[14px] tracking-[-0.016em] text-slate-800" title={t.contactName || undefined}>
                            {t.contactName || '—'}
                          </span>
                          {t.contactEmail && (
                            <span className="block truncate text-[12px] text-slate-500" title={t.contactEmail}>
                              {t.contactEmail}
                            </span>
                          )}
                        </td>
                        <td className={cn(TABLE.cell, 'whitespace-nowrap')}>
                          <span className="block text-[14px] tabular-nums tracking-[-0.016em] text-slate-700">
                            {fmtDateFull(t.createdAt)}
                          </span>
                          <span className="block text-[12px] tabular-nums text-slate-400">
                            {fmtTime(t.createdAt)}
                          </span>
                        </td>
                        <td className={TABLE.cell}>
                          <StatusBadge status={t.status} />
                          {t.priority && <PriorityBadge priority={t.priority} />}
                        </td>
                        <td className={cn(TABLE.cell, 'text-right')}>
                          <DueCell dueAt={t.dueAt} isOpen={OPEN_STATUSES.includes(t.status)} estimateDays={t.estimateDays} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <PhanTrang
              tong={daSap.length}
              trang={trang}
              moiTrang={moiTrang}
              onTrang={setTrang}
              onMoiTrang={setMoiTrang}
            />
          </>
        )}
      </Card>
    </div>
  );
}

/**
 * Nhãn cột bấm được để đổi chiều sắp xếp.
 *
 * Chỉ hai cột sắp xếp được — mã phiếu và ngày gửi. Mọi cột còn lại (trường,
 * phân hệ, trạng thái) đã có bộ lọc riêng ngay bên trên bảng, và sắp xếp theo
 * chúng chỉ là cách chậm hơn để làm cùng một việc.
 */
function SapTheo({ nhan, dang, onClick }: { nhan: string; dang: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1 transition-colors hover:text-slate-800',
        dang && 'text-slate-800'
      )}
    >
      {nhan}
      <ChevronsUpDown size={ICON.xs} className={dang ? 'text-indigo-500' : 'text-slate-300'} aria-hidden />
    </button>
  );
}
