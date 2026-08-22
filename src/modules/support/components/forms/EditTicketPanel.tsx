import {
  AlertCircle, Bug, Camera, FileText, Hash, Info, ListOrdered, Save, UserRound, Users, X,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { AttachmentUploader } from '../AttachmentUploader';
import { updateTicketContent } from '../../repository/ticketRepository';
import { ContactFields, isValidFptEmail } from './ContactFields';
import { DomainError, type ImpactScale, type Ticket, type TicketAttachment } from '../../types';

// ===========================================================================
// Sửa nội dung phiếu khi CHƯA được tiếp nhận.
//
// Cửa sổ sửa đóng lại ngay khi đầu mối bấm tiếp nhận: từ lúc đó người xử lý đã
// đọc phiếu và bắt đầu làm theo nội dung cũ. Cho sửa tiếp là để nội dung trôi
// khỏi thứ mà kỹ thuật viên đang dựa vào — họ sửa một lỗi, người báo lại đổi
// mô tả thành lỗi khác.
//
// Bố cục theo đúng thứ tự người ta nghĩ khi kể lại một sự cố:
//   chuyện gì -> kể chi tiết -> đã thử gì / thực tế ra sao -> tái hiện thế nào
//   -> ai liên hệ -> ảnh
// Ô nào cũng có nhãn nhìn thấy được và icon dẫn; ô bắt buộc có dấu sao đỏ.
//
// Ảnh và tài liệu đã tải lên KHÔNG gỡ ra được ở đây: storage.rules cấm xoá file
// (ảnh là bằng chứng của phiếu). Chỉ thêm được file mới.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

/** Một lớp ô nhập cho MỌI ô trong form — cao bằng nhau, viền như nhau. */
const O_NHAP =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none';

const MO_TA_TOI_DA = 2000;

/** Nhãn ô nhập: icon + chữ + dấu sao nếu bắt buộc. */
function Nhan({
  icon, children, bat,
}: {
  icon?: React.ReactNode; children: React.ReactNode; bat?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
      {icon && <span className="text-slate-400">{icon}</span>}
      {children}
      {bat && <span className="text-red-500" aria-hidden>*</span>}
    </span>
  );
}

export function EditTicketPanel({
  ticket, onDone, onCancel, onToast,
}: {
  ticket: Ticket;
  onDone: () => void;
  onCancel: () => void;
  onToast: Toast;
}) {
  const [form, setForm] = useState({
    title: ticket.title,
    description: ticket.description,
    stepsToReproduce: ticket.stepsToReproduce,
    expectedResult: ticket.expectedResult,
    actualResult: ticket.actualResult,
    impactScale: ticket.impactScale ?? '',
    hasWorkaround: ticket.hasWorkaround,
    affectedUserRef: ticket.affectedUserRef,
    errorCode: ticket.errorCode,
    contactName: ticket.contactName,
    contactEmail: ticket.contactEmail,
  });
  // Giữ nguyên file cũ, chỉ nối thêm file mới. Không cho gỡ vì storage.rules
  // cấm xoá, gỡ khỏi danh sách sẽ để lại file mồ côi trong bucket.
  const [newAttachments, setNewAttachments] = useState<TicketAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});

  const isBug = ticket.type === 'BUG';
  const draftId = useMemo(() => `${ticket.id}-edit-${Date.now().toString(36)}`, [ticket.id]);

  function patch(p: Partial<typeof form>) {
    setForm((f) => ({ ...f, ...p }));
  }

  async function save() {
    setError(null);
    setFieldErrors({});

    if (form.title.trim().length < 10) return setError('Tiêu đề cần ít nhất 10 ký tự');
    const errs: { name?: string; email?: string } = {};
    if (!form.contactName.trim()) errs.name = 'Chưa nhập họ tên đầu mối';
    if (!form.contactEmail.trim()) errs.email = 'Chưa nhập email đầu mối';
    else if (!isValidFptEmail(form.contactEmail)) errs.email = 'Phải là email @fpt.edu.vn hoặc @fe.edu.vn';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return setError('Thiếu thông tin đầu mối');
    }

    setSaving(true);
    try {
      const { ok, error: repoError } = await updateTicketContent(ticket, {
        ...form,
        impactScale: (form.impactScale || null) as ImpactScale | null,
        attachments: [...(ticket.attachments ?? []), ...newAttachments],
      });
      if (!ok) {
        setError(
          repoError?.kind === 'denied'
            ? 'Phiếu đã được tiếp nhận nên không sửa được nữa. Tải lại trang để xem trạng thái mới.'
            : `Không lưu được (${repoError?.message ?? 'lỗi mạng'})`
        );
        return;
      }
      onToast('Đã cập nhật phiếu', 'success');
      onDone();
    } catch (err: any) {
      setError(err instanceof DomainError ? err.message : 'Không lưu được. Thử lại sau ít phút.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-slate-900">Sửa nội dung phiếu</h3>
          <p className="mt-0.5 text-xs text-slate-500">Chỉ sửa được khi phiếu chưa được tiếp nhận.</p>
        </div>
        <button
          onClick={onCancel}
          aria-label="Đóng khung sửa"
          className="rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <X size={ICON.lg} />
        </button>
      </div>

      {/* Hàng 1: tiêu đề chiếm nửa, hai ô phân loại ngắn đứng cạnh — chúng ngắn
          thật, cho mỗi ô một hàng riêng chỉ làm form dài thêm vô ích. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-4">
        <label className="block lg:col-span-2">
          <Nhan icon={<FileText size={ICON.sm} />} bat>Tiêu đề</Nhan>
          <input
            value={form.title}
            onChange={(e) => patch({ title: e.target.value })}
            placeholder="Ví dụ: Không điểm danh được lớp 3A"
            className={O_NHAP}
          />
        </label>

        {isBug ? (
          <>
            <label className="block">
              <Nhan icon={<Users size={ICON.sm} />}>Số người ảnh hưởng</Nhan>
              <select
                value={form.impactScale}
                onChange={(e) => patch({ impactScale: e.target.value })}
                className={O_NHAP}
              >
                <option value="">— Chọn —</option>
                <option value="LT_10">Dưới 10 người</option>
                <option value="FROM_10_TO_100">10 đến 100 người</option>
                <option value="GT_100">Trên 100 người</option>
              </select>
            </label>
            <label className="block">
              <Nhan icon={<Hash size={ICON.sm} />}>Mã lỗi</Nhan>
              <input
                value={form.errorCode}
                onChange={(e) => patch({ errorCode: e.target.value })}
                placeholder="Nhập mã lỗi (nếu có)"
                className={cn(O_NHAP, 'font-mono')}
              />
            </label>
          </>
        ) : (
          <label className="block lg:col-span-2">
            <Nhan icon={<Users size={ICON.sm} />}>Số người hưởng lợi</Nhan>
            <select
              value={form.impactScale}
              onChange={(e) => patch({ impactScale: e.target.value })}
              className={O_NHAP}
            >
              <option value="">— Chọn —</option>
              <option value="LT_10">Dưới 10 người</option>
              <option value="FROM_10_TO_100">10 đến 100 người</option>
              <option value="GT_100">Trên 100 người</option>
            </select>
          </label>
        )}
      </div>

      <label className="mt-4 block">
        <Nhan icon={<AlertCircle size={ICON.sm} />} bat>Mô tả</Nhan>
        <textarea
          rows={4}
          maxLength={MO_TA_TOI_DA}
          value={form.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="Kể lại như đang nhắn cho đồng nghiệp. Có dấu hay không dấu đều được."
          className={cn(O_NHAP, 'resize-y')}
        />
        <span className="mt-1 block text-right text-[11px] tabular-nums text-slate-400">
          {form.description.length}/{MO_TA_TOI_DA}
        </span>
      </label>

      {isBug && (
        <>
          <div className="mt-2 grid gap-4 lg:grid-cols-2">
            <label className="block">
              {/* Nhãn là "đã làm gì", KHÔNG phải "đáng lẽ phải ra gì": người ở
                  trường không phát biểu được kỳ vọng của hệ thống, nhưng kể
                  được mình đã thử những cách nào. Khoá lưu trong Firestore vẫn
                  là expectedResult — đổi tên khoá là việc di trú dữ liệu, chưa
                  làm ở đây. */}
              <Nhan icon={<UserRound size={ICON.sm} />}>Đã làm gì</Nhan>
              <textarea
                rows={3}
                value={form.expectedResult}
                onChange={(e) => patch({ expectedResult: e.target.value })}
                placeholder="Ví dụ: Clear cache, đổi trình duyệt, reset mật khẩu…"
                className={cn(O_NHAP, 'resize-y')}
              />
            </label>
            <label className="block">
              <Nhan icon={<Bug size={ICON.sm} />}>Thực tế ra gì</Nhan>
              <textarea
                rows={3}
                value={form.actualResult}
                onChange={(e) => patch({ actualResult: e.target.value })}
                placeholder="Ví dụ: Vẫn không đăng nhập được, lỗi quay vòng…"
                className={cn(O_NHAP, 'resize-y')}
              />
            </label>
          </div>

          <label className="mt-4 block">
            <Nhan icon={<ListOrdered size={ICON.sm} />}>Các bước tái hiện (nếu có)</Nhan>
            <textarea
              rows={4}
              value={form.stepsToReproduce}
              onChange={(e) => patch({ stepsToReproduce: e.target.value })}
              placeholder={'1. Truy cập…\n2. Nhập tài khoản…\n3. Bấm đăng nhập…\n→ Kết quả: …'}
              className={cn(O_NHAP, 'resize-y')}
            />
          </label>
        </>
      )}

      <div className="mt-4">
        <Nhan icon={<UserRound size={ICON.sm} />} bat>Đầu mối hỗ trợ</Nhan>
        <div className="mt-1">
          <ContactFields
            name={form.contactName} email={form.contactEmail}
            onChange={(p) => patch(p as Partial<typeof form>)} errors={fieldErrors}
          />
        </div>
      </div>

      {isBug && (
        <label className="mt-4 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox" checked={form.hasWorkaround}
            onChange={(e) => patch({ hasWorkaround: e.target.checked })}
            className="h-4 w-4 rounded border-slate-300 accent-indigo-600"
          />
          Đã có cách làm tạm thay thế
          <span title="Có cách nào khác để làm tiếp công việc trong lúc chờ sửa không. Có thì phiếu bớt gấp hơn.">
            <Info size={ICON.sm} className="text-slate-300" />
          </span>
        </label>
      )}

      <div className="mt-4">
        <Nhan icon={<Camera size={ICON.sm} />}>
          Bổ sung {isBug ? 'ảnh' : 'ảnh hoặc tài liệu'} (nếu có)
        </Nhan>
        <p className="mt-0.5 text-[11px] text-slate-400">
          {(ticket.attachments ?? []).length > 0
            ? `${(ticket.attachments ?? []).length} mục đã gửi trước đó được giữ nguyên, không gỡ ra được.`
            : 'Chưa có mục nào.'}
        </p>
        <div className="mt-1.5">
          <AttachmentUploader
            campusId={ticket.campusId} draftId={draftId} uploaderUid={ticket.reporterUserId}
            mode={isBug ? 'image' : 'imageAndDocument'}
            onChange={setNewAttachments}
          />
        </div>
      </div>

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
          <AlertCircle size={ICON.md} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <div className="mt-5 flex gap-2">
        <Button disabled={saving} onClick={save}>
          <Save size={ICON.md} /> {saving ? 'Đang lưu…' : 'Lưu thay đổi'}
        </Button>
        <Button variant="outline" onClick={onCancel}>Huỷ</Button>
      </div>
    </div>
  );
}
