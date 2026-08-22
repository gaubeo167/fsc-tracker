import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Copy, Download, HelpCircle, RotateCcw, XCircle, ExternalLink, FileSpreadsheet, FileText, FileType, ImageIcon, Link2, Lock, Mail, Paperclip, Pencil, Trash2, UserRound } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { downloadAttachment, loadAttachmentUrl } from '../services/attachmentUpload';
import {
  canCampusEdit, confirmTicketClosed, deleteTicket, fetchLinkedTask, reopenTicket,
  resolveTicket, type LinkedTask,
} from '../repository/ticketRepository';
import { EditTicketPanel } from './forms/EditTicketPanel';
import { Badge, Button, Card, cn } from '../../../components/ui';
import { ICON, ModuleCell } from '../ui/tokens';
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

        <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
          {/* Phân hệ hiện kèm icon giống hệt trong các bảng danh sách — cùng
              một khái niệm thì phải mang cùng một hình ở mọi màn. */}
          <div>
            <dt className="text-[11px] uppercase tracking-wide text-slate-400">Phân hệ</dt>
            <dd className="mt-0.5"><ModuleCell code={ticket.moduleId} /></dd>
          </div>
          <Field label="Loại" value={ticket.type === 'BUG' ? vi.ticket.typeBug : vi.ticket.typeFeature} />
          <Field label="Gửi lúc" value={fmt(ticket.createdAt)} />
          <Field label={vi.list.due} value={fmt(ticket.dueAt)} />
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

function typeIcon(contentType: string) {
  const c = 'h-5 w-5';
  if (contentType === 'text/uri-list') return <Link2 className={`${c} text-sky-500`} />;
  if (contentType.startsWith('image/')) return <ImageIcon className={`${c} text-emerald-500`} />;
  if (contentType === 'application/pdf') return <FileType className={`${c} text-red-500`} />;
  if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType === 'text/csv')
    return <FileSpreadsheet className={`${c} text-emerald-600`} />;
  return <FileText className={`${c} text-indigo-500`} />;
}

function AttachmentGallery({ paths }: { paths: Ticket['attachments'] }) {
  const [urls, setUrls] = useState<Record<string, string | 'error'>>({});
  // Link không cần tải gì; chỉ file mới phải lấy blob qua storage.rules.
  const files = paths.filter((a) => a.kind !== 'link');
  const links = paths.filter((a) => a.kind === 'link');
  const images = files.filter((a) => a.contentType.startsWith('image/'));
  const docs = files.filter((a) => !a.contentType.startsWith('image/'));

  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all(
      images.map(async (a) => {
        try {
          const url = await loadAttachmentUrl(a.path);
          if (!alive) { URL.revokeObjectURL(url); return; }
          made.push(url);
          setUrls((p) => ({ ...p, [a.path]: url }));
        } catch {
          if (alive) setUrls((p) => ({ ...p, [a.path]: 'error' }));
        }
      })
    );
    return () => {
      alive = false;
      // Thu hồi object URL, nếu không mỗi lần mở phiếu là rò bộ nhớ bằng đúng
      // tổng dung lượng ảnh.
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  return (
    <div className="mt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <Paperclip size={ICON.sm} /> Đính kèm ({paths.length})
      </p>

      {images.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((a) => {
            const u = urls[a.path];
            return (
              <li key={a.path} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                {u === 'error' ? (
                  <div className="flex h-full items-center justify-center p-2 text-center text-[10px] leading-tight text-amber-600">
                    Không xem được ảnh này
                  </div>
                ) : u ? (
                  <>
                    <a href={u} target="_blank" rel="noreferrer" title="Xem ảnh gốc">
                      <img src={u} alt={a.name} className="h-full w-full object-cover" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void downloadAttachment(a.path, a.name)}
                      title={`Tải về: ${a.name}`}
                      className="absolute bottom-1 right-1 rounded-md bg-slate-900/70 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      <Download size={ICON.sm} />
                    </button>
                  </>
                ) : (
                  <div className="h-full w-full animate-pulse bg-slate-200" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(docs.length > 0 || links.length > 0) && (
        <ul className="mt-2 space-y-1.5">
          {docs.map((a) => (
            <li key={a.path} className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-2">
              {typeIcon(a.contentType)}
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{a.name}</span>
              <span className="shrink-0 text-[11px] text-slate-400">
                {a.sizeBytes < 1024 * 1024
                  ? `${Math.round(a.sizeBytes / 1024)} KB`
                  : `${(a.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
              </span>
              {/* Tài liệu không xem trực tiếp trong trang được (PDF/Word), nên
                  đường duy nhất để đọc chi tiết là tải về. */}
              <button
                type="button"
                onClick={() => void downloadAttachment(a.path, a.name)}
                title={`Tải về: ${a.name}`}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Download size={ICON.md} />
              </button>
            </li>
          ))}
          {links.map((a) => (
            <li key={a.url} className="flex items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-2">
              {typeIcon(a.contentType)}
              <a
                href={a.url}
                target="_blank"
                // noreferrer bắt buộc: thiếu nó thì trang đích đọc được
                // document.referrer và biết đường dẫn nội bộ của hệ thống.
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate text-sm text-sky-700 hover:underline"
              >
                {a.name}
              </a>
              <ExternalLink size={ICON.sm} className="shrink-0 text-sky-400" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-800">{value}</dd>
    </div>
  );
}
