import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Copy, ExternalLink, HelpCircle, Lock, Mail, Pencil, RotateCcw, Trash2, UserRound, XCircle } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { AttachmentGallery } from './AttachmentGallery';
import { TicketThread } from './TicketThread';
import {
  canCampusEdit, confirmTicketClosed, deleteTicket, fetchLinkedTask, reopenTicket,
  resolveTicket, type LinkedTask,
} from '../repository/ticketRepository';
import { EditTicketPanel } from './forms/EditTicketPanel';
import { Badge, Button, Card, cn } from '../../../components/ui';
import { ICON, ModuleCell, TypeBadge } from '../ui/tokens';
import { vi } from '../i18n/vi';
import { DomainError, type Ticket } from '../types';

// ===========================================================================
// Chi tiết một phiếu. Đây là đích đến của deep link ?ticket=FSC-...
// Chỉ đọc: người tại trường xem tiến độ, không sửa gì.
// ===========================================================================

/** Các mốc theo thứ tự thường gặp. Trạng thái rẽ nhánh xử lý riêng bên dưới. */
const STEPS: Array<{ status: Ticket['status']; label: string }> = [
  { status: 'TRIAGE', label: 'Tiếp nhận' },
  { status: 'ACCEPTED', label: 'Đã duyệt' },
  { status: 'IN_PROGRESS', label: 'Đang xử lý' },
  { status: 'RESOLVED', label: 'Đã khắc phục' },
  { status: 'CLOSED', label: 'Hoàn tất' },
];

