import { AlertCircle, AlertTriangle, ArrowLeft, Camera, FileText, Layers, Send, UserRound } from 'lucide-react';
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
import {
  DomainError,
  type ImpactScale,
  type SupportModuleCode,
  type Ticket,
  type TicketAttachment,
} from '../../types';

// ===========================================================================
// Form BÁO LỖI.
//
// Thứ tự các ô bám theo đúng cách người đang gấp kể chuyện, không theo cấu trúc
// database: chuyện gì xảy ra -> ở đâu -> ảnh -> chi tiết -> ai liên hệ.
//
// Ảnh đặt NGAY sau tiêu đề chứ không giấu dưới cùng: nó là thứ trả lời "lỗi
// trông thế nào" nhanh hơn mọi đoạn mô tả, và là lý do chính khiến phiếu có giá
// trị hơn một tin nhắn Zalo.
// ===========================================================================

interface Draft extends Record<string, unknown> {
  moduleId: string;
  title: string;
  description: string;
  stepsToReproduce: string;
  expectedResult: string;
  actualResult: string;
  impactScale: string;
  hasWorkaround: boolean;
  affectedUserRef: string;
  errorCode: string;
  contactName: string;
  contactEmail: string;
}

const EMPTY: Draft = {
  moduleId: '', title: '', description: '', stepsToReproduce: '',
  expectedResult: '', actualResult: '', impactScale: '', hasWorkaround: false,
  affectedUserRef: '', errorCode: '', contactName: '', contactEmail: '',
};

function detectDevice() {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android'
    : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux' : 'Không rõ';
  const browser = /Zalo/i.test(ua) ? 'Zalo webview' : /EdgA?\//.test(ua) ? 'Edge'
    : /CriOS|Chrome/.test(ua) ? 'Chrome' : /FxiOS|Firefox/.test(ua) ? 'Firefox'
    : /Safari/.test(ua) ? 'Safari' : 'Không rõ';
  return { os, browser, ua };
}

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

