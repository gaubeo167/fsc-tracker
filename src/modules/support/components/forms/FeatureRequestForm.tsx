import { AlertTriangle, ArrowLeft, Layers, Lightbulb, Paperclip, Send, TrendingUp, UserRound } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { useDuplicateCheck, type DuplicateCandidate } from '../../hooks/useDuplicateCheck';
import { useSupportModules } from '../../hooks/useSupportModules';
import { useTicketDraft } from '../../hooks/useTicketDraft';
import { createTicket } from '../../repository/ticketRepository';
import { AttachmentUploader } from '../AttachmentUploader';
import { DuplicatePanel, hasStrongDuplicate } from '../DuplicatePanel';
import { ContactFields, isValidFptEmail } from './ContactFields';
import { FormSection } from './FormSection';
import { SubmitSuccess } from './SubmitSuccess';
import { DomainError, type SupportModuleCode, type Ticket, type TicketAttachment } from '../../types';

// ===========================================================================
// Form ĐỀ XUẤT TÍNH NĂNG MỚI.
//
// Ngắn hơn hẳn form báo lỗi, và cố ý bỏ hết những ô không có nghĩa ở đây:
//   - không có ảnh chụp lỗi  (chưa có lỗi nào để chụp)
//   - không có "các bước tái hiện"  (chưa có gì để tái hiện)
//   - không có "đáng lẽ ra gì / thực tế ra gì"
//   - không có mã lỗi, không có thiết bị
//
// Đổi lại hỏi hai câu mà form báo lỗi không hỏi, và là hai câu quyết định đề
// xuất có được xếp vào kế hoạch hay không:
//   - hiện tại đang phải làm thế nào  (bối cảnh)
//   - có được thì tiết kiệm/cải thiện gì  (giá trị)
//
// Theo §7 spec, loại này KHÔNG có SLA hoàn thành — chỉ có SLA phản hồi 3 ngày
// làm việc, rồi gán target_quarter khi được duyệt.
// ===========================================================================

interface Draft extends Record<string, unknown> {
  moduleId: string;
  title: string;
  description: string;
  currentWorkaround: string;
  expectedBenefit: string;
  contactName: string;
  contactEmail: string;
}

const EMPTY: Draft = {
  moduleId: '', title: '', description: '', currentWorkaround: '',
  expectedBenefit: '', contactName: '', contactEmail: '',
};

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

