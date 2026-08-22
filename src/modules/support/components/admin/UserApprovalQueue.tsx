import { Check, UserCheck, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { Badge, Button, Card, StateBlock } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import type { UserProfile } from '../../../../types';
import { vi } from '../../i18n/vi';
import { watchCampuses, type RepoError } from '../../repository/campusRepository';
import { approveUser, rejectUser, watchPendingUsers } from '../../repository/userAdminRepository';
import {
  DomainError,
  ROLES_REQUIRING_CAMPUS,
  SUPPORT_ROLES,
  type Campus,
  type SupportRole,
} from '../../types';

// ===========================================================================
// Hàng đợi duyệt tài khoản (SYS_ADMIN).
//
// Mỗi dòng là một quyết định trọn vẹn: chọn vai trò, chọn trường, bấm duyệt.
// Cố ý KHÔNG bắt admin mở modal rồi mới thao tác được — hàng đợi này sẽ có
// hàng chục dòng mỗi đợt tuyển, mở/đóng modal từng cái là cực hình.
// ===========================================================================

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

type RowDraft = { supportRole: SupportRole; campusId: string };

export function UserApprovalQueue({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  const [pending, setPending] = useState<UserProfile[] | null>(null);
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loadError, setLoadError] = useState<RepoError | null>(null);
  const [drafts, setDrafts] = useState<Record<string, RowDraft>>({});
  const [busyUid, setBusyUid] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});

  useEffect(() => {
    const stopUsers = watchPendingUsers(
      (rows) => {
        setPending(rows);
        setLoadError(null);
      },
      (err) => {
        setPending([]);
        setLoadError(err);
      }
    );
    const stopCampuses = watchCampuses(
      (rows) => setCampuses(rows.filter((c) => c.isActive)),
      () => setCampuses([])
    );
    return () => {
      stopUsers();
      stopCampuses();
    };
  }, []);

  function draftOf(uid: string): RowDraft {
    return drafts[uid] ?? { supportRole: 'CAMPUS_REPORTER', campusId: '' };
  }

  function patchDraft(uid: string, patch: Partial<RowDraft>) {
    setDrafts((d) => ({ ...d, [uid]: { ...draftOf(uid), ...patch } }));
    setRowError((e) => ({ ...e, [uid]: '' }));
  }

  async function handleApprove(user: UserProfile) {
    const draft = draftOf(user.uid);
    setBusyUid(user.uid);
    try {
      await approveUser({
        uid: user.uid,
        supportRole: draft.supportRole,
        campusId: draft.campusId || null,
        actorUid,
      });
      onToast(`Đã duyệt ${user.displayName}`, 'success');
    } catch (err: any) {
      const message =
        err instanceof DomainError
          ? err.message
          : `${vi.errors.saveFailed} (${err?.code ?? 'UNKNOWN'})`;
      setRowError((e) => ({ ...e, [user.uid]: message }));
    } finally {
      setBusyUid(null);
    }
  }

  async function handleReject(user: UserProfile) {
    if (!window.confirm(vi.approval.confirmReject(user.displayName))) return;
    setBusyUid(user.uid);
    try {
      await rejectUser(user.uid);
      onToast(`Đã từ chối ${user.displayName}`, 'info');
    } catch (err: any) {
      setRowError((e) => ({
        ...e,
        [user.uid]: `${vi.errors.saveFailed} (${err?.code ?? 'UNKNOWN'})`,
      }));
    } finally {
      setBusyUid(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-slate-900">{vi.approval.title}</h2>
        <p className="mt-0.5 text-sm text-slate-500">{vi.approval.subtitle}</p>
      </div>

      {/* Không có trường nào thì duyệt cũng vô nghĩa: vai trò tại trường bắt buộc
          phải chọn trường. Nói trước còn hơn để admin bấm rồi mới báo lỗi. */}
      {pending && pending.length > 0 && campuses.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {vi.approval.noCampusYet}
        </p>
      )}

      <Card>
        {pending === null ? (
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
        ) : pending.length === 0 ? (
          <StateBlock kind="empty" title={vi.approval.empty} description={vi.approval.emptyHint} />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3 text-xs text-slate-500">
              <UserCheck size={ICON.sm} />
              <span>{vi.approval.pendingCount(pending.length)}</span>
            </div>
            <ul className="divide-y divide-slate-100">
              {pending.map((user) => {
                const draft = draftOf(user.uid);
                const needsCampus = ROLES_REQUIRING_CAMPUS.includes(draft.supportRole);
                const busy = busyUid === user.uid;
                return (
                  <li key={user.uid} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {user.displayName}
                        </p>
                        <p className="truncate text-xs text-slate-500">{user.email}</p>
                      </div>
                      <Badge variant="warning">Chờ duyệt</Badge>
                    </div>

                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-600">
                          {vi.approval.assignRole}
                        </span>
                        <select
                          value={draft.supportRole}
                          onChange={(e) =>
                            patchDraft(user.uid, { supportRole: e.target.value as SupportRole })
                          }
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                        >
                          {SUPPORT_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {vi.roles[r]}
                            </option>
                          ))}
                        </select>
                        <span className="mt-1 block text-[11px] text-slate-400">
                          {vi.roleHints[draft.supportRole]}
                        </span>
                      </label>

                      <label className="block">
                        <span className="text-[11px] font-semibold text-slate-600">
                          {vi.approval.assignCampus}
                          {needsCampus && <span className="text-red-500"> *</span>}
                        </span>
                        <select
                          value={draft.campusId}
                          onChange={(e) => patchDraft(user.uid, { campusId: e.target.value })}
                          disabled={!needsCampus}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none disabled:bg-slate-50 disabled:text-slate-400"
                        >
                          <option value="">
                            {needsCampus ? '— Chọn trường —' : 'Không thuộc trường nào'}
                          </option>
                          {campuses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.code} — {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {rowError[user.uid] && (
                      <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
                        {rowError[user.uid]}
                      </p>
                    )}

                    <div className="mt-3 flex gap-2">
                      <Button size="sm" disabled={busy} onClick={() => handleApprove(user)}>
                        <Check size={ICON.md} />
                        {busy ? vi.common.loading : vi.approval.approve}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => handleReject(user)}
                      >
                        <X size={ICON.md} />
                        {vi.approval.reject}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>
    </div>
  );
}
