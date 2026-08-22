import { Building2, GraduationCap, MapPin, Pencil, Plus, Power, PowerOff, Save, Search, X } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, StateBlock } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { vi } from '../../i18n/vi';
import {
  createCampus,
  normalizeCampusCode,
  setCampusActive,
  updateCampus,
  watchCampuses,
  type RepoError,
} from '../../repository/campusRepository';
import { DomainError, type Campus } from '../../types';

// ===========================================================================
// Quản lý trường (SYS_ADMIN).
//
// Thay cho việc seed cứng 18 trường: danh sách và mã trường là dữ liệu nghiệp vụ
// chỉ phía trường chốt được, và nó sẽ đổi (mở trường mới, đổi tên, gộp).
// Seed cứng nghĩa là mỗi lần đổi phải sửa code và deploy lại.
// ===========================================================================

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

/** Một lớp ô nhập cho khung sửa — cao bằng nhau, viền như nhau. */
const O_NHAP =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';

/** Bỏ dấu tiếng Việt để tìm kiếm khớp cả khi gõ không dấu. */
function boDau(s: string): string {
  return s.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

export function CampusManager({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  const [rows, setRows] = useState<Campus[] | null>(null);
  const [loadError, setLoadError] = useState<RepoError | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    code: '', name: '', region: '', address: '', province: '', levels: '',
  });
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  /** Trường nào đang mở khung sửa, và nội dung đang sửa. */
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState({ name: '', region: '', address: '', province: '', levels: '' });
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    return watchCampuses(
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

  const activeCount = useMemo(() => (rows ?? []).filter((r) => r.isActive).length, [rows]);

  // Tìm không dấu, khớp cả mã, tên, địa chỉ, tỉnh. 18 cơ sở là đủ dài để phải
  // cuộn tìm, và địa chỉ mới là thứ người ta nhớ chứ không phải mã.
  const shown = useMemo(() => {
    const needle = boDau(q.trim());
    if (!needle) return rows ?? [];
    return (rows ?? []).filter((r) =>
      boDau(`${r.code} ${r.name} ${r.address ?? ''} ${r.province ?? ''} ${r.region}`).includes(needle)
    );
  }, [rows, q]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFieldError(null);
    setSaving(true);
    try {
      await createCampus(form, actorUid);
      onToast(`Đã thêm trường ${normalizeCampusCode(form.code)}`, 'success');
      setForm({ code: '', name: '', region: '', address: '', province: '', levels: '' });
      setShowForm(false);
    } catch (err: any) {
      // DomainError có thông điệp tiếng Việt viết sẵn cho người dùng.
      // Lỗi khác thì hiện kèm mã để ảnh chụp màn hình đủ làm bug report.
      if (err instanceof DomainError) {
        setFieldError(err.message);
      } else {
        setFieldError(`${vi.errors.saveFailed} (${err?.code ?? 'UNKNOWN'})`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEdit(row: Campus) {
    setSavingEdit(true);
    try {
      await updateCampus(row.id, edit);
      onToast(`Đã cập nhật ${row.code}`, 'success');
      setEditing(null);
    } catch (err: any) {
      onToast(
        err instanceof DomainError ? err.message : `${vi.errors.saveFailed} (${err?.code ?? 'UNKNOWN'})`,
        'error'
      );
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleToggle(row: Campus) {
    try {
      await setCampusActive(row.id, !row.isActive);
      onToast(row.isActive ? `Đã tắt trường ${row.code}` : `Đã bật lại trường ${row.code}`, 'success');
    } catch (err: any) {
      onToast(`${vi.errors.saveFailed} (${err?.code ?? 'UNKNOWN'})`, 'error');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">{vi.campus.title}</h2>
          <p className="mt-0.5 text-sm text-slate-500">{vi.campus.subtitle}</p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} size="sm">
          <Plus size={ICON.md} />
          {vi.campus.addNew}
        </Button>
      </div>

      {showForm && (
        <Card className="p-5">
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">{vi.campus.code}</span>
                <input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="HN01"
                  autoFocus
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase focus:border-indigo-500 focus:outline-none"
                />
                <span className="mt-1 block text-[11px] text-slate-400">{vi.campus.codeHint}</span>
              </label>
              <label className="block sm:col-span-2">
                <span className="text-xs font-semibold text-slate-700">{vi.campus.name}</span>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="FPT Schools Hà Nội"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <span className="mt-1 block text-[11px] text-slate-400">{vi.campus.nameHint}</span>
              </label>
            </div>

            <label className="block">
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                <MapPin size={ICON.sm} className="text-slate-400" /> Địa chỉ
              </span>
              <input
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                placeholder="Số 15 Đông Quan, Phường Nghĩa Đô"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Tỉnh/TP</span>
                <input
                  value={form.province}
                  onChange={(e) => setForm({ ...form, province: e.target.value })}
                  placeholder="Hà Nội"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  <GraduationCap size={ICON.sm} className="text-slate-400" /> Cấp học
                </span>
                <input
                  value={form.levels}
                  onChange={(e) => setForm({ ...form, levels: e.target.value })}
                  placeholder="TH, THCS, THPT"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">{vi.campus.region}</span>
                <input
                  value={form.region}
                  onChange={(e) => setForm({ ...form, region: e.target.value })}
                  placeholder="Miền Bắc"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>
            </div>

            {fieldError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{fieldError}</p>
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={saving} size="sm">
                {saving ? vi.common.loading : vi.common.save}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setShowForm(false);
                  setFieldError(null);
                }}
              >
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
          <StateBlock kind="empty" title={vi.campus.empty} description={vi.campus.emptyHint} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
              <Building2 size={ICON.sm} />
              <span>
                {rows.length} trường · {activeCount} đang hoạt động
                {q.trim() && ` · ${shown.length} khớp tìm kiếm`}
              </span>
              <div className="relative ml-auto">
                <Search size={ICON.sm} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Tìm mã, tên, địa chỉ, tỉnh…"
                  className="w-52 rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
            <ul className="divide-y divide-slate-100">
              {shown.map((row) => (
                <li key={row.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="w-16 shrink-0 rounded-md bg-slate-100 px-1.5 py-0.5 text-center font-mono text-xs font-bold text-slate-700">
                      {row.code}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{row.name}</p>
                      {/* Địa chỉ đứng ngay dưới tên, không giấu sau nút bấm:
                          đây là thứ phân biệt hai cơ sở cùng tên trong một
                          thành phố, và là thứ người ta nhớ chứ không phải mã. */}
                      {row.address ? (
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                          <MapPin size={ICON.xs} className="mt-0.5 shrink-0 text-slate-300" />
                          <span className="min-w-0">
                            {row.address}
                            {row.province && <span className="text-slate-400">, {row.province}</span>}
                          </span>
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-slate-300">Chưa có địa chỉ</p>
                      )}
                    </div>
                    {row.levels && (
                      <span className="hidden items-center gap-1 text-[11px] text-slate-400 sm:inline-flex">
                        <GraduationCap size={ICON.xs} /> {row.levels}
                      </span>
                    )}
                    {row.region && (
                      <span className="hidden text-xs text-slate-400 md:inline">{row.region}</span>
                    )}
                    <Badge variant={row.isActive ? 'success' : 'neutral'}>
                      {row.isActive ? vi.common.active : vi.common.inactive}
                    </Badge>
                    <Button
                      variant="ghost" size="sm" title="Sửa thông tin trường"
                      onClick={() => {
                        setEditing(editing === row.id ? null : row.id);
                        setEdit({
                          name: row.name, region: row.region ?? '', address: row.address ?? '',
                          province: row.province ?? '', levels: row.levels ?? '',
                        });
                      }}
                    >
                      <Pencil size={ICON.md} />
                    </Button>
                    <Button
                      variant="ghost" size="sm" title={vi.campus.deactivateHint}
                      onClick={() => handleToggle(row)}
                    >
                      {row.isActive ? <PowerOff size={ICON.md} /> : <Power size={ICON.md} />}
                    </Button>
                  </div>

                  {editing === row.id && (
                    <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block sm:col-span-2">
                          <span className="text-[11px] font-semibold text-slate-700">Tên trường</span>
                          <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                            className={O_NHAP} />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700">
                            <MapPin size={ICON.xs} className="text-slate-400" /> Địa chỉ
                          </span>
                          <input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })}
                            placeholder="Số nhà, đường, phường/xã" className={O_NHAP} />
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-semibold text-slate-700">Tỉnh/TP</span>
                          <input value={edit.province} onChange={(e) => setEdit({ ...edit, province: e.target.value })}
                            className={O_NHAP} />
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-semibold text-slate-700">Cấp học</span>
                          <input value={edit.levels} onChange={(e) => setEdit({ ...edit, levels: e.target.value })}
                            placeholder="TH, THCS, THPT" className={O_NHAP} />
                        </label>
                        <label className="block">
                          <span className="text-[11px] font-semibold text-slate-700">{vi.campus.region}</span>
                          <input value={edit.region} onChange={(e) => setEdit({ ...edit, region: e.target.value })}
                            className={O_NHAP} />
                        </label>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" disabled={savingEdit} onClick={() => handleSaveEdit(row)}>
                          <Save size={ICON.sm} /> {savingEdit ? 'Đang lưu…' : 'Lưu'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          <X size={ICON.sm} /> Huỷ
                        </Button>
                      </div>
                      {/* Mã trường KHÔNG sửa được: nó là doc id và là thứ mọi
                          phiếu lịch sử trỏ về. Đổi mã là mất dấu toàn bộ phiếu cũ. */}
                      <p className="mt-2 text-[11px] text-slate-400">
                        Mã trường <span className="font-mono font-semibold">{row.code}</span> không đổi được —
                        mọi phiếu đã gửi đều trỏ về mã này.
                      </p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
