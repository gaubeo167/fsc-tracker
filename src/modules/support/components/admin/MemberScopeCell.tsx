import { Building2, Check, Headset, Pencil, ShieldCheck, UserRound, X } from 'lucide-react';
import React, { useState } from 'react';
import { Badge, Button, cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { clearMemberScope, reassignUser } from '../../repository/userAdminRepository';
import { DomainError, type Campus, type SupportRole, type SupportRoleAssignment } from '../../types';

// ===========================================================================
// Loại thành viên trong module hỗ trợ, gán ngay tại màn Thành viên.
//
// Trước đây quyền hỗ trợ CHỈ gán được ở hàng đợi "Duyệt tài khoản" — tức là chỉ
// đúng một lần, lúc người đó vừa đăng ký. Sau đó muốn thêm một cán bộ nhà
// trường, hay chuyển một người từ dự án này sang trường khác, thì không có
// đường nào. Màn Thành viên là nơi admin đã quen tìm tới, nên đặt ở đây.
//
// Ba loại, đúng ba nhóm người có thật trong hệ thống:
//
//   Cán bộ nhà trường  -> gửi và theo dõi yêu cầu của TRƯỜNG MÌNH. Bắt buộc
//                         phải chọn trường, không có trường thì họ đăng nhập
//                         vào và không thấy gì cả.
//   Cán bộ phụ trách   -> đầu mối một hệ thống: tiếp nhận, từ chối, giao việc
//   Nhân viên dự án    -> nhận và xử lý công việc sinh ra từ phiếu
//
// Vai trò cũ (CAMPUS_REPORTER, PTUD_MANAGER, SYS_ADMIN) vẫn HIỆN đúng tên,
// nhưng không nằm trong danh sách chọn ở đây — chúng thuộc màn Duyệt tài khoản,
// nơi có đủ sáu vai trò. Ở đây chỉ ba loại dùng hằng ngày.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

const CHON = [
  {
    role: 'CAMPUS_FOCAL' as SupportRole,
    label: 'Cán bộ nhà trường',
    hint: 'Gửi và theo dõi yêu cầu của trường mình. Không thấy phần Công việc.',
    canCampus: true,
  },
  {
    role: 'MODULE_OWNER' as SupportRole,
    label: 'Cán bộ phụ trách',
    hint: 'Đầu mối một hệ thống: tiếp nhận, từ chối, giao việc.',
    canCampus: false,
  },
  {
    role: 'DEVELOPER' as SupportRole,
    label: 'Nhân viên dự án',
    hint: 'Nhận và xử lý công việc sinh ra từ phiếu hỗ trợ.',
    canCampus: false,
  },
];

/** Tên và hình của MỌI vai trò, kể cả vai trò không nằm trong danh sách chọn. */
const HIEN: Record<SupportRole, { label: string; Icon: typeof UserRound; variant: 'sky' | 'primary' | 'neutral' | 'danger' }> = {
  CAMPUS_REPORTER: { label: 'Cán bộ nhà trường', Icon: Building2, variant: 'sky' },
  CAMPUS_FOCAL: { label: 'Cán bộ nhà trường', Icon: Building2, variant: 'sky' },
  MODULE_OWNER: { label: 'Cán bộ phụ trách', Icon: Headset, variant: 'primary' },
  PTUD_MANAGER: { label: 'Cán bộ phụ trách', Icon: Headset, variant: 'primary' },
  DEVELOPER: { label: 'Nhân viên dự án', Icon: UserRound, variant: 'neutral' },
  SYS_ADMIN: { label: 'Quản trị hệ thống', Icon: ShieldCheck, variant: 'danger' },
};

export function MemberScopeCell({
  uid, userStatus, assignment, campuses, actorUid, onToast,
}: {
  uid: string;
  userStatus: string;
  assignment: SupportRoleAssignment | null;
  campuses: Campus[];
  actorUid: string;
  onToast: Toast;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<SupportRole | ''>(assignment?.supportRole ?? '');
  const [campusId, setCampusId] = useState(assignment?.campusId ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const chon = CHON.find((c) => c.role === role);
  const canDung = !!chon?.canCampus;

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      if (!role) {
        await clearMemberScope(uid);
        onToast('Đã gỡ loại thành viên hỗ trợ', 'info');
      } else {
        await reassignUser({
          uid,
          supportRole: role,
          campusId: canDung ? campusId || null : null,
          actorUid,
          // Gán loại cho người đang chờ duyệt = duyệt luôn. Không làm thì admin
          // gán xong tưởng xong, còn người kia vẫn kẹt ở màn chờ.
          alsoActivate: userStatus === 'pending',
        });
        onToast(
          userStatus === 'pending'
            ? 'Đã gán loại thành viên và kích hoạt tài khoản'
            : 'Đã cập nhật loại thành viên',
          'success'
        );
      }
      setEditing(false);
    } catch (e: any) {
      setErr(e instanceof DomainError ? e.message : `Không lưu được (${e?.code ?? 'lỗi'})`);
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    const h = assignment ? HIEN[assignment.supportRole] : null;
    const campus = assignment?.campusId
      ? campuses.find((c) => c.id === assignment.campusId)
      : null;
    return (
      <div className="flex items-center gap-2">
        {h ? (
          <Badge variant={h.variant} className="inline-flex items-center gap-1 normal-case tracking-normal">
            <h.Icon size={ICON.xs} />
            {h.label}
            {assignment?.campusId && (
              <span className="font-normal opacity-80">· {campus?.code ?? assignment.campusId}</span>
            )}
          </Badge>
        ) : (
          <span className="text-xs text-slate-400">Chưa gán</span>
        )}
        <button
          onClick={() => {
            setRole(assignment?.supportRole ?? '');
            setCampusId(assignment?.campusId ?? '');
            setEditing(true);
          }}
          title="Đổi loại thành viên"
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
        >
          <Pencil size={ICON.sm} />
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-56 space-y-2">
      <select
        value={role}
        onChange={(e) => {
          const r = e.target.value as SupportRole | '';
          setRole(r);
          // Đổi sang loại không thuộc trường thì bỏ luôn trường đã chọn, không
          // để một mã trường mồ côi nằm lại trong bản ghi.
          if (!CHON.find((c) => c.role === r)?.canCampus) setCampusId('');
        }}
        className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none"
      >
        <option value="">— Chưa gán —</option>
        {CHON.map((c) => <option key={c.role} value={c.role}>{c.label}</option>)}
        {/* Vai trò cũ ngoài ba loại trên vẫn giữ được, không bị ép đổi. */}
        {assignment && !CHON.some((c) => c.role === assignment.supportRole) && (
          <option value={assignment.supportRole}>
            {HIEN[assignment.supportRole].label} (đặt ở Duyệt tài khoản)
          </option>
        )}
      </select>

      {/* Chưa có trường nào thì ô chọn rỗng và nút Lưu khoá cứng — nói thẳng
          phải đi đâu, thay vì để admin ngồi bấm một ô không có lựa chọn. */}
      {canDung && campuses.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] leading-relaxed text-amber-800">
          Chưa có trường nào trong hệ thống. Vào <strong>Hỗ trợ → Trường học</strong> thêm trường trước.
        </p>
      )}

      {canDung && campuses.length > 0 && (
        <select
          value={campusId}
          onChange={(e) => setCampusId(e.target.value)}
          className={cn(
            'w-full rounded-lg border px-2 py-1.5 text-xs focus:border-indigo-500 focus:outline-none',
            campusId ? 'border-slate-300' : 'border-red-300 bg-red-50'
          )}
        >
          <option value="">— Chọn trường (bắt buộc) —</option>
          {campuses.filter((c) => c.isActive).map((c) => (
            <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
          ))}
        </select>
      )}

      {chon && <p className="text-[11px] leading-relaxed text-slate-400">{chon.hint}</p>}
      {err && <p className="text-[11px] text-red-600">{err}</p>}

      <div className="flex gap-1.5">
        <Button size="sm" disabled={busy || (canDung && !campusId)} onClick={save}>
          <Check size={ICON.sm} /> {busy ? 'Đang lưu…' : 'Lưu'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setErr(null); }}>
          <X size={ICON.sm} />
        </Button>
      </div>
    </div>
  );
}
