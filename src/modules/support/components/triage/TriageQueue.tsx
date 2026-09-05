import {
  Building2, ChevronDown, ChevronRight, ChevronUp, HelpCircle, Inbox, Mail,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, StateBlock, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import { fetchTriageQueueForModules } from '../../repository/ticketRepository';
import {
  fetchMyTriageScope, fetchPtudStaff, fetchSupportModules, type ModuleScope,
} from '../../repository/userAdminRepository';
import { useWorkingCalendar } from '../../hooks/useWorkingCalendar';
import { MessageChip, StatusBadge, TypeBadge, TypeFilterChips } from '../../ui/tokens';
import { useSupportModules } from '../../hooks/useSupportModules';
import { useCampuses } from '../../hooks/useCampuses';
import { TicketDetail } from '../TicketDetail';
import { TriageActions, type TriageMode } from './TriageActions';
import type {
  SupportModuleCode, SupportModuleConfig, Ticket, TicketType,
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

  // Đếm theo loại — tính trên TOÀN BỘ hàng đợi, không phải trên danh sách đã
  // lọc. Đếm sau khi lọc thì nút "Báo lỗi" luôn hiện đúng số phiếu đang xem và
  // hai nút kia về 0, tức là con số mất hết ý nghĩa.
  const demTheoLoai = useMemo(() => {
    const ds = tickets ?? [];
    return {
      all: ds.length,
      BUG: ds.filter((t) => t.type === 'BUG').length,
      FEATURE_REQUEST: ds.filter((t) => t.type === 'FEATURE_REQUEST').length,
    };
  }, [tickets]);

  const phieuHienThi = useMemo(
    () => (tickets ?? []).filter((t) => loaiLoc === 'all' || t.type === loaiLoc),
    [tickets, loaiLoc]
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
    const conChoTiepNhan = openDetail.status === 'TRIAGE' || openDetail.status === 'NEEDS_INFO';
    return (
      <TicketDetail
        ticket={openDetail}
        campusName={tenDonVi(openDetail.campusId)}
        actorUid={actorUid}
        canResolve
        onChanged={() => { setOpenDetail(null); void reload(); }}
        onBack={() => { setOpenDetail(null); void reload(); }}
        onToast={onToast}
        triageActions={conChoTiepNhan ? (
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

      {/* Lọc theo loại. Chỉ hiện khi hàng đợi có CẢ HAI loại: một dải nút mà
          bấm loại nào cũng ra cùng một danh sách là chrome thừa. */}
      {demTheoLoai.BUG > 0 && demTheoLoai.FEATURE_REQUEST > 0 && (
        <TypeFilterChips value={loaiLoc} onChange={setLoaiLoc} counts={demTheoLoai} />
      )}

      <Card>
        {tickets.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Không có phiếu nào chờ tiếp nhận"
            description="Mọi yêu cầu thuộc phân hệ bạn phụ trách đều đã được xử lý."
          />
        ) : phieuHienThi.length === 0 ? (
          // Rỗng vì BỘ LỌC, không phải vì hết việc — nói rõ, kèm lối thoát.
          // Gộp hai trạng thái này làm người trực tưởng đã xong việc.
          <StateBlock
            kind="empty"
            title={`Không có phiếu ${loaiLoc === 'BUG' ? 'báo lỗi' : 'đề xuất tính năng'} nào đang chờ`}
            description="Hàng đợi vẫn còn phiếu thuộc loại khác."
            action={
              <Button size="sm" variant="outline" onClick={() => setLoaiLoc('all')}>
                Xem tất cả {demTheoLoai.all} phiếu
              </Button>
            }
          />
        ) : (
          <>
            {/* Nền parchment thay cho đường viền dày: DESIGN.md §Do's — "alternate
                surface before adding chrome". Đổi màu nền LÀ đường phân cách. */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3">
              <span className="flex items-center gap-2 text-[15px] font-semibold tracking-[-0.016em] text-slate-700">
                <Inbox size={ICON.lg} className="text-slate-400" />
                {phieuHienThi.length} phiếu chờ tiếp nhận
                {loaiLoc !== 'all' && (
                  <span className="font-normal text-slate-400">
                    · đang lọc {loaiLoc === 'BUG' ? 'báo lỗi' : 'đề xuất tính năng'}
                  </span>
                )}
              </span>
              <Button size="sm" variant="outline" onClick={() => setCollapsed((v) => !v)}>
                {collapsed ? <>Mở rộng <ChevronDown size={ICON.md} /></>
                           : <>Thu gọn <ChevronUp size={ICON.md} /></>}
              </Button>
            </div>
            <ul className={cn('divide-y divide-slate-100', collapsed && 'hidden')}>
              {phieuHienThi.map((t) => {
                const cfg = moduleById[t.moduleId];
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
                const donVi = campusOf(t.campusId);
                // Tỉnh/thành và cấp học chỉ hiện khi CÓ. Trường nhập trước khi
                // hai ô này ra đời vẫn phải đọc được, và một dấu chấm giữa
                // trông như lỗi hiển thị.
                const phuChuDonVi = [donVi?.province, donVi?.levels].filter(Boolean).join(' · ');
                return (
                  <li key={t.id} className="px-5 py-4">
                    {/* Vùng bấm để mở chi tiết.
                        Chỉ bọc phần NỘI DUNG (mã, tiêu đề, mô tả, đơn vị) —
                        không bọc cả dòng. Khung tiếp nhận bung ra ngay bên dưới
                        và chứa select/input/textarea; để cả dòng bắt click thì
                        mỗi lần bấm vào ô ghi chú lại nhảy sang màn chi tiết,
                        mất sạch thứ đang gõ dở. */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => { setOpenDetail(t); setModeChiTiet(null); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault(); setOpenDetail(t); setModeChiTiet(null);
                        }
                      }}
                      aria-label={`Xem chi tiết phiếu ${t.ticketNo}: ${t.title}`}
                      className="group -mx-2 cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-slate-50"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Nhãn CÓ CHỮ, đứng đầu hàng. Loại yêu cầu quyết định
                            phiếu có hạn xử lý hay không, nên nó phải đọc được
                            ngay chứ không nằm sau một con bọ 18px. */}
                        <TypeBadge type={t.type} />
                        <span className="rounded-xs bg-slate-100 px-2 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-slate-600">
                          {t.ticketNo}
                        </span>
                        <StatusBadge status={t.status} />
                        <MessageChip ticket={t} viewerSide="PTUD" />
                        {t.attachments?.length > 0 && (
                          <span className="text-[12px] text-slate-400">{t.attachments.length} đính kèm</span>
                        )}
                      </div>

                      {/* 17px/600 = token `body-strong`. DESIGN.md §Do's: thân
                          bài chạy 17px chứ không 16px — "the extra pixel defines
                          the brand's reading pace". */}
                      <p className="mt-2 text-[17px] font-semibold leading-[1.24] tracking-[-0.022em] text-slate-900 group-hover:text-indigo-600">
                        {t.title}
                      </p>
                      {t.description && (
                        <p className="mt-1 line-clamp-2 text-[17px] leading-[1.47] tracking-[-0.022em] text-slate-500">
                          {t.description}
                        </p>
                      )}

                      {/* ĐƠN VỊ GỬI — khối riêng, không phải một badge mã ba chữ.
                          Bản cũ chỉ hiện một Badge chứa t.campusId, tức "FCG".
                          Người trực hàng đợi nhìn ba chữ đó không biết là cơ sở
                          nào, ở đâu, cấp học gì — mà đó chính là thứ quyết định
                          phiếu này khẩn tới đâu và gọi cho ai.
                          Nền parchment thay cho viền, đúng luật "đổi mặt phẳng
                          trước khi thêm khung" của DESIGN.md. */}
                      <div className="mt-2.5 rounded-md bg-slate-50 px-3 py-2.5">
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <Building2 size={ICON.sm} className="shrink-0 translate-y-0.5 text-slate-400" aria-hidden />
                          <span className="text-[14px] font-semibold leading-[1.29] tracking-[-0.016em] text-slate-900">
                            {tenDonVi(t.campusId)}
                          </span>
                          {/* Mã vẫn giữ: đó là thứ người ta gõ khi tra cứu và
                              là thứ in trên mọi báo cáo. Nhưng nó đứng SAU tên,
                              ở vai trò phụ chú. */}
                          {donVi && donVi.code !== donVi.name && (
                            <span className="rounded-xs bg-white px-1.5 py-0.5 font-mono text-[12px] font-semibold tabular-nums text-slate-500">
                              {donVi.code}
                            </span>
                          )}
                          {phuChuDonVi && (
                            <span className="text-[14px] leading-[1.43] tracking-[-0.016em] text-slate-500">
                              {phuChuDonVi}
                            </span>
                          )}
                        </div>
                        {t.contactEmail && (
                          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-[1.43] tracking-[-0.016em] text-slate-500">
                            <Mail size={ICON.sm} className="shrink-0 text-slate-400" />
                            Người gửi: <span className="text-slate-700">{t.contactName}</span>
                            <span aria-hidden>·</span>
                            {/* mailto: kỹ thuật viên liên hệ được ngay từ hàng đợi,
                                không phải chép tay địa chỉ sang ứng dụng mail.
                                stopPropagation để bấm vào email không mở màn chi tiết. */}
                            <a
                              href={`mailto:${t.contactEmail}?subject=${encodeURIComponent(`[${t.ticketNo}] ${t.title}`)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-indigo-600 underline decoration-indigo-200 underline-offset-2"
                            >
                              {t.contactEmail}
                            </a>
                          </p>
                        )}
                      </div>

                      {/* Lời mời bấm. Không có nó thì "bấm vào đâu để xem chi
                          tiết" là thứ người dùng phải đoán — và họ đoán sai. */}
                      <span className="mt-2 inline-flex items-center gap-0.5 text-[14px] tracking-[-0.016em] text-indigo-600">
                        Xem chi tiết yêu cầu
                        <ChevronRight size={ICON.sm} className="transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>

                    {/* Phiếu đang chờ trường trả lời: hiện đúng câu đã hỏi, để
                        người tiếp nhận biết đang chờ cái gì mà không phải mở
                        phiếu ra đọc lại. */}
                    {t.status === 'NEEDS_INFO' && (
                      <p className="mt-2.5 flex items-start gap-2 rounded-md bg-red-50 px-3.5 py-2.5 text-[14px] leading-[1.43] tracking-[-0.016em] text-red-700">
                        <HelpCircle size={ICON.md} className="mt-0.5 shrink-0" />
                        <span>
                          Đang chờ trường bổ sung:{' '}
                          <span className="font-medium">
                            {t.needsInfoRequest || 'thêm thông tin để tiếp nhận và xử lý yêu cầu.'}
                          </span>
                        </span>
                      </p>
                    )}

                    {/* Ba thao tác tiếp nhận. Cùng một component với màn chi
                        tiết — xem TriageActions.tsx. */}
                    <TriageActions
                      ticket={t}
                      actorUid={actorUid}
                      mode={openFor?.id === t.id ? openFor.mode : null}
                      onModeChange={(m) => setOpenFor(m ? { id: t.id, mode: m } : null)}
                      projectId={cfg?.projectId ?? null}
                      canAssignOthers={canAssignOthers}
                      people={basePeople}
                      nameOf={nameOf}
                      calendar={lichLamViec}
                      onDone={reload}
                      onToast={onToast}
                    />
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
