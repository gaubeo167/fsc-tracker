import { Eye, FileText, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, StateBlock } from '../../../../components/ui';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import {
  createEmailTemplate,
  deleteEmailTemplate,
  updateEmailTemplate,
  watchEmailTemplates,
} from '../../repository/notifyRepository';
import { CHO_DIEN, choDienLa, dienMau } from '../../services/emailTemplate';
import { ICON } from '../../ui/tokens';
import { DomainError, type EmailTemplate } from '../../types';

// ===========================================================================
// Mẫu email.
//
// Người soạn mẫu là cán bộ nghiệp vụ, không phải lập trình viên. Nên chỗ điền
// động được CHÈN BẰNG NÚT chứ không bắt gõ tay đúng dấu ngoặc, và mọi chỗ điền
// gõ sai đều bị bêu ra ngay dưới ô nhập kèm hậu quả cụ thể: "người nhận sẽ thấy
// nguyên chữ này trong thư".
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

const O_NHAP =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

const DRAFT_RONG = { name: '', subject: '', body: '' };

export function EmailTemplateManager({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  const [rows, setRows] = useState<EmailTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<RepoError | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState(DRAFT_RONG);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [xemTruoc, setXemTruoc] = useState<string | null>(null);
  const oNoiDung = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return watchEmailTemplates(
      (data) => {
        setRows(data);
        setLoadError(null);
      },
      (err) => {
        setRows([]);
        setLoadError(err);
      }
    );
  }, []);

  const choDienSai = useMemo(
    () => choDienLa(`${draft.subject}\n${draft.body}`),
    [draft.subject, draft.body]
  );

  function moTao() {
    setEditing(null);
    setDraft(DRAFT_RONG);
    setFormError(null);
    setCreating(true);
  }

  function moSua(t: EmailTemplate) {
    setCreating(false);
    setFormError(null);
    setEditing(t.id);
    setDraft({ name: t.name, subject: t.subject, body: t.body });
  }

  function dong() {
    setCreating(false);
    setEditing(null);
    setDraft(DRAFT_RONG);
    setFormError(null);
  }

  /** Chèn chỗ điền vào ĐÚNG vị trí con trỏ, không phải nối vào cuối. */
  function chen(key: string) {
    const el = oNoiDung.current;
    const the = `{{${key}}}`;
    if (!el) {
      setDraft((d) => ({ ...d, body: d.body + the }));
      return;
    }
    const { selectionStart: a, selectionEnd: b } = el;
    const moi = draft.body.slice(0, a) + the + draft.body.slice(b);
    setDraft((d) => ({ ...d, body: moi }));
    // Đặt lại con trỏ sau chuỗi vừa chèn, để gõ tiếp được ngay.
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + the.length, a + the.length);
    });
  }

  async function luu(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (editing) {
        await updateEmailTemplate(editing, draft, actorUid);
      } else {
        await createEmailTemplate(draft, actorUid);
      }
      onToast(vi.notify.template.saved, 'success');
      dong();
    } catch (err: any) {
      setFormError(
        err instanceof DomainError ? err.message : `${vi.errors.saveFailed} (${err?.code ?? 'lỗi'})`
      );
    } finally {
      setBusy(false);
    }
  }

  async function xoa(t: EmailTemplate) {
    if (!window.confirm(vi.notify.template.confirmDelete(t.name))) return;
    setBusy(true);
    try {
      await deleteEmailTemplate(t.id);
      onToast(vi.notify.template.deleted, 'info');
    } catch (err: any) {
      onToast(`${vi.errors.saveFailed} (${err?.code ?? 'lỗi'})`, 'error');
    } finally {
      setBusy(false);
    }
  }

  const nguCanhMau = {
    recipient: { email: 'hieutruong.hn@fpt.edu.vn', name: 'Nguyễn Văn A' },
    senderName: 'Phòng Phát triển ứng dụng',
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{vi.notify.template.title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{vi.notify.template.subtitle}</p>
        </div>
        {!creating && !editing && (
          <Button size="sm" onClick={moTao}>
            <Plus size={ICON.md} />
            {vi.notify.template.addNew}
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <Card className="p-5">
          <form onSubmit={luu} className="space-y-3">
            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">{vi.notify.template.name}</span>
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                placeholder={vi.notify.template.nameHint}
                className={O_NHAP}
              />
            </label>

            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">
                {vi.notify.template.subject}
              </span>
              <input
                value={draft.subject}
                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                className={O_NHAP}
              />
            </label>

            <div>
              <span className="text-[11px] font-semibold text-slate-600">
                {vi.notify.template.placeholders}
              </span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {CHO_DIEN.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => chen(c.key)}
                    title={`${c.label} — ví dụ: ${c.vd}`}
                    className="rounded-full border border-slate-300 px-2.5 py-1 font-mono text-[11px] text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
                  >
                    {`{{${c.key}}}`}
                  </button>
                ))}
              </div>
              <span className="mt-1 block text-[11px] text-slate-400">
                {vi.notify.template.placeholdersHint}
              </span>
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">{vi.notify.template.body}</span>
              <textarea
                ref={oNoiDung}
                value={draft.body}
                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                rows={10}
                className={`${O_NHAP} text-[13px]`}
              />
              <span className="mt-1 block text-[11px] text-slate-400">{vi.notify.template.bodyHint}</span>
            </label>

            {choDienSai.length > 0 && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {vi.notify.template.unknownPlaceholder(choDienSai.map((k) => `{{${k}}}`).join(', '))}
              </p>
            )}

            {/* Xem trước ngay trong khung soạn: mẫu chỉ có nghĩa khi thấy nó
                sau khi đã điền, chứ không phải lúc còn đầy dấu ngoặc. */}
            {(draft.subject || draft.body) && (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  {vi.notify.template.preview}
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {dienMau(draft.subject, nguCanhMau)}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-600">
                  {dienMau(draft.body, nguCanhMau)}
                </p>
              </div>
            )}

            {formError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
            )}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                <Save size={ICON.md} />
                {busy ? vi.common.loading : vi.common.save}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={dong}>
                <X size={ICON.md} />
                {vi.common.cancel}
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {rows === null ? (
          <StateBlock kind="loading" />
        ) : loadError ? (
          <StateBlock
            kind={loadError.kind === 'denied' ? 'denied' : 'error'}
            description={
              loadError.kind === 'denied'
                ? vi.errors.permissionDeniedHint
                : `${vi.errors.loadFailed} — ${loadError.message}`
            }
          />
        ) : rows.length === 0 ? (
          <StateBlock
            kind="empty"
            title={vi.notify.template.empty}
            description={vi.notify.template.emptyHint}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => (
              <li key={t.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                    <FileText size={ICON.lg} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="truncate text-xs text-slate-500">{t.subject}</p>
                  </div>
                  <div className="flex gap-1">
                    {/* Xem trước và Xoá đều chỉ có icon — phải đặt tên, xem
                        ghi chú cùng chỗ ở NotifyGroupManager. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      title={`Xem trước mẫu ${t.name}`}
                      aria-label={`Xem trước mẫu ${t.name}`}
                      onClick={() => setXemTruoc(xemTruoc === t.id ? null : t.id)}
                    >
                      <Eye size={ICON.md} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => moSua(t)}>
                      <Pencil size={ICON.md} />
                      {vi.common.edit}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      title={`Xoá mẫu ${t.name}`}
                      aria-label={`Xoá mẫu ${t.name}`}
                      onClick={() => xoa(t)}
                    >
                      <Trash2 size={ICON.md} />
                    </Button>
                  </div>
                </div>

                {xemTruoc === t.id && (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3">
                    <Badge variant="neutral">{vi.notify.template.preview}</Badge>
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                      {dienMau(t.subject, nguCanhMau)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-slate-600">
                      {dienMau(t.body, nguCanhMau)}
                    </p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
