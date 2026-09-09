import { ChevronDown, Mail, Pencil, Plus, Save, Trash2, Users, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, StateBlock } from '../../../../components/ui';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import {
  createNotifyGroup,
  deleteNotifyGroup,
  updateNotifyGroup,
  watchNotifyGroups,
} from '../../repository/notifyRepository';
import { catTheoTran, docDanhSachNguoiNhan, gopNguoiNhan, moTaNguoiNhan } from '../../services/emailList';
import { ICON } from '../../ui/tokens';
import { DomainError, type NotifyGroup, type NotifyRecipient } from '../../types';

// ===========================================================================
// Nhóm nhận tin.
//
// Toàn bộ màn này chỉ để một việc: biến một cột email trong Excel thành một
// danh sách dùng lại được. Nên ô nhập là một textarea to, nhận mọi kiểu dán,
// và mọi thứ nó phải bỏ đi (dòng không phải email, địa chỉ trùng) đều được
// NÓI RA thành số. Im lặng bỏ bớt nghĩa là một hiệu trưởng không nhận được
// thông báo và không ai biết cho tới lúc quá muộn.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

const O_NHAP =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

interface Draft {
  name: string;
  description: string;
  text: string;
}

const DRAFT_RONG: Draft = { name: '', description: '', text: '' };

/** Danh sách người nhận đã dọn, kèm những gì đã bỏ đi để nói cho người dùng. */
function docDraft(text: string): {
  recipients: NotifyRecipient[];
  invalid: string[];
  trungBiBo: number;
  daCat: number;
} {
  const { recipients, invalid } = docDanhSachNguoiNhan(text);
  const gop = gopNguoiNhan([recipients]);
  const { recipients: cuoi, daCat } = catTheoTran(gop);
  return { recipients: cuoi, invalid, trungBiBo: recipients.length - gop.length, daCat };
}

