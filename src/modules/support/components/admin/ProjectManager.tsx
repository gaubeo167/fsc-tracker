import { collection, doc, getDocs, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { AlertTriangle, FolderGit2, Plus, Save, Users } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { db } from '../../../../firebase';
import { Badge, Button, Card, StateBlock, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import { fetchPtudStaff, fetchSupportModules } from '../../repository/userAdminRepository';
import { COL, SUPPORT_MODULES, type SupportModuleCode, type SupportModuleConfig } from '../../types';
import { useSupportModules } from '../../hooks/useSupportModules';

// ===========================================================================
// Dự án và phân hệ.
//
// Hướng gán: TẠO DỰ ÁN rồi chọn phân hệ liên quan — không phải vào từng phân hệ
// chọn dự án. Đây là cách nghĩ tự nhiên của người vận hành: dự án là thứ có
// thật, phân hệ là nhãn phân loại việc đổ vào nó.
//
// Lưu HAI chiều, và màn này là nơi duy nhất ghi cả hai:
//   projects/{id}.supportModules   -> dự án khai nó nhận phân hệ nào
//   support_modules/{code}.projectId -> phân hệ tra ngược ra dự án
//
// Vì sao cần chiều thứ hai: lúc tiếp nhận phiếu, hệ thống chỉ biết moduleId và
// phải ra ngay projectId để đặt task vào. Không có chiều tra ngược thì phải
// quét toàn bộ dự án mỗi lần tiếp nhận.
//
// MỘT phân hệ chỉ thuộc MỘT dự án. Nếu hai dự án cùng nhận một phân hệ thì lúc
// tiếp nhận không biết đặt task vào đâu — màn này cảnh báo và chuyển hẳn sang
// dự án vừa lưu.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

interface ProjectRow {
  id: string;
  name: string;
  description: string;
  managers: string[];
  members: string[];
  supportModules: string[];
  status: string;
}

/**
 * Chọn cán bộ và vai trò của họ trong dự án.
 *
 * Bấm vào tên = thêm/bỏ khỏi dự án. Bấm vào nhãn vai trò = đổi giữa Thành viên
 * và Quản lý. Hai việc này tách hẳn ra thay vì bấm-xoay-vòng ba trạng thái: xoay
 * vòng thì không ai đoán được bấm tiếp sẽ ra gì.
 */
function PeoplePicker({
  staff, selected, managers, onChange,
}: {
  staff: Array<{ uid: string; displayName: string }>;
  selected: string[];
  managers: string[];
  onChange: (next: { staff: string[]; mgrs: string[] }) => void;
}) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {staff.map((s) => {
        const inProject = selected.includes(s.uid);
        const isMgr = managers.includes(s.uid);
        return (
          <span
            key={s.uid}
            className={cn(
              'inline-flex items-center overflow-hidden rounded-full border text-xs font-medium transition-colors',
              inProject ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-slate-200 bg-white text-slate-600'
            )}
          >
            <button
              type="button"
              className="px-3 py-1.5"
              onClick={() =>
                onChange(
                  inProject
                    // Bỏ khỏi dự án thì mất luôn quyền quản lý — nếu không sẽ
                    // còn tên trong managers của một dự án mình không tham gia.
                    ? { staff: selected.filter((x) => x !== s.uid),
                        mgrs: managers.filter((x) => x !== s.uid) }
                    : { staff: [...selected, s.uid], mgrs: managers }
                )
              }
            >
              {s.displayName}
            </button>
            {inProject && (
              <button
                type="button"
                title="Đổi vai trò trong dự án"
                className={cn(
                  'border-l px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider',
                  isMgr ? 'border-indigo-200 bg-indigo-600 text-white'
                        : 'border-indigo-200 bg-white/70 text-slate-500'
                )}
                onClick={() =>
                  onChange({
                    staff: selected,
                    mgrs: isMgr ? managers.filter((x) => x !== s.uid) : [...managers, s.uid],
                  })
                }
              >
                {isMgr ? 'Quản lý' : 'Thành viên'}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

export function ProjectManager({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [modules, setModules] = useState<SupportModuleConfig[]>([]);
  const [staff, setStaff] = useState<Array<{ uid: string; displayName: string }>>([]);
  const [creating, setCreating] = useState(false);
  // staff = mọi người trong dự án; mgrs = tập con được làm quản lý dự án.
  // Tách ra vì quyền GÁN VIỆC cho người khác chỉ thuộc về managers.
  const [form, setForm] = useState({
    name: '', modules: [] as string[], staff: [] as string[], mgrs: [] as string[],
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  // Phân hệ đọc từ Firestore: dự án phải chọn được cả phân hệ admin vừa tạo.
  const { modules: phanHe, nameOf: tenPhanHe } = useSupportModules();
  const [edits, setEdits] =
    useState<Record<string, { modules: string[]; staff: string[]; mgrs: string[] }>>({});

  const reload = useCallback(async () => {
    const [mod, st] = await Promise.all([fetchSupportModules(), fetchPtudStaff()]);
    setModules(mod.modules);
    setStaff(st.staff);
    try {
      const snap = await getDocs(collection(db, 'projects'));
      setProjects(
        snap.docs.map((d) => {
          const x = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            name: String(x.name ?? d.id),
            description: String(x.description ?? ''),
            managers: (x.managers as string[]) ?? [],
            members: (x.members as string[]) ?? [],
            supportModules: (x.supportModules as string[]) ?? [],
            status: String(x.status ?? 'active'),
          };
        }).sort((a, b) => a.name.localeCompare(b.name, 'vi'))
      );
    } catch {
      setProjects([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** Phân hệ nào đang thuộc dự án nào — nguồn là support_modules.projectId. */
  const moduleOwnerProject = useMemo(
    () => Object.fromEntries(modules.map((m) => [m.code, m.projectId])),
    [modules]
  );

  /**
   * Ghi cả hai chiều. Phải làm cùng lúc, nếu không phân hệ trỏ về dự án cũ
   * trong khi dự án mới tưởng mình đang nhận phân hệ đó.
   */
  async function persist(
    projectId: string, moduleCodes: string[], staffUids: string[], mgrUids: string[], name?: string
  ) {
    // managers là TẬP CON của members. Trước đây hai trường này bằng nhau nên
    // mọi người trong dự án đều là quản lý — khi đó quy tắc "chỉ quản lý mới
    // gán việc cho người khác" không chặn được ai.
    const patch: Record<string, unknown> = {
      supportModules: moduleCodes,
      members: staffUids,
      managers: mgrUids.filter((u) => staffUids.includes(u)),
    };
    if (name) patch.name = name;
    await updateDoc(doc(db, 'projects', projectId), patch);

    // setDoc(merge) chứ KHÔNG phải updateDoc.
    //
    // updateDoc ném not-found khi document chưa tồn tại. Năm phân hệ mặc định
    // hiện ra trong giao diện là do hook rơi về danh sách trong code khi
    // collection còn rỗng — nên admin chọn được một phân hệ chưa từng có
    // document, bấm Lưu, và nhận "Không lưu được (not-found)" mà không hiểu vì
    // sao khi phân hệ đó đang hiện rành rành trước mắt.
    //
    // Gán phân hệ vào dự án chính là lúc hợp lý để tạo cấu hình của nó.
    for (const code of moduleCodes) {
      await setDoc(
        doc(db, COL.modules, code),
        {
          code,
          name: SUPPORT_MODULES.find((m) => m.code === code)?.name ?? code,
          projectId,
          isActive: true,
        },
        { merge: true }
      );
    }
    // Gỡ những phân hệ trước đây thuộc dự án này mà giờ bỏ chọn — nếu không
    // chúng vẫn trỏ về đây và phiếu tiếp tục chảy vào dự án đã bỏ nhận.
    for (const m of modules) {
      if (m.projectId === projectId && !moduleCodes.includes(m.code)) {
        await setDoc(doc(db, COL.modules, m.code), { projectId: null }, { merge: true });
      }
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) return setFormError('Chưa nhập tên dự án');
    if (form.modules.length === 0) return setFormError('Chọn ít nhất một phân hệ để dự án nhận yêu cầu');
    if (form.staff.length === 0) return setFormError('Chọn ít nhất một cán bộ phụ trách');
    if (form.mgrs.length === 0) {
      return setFormError(
        'Chọn ít nhất một quản lý dự án. Không có quản lý thì không ai gán được việc cho người khác.'
      );
    }

    setBusy('new');
    try {
      const ref = doc(collection(db, 'projects'));
      await setDoc(ref, {
        id: ref.id,
        name: form.name.trim(),
        description: `Dự án phụ trách: ${form.modules.map(tenPhanHe).join(', ')}`,
        managers: form.mgrs,
        members: form.staff,
        supportModules: form.modules,
        status: 'active',
        createdAt: serverTimestamp(),
      });
      await persist(ref.id, form.modules, form.staff, form.mgrs);
      onToast(`Đã tạo dự án ${form.name}`, 'success');
      setForm({ name: '', modules: [], staff: [], mgrs: [] });
      setCreating(false);
      await reload();
    } catch (err: any) {
      setFormError(`Không tạo được (${err?.code ?? 'lỗi'})`);
    } finally {
      setBusy(null);
    }
  }

  async function saveProject(p: ProjectRow) {
    const e = edits[p.id] ?? initialEdit(p);
    setBusy(p.id);
    if (e.mgrs.length === 0) {
      onToast('Dự án phải có ít nhất một quản lý dự án', 'error');
      setBusy(null);
      return;
    }
    try {
      await persist(p.id, e.modules, e.staff, e.mgrs);
      onToast(`Đã lưu ${p.name}`, 'success');
      setEdits((x) => { const n = { ...x }; delete n[p.id]; return n; });
      await reload();
    } catch (err: any) {
      onToast(`Không lưu được (${err?.code ?? 'lỗi'})`, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (projects === null) return <StateBlock kind="loading" />;

  const orphanModules = phanHe.filter((m) => m.isActive && !moduleOwnerProject[m.code]);

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  }

  /**
   * Dự án cũ được tạo khi managers == members, và có dự án chỉ có managers.
   * Lấy hợp của hai trường làm danh sách người, giữ managers làm tập quản lý.
   */
  function initialEdit(p: ProjectRow) {
    return {
      modules: p.supportModules,
      staff: [...new Set([...p.members, ...p.managers])],
      mgrs: p.managers,
    };
  }

  const chip = (active: boolean) =>
    cn(
      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
      active ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Dự án và phân hệ</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            Mỗi dự án khai nhận những phân hệ nào. Yêu cầu thuộc phân hệ đó sẽ sinh công việc trong dự án tương ứng.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          <Plus size={ICON.md} /> Tạo dự án
        </Button>
      </div>

      {orphanModules.length > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle size={ICON.md} className="mt-0.5 shrink-0" />
          <span>
            {orphanModules.length} phân hệ chưa thuộc dự án nào:{' '}
            <strong>{orphanModules.map((m) => m.name).join(', ')}</strong>. Yêu cầu thuộc các phân hệ
            này sẽ không tiếp nhận được vì công việc không có dự án để đưa vào.
          </span>
        </p>
      )}

      {creating && (
        <Card className="p-5">
          <form onSubmit={create} className="space-y-4">
            <label className="block">
              <span className="text-xs font-semibold text-slate-700">Tên dự án</span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ví dụ: Hệ thống Tài chính"
                autoFocus
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base focus:border-indigo-500 focus:outline-none"
              />
            </label>

            <div>
              <span className="text-xs font-semibold text-slate-700">Phân hệ liên quan</span>
              <p className="text-[11px] text-slate-400">
                Yêu cầu thuộc phân hệ được chọn sẽ đổ vào dự án này.
              </p>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {phanHe.map((m) => {
                  const taken = moduleOwnerProject[m.code];
                  const active = form.modules.includes(m.code);
                  return (
                    <button
                      key={m.code} type="button"
                      onClick={() => setForm({ ...form, modules: toggle(form.modules, m.code) })}
                      className={chip(active)}
                      title={taken ? 'Đang thuộc một dự án khác — chọn sẽ chuyển sang dự án này' : ''}
                    >
                      {m.name}
                      {taken && !active && <span className="ml-1 text-amber-500">•</span>}
                    </button>
                  );
                })}
              </div>
              {form.modules.some((c) => moduleOwnerProject[c]) && (
                <p className="mt-1.5 text-[11px] text-amber-600">
                  Phân hệ có dấu chấm đang thuộc dự án khác. Lưu sẽ chuyển hẳn sang dự án này —
                  một phân hệ chỉ thuộc một dự án.
                </p>
              )}
            </div>

            <div>
              <span className="text-xs font-semibold text-slate-700">
                <Users size={ICON.xs} className="mr-1 inline" /> Cán bộ phụ trách
              </span>
              <p className="text-[11px] text-slate-400">
                Một cán bộ có thể tham gia nhiều dự án khác nhau. Bấm vào tên để thêm, bấm nhãn
                bên phải để đổi giữa <strong>Thành viên</strong> và <strong>Quản lý</strong> —
                chỉ quản lý mới gán được việc cho người khác khi tiếp nhận yêu cầu.
              </p>
              <PeoplePicker
                staff={staff}
                selected={form.staff}
                managers={form.mgrs}
                onChange={(n) => setForm({ ...form, staff: n.staff, mgrs: n.mgrs })}
              />
            </div>

            {formError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{formError}</p>
            )}

            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy === 'new'}>
                {busy === 'new' ? 'Đang tạo…' : 'Tạo dự án'}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => setCreating(false)}>
                Huỷ
              </Button>
            </div>
          </form>
        </Card>
      )}

      <div className="space-y-3">
        {projects.length === 0 ? (
          <Card>
            <StateBlock
              kind="empty"
              title="Chưa có dự án nào"
              description="Tạo dự án đầu tiên và gán phân hệ để hệ thống biết đưa yêu cầu vào đâu."
            />
          </Card>
        ) : (
          projects.map((p) => {
            const e = edits[p.id] ?? initialEdit(p);
            const dirty = !!edits[p.id];
            return (
              <Card key={p.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <FolderGit2 size={ICON.md} className="text-slate-400" />
                  <h3 className="text-sm font-bold text-slate-900">{p.name}</h3>
                  <Badge variant={p.supportModules.length > 0 ? 'success' : 'neutral'}>
                    {p.supportModules.length > 0 ? `${p.supportModules.length} phân hệ` : 'Chưa gán phân hệ'}
                  </Badge>
                </div>

                <div className="mt-3">
                  <span className="text-[11px] font-semibold text-slate-600">Phân hệ liên quan</span>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {phanHe.map((m) => {
                      const other = moduleOwnerProject[m.code] && moduleOwnerProject[m.code] !== p.id;
                      return (
                        <button
                          key={m.code} type="button"
                          onClick={() =>
                            setEdits((x) => ({ ...x, [p.id]: { ...e, modules: toggle(e.modules, m.code) } }))
                          }
                          className={chip(e.modules.includes(m.code))}
                          title={other ? 'Đang thuộc dự án khác' : ''}
                        >
                          {m.name}
                          {other && !e.modules.includes(m.code) && <span className="ml-1 text-amber-500">•</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="mt-3">
                  <span className="text-[11px] font-semibold text-slate-600">Cán bộ phụ trách</span>
                  <PeoplePicker
                    staff={staff}
                    selected={e.staff}
                    managers={e.mgrs}
                    onChange={(n) =>
                      setEdits((x) => ({ ...x, [p.id]: { ...e, staff: n.staff, mgrs: n.mgrs } }))
                    }
                  />
                </div>

                {dirty && (
                  <div className="mt-3">
                    <Button size="sm" disabled={busy === p.id} onClick={() => saveProject(p)}>
                      <Save size={ICON.sm} /> {busy === p.id ? 'Đang lưu…' : 'Lưu thay đổi'}
                    </Button>
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      <p className="text-[11px] text-slate-400">
        Đầu mối tiếp nhận của từng phân hệ được gán ở tab Phân hệ.
      </p>
    </div>
  );
}