function fmt(ms: number | null): string {
  if (!ms) return '—';
  const d = new Date(ms + 7 * 3600_000);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function TicketDetail({
  ticket,
  campusName,
  onBack,
  onToast,
  canEdit = false,
  onEdited,
  onDeleted,
  onChanged,
  actorUid,
  canResolve = false,
  startEditing = false,
  triageActions,
}: {
  ticket: Ticket;
  campusName: string;
  onBack: () => void;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  /** Người xem có phải là phía trường sở hữu phiếu không. */
  canEdit?: boolean;
  onEdited?: () => void;
  /** Xoá xong thì quay về danh sách — phiếu này không còn tồn tại để hiện. */
  onDeleted?: () => void;
  /** Đổi trạng thái xong thì nạp lại danh sách bên ngoài. */
  onChanged?: () => void;
  actorUid?: string;
  /** Phía PTUD: được đánh dấu phiếu đã xử lý xong. */
  canResolve?: boolean;
  /** Vào thẳng chế độ sửa, khi người dùng chọn "Sửa yêu cầu" từ danh sách. */
  startEditing?: boolean;
  /**
   * Khe cho các thao tác tiếp nhận (tiếp nhận / hỏi thêm / từ chối).
   *
   * Là một khe (slot) chứ không phải cờ bật-tắt: TicketDetail được dựng từ CẢ
   * HAI phía — màn của trường lẫn màn của PTUD. Nếu component này tự quyết định
   * khi nào hiện nút tiếp nhận, nó sẽ phải biết vai trò người xem, phạm vi dự
   * án, danh sách cán bộ, lịch làm việc — tức là kéo nguyên nửa module hỗ trợ
   * vào một màn vốn chỉ để ĐỌC. Bên gọi biết ngữ cảnh, bên gọi truyền vào.
   */
  triageActions?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [verdict, setVerdict] = useState<'resolve' | 'reopen' | null>(null);
  const [verdictText, setVerdictText] = useState('');
  const [busy, setBusy] = useState(false);

  async function chay(
    fn: () => Promise<{ ok: boolean; error: { kind?: string; message?: string } | null }>,
    ok: string
  ) {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) {
        onToast(
          r.error?.kind === 'denied'
            ? 'Bạn không có quyền thao tác này.'
            : `Không lưu được (${r.error?.message ?? 'lỗi mạng'})`,
          'error'
        );
        return;
      }
      onToast(ok, 'success');
      setVerdict(null);
      setVerdictText('');
      onChanged?.();
    } catch (e: any) {
      onToast(e instanceof DomainError ? e.message : 'Không lưu được', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Giá trị khởi tạo của useState chỉ chạy MỘT lần. Mở phiếu A rồi mở phiếu B
  // bằng "Sửa yêu cầu" thì component không dựng lại, nên không có effect này
  // phiếu B sẽ mở ở chế độ xem. Cố ý không phụ thuộc vào ticket object: sau khi
  // lưu, phiếu được nạp lại và effect sẽ bật lại chế độ sửa vừa đóng.
  useEffect(() => { setEditing(startEditing); setConfirmDelete(false); }, [ticket.id, startEditing]);

  async function handleDelete() {
    setDeleting(true);
    try {
      const { ok, error } = await deleteTicket({ ticket });
      if (!ok) {
        onToast(
          error?.kind === 'denied'
            ? 'Bạn không có quyền xoá yêu cầu này.'
            : `Không xoá được (${error?.message ?? 'lỗi mạng'})`,
          'error'
        );
        return;
      }
      onToast(`Đã xoá yêu cầu ${ticket.ticketNo}`, 'success');
      onDeleted?.();
    } catch (e: any) {
      onToast(e instanceof DomainError ? e.message : 'Không xoá được', 'error');
    } finally {
      setDeleting(false);
    }
  }
  const stepIndex = STEPS.findIndex((s) => s.status === ticket.status);
  // Cửa sổ sửa đóng lại khi phiếu được tiếp nhận.
  const editable = canEdit && canCampusEdit(ticket);
  // Trạng thái rẽ ngang / lùi lại (từ chối, trùng, mở lại, cần bổ sung) không
  // nằm trên đường thẳng. Stepper tuyến tính không có từ vựng cho chúng, nên
  // hiện bằng banner riêng thay vì vẽ sai.
  const offTrack = stepIndex === -1;

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={ICON.md} /> Quay lại danh sách
      </button>

      <Card className="p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs font-bold text-slate-500">{ticket.ticketNo}</span>
          <Badge variant="neutral">{campusName}</Badge>
          <Badge variant={ticket.scope === 'SYSTEM_WIDE' ? 'sky' : 'neutral'}>
            {ticket.scope === 'SYSTEM_WIDE' ? 'Toàn hệ thống' : 'Nội bộ trường'}
          </Badge>
          {ticket.priority && <Badge variant="primary">{ticket.priority}</Badge>}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => {
              navigator.clipboard?.writeText(
                `${window.location.origin}?ticket=${ticket.ticketNo}`
              );
              onToast('Đã sao chép link phiếu', 'success');
            }}
          >
            <Copy size={ICON.sm} /> Link
          </Button>
        </div>

        <h1 className="mt-3 text-lg font-bold text-slate-900">{ticket.title}</h1>

        {/* Trạng thái sửa: nói rõ CÒN sửa được hay ĐÃ khoá, và vì sao. Không có
            dòng này thì người dùng thấy nút biến mất mà không hiểu tại sao. */}
        {canEdit && (
          editable ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2">
              <Pencil size={ICON.sm} className="shrink-0 text-indigo-500" />
              <span className="flex-1 text-xs text-indigo-800">
                Phiếu đang chờ tiếp nhận — bạn còn sửa được nội dung.
              </span>
              {!editing && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    <Pencil size={ICON.sm} /> Sửa phiếu
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setConfirmDelete(true)}>
                    <Trash2 size={ICON.sm} /> Xoá
                  </Button>
                </>
              )}
            </div>
          ) : (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2">
              <Lock size={ICON.sm} className="shrink-0 text-slate-400" />
              <span className="text-xs text-slate-600">
                Phiếu đã được tiếp nhận nên không sửa được nữa. Cần bổ sung thông tin thì liên hệ
                đầu mối xử lý.
              </span>
            </div>
          )
        )}

        {/* Đầu mối báo đã xử lý xong. Dừng ở "đã khắc phục" chứ không đóng
            luôn: người sửa lỗi không phải người biết lỗi đã hết hay chưa. */}
        {canResolve && ['ACCEPTED', 'IN_PROGRESS', 'REOPENED', 'ON_HOLD'].includes(ticket.status) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5">
            <CheckCircle2 size={ICON.md} className="shrink-0 text-emerald-600" />
            <span className="flex-1 text-xs text-emerald-900">
              Xử lý xong thì báo lại để trường vào xác nhận.
            </span>
            <Button size="sm" disabled={busy}
              onClick={() => chay(
                () => resolveTicket({ ticket, actorUid: actorUid ?? '' }),
                `Đã báo xử lý xong ${ticket.ticketNo}`
              )}>
              <CheckCircle2 size={ICON.sm} /> {busy ? 'Đang lưu…' : 'Đã xử lý xong'}
            </Button>
          </div>
        )}

        {/* Trường nghiệm thu. Hai lựa chọn, không có đường thứ ba. */}
        {canEdit && ticket.status === 'RESOLVED' && (
          <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="flex items-start gap-2 text-sm font-bold text-emerald-900">
              <CheckCircle2 size={ICON.md} className="mt-0.5 shrink-0" />
              Đội kỹ thuật báo đã xử lý xong
            </p>
            <p className="mt-1 pl-6 text-xs leading-relaxed text-emerald-800">
              Kiểm tra lại giúp. Hết lỗi thì xác nhận để đóng phiếu; còn lỗi thì mở lại,
              phiếu quay về đội xử lý kèm mô tả của bạn.
            </p>
            {verdict !== 'reopen' ? (
              <div className="mt-3 flex flex-wrap gap-2 pl-6">
                <Button size="sm" disabled={busy}
                  onClick={() => chay(
                    () => confirmTicketClosed({ ticket, actorUid: actorUid ?? '' }),
                    `Đã đóng ${ticket.ticketNo}. Cảm ơn bạn đã xác nhận.`
                  )}>
                  <CheckCircle2 size={ICON.sm} /> Đúng rồi, đóng phiếu
                </Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setVerdict('reopen')}>
                  <RotateCcw size={ICON.sm} /> Vẫn còn lỗi
                </Button>
              </div>
            ) : (
              <div className="mt-3 pl-6">
                <textarea
                  rows={2} autoFocus value={verdictText}
                  onChange={(e) => setVerdictText(e.target.value)}
                  placeholder="Còn lỗi ở đâu? Ví dụ: Vẫn không đăng nhập được trên máy của phòng 201."
                  className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  {verdictText.trim().length < 10
                    ? `Còn thiếu ${10 - verdictText.trim().length} ký tự`
                    : 'Đội xử lý sẽ đọc nguyên văn phần này.'}
                </p>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" variant="danger"
                    disabled={busy || verdictText.trim().length < 10}
                    onClick={() => chay(
                      () => reopenTicket({ ticket, actorUid: actorUid ?? '', reason: verdictText }),
                      `Đã mở lại ${ticket.ticketNo}`
                    )}>
                    <RotateCcw size={ICON.sm} /> Mở lại phiếu
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setVerdict(null)}>Huỷ</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Xác nhận xoá ngay tại chỗ, không dùng window.confirm: hộp thoại của
            trình duyệt không nói được mã phiếu lẫn hậu quả, và trên điện thoại
            nó hiện ra như một cảnh báo của hệ điều hành. */}
        {confirmDelete && (
          <div className="mt-3 rounded-lg border-2 border-red-200 bg-red-50 p-3">
            <p className="flex items-start gap-2 text-sm font-bold text-red-800">
              <AlertTriangle size={ICON.md} className="mt-0.5 shrink-0" />
              Xoá yêu cầu {ticket.ticketNo}?
            </p>
            <p className="mt-1 pl-6 text-xs leading-relaxed text-red-700">
              Yêu cầu sẽ bị xoá vĩnh viễn, không khôi phục được. Mã {ticket.ticketNo} cũng
              không cấp lại cho yêu cầu khác. Nếu chỉ cần sửa nội dung thì bấm “Sửa phiếu”.
            </p>
            <div className="mt-3 flex gap-2 pl-6">
              <Button size="sm" variant="danger" disabled={deleting} onClick={handleDelete}>
                <Trash2 size={ICON.sm} /> {deleting ? 'Đang xoá…' : 'Xoá vĩnh viễn'}
              </Button>
              <Button size="sm" variant="ghost" disabled={deleting} onClick={() => setConfirmDelete(false)}>
                Giữ lại
              </Button>
            </div>
          </div>
        )}

        {editing && (
          <div className="mt-3">
            <EditTicketPanel
              ticket={ticket}
              onCancel={() => setEditing(false)}
              onDone={() => { setEditing(false); onEdited?.(); }}
              onToast={onToast}
            />
          </div>
        )}

        {offTrack ? (
          <div className={cn(
            'mt-4 rounded-lg px-4 py-3',
            ticket.status === 'REJECTED' ? 'bg-red-50' : 'bg-amber-50'
          )}>
            <p className={cn(
              'flex items-center gap-1.5 text-sm font-bold',
              ticket.status === 'REJECTED' ? 'text-red-800' : 'text-amber-800'
            )}>
              {ticket.status === 'REJECTED'
                ? <XCircle size={ICON.md} />
                : <HelpCircle size={ICON.md} />}
              {vi.status[ticket.status]}
            </p>

            {/* Lý do hiện NGUYÊN VĂN, không tóm tắt. Đây là thứ duy nhất trả lời
                câu "vì sao phiếu của tôi bị từ chối" — và nếu không hiện ra thì
                cả bước bắt buộc nhập lý do ở màn tiếp nhận trở thành vô nghĩa. */}
            {ticket.status === 'REJECTED' && ticket.rejectionReason && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-red-500">
                  Lý do từ chối
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-red-900">
                  {ticket.rejectionReason}
                </p>
                <p className="mt-2 text-[11px] text-red-600">
                  Phiếu này đã đóng. Nếu vấn đề vẫn còn, hãy tạo phiếu mới kèm thông tin đã bổ sung.
                </p>
              </div>
            )}

            {ticket.status === 'NEEDS_INFO' && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                  Đội xử lý cần bạn bổ sung
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-amber-900">
                  {ticket.needsInfoRequest || 'Vui lòng bổ sung thêm thông tin cho phiếu này.'}
                </p>
                {canEdit && (
                  <p className="mt-2 text-[11px] text-amber-700">
                    Bấm “Sửa phiếu” bên dưới để bổ sung. Gửi xong, phiếu tự quay lại hàng đợi tiếp nhận.
                  </p>
                )}
              </div>
            )}

            {/* Phiếu bị mở lại: lý do trường viết ĐƯỢC LƯU nhưng trước đây
                không hiện ở đâu cả — nó nằm trong needsInfoRequest, mà khối
                bên trên chỉ vẽ khi status là NEEDS_INFO. Kỹ thuật viên mở
                phiếu ra chỉ thấy một ô vàng ghi "Mở lại", không biết còn lỗi
                ở đâu; nội dung chỉ tồn tại trong một thông báo chạy qua chuông. */}
            {ticket.status === 'REOPENED' && (
              <div className="mt-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
                  Trường báo vẫn còn lỗi
                  {ticket.reopenCount > 1 && ` · lần thứ ${ticket.reopenCount}`}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-amber-900">
                  {ticket.needsInfoRequest || 'Trường chưa nêu rõ còn lỗi ở đâu.'}
                </p>
                <p className="mt-2 text-[11px] text-amber-700">
                  Phiếu đã quay lại đội xử lý. Làm lại rồi bấm “Đã xử lý xong” để trường kiểm tra tiếp.
                </p>
              </div>
            )}

            {ticket.status === 'DUPLICATE' && (
              <p className="mt-1 text-sm text-amber-900">Phiếu này trùng với một phiếu khác đã được ghi nhận.</p>
            )}
          </div>
        ) : (
          <ol className="mt-4 flex items-center gap-1">
            {STEPS.map((s, i) => (
              <li key={s.status} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={
                    i <= stepIndex
                      ? 'h-1.5 w-full rounded-full bg-indigo-500'
                      : 'h-1.5 w-full rounded-full bg-slate-200'
                  }
                />
                <span
                  className={
                    i <= stepIndex
                      ? 'text-[10px] font-semibold text-indigo-600'
                      : 'text-[10px] text-slate-400'
                  }
                >
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        )}

        {/* Thao tác tiếp nhận.
            Vị trí có cân nhắc: SAU thanh tiến trình để tiêu đề và trạng thái
            phiếu dính liền nhau thành một khối "phiếu này là gì, đang ở đâu";
            TRƯỚC khối thông tin để người đã đọc từ hàng đợi không phải cuộn
            hết trang mới thấy nút.
            Lúc chưa bấm gì nó chỉ là ba cái nút — không chiếm chỗ của nội dung. */}
        {triageActions && <div className="mt-5">{triageActions}</div>}

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          {/* Phân hệ hiện kèm icon giống hệt trong các bảng danh sách — cùng
              một khái niệm thì phải mang cùng một hình ở mọi màn. */}
          <div>
            <dt className="text-[13px] tracking-[-0.01em] text-slate-400">Phân hệ</dt>
            <dd className="mt-0.5"><ModuleCell code={ticket.moduleId} /></dd>
          </div>
          {/* Nhãn có màu thay cho chữ trần: đây là trường quyết định phiếu có
              hạn hoàn thành theo SLA hay không (§7 — đề xuất chỉ có SLA phản
              hồi), nên nó phải nhìn ra ngay giữa một khối chữ xám. */}
          <div>
            <dt className="text-[13px] tracking-[-0.01em] text-slate-400">Loại</dt>
            <dd className="mt-1"><TypeBadge type={ticket.type} /></dd>
          </div>
          <Field label="Gửi lúc" value={fmt(ticket.createdAt)} />
          {/* Hạn: nói rõ "chưa xác định" thay vì để trống. Phiếu tiếp nhận mà
              chưa chốt được lịch vẫn phải cho trường biết ước lượng bao lâu. */}
          <Field
            label={vi.list.due}
            value={
              ticket.dueAt
                ? fmt(ticket.dueAt)
                : ticket.estimateDays > 0
                  ? `Chưa xác định · dự kiến ${ticket.estimateDays} ngày làm việc`
                  : '—'
            }
          />
          {ticket.affectedCampusIds.length > 1 && (
            <Field
              label="Số trường bị ảnh hưởng"
              value={`${ticket.affectedCampusIds.length} trường`}
            />
          )}
          {ticket.reopenCount > 0 && (
            <Field label="Số lần mở lại" value={String(ticket.reopenCount)} />
          )}
        </dl>

        {ticket.description && (
          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-500">Mô tả</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{ticket.description}</p>
          </div>
        )}
        {/* Ba ô này TRƯỚC ĐÂY KHÔNG ĐƯỢC HIỆN Ở ĐÂU CẢ: form hỏi, người dùng
            điền, rồi không ai đọc được. Kỹ thuật viên mất đúng phần giá trị nhất
            của một phiếu báo lỗi — đã thử gì và kết quả ra sao. */}
        {ticket.expectedResult && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Đã làm gì</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{ticket.expectedResult}</p>
          </div>
        )}
        {ticket.actualResult && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Thực tế ra gì</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{ticket.actualResult}</p>
          </div>
        )}
        {ticket.stepsToReproduce && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-slate-500">Các bước tái hiện</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">
              {ticket.stepsToReproduce}
            </p>
          </div>
        )}

        {/* Đầu mối liên hệ — thứ kỹ thuật viên cần đầu tiên khi có câu hỏi. */}
        {(ticket.contactName || ticket.contactEmail) && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-500">Đầu mối hỗ trợ tại trường</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              {ticket.contactName && (
                <span className="flex items-center gap-1.5 text-slate-800">
                  <UserRound size={ICON.sm} className="text-slate-400" />
                  {ticket.contactName}
                </span>
              )}
              {ticket.contactEmail && (
                <a
                  href={`mailto:${ticket.contactEmail}?subject=${encodeURIComponent(`[${ticket.ticketNo}] ${ticket.title}`)}`}
                  className="flex items-center gap-1.5 text-indigo-600 hover:underline"
                >
                  <Mail size={ICON.sm} />
                  {ticket.contactEmail}
                </a>
              )}
            </div>
          </div>
        )}

        {/* Tiến độ đọc THẲNG từ task đã gắn, không sao chép sang phiếu.
            Sao chép thì phải đồng bộ hai chiều, và mọi lỗi đồng bộ đều biểu
            hiện thành "trường nhìn thấy tiến độ sai" mà không ai phát hiện. */}
        {ticket.linkedTaskId && <TaskProgress ticket={ticket} canOpenTask={canResolve} />}

        {ticket.attachments?.length > 0 && <AttachmentGallery paths={ticket.attachments} />}

        {/* Trao đổi nằm NGAY DƯỚI nội dung phiếu, trước phần thông tin thiết bị:
            người mở phiếu ra là để biết "chuyện này tới đâu rồi", mà câu trả lời
            cho điều đó nằm ở dòng trao đổi cuối cùng chứ không nằm ở trạng thái. */}
        <TicketThread ticket={ticket} actorUid={actorUid} onToast={onToast} />

        {(ticket.deviceOs || ticket.deviceBrowser) && (
          <p className="mt-4 text-[11px] text-slate-400">
            Thiết bị: {ticket.deviceOs} · {ticket.deviceBrowser}
          </p>
        )}
      </Card>
    </div>
  );
}

