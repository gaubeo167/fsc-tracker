import { Loader2 } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import type { UserProfile } from '../../../types';
import { vi } from '../i18n/vi';
import { watchCampuses, type RepoError } from '../repository/campusRepository';
import { getMyUnitClaim, saveMyUnitClaim } from '../repository/unitClaimRepository';
import type { Campus, SupportUnitClaim } from '../types';
import { PendingGate } from './PendingGate';
import { UnitClaimForm } from './UnitClaimForm';

// ===========================================================================
// Cổng của một tài khoản CHƯA được duyệt.
//
// Thay chỗ của PendingGate trong App.tsx và quyết định người mới thấy gì:
//
//   chưa khai đơn vị  -> hỏi họ công tác ở đâu (UnitClaimForm)
//   đã khai / bỏ qua  -> màn chờ duyệt như cũ, có hiện lại đơn vị đã khai
//   đã bị từ chối     -> màn chờ duyệt, nhánh 'disabled', KHÔNG hỏi gì thêm
//
// Vì sao tách khỏi PendingGate: PendingGate là một màn thuần hiển thị, không
// đọc mạng. Nhét việc tải danh sách trường và ghi bản khai vào đó thì một màn
// vốn không bao giờ hỏng được lại có thêm hai đường hỏng.
// ===========================================================================

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

export function OnboardingGate({
  profile,
  onSignOut,
  onToast,
}: {
  profile: UserProfile;
  onSignOut: () => void;
  onToast: Toast;
}) {
  // undefined = đang đọc. null = chưa khai.
  const [claim, setClaim] = useState<SupportUnitClaim | null | undefined>(undefined);
  const [campuses, setCampuses] = useState<Campus[] | null>(null);
  const [loadError, setLoadError] = useState<RepoError | null>(null);
  const [editing, setEditing] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const isRejected = profile.status === 'disabled';

  useEffect(() => {
    if (isRejected) return;
    let alive = true;
    void getMyUnitClaim(profile.uid)
      .then((c) => alive && setClaim(c))
      // Đọc hỏng thì coi như chưa khai: người dùng khai lại một lần nữa còn hơn
      // kẹt ở màn quay vòng vì một lỗi mạng.
      .catch(() => alive && setClaim(null));
    return () => {
      alive = false;
    };
  }, [profile.uid, isRejected]);

  useEffect(() => {
    if (isRejected) return;
    return watchCampuses(
      (rows) => {
        setCampuses(rows);
        setLoadError(null);
      },
      (err) => {
        setCampuses([]);
        setLoadError(err);
      }
    );
  }, [isRejected]);

  async function handleSubmit(input: { campusId: string | null; jobTitle: string }) {
    setSaving(true);
    setSaveError(null);
    try {
      await saveMyUnitClaim({ uid: profile.uid, ...input });
      setClaim({
        uid: profile.uid,
        campusId: input.campusId,
        jobTitle: input.jobTitle,
      });
      setEditing(false);
      onToast(vi.unitClaim.saved, 'success');
    } catch (err: any) {
      // Mã lỗi đi kèm để một ảnh chụp màn hình đủ làm báo lỗi.
      setSaveError(
        err?.code === 'permission-denied'
          ? `${vi.errors.permissionDeniedHint} (permission-denied)`
          : `${vi.errors.saveFailed} (${err?.code ?? 'UNKNOWN'})`
      );
    } finally {
      setSaving(false);
    }
  }

  if (isRejected) return <PendingGate profile={profile} onSignOut={onSignOut} />;

  if (claim === undefined) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <Loader2 size={28} className="animate-spin text-indigo-500" />
      </div>
    );
  }

  if (editing || (claim === null && !skipped)) {
    return (
      <UnitClaimForm
        title={claim ? vi.unitClaim.changeTitle : undefined}
        campuses={campuses}
        loadError={loadError}
        initialCampusId={claim ? claim.campusId : undefined}
        initialJobTitle={claim?.jobTitle}
        saving={saving}
        saveError={saveError}
        onSubmit={handleSubmit}
        onCancel={editing ? () => setEditing(false) : undefined}
        onSkip={() => {
          setEditing(false);
          setSkipped(true);
        }}
        onSignOut={onSignOut}
      />
    );
  }

  return (
    <PendingGate
      profile={profile}
      onSignOut={onSignOut}
      unitLine={claim ? moTaDonVi(claim, campuses) : null}
      onEditUnit={() => {
        setSaveError(null);
        setEditing(true);
      }}
      editLabel={claim ? vi.unitClaim.change : vi.unitClaim.title}
    />
  );
}

/**
 * Đơn vị đã khai, viết thành một dòng cho người dùng đọc lại.
 *
 * Trường đã khai mà không còn trong danh sách vẫn phải hiện ra một cái gì đó:
 * im lặng bỏ trống thì người dùng tưởng bản khai của mình bị mất và khai lại
 * lần nữa, còn admin thì thấy hai thông tin mâu thuẫn.
 */
function moTaDonVi(claim: SupportUnitClaim, campuses: Campus[] | null): string {
  const phanChucDanh = claim.jobTitle ? ` — ${claim.jobTitle}` : '';
  if (claim.campusId === null) return vi.unitClaim.noCampus + phanChucDanh;
  const c = (campuses ?? []).find((x) => x.id === claim.campusId);
  return (c ? `${c.name} (${c.code})` : `${claim.campusId} — ${vi.unitClaim.unknownCampus}`) + phanChucDanh;
}
