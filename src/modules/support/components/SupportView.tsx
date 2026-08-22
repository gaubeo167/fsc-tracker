import React, { useCallback, useEffect, useState } from 'react';
import { Card, StateBlock } from '../../../components/ui';
import { vi } from '../i18n/vi';
import type { DuplicateCandidate } from '../hooks/useDuplicateCheck';
import { watchCampuses, type RepoError } from '../repository/campusRepository';
import { fetchTicketByNo, fetchTicketsForCampus, markMeToo } from '../repository/ticketRepository';
import { getMyAssignment } from '../repository/userAdminRepository';
import type { Campus, SupportRoleAssignment, Ticket, TicketType } from '../types';
import { CampusDashboard } from './CampusDashboard';
import { RequestTypeChooser } from './RequestTypeChooser';
import { TicketDetail } from './TicketDetail';
import { BugReportForm } from './forms/BugReportForm';
import { FeatureRequestForm } from './forms/FeatureRequestForm';

// ===========================================================================
// Điểm vào của module hỗ trợ cho cán bộ trường.
//
// Luồng: bảng điều khiển -> chọn loại yêu cầu -> form tương ứng -> xác nhận.
// Cộng thêm một đường vào thẳng: deep link ?ticket=FSC-... mở luôn chi tiết.
//
// Dùng state thay vì router: repo không có thư viện router (chủ dự án không
// duyệt thêm), và pattern ?param= là thứ App.tsx vốn đã dùng cho ?project=.
// ===========================================================================

type Screen = 'dashboard' | 'choose' | 'bug' | 'feature';
type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