export function BugReportForm({
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
    // Điền sẵn đầu mối bằng chính người đang đăng nhập: phần lớn trường hợp
    // người báo lỗi cũng là người sẽ được liên hệ lại.
    () => ({ ...EMPTY, contactName: defaultContact.name, contactEmail: defaultContact.email }),
    [defaultContact.name, defaultContact.email]
  );
  const { draft, patch, clear, restored, dismissRestoredNotice } = useTicketDraft<Draft>(
    `${campusId}:bug`, initial
  );
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
  const [created, setCreated] = useState<Ticket | null>(null);

  const device = useMemo(detectDevice, []);
  // Id tạm cho thư mục ảnh, sinh TRƯỚC khi phiếu tồn tại. Ảnh phải tải lên được
  // trong lúc người dùng còn đang điền, không thể chờ có ticketId.
  const draftId = useMemo(
    () => `${reporterUserId}-${Date.now().toString(36)}`,
    [reporterUserId]
  );

  // Phân hệ đang bật, đọc từ Firestore — admin thêm phân hệ mới thì nó
  // hiện ra ngay ở đây mà không phải sửa code.
  const phanHe = useSupportModules().active;

  const dup = useDuplicateCheck({
    moduleId: (draft.moduleId || null) as SupportModuleCode | null,
    title: draft.title,
    description: draft.description,
    enabled: !created,
  });

  // Đã tự tay xác nhận "đây là vấn đề khác" chưa. Đặt lại mỗi khi tập ứng viên
  // đổi: xác nhận cho một phiếu trùng cũ không được tính cho phiếu trùng mới.
  const [dupAcked, setDupAcked] = useState(false);
  const dupKey = dup.candidates.map((c) => c.item.id).join(',');
  useEffect(() => { setDupAcked(false); }, [dupKey]);
  // Chỉ chặn khi giống >= 75%. Dưới ngưỡng đó là gợi ý, không phải rào.
  const blockedByDup = hasStrongDuplicate(dup.candidates) && !dupAcked;
  const dupRef = useRef<HTMLDivElement | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    if (!draft.moduleId) return setFormError('Chưa chọn phân hệ gặp lỗi');
    if (draft.title.trim().length < 10) return setFormError('Tiêu đề cần ít nhất 10 ký tự');

    const errs: { name?: string; email?: string } = {};
    if (!draft.contactName.trim()) errs.name = 'Chưa nhập họ tên đầu mối';
    if (!draft.contactEmail.trim()) errs.email = 'Chưa nhập email đầu mối';
    else if (!isValidFptEmail(draft.contactEmail)) errs.email = 'Phải là email @fpt.edu.vn hoặc @fe.edu.vn';
    if (Object.keys(errs).length) {
      setFieldErrors(errs);
      return setFormError('Thiếu thông tin đầu mối hỗ trợ');
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
      const ticket = await createTicket({
        type: 'BUG',
        moduleId: draft.moduleId as SupportModuleCode,
        subFeature: '', campusId, reporterUserId, campusContactUserId: null,
        title: draft.title, description: draft.description,
        stepsToReproduce: draft.stepsToReproduce,
        expectedResult: draft.expectedResult, actualResult: draft.actualResult,
        hasWorkaround: draft.hasWorkaround,
        impactScale: (draft.impactScale || null) as ImpactScale | null,
        affectedUserRef: draft.affectedUserRef, errorCode: draft.errorCode,
        deviceOs: device.os, deviceBrowser: device.browser, appVersion: device.ua.slice(0, 200),
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
        // SLA phản hồi đầu chưa biết chính xác vì độ ưu tiên do đầu mối đặt lúc
        // triage. Nói khoảng chắc chắn đúng còn hơn hứa một con số rồi sai.
        slaText="Trong vòng 1 ngày làm việc"
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
        <h2 className="text-lg font-bold text-slate-900">Báo lỗi</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Càng nhiều thông tin, kỹ thuật viên càng sửa nhanh. Ảnh chụp lỗi là thứ hữu ích nhất.
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
            title="Lỗi nằm ở phân hệ nào?"
            description="Chọn đúng phân hệ để phiếu tới thẳng người phụ trách."
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
            icon={<AlertCircle size={ICON.lg} />} tone="red" required
            title="Chuyện gì xảy ra?"
            description="Viết như đang nhắn cho đồng nghiệp. Có dấu hay không dấu đều được."
          >
            <input
              value={draft.title}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Ví dụ: Không điểm danh được lớp 3A"
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
          </FormSection>

          {/* Ảnh đặt ngay sau tiêu đề — đây là thứ giá trị nhất của phiếu. */}
          <FormSection
            icon={<Camera size={ICON.lg} />} tone="amber"
            title="Ảnh chụp lỗi"
            description="Vui lòng che thông tin cá nhân của học sinh và phụ huynh trong ảnh (họ tên, số điện thoại, địa chỉ) trước khi tải lên."
          >
            <AttachmentUploader
              campusId={campusId} draftId={draftId} uploaderUid={reporterUserId}
              mode="image" onChange={setAttachments}
            />
          </FormSection>

          <FormSection
            icon={<UserRound size={ICON.lg} />} tone="sky" required
            title="Đầu mối hỗ trợ tại trường"
            description="Người kỹ thuật viên sẽ liên hệ khi cần hỏi thêm về lỗi này. Có thể là chính bạn."
          >
            <ContactFields
              name={draft.contactName} email={draft.contactEmail}
              onChange={(p) => patch(p as Partial<Draft>)} errors={fieldErrors}
            />
          </FormSection>

          <button
            type="button" onClick={() => setShowDetails((v) => !v)}
            className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <FileText size={ICON.lg} />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-bold text-slate-900">Mô tả chi tiết hơn</span>
              <span className="block text-[11px] text-slate-500">
                Không bắt buộc, nhưng càng rõ thì sửa càng nhanh
              </span>
            </span>
            <span className={cn('text-slate-400 transition-transform', showDetails && 'rotate-180')}>▾</span>
          </button>

          {showDetails && (
            <div className="space-y-3 rounded-xl border border-slate-200 p-4">
              {/* Nhãn và gợi ý khớp CHÍNH XÁC với khung sửa phiếu. Hai màn hỏi
                  cùng một thứ bằng hai câu khác nhau thì người dùng tưởng là hai
                  câu hỏi khác nhau và điền hai kiểu. */}
              {([
                ['description', 'Mô tả kỹ hơn', 'Kể lại như đang nhắn cho đồng nghiệp.'],
                ['expectedResult', 'Đã làm gì', 'Ví dụ: Clear cache, đổi trình duyệt, reset mật khẩu…'],
                ['actualResult', 'Thực tế ra gì', 'Ví dụ: Vẫn không đăng nhập được, lỗi quay vòng…'],
                ['stepsToReproduce', 'Các bước tái hiện (nếu có)', '1. Truy cập…\n2. Nhập tài khoản…\n3. Bấm đăng nhập…\n→ Kết quả: …'],
              ] as const).map(([field, label, hint]) => (
                <label key={field} className="block">
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  <textarea
                    rows={field === 'stepsToReproduce' ? 4 : 2}
                    value={String(draft[field] ?? '')}
                    placeholder={hint}
                    onChange={(e) => patch({ [field]: e.target.value } as Partial<Draft>)}
                    className="mt-1 w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
                  />
                </label>
              ))}

              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Bao nhiêu người bị ảnh hưởng</span>
                <select
                  value={draft.impactScale}
                  onChange={(e) => patch({ impactScale: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                >
                  <option value="">— Chọn —</option>
                  <option value="LT_10">Dưới 10 người</option>
                  <option value="FROM_10_TO_100">10 đến 100 người</option>
                  <option value="GT_100">Trên 100 người</option>
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox" checked={draft.hasWorkaround}
                  onChange={(e) => patch({ hasWorkaround: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Đã có cách làm tạm thay thế
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-slate-700">
                  Mã học sinh / mã nhân viên bị ảnh hưởng
                </span>
                <input
                  value={draft.affectedUserRef}
                  onChange={(e) => patch({ affectedUserRef: e.target.value })}
                  placeholder="HS2026001"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="mt-1 block text-[11px] font-medium text-amber-600">
                  CHỈ nhập mã. Không nhập họ tên, số điện thoại hay địa chỉ (Nghị định 13/2023).
                </span>
              </label>

              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Mã lỗi hiện trên màn hình</span>
                <input
                  value={draft.errorCode}
                  onChange={(e) => patch({ errorCode: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>

              <p className="text-[11px] text-slate-400">
                Thiết bị được điền tự động: {device.os} · {device.browser}
              </p>
            </div>
          )}

          {formError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
          )}

          {/* Nút khoá lại khi có phiếu giống >= 75% mà chưa ai đọc. Nói rõ vì
              sao khoá ngay cạnh nút — nút mờ không lời giải thích là cách nhanh
              nhất khiến người dùng nghĩ hệ thống hỏng. */}
          {blockedByDup && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={ICON.md} className="mt-0.5 shrink-0" />
              Có yêu cầu rất giống đã tồn tại. Xem phần cảnh báo phía trên rồi tích xác nhận,
              hoặc bấm “Trường tôi cũng gặp lỗi này” để theo dõi phiếu đã có.
            </p>
          )}

          <Button type="submit" disabled={submitting || blockedByDup} className="w-full">
            <Send size={ICON.md} />
            {submitting ? 'Đang gửi…' : 'Gửi báo lỗi'}
          </Button>
        </form>
      </div>
    </div>
  );
}
