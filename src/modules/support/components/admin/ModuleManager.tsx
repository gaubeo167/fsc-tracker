import { AlertTriangle, FolderGit2, Layers, Pencil, Plus, Power, PowerOff, Save, X } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { collection, doc, getDocs, updateDoc } from 'firebase/firestore';
import { db } from '../../../../firebase';
import { Badge, Button, Card, StateBlock, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import type { RepoError } from '../../repository/campusRepository';
import {
  createSupportModule, fetchPtudStaff, fetchSupportModules,
  renameSupportModule, setSupportModuleActive,
} from '../../repository/userAdminRepository';
import { COL, DomainError, type SupportModuleConfig } from '../../types';

// ===========================================================================
// Cấu hình 5 phân hệ: ai phụ trách, và task sinh ra nằm ở dự án nào.
//
// Đây là màn PHẢI làm trước khi hệ thống chạy được. Chưa gán đầu mối thì phiếu
// không có ai tiếp nhận; chưa gán dự án thì tiếp nhận cũng không sinh task được
// vì task không có project để chui vào.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

interface ProjectRow { id: string; name: string }

export function ModuleManager({ onToast }: { onToast: Toast }) {
  const [modules, setModules] = useState<SupportModuleConfig[] | null>(null);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [staff, setStaff] = useState<Array<{ uid: string; displayName: string }>>([]);
  const [error, setError] = useState<RepoError | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Partial<SupportModuleConfig>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: '', name: '' });
  const [formError, setFormError] = useState<string | null>(null);
  /** Phân hệ nào đang đổi tên, và tên đang gõ. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setBusy('new');
    try {
      const code = await createSupportModule(form);
      onToast(`Đã tạo phân hệ ${code}`, 'success');
      setForm({ code: '', name: '' });
      setCreating(false);
      await reload();
    } catch (err: any) {
      setFormError(
        err instanceof DomainError ? err.message : `Không tạo được (${err?.code ?? 'lỗi'})`
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleRename(code: string) {
    setBusy(code);
    try {
      await renameSupportModule(code, newName);
      onToast(`Đã đổi tên ${code}`, 'success');
      setRenaming(null);
      await reload();
    } catch (err: any) {
      onToast(
        err instanceof DomainError ? err.message : `Không lưu được (${err?.code ?? 'lỗi'})`,
        'error'
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleToggleActive(m: SupportModuleConfig) {
    // Khoá như mọi nút ghi khác trong màn này. Thiếu khoá thì bấm hai nhát là
    // tắt rồi bật lại — hoặc hai lượt ghi ngược nhau cùng bay đi.
    setBusy(m.code);
    try {
      await setSupportModuleActive(m.code, !m.isActive);
      onToast(m.isActive ? `Đã tắt ${m.code}` : `Đã bật lại ${m.code}`, 'success');
      await reload();
    } catch (err: any) {
      onToast(`Không lưu được (${err?.code ?? 'lỗi'})`, 'error');
    } finally {
      setBusy(null);
    }
  }

  const reload = useCallback(async () => {
    const [mod, st] = await Promise.all([fetchSupportModules(), fetchPtudStaff()]);
    setModules(mod.modules);
    setStaff(st.staff);
    setError(mod.error ?? st.error);
    try {
      const snap = await getDocs(collection(db, 'projects'));
      setProjects(
        snap.docs
          .map((d) => ({ id: d.id, name: String((d.data() as any).name ?? d.id) }))
          .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      );
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  function valueOf(code: string, field: keyof SupportModuleConfig) {
    const d = drafts[code];
    if (d && field in d) return (d as any)[field] ?? '';
    const m = modules?.find((x) => x.code === code);
    return (m as any)?.[field] ?? '';
  }

  async function save(code: string) {
    setBusy(code);
    try {
      const patch = drafts[code] ?? {};
      await updateDoc(doc(db, COL.modules, code), {
        ownerUserId: (patch.ownerUserId ?? valueOf(code, 'ownerUserId')) || null,
        backupOwnerUserId: (patch.backupOwnerUserId ?? valueOf(code, 'backupOwnerUserId')) || null,
      });
      onToast(`Đã lưu cấu hình ${code}`, 'success');
      setDrafts((d) => ({ ...d, [code]: {} }));
      await reload();
    } catch (err: any) {
      onToast(`Không lưu được (${err?.code ?? 'lỗi'})`, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (modules === null) return <StateBlock kind="loading" />;
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

  const unconfigured = modules.filter((m) => !m.projectId || !m.ownerUserId).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <Layers size={ICON.xl} className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <h2 className="text-lg font-bold text-slate-900">Phân hệ hỗ trợ</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Đặt tên, gán đầu mối phụ trách, thêm phân hệ mới. Việc gán phân hệ vào dự án nằm ở tab Dự án.
            </p>
          </div>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus size={ICON.md} /> Thêm phân hệ
        </Button>
      </div>

      {creating && (
        <Card className="p-5">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Mã phân hệ</span>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="LIBRARY"
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono uppercase focus:border-indigo-500 focus:outline-none"
                />
                {/* Mã đi vào mã phiếu (FSC-LIBRARY-2608-0001) và vào bộ đếm số
                    phiếu, nên nó là vĩnh viễn. Nói trước, đừng để họ biết sau. */}
                <span className="mt-1 block text-[11px] text-slate-400">
                  Chữ in hoa, số, gạch dưới. Mã đi vào mã phiếu nên <strong>không đổi được</strong> sau khi tạo.
                </span>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-700">Tên phân hệ</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Hệ thống Thư viện"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="mt-1 block text-[11px] text-slate-400">
                  Tên hiện cho cán bộ trường lúc chọn phân hệ. Đổi lại được bất cứ lúc nào.
                </span>
              </label>
            </div>
            {formError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy === 'new'}>
                {busy === 'new' ? 'Đang tạo…' : 'Tạo phân hệ'}
              </Button>
              <Button type="button" size="sm" variant="outline"
                onClick={() => { setCreating(false); setFormError(null); }}>
                Huỷ
              </Button>
            </div>
          </form>
        </Card>
      )}

      {unconfigured > 0 && (
        <p className="flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={ICON.md} className="shrink-0" />
          {unconfigured} phân hệ chưa cấu hình xong. Phiếu thuộc phân hệ đó sẽ không tiếp nhận được.
        </p>
      )}

      <div className="space-y-3">
        {/* Lặp theo DỮ LIỆU Firestore, không phải mảng hằng trong code: phân hệ
            admin vừa tạo phải hiện ra ngay ở đây. */}
        {modules.map((m) => {
          const cfg = m;
          const ready = !!cfg?.projectId && !!cfg?.ownerUserId;
          const dirty = Object.keys(drafts[m.code] ?? {}).length > 0;
          const off = m.isActive === false;
          return (
            <Card key={m.code} className={cn('p-4', off && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-2">
                {renaming === m.code ? (
                  <>
                    <input
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      autoFocus
                      className="rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none"
                    />
                    <Button size="sm" disabled={busy === m.code} onClick={() => handleRename(m.code)}>
                      <Save size={ICON.sm} /> {busy === m.code ? 'Đang lưu…' : 'Lưu tên'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                      <X size={ICON.sm} />
                    </Button>
                  </>
                ) : (
                  <>
                    <h3 className="text-sm font-bold text-slate-900">{m.name}</h3>
                    <button
                      onClick={() => { setRenaming(m.code); setNewName(m.name); }}
                      title="Đổi tên phân hệ"
                      className="rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    >
                      <Pencil size={ICON.sm} />
                    </button>
                  </>
                )}
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-500">
                  {m.code}
                </span>
                <Badge variant={off ? 'neutral' : ready ? 'success' : 'warning'}>
                  {off ? 'Đã tắt' : ready ? 'Sẵn sàng' : 'Chưa cấu hình'}
                </Badge>
                <Button
                  size="sm" variant="ghost" className="ml-auto"
                  disabled={busy === m.code}
                  title={off ? 'Bật lại phân hệ' : 'Tắt phân hệ — trường sẽ không chọn được nữa'}
                  onClick={() => handleToggleActive(m)}
                >
                  {off ? <Power size={ICON.md} /> : <PowerOff size={ICON.md} />}
                </Button>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-600">Đầu mối chính</span>
                  <select
                    value={valueOf(m.code, 'ownerUserId')}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [m.code]: { ...d[m.code], ownerUserId: e.target.value } }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="">— Chưa gán —</option>
                    {staff.map((s) => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}
                  </select>
                </label>

                <label className="block">
                  <span className="text-[11px] font-semibold text-slate-600">Đầu mối dự phòng</span>
                  <select
                    value={valueOf(m.code, 'backupOwnerUserId')}
                    onChange={(e) =>
                      setDrafts((d) => ({ ...d, [m.code]: { ...d[m.code], backupOwnerUserId: e.target.value } }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                  >
                    <option value="">— Chưa gán —</option>
                    {staff.map((s) => <option key={s.uid} value={s.uid}>{s.displayName}</option>)}
                  </select>
                </label>

                {/* Dự án CHỈ ĐỌC ở đây. Việc gán phân hệ vào dự án nằm ở tab Dự án:
                    người vận hành nghĩ theo hướng "tạo dự án rồi chọn phân hệ",
                    không phải "vào từng phân hệ chọn dự án". Hai màn cùng ghi
                    một giá trị là công thức cho dữ liệu lệch nhau. */}
                <div className="block">
                  <span className="text-[11px] font-semibold text-slate-600">
                    <FolderGit2 size={ICON.xs} className="mr-0.5 inline" /> Dự án nhận yêu cầu
                  </span>
                  <p className="mt-1 rounded-lg bg-slate-50 px-2 py-2 text-sm text-slate-700">
                    {projects.find((p) => p.id === valueOf(m.code, 'projectId'))?.name ?? 'Chưa gán'}
                  </p>
                  <span className="mt-0.5 block text-[10px] text-slate-400">
                    Gán ở tab Dự án
                  </span>
                </div>
              </div>

              {dirty && (
                <div className="mt-3">
                  <Button size="sm" disabled={busy === m.code} onClick={() => save(m.code)}>
                    <Save size={ICON.sm} /> {busy === m.code ? 'Đang lưu…' : 'Lưu'}
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