export function SupportView({
  userId, userName, userEmail, onToast,
}: {
  userId: string;
  userName: string;
  userEmail: string;
  onToast: Toast;
}) {
  const [assignment, setAssignment] = useState<SupportRoleAssignment | null | 'loading'>('loading');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<RepoError | null>(null);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [openTicket, setOpenTicket] = useState<Ticket | null>(null);
  const [deepLinkMiss, setDeepLinkMiss] = useState<string | null>(null);
  /** Mở thẳng vào chế độ sửa khi người dùng chọn "Sửa yêu cầu" từ danh sách. */
  const [openInEdit, setOpenInEdit] = useState(false);

  useEffect(() => {
    void getMyAssignment(userId).then(setAssignment).catch(() => setAssignment(null));
  }, [userId]);

  useEffect(() => watchCampuses(setCampuses, () => setCampuses([])), []);

  const campusId = assignment && assignment !== 'loading' ? assignment.campusId : null;

  const reload = useCallback(async () => {
    if (!campusId) return;
    setListLoading(true);
    const { tickets: rows, error } = await fetchTicketsForCampus(campusId);
    setTickets(rows);
    setListError(error);
    setListLoading(false);
  }, [campusId]);

  useEffect(() => { void reload(); }, [reload]);

  /** Mở phiếu theo mã. Dùng cho cả deep link và cú bấm từ chuông thông báo. */
  const moPhieuTheoMa = useCallback((raw: string) => {
    // Mã phiếu đến từ URL hoặc từ thông báo nên coi là dữ liệu người lạ nhập:
    // cắt độ dài trước khi gửi đi truy vấn.
    const ticketNo = raw.slice(0, 64);
    void fetchTicketByNo(ticketNo).then(({ ticket }) => {
      if (ticket) { setOpenInEdit(false); setOpenTicket(ticket); }
      // Không im lặng: người bấm link từ email hay Zalo mà không thấy gì sẽ
      // tưởng hệ thống hỏng, chứ không nghĩ là mình không có quyền.
      else setDeepLinkMiss(ticketNo);
    });
  }, []);

  // Deep link, đọc một lần lúc mount — giống cách App.tsx xử lý ?project=.
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('ticket');
    if (raw) moPhieuTheoMa(raw);
  }, [moPhieuTheoMa]);

  // Bấm một thông báo trong chuông thì mở thẳng phiếu đó.
  //
  // Sự kiện window thay vì đổi URL rồi tải lại trang: tải lại làm mất trạng
  // thái đang gõ dở, mà thông báo hay đến đúng lúc người ta đang làm việc khác.
  useEffect(() => {
    const h = (e: Event) => moPhieuTheoMa(String((e as CustomEvent).detail ?? ''));
    window.addEventListener('fsc:open-ticket', h);
    return () => window.removeEventListener('fsc:open-ticket', h);
  }, [moPhieuTheoMa]);

  const campusNames = Object.fromEntries(campuses.map((c) => [c.id, c.name]));

  async function handleMeToo(c: DuplicateCandidate) {
    if (!campusId) return;
    const { error } = await markMeToo({ ticketId: c.item.id, campusId, userId });
    if (error) {
      onToast(error.kind === 'denied' ? vi.errors.permissionDenied : vi.errors.saveFailed, 'error');
      return;
    }
    onToast('Đã ghi nhận trường bạn cũng gặp vấn đề này', 'success');
    setScreen('dashboard');
    await reload();
  }

  function backToDashboard() {
    setScreen('dashboard');
    void reload();
  }

  if (assignment === 'loading') return <StateBlock kind="loading" />;

  if (!campusId) {
    return (
      <Card>
        <StateBlock
          kind="denied"
          title="Tài khoản chưa được gán vào trường"
          description="Liên hệ quản trị viên để được gán trường. Sau khi được gán, bạn gửi và theo dõi được yêu cầu hỗ trợ của trường mình."
        />
      </Card>
    );
  }

  if (openTicket) {
    return (
      <TicketDetail
        ticket={openTicket}
        startEditing={openInEdit}
        campusName={campusNames[openTicket.campusId] ?? openTicket.campusId}
        // Chỉ phiếu của CHÍNH trường mình mới sửa được. Phiếu toàn hệ thống của
        // trường khác thì xem được nhưng không phải của mình để sửa.
        canEdit={openTicket.campusId === campusId}
        actorUid={userId}
        onChanged={async () => {
          await reload();
          const fresh = await fetchTicketByNo(openTicket.ticketNo);
          if (fresh.ticket) setOpenTicket(fresh.ticket);
        }}
        onEdited={async () => {
          await reload();
          // Nạp lại bản mới để màn chi tiết không hiện nội dung cũ vừa bị thay.
          const fresh = await fetchTicketByNo(openTicket.ticketNo);
          if (fresh.ticket) setOpenTicket(fresh.ticket);
        }}
        onDeleted={async () => {
          setOpenTicket(null);
          setOpenInEdit(false);
          await reload();
        }}
        onBack={() => {
          setOpenTicket(null);
          setOpenInEdit(false);
          // Dọn tham số khỏi URL, nếu không bấm tải lại sẽ mở lại phiếu cũ.
          const url = new URL(window.location.href);
          url.searchParams.delete('ticket');
          window.history.replaceState({}, '', url.toString());
        }}
        onToast={onToast}
      />
    );
  }

  const formProps = {
    campusId,
    reporterUserId: userId,
    defaultContact: { name: userName, email: userEmail },
    campusNames,
    onToast,
    onCreated: () => void reload(),
    onMeToo: handleMeToo,
    onBack: () => setScreen('choose'),
    onBackToList: backToDashboard,
  };

  return (
    <div className="space-y-4">
      {deepLinkMiss && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <span className="flex-1">
            Không mở được yêu cầu <span className="font-mono">{deepLinkMiss}</span>. Yêu cầu không
            tồn tại, hoặc thuộc trường khác nên bạn không có quyền xem.
          </span>
          <button onClick={() => setDeepLinkMiss(null)} className="font-semibold underline">Đóng</button>
        </div>
      )}

      {screen === 'dashboard' && (
        <CampusDashboard
          tickets={tickets}
          loading={listLoading}
          error={listError}
          campusName={campusNames[campusId] ?? campusId}
          onOpen={(t) => { setOpenInEdit(false); setOpenTicket(t); }}
          onEdit={(t) => { setOpenInEdit(true); setOpenTicket(t); }}
          onDeleted={reload}
          onNew={() => setScreen('choose')}
          onToast={onToast}
        />
      )}

      {screen === 'choose' && (
        <RequestTypeChooser
          onBack={backToDashboard}
          onPick={(t: TicketType) => setScreen(t === 'BUG' ? 'bug' : 'feature')}
        />
      )}

      {screen === 'bug' && <BugReportForm {...formProps} />}
      {screen === 'feature' && <FeatureRequestForm {...formProps} />}
    </div>
  );
}