/**
 * Hiển thị ảnh đính kèm.
 *
 * Tải qua getBlob (xem services/attachmentUpload.ts) chứ KHÔNG dùng
 * getDownloadURL: link của getDownloadURL là vĩnh viễn và ai cầm cũng mở được,
 * kể cả người ngoài trường. Ảnh lỗi rất dễ chứa thông tin học sinh nên phải đi
 * qua storage.rules với danh tính của người đang xem.
 */
/** Ánh xạ trạng thái task của module Công việc sang chữ người dùng cuối hiểu. */
const TASK_STATUS_VI: Record<string, string> = {
  pending: 'Chờ duyệt',
  todo: 'Đã tiếp nhận, chờ xử lý',
  'in-progress': 'Đang xử lý',
  review: 'Chờ nghiệm thu',
  done: 'Đã hoàn thành',
  rejected: 'Bị từ chối',
  overdue: 'Quá hạn',
};

function TaskProgress({ ticket, canOpenTask }: { ticket: Ticket; canOpenTask?: boolean }) {
  const [task, setTask] = useState<LinkedTask | null | 'loading'>('loading');

  useEffect(() => {
    let alive = true;
    void fetchLinkedTask(ticket).then(({ task: t }) => alive && setTask(t));
    return () => { alive = false; };
  }, [ticket]);

  if (task === 'loading') {
    return <div className="mt-4 h-16 animate-pulse rounded-lg bg-slate-100" />;
  }
  // Không có task (chưa tiếp nhận, hoặc người xem không đọc được project) thì
  // không vẽ khối rỗng gây hiểu nhầm là "tiến độ 0%".
  if (!task) return null;

  const pct = Math.max(0, Math.min(100, task.progress));
  return (
    <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
      <div className="flex items-center gap-1.5">
        <Activity size={ICON.sm} className="text-sky-600" />
        <span className="text-xs font-semibold text-sky-900">Tiến độ xử lý</span>
        <span className="ml-auto text-xs font-bold text-sky-900">{pct}%</span>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-sky-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <p className="text-[11px] text-sky-800">
          {TASK_STATUS_VI[task.status] ?? task.status}
          {task.date && ` · hạn ${task.date.split('-').reverse().slice(0, 2).join('/')}`}
        </p>
        {/* Đường sang công việc. Chỉ hiện cho người CÓ mục Công việc: cán bộ
            trường không có mục đó, đưa nút sang một màn họ không vào được là
            hứa một thứ không tồn tại. */}
        {canOpenTask && ticket.linkedProjectId && ticket.linkedTaskId && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('fsc:open-task', {
              detail: { projectId: ticket.linkedProjectId, taskId: ticket.linkedTaskId },
            }))}
            className="ml-auto inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-sky-700 transition-colors hover:bg-sky-50"
          >
            <ExternalLink size={ICON.xs} /> Mở công việc
          </button>
        )}
      </div>
    </div>
  );
}


function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      {/* Cùng một kiểu nhãn với hai <dt> viết tay ở khối trên — trước đây khối
          này có BA kiểu nhãn khác nhau đứng cạnh nhau trong cùng một <dl>. */}
      <dt className="text-[13px] tracking-[-0.01em] text-slate-400">{label}</dt>
      <dd className="mt-1 font-semibold text-slate-800">{value}</dd>
    </div>
  );
}
