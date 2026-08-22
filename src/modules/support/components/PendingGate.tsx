import { Clock, LogOut, RefreshCw, ShieldX } from 'lucide-react';
import React from 'react';
import { Button, Card } from '../../../components/ui';
import { ICON } from '../ui/tokens';
import type { UserProfile } from '../../../types';
import { vi } from '../i18n/vi';

// ===========================================================================
// Màn chờ duyệt.
//
// Đây là thứ DUY NHẤT một tài khoản chưa được duyệt nhìn thấy. Nó phải trả lời
// đúng ba câu, bằng tiếng Việt, không có thuật ngữ kỹ thuật:
//   1. Tôi đăng nhập được chưa?  -> rồi
//   2. Vì sao tôi không thấy gì?  -> chưa được duyệt, không phải app hỏng
//   3. Giờ tôi làm gì?            -> liên hệ quản trị viên, rồi tải lại
//
// Không có màn này thì tài khoản pending gặp một loạt danh sách trống và kết
// luận app bị lỗi — đúng cái hiểu lầm khiến người ta quay lại nhắn Zalo.
// ===========================================================================

export function PendingGate({
  profile,
  onSignOut,
}: {
  profile: UserProfile;
  onSignOut: () => void;
}) {
  const isRejected = profile.status === 'disabled';

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center">
          <div
            className={
              isRejected
                ? 'mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-red-500'
                : 'mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-amber-500'
            }
          >
            {isRejected ? <ShieldX size={ICON.xl} /> : <Clock size={ICON.xl} />}
          </div>

          <h1 className="text-lg font-bold text-slate-900">
            {isRejected ? vi.gate.rejected : vi.gate.title}
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {isRejected ? vi.gate.rejectedBody : vi.gate.body}
          </p>

          <div className="mt-6 w-full rounded-lg bg-slate-50 px-4 py-3 text-left">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tài khoản
            </p>
            <p className="mt-1 truncate text-sm font-medium text-slate-800">
              {profile.displayName}
            </p>
            <p className="truncate text-xs text-slate-500">{profile.email}</p>
          </div>

          {!isRejected && (
            <div className="mt-5 w-full text-left">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                {vi.gate.whatNext}
              </p>
              <ol className="mt-2 space-y-1.5 text-sm text-slate-600">
                <li className="flex gap-2">
                  <span className="font-semibold text-slate-400">1.</span>
                  <span>{vi.gate.step1}</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-semibold text-slate-400">2.</span>
                  <span>{vi.gate.step2}</span>
                </li>
              </ol>
            </div>
          )}

          <div className="mt-7 flex w-full flex-col gap-2 sm:flex-row">
            {!isRejected && (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={ICON.md} />
                {vi.gate.reload}
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onSignOut}>
              <LogOut size={ICON.md} />
              {vi.gate.signOut}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