export function FeatureRequestForm({
  campusId, reporterUserId, defaultContact, campusNames,
  onToast, onCreated, onMeToo, onBack, onBackToList,
}: {
  campusId: string;
  reporterUserId: string;
  defaultContact: { name: string; email: string };
  campusNames: Record<string, string>;
  onToast: Toast;
  onCreated: (t: Ticket) => void;
  onMeToo: (c: DuplicateCandidate) => Promise<void>;
  onBack: () => void;
  onBackToList: () => void;
}) {
  const initial = useMemo<Draft>(
    () => ({ ...EMPTY, contactName: defaultContact.name, contactEmail: defaultContact.email }),
    [defaultContact.name, defaultContact.email]
  );
  const { draft, patch, clear, restored, dismissRestoredNotice } = useTicketDraft<Draft>(
    `${campusId}:feature`, initial
  );
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
  const [created, setCreated] = useState<Ticket | null>(null);

  // Id tạm cho thư mục tài liệu, sinh trước khi phiếu tồn tại.
  const draftId = useMemo(() => `${reporterUserId}-${Date.now().toString(36)}`, [reporterUserId]);

  // Phân hệ đang bật, đọc từ Firestore — admin thêm phân hệ mới thì nó
  // hiện ra ngay ở đây mà không phải sửa code.
  const phanHe = useSupportModules().active;

  const dup = useDuplicateCheck({
    moduleId: (draft.moduleId || null) as SupportModuleCode | null,
    title: draft.title,
    description: draft.description,
    enabled: !created,
  });

  // Đề xuất tính năng trùng nhau còn hay hơn cả báo lỗi trùng: nhiều trường
  // cùng nghĩ ra một ý. Gộp lại thành một phiếu có nhiều trường theo dõi thì
  // mức độ ưu tiên mới phản ánh đúng nhu cầu thật.
  const [dupAcked, setDupAcked] = useState(false);
  const dupKey = dup.candidates.map((c) => c.item.id).join(',');
  useEffect(() => { setDupAcked(false); }, [dupKey]);
  const blockedByDup = hasStrongDuplicate(dup.candidates) && !dupAcked;
  const dupRef = useRef<HTMLDivElement | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!draft.moduleId) return setFormError('Chưa chọn phân hệ');
    if (draft.title.trim().length < 10) return setFormError('Tiêu đề cần ít nhất 10 ký tự');

    const errs: { name?: string; email?: string } = {};
    if (!draft.contactName.trim()) errs.name = 'Chưa nhập họ tên đầu mối';
    if (!draft.contactEmail.trim()) errs.email = 'Chưa nhập email đầu mối';
    else if (!isValidFptEmail(draft.contactEmail)) errs.email = 'Phải là email @fpt.edu.vn hoặc @fe.edu.vn';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return setFormError('Thiếu thông tin đầu mối');
    }


    // Khoá nút NGAY, trước cả lượt quét trùng.
    //
    // Lượt quét là một vòng mạng; nếu chỉ khoá sau nó thì trong suốt thời gian
    // chờ nút vẫn bấm được, và hai cú bấm liên tiếp tạo ra HAI phiếu thật với
    // hai mã khác nhau — cấp số nằm trong transaction nên không có gì chặn lại.
    setSubmitting(true);

    // Quét trùng LẦN CUỐI ngay tại nút gửi.
    //
    // Bản quét theo nhịp gõ không đủ: gõ xong bấm gửi trong vòng 600ms, hoặc
    // dán cả tiêu đề vào rồi bấm luôn, thì lượt quét chưa kịp chạy và phiếu
    // trùng lọt qua không ai hay. Lượt quét ở đây chặn đúng khoảnh khắc tạo.
    if (!dupAcked) {
      const found = await dup.recheck();
      if (hasStrongDuplicate(found)) {
        setFormError(
          'Yêu cầu này gần như trùng với yêu cầu đã có. Xem phần cảnh báo ngay dưới ô tiêu đề: '
          + 'bấm “Trường tôi cũng gặp lỗi này” để theo dõi phiếu đã có, hoặc tích xác nhận đây là vấn đề khác.'
        );
        dupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setSubmitting(false);
        return;
      }
    }

    try {
      // Gộp bối cảnh và giá trị vào description để không phải thêm field mới
      // vào model chỉ dùng cho một loại phiếu. Đầu mối đọc vẫn thấy đủ ý.
      const description = [
        draft.description.trim(),
        draft.currentWorkaround.trim() && `\n\nHiện tại đang phải làm:\n${draft.currentWorkaround.trim()}`,
        draft.expectedBenefit.trim() && `\n\nCó được thì sẽ cải thiện:\n${draft.expectedBenefit.trim()}`,
      ].filter(Boolean).join('');

      const ticket = await createTicket({
        type: 'FEATURE_REQUEST',
        moduleId: draft.moduleId as SupportModuleCode,
        subFeature: '', campusId, reporterUserId, campusContactUserId: null,
        title: draft.title, description,
        contactName: draft.contactName, contactEmail: draft.contactEmail,
        attachments,
      });
      clear();
      setCreated(ticket);
      onCreated(ticket);
    } catch (err: any) {
      setFormError(
        err instanceof DomainError ? err.message : `Không gửi được. Thử lại sau ít phút. (${err?.code ?? 'UNKNOWN'})`
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    return (
      <SubmitSuccess
        ticket={created}
        slaText="Trong vòng 3 ngày làm việc"
        onToast={onToast}
        onAnother={() => setCreated(null)}
        onBackToList={onBackToList}
      />
    );
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft size={ICON.md} /> Chọn lại loại yêu cầu
      </button>

      <div>
        <h2 className="text-lg font-bold text-slate-900">Đề xuất tính năng mới</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Mô tả việc bạn đang phải làm thủ công và mong muốn hệ thống làm giúp.
        </p>

        {restored && (
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
            <span className="flex-1">Đã khôi phục nội dung bạn gõ dở lần trước</span>
            <button type="button" onClick={dismissRestoredNotice} className="font-semibold underline">OK</button>
            <button type="button" onClick={clear} className="font-semibold text-sky-600 underline">Bỏ nháp</button>
          </div>
        )}

        <form onSubmit={submit} className="mt-4 space-y-4">
          <FormSection
            icon={<Layers size={ICON.lg} />} tone="slate" required
            title="Đề xuất cho phân hệ nào?"
            description="Chọn đúng phân hệ để đề xuất tới thẳng người phụ trách."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {phanHe.map((m) => (
                <button
                  key={m.code} type="button" onClick={() => patch({ moduleId: m.code })}
                  className={cn(
                    'rounded-lg border px-3 py-3 text-left text-sm font-medium transition-colors',
                    draft.moduleId === m.code
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  )}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </FormSection>

          <FormSection
            icon={<Lightbulb size={ICON.lg} />} tone="indigo" required
            title="Bạn muốn hệ thống làm được gì?"
            description="Mô tả tính năng mong muốn, càng cụ thể càng dễ ước lượng."
          >
            <input
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Ví dụ: Xuất danh sách học sinh nghỉ học theo tuần"
              className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-indigo-500 focus:outline-none"
            />
            <div ref={dupRef}>
              <DuplicatePanel
                candidates={dup.candidates} state={dup.state} campusNames={campusNames}
                onDismiss={() => {}}
                acknowledged={dupAcked}
                onAcknowledge={setDupAcked}
                onMeToo={async (c) => { await onMeToo(c); clear(); }}
              />
            </div>
            <textarea
              rows={3} value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Tính năng nên hoạt động thế nào, ai sẽ dùng nó"
              className="w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </FormSection>

          <FormSection
            icon={<TrendingUp size={ICON.lg} />} tone="emerald"
            title="Bối cảnh và giá trị"
            description="Hai câu này quyết định đề xuất được xếp vào kế hoạch quý nào."
          >
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">
                Hiện tại bạn đang phải làm thế nào?
              </span>
              <textarea
                rows={2} value={draft.currentWorkaround}
                onChange={(e) => patch({ currentWorkaround: e.target.value })}
                placeholder="Ví dụ: Đang phải lọc tay trên Excel, mỗi tuần mất khoảng 2 tiếng"
                className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">
                Có tính năng này thì cải thiện được gì?
              </span>
              <textarea
                rows={2} value={draft.expectedBenefit}
                onChange={(e) => patch({ expectedBenefit: e.target.value })}
                placeholder="Ví dụ: Tiết kiệm 2 tiếng mỗi tuần cho giáo vụ, giảm sai sót nhập tay"
                className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </label>
          </FormSection>

          <FormSection
            icon={<Paperclip size={ICON.lg} />} tone="sky"
            title="Ảnh minh hoạ hoặc tài liệu"
            description="Tải file lên, hoặc gửi link nếu tài liệu đã có sẵn trên Google Docs, Drive, Figma."
          >
            <AttachmentUploader
              campusId={campusId} draftId={draftId} uploaderUid={reporterUserId}
              mode="imageAndDocument" onChange={setAttachments}
            />
          </FormSection>

          <FormSection
            icon={<UserRound size={ICON.lg} />} tone="amber" required
            title="Đầu mối trao đổi tại trường"
            description="Người đội kỹ thuật sẽ liên hệ khi cần làm rõ đề xuất. Có thể là chính bạn."
          >
            <ContactFields
              name={draft.contactName} email={draft.contactEmail}
              onChange={(p) => patch(p as Partial<Draft>)} errors={fieldErrors}
            />
          </FormSection>

          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
          )}

          {blockedByDup && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={ICON.md} className="mt-0.5 shrink-0" />
              Có đề xuất rất giống đã tồn tại. Xem phần cảnh báo phía trên rồi tích xác nhận,
              hoặc bấm “Trường tôi cũng gặp lỗi này” để cùng theo dõi đề xuất đã có.
            </p>
          )}

          <Button type="submit" disabled={submitting || blockedByDup} className="w-full">
            <Send size={ICON.md} />
            {submitting ? 'Đang gửi…' : 'Gửi đề xuất'}
          </Button>
        </form>
      </div>
    </div>
  );
}