export function NotifyGroupManager({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  const [rows, setRows] = useState<NotifyGroup[] | null>(null);
  const [loadError, setLoadError] = useState<RepoError | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(DRAFT_RONG);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [moRong, setMoRong] = useState<string | null>(null);

  useEffect(() => {
    return watchNotifyGroups(
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

  const doc = useMemo(() => docDraft(draft.text), [draft.text]);

  function moTao() {
    setEditing(null);
    setDraft(DRAFT_RONG);
    setFormError(null);
    setCreating(true);
  }

  function moSua(g: NotifyGroup) {
    setCreating(false);
    setFormError(null);
    setEditing(g.id);
    setDraft({
      name: g.name,
      description: g.description,
      // Mở ra đúng dạng người dùng đã quen nhìn, mỗi người một dòng.
      text: g.recipients.map(moTaNguoiNhan).join('\n'),
    });
  }

  function dong() {
    setCreating(false);
    setEditing(null);
    setDraft(DRAFT_RONG);
    setFormError(null);
  }

  async function luu(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy(true);
    try {
      if (editing) {
        await updateNotifyGroup(
          editing,
          { name: draft.name, description: draft.description, recipients: doc.recipients },
          actorUid
        );
      } else {
        await createNotifyGroup(
          { name: draft.name, description: draft.description, recipients: doc.recipients },
          actorUid
        );
      }
      onToast(vi.notify.group.saved, 'success');
      dong();
    } catch (err: any) {
      setFormError(
        err instanceof DomainError ? err.message : `${vi.errors.saveFailed} (${err?.code ?? 'lỗi'})`
      );
    } finally {
      setBusy(false);
    }
  }

  async function xoa(g: NotifyGroup) {
    if (!window.confirm(vi.notify.group.confirmDelete(g.name))) return;
    setBusy(true);
    try {
      await deleteNotifyGroup(g.id);
      onToast(vi.notify.group.deleted, 'info');
    } catch (err: any) {
      onToast(`${vi.errors.saveFailed} (${err?.code ?? 'lỗi'})`, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{vi.notify.group.title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{vi.notify.group.subtitle}</p>
        </div>
        {!creating && !editing && (
          <Button size="sm" onClick={moTao}>
            <Plus size={ICON.md} />
            {vi.notify.group.addNew}
          </Button>
        )}
      </div>

      {(creating || editing) && (
        <Card className="p-5">
          <form onSubmit={luu} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">{vi.notify.group.name}</span>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder={vi.notify.group.nameHint}
                  className={O_NHAP}
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-slate-600">
                  {vi.notify.group.description}
                </span>
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder={vi.notify.group.descriptionHint}
                  className={O_NHAP}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold text-slate-600">
                {vi.notify.group.recipients}
              </span>
              <textarea
                value={draft.text}
                onChange={(e) => setDraft({ ...draft, text: e.target.value })}
                rows={8}
                placeholder={'hieutruong.hn@fpt.edu.vn\nNguyen Van A <a@fpt.edu.vn>'}
                className={`${O_NHAP} font-mono text-[13px]`}
              />
              <span className="mt-1 block text-[11px] text-slate-400">
                {vi.notify.group.recipientsHint}
              </span>
            </label>

            {/* Mọi thứ bị bỏ đi đều thành một con số nhìn thấy được. */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant="info">{vi.notify.group.count(doc.recipients.length)}</Badge>
              {doc.trungBiBo > 0 && (
                <Badge variant="neutral">{vi.notify.group.duplicateRemoved(doc.trungBiBo)}</Badge>
              )}
              {doc.daCat > 0 && <Badge variant="warning">{vi.notify.group.trimmed(doc.daCat)}</Badge>}
              {doc.invalid.length > 0 && (
                <Badge variant="danger">{vi.notify.group.invalidFound(doc.invalid.length)}</Badge>
              )}
            </div>

            {doc.invalid.length > 0 && (
              <div className="rounded-lg bg-red-50 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-red-500">
                  {vi.notify.group.invalidList}
                </p>
                <p className="mt-1 break-words font-mono text-xs text-red-700">
                  {doc.invalid.slice(0, 20).join(' · ')}
                  {doc.invalid.length > 20 ? ' …' : ''}
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
            title={vi.notify.group.empty}
            description={vi.notify.group.emptyHint}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((g) => (
              <li key={g.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                    <Users size={ICON.lg} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{g.name}</p>
                    {g.description && (
                      <p className="truncate text-xs text-slate-500">{g.description}</p>
                    )}
                  </div>
                  <Badge variant="info">{vi.notify.group.count(g.recipients?.length ?? 0)}</Badge>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => moSua(g)}>
                      <Pencil size={ICON.md} />
                      {vi.common.edit}
                    </Button>
                    {/* Chỉ có icon, nên PHẢI có tên: trình đọc màn hình đọc ra
                        "button" trống, còn người nhìn thấy một thùng rác cạnh
                        nút Sửa mà không biết nó xoá cái gì. Nút một chiều thì
                        mơ hồ là đắt nhất. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      title={`Xoá nhóm ${g.name}`}
                      aria-label={`Xoá nhóm ${g.name}`}
                      onClick={() => xoa(g)}
                    >
                      <Trash2 size={ICON.md} />
                    </Button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setMoRong(moRong === g.id ? null : g.id)}
                  className="mt-2 flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                >
                  <ChevronDown
                    size={ICON.sm}
                    className={moRong === g.id ? 'rotate-180 transition-transform' : 'transition-transform'}
                  />
                  {moRong === g.id ? vi.notify.group.hideMembers : vi.notify.group.viewMembers}
                </button>

                {moRong === g.id && (
                  <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-lg bg-slate-50 px-3 py-2">
                    {(g.recipients ?? []).map((r) => (
                      <li key={r.email} className="flex items-center gap-2 text-xs text-slate-600">
                        <Mail size={ICON.xs} className="shrink-0 text-slate-300" />
                        <span className="truncate">{moTaNguoiNhan(r)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
