import { Building2, Check, LogOut, MapPin, Search } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { Button, Card, StateBlock } from '../../../components/ui';
import { vi } from '../i18n/vi';
import type { RepoError } from '../repository/campusRepository';
import { filterCampuses } from '../services/campusSearch';
import { ICON } from '../ui/tokens';
import type { Campus } from '../types';

// ===========================================================================
// Màn "bạn công tác ở đơn vị nào" — bước đầu tiên của một tài khoản mới.
//
// Trước đây người mới đăng nhập rơi thẳng vào màn chờ duyệt, và admin phải tự
// đi hỏi từng người xem họ ở cơ sở nào. Người dùng biết câu trả lời đó rõ hơn
// bất kỳ ai, nên để họ trả lời một lần, ngay lúc đăng nhập.
//
// Ba điều màn này KHÔNG được làm:
//   1. Không khoá người dùng lại. Danh sách trường hỏng, rỗng, hay họ không tìm
//      thấy đơn vị mình — luôn có đường "bỏ qua" để về màn chờ duyệt như cũ.
//   2. Không cho chọn VAI TRÒ. Vai trò là quyền, và quyền thì admin cấp. Ở đây
//      chỉ hỏi nơi công tác, thứ tự khai không mở thêm quyền nào.
//   3. Không hứa hẹn được vào ngay. Khai xong vẫn phải chờ duyệt.
// ===========================================================================

/** Giá trị của lựa chọn "không thuộc trường nào" trong danh sách. */
const KHONG_THUOC_TRUONG = '__none__';

export function UnitClaimForm({
  title,
  campuses,
  loadError,
  initialCampusId,
  initialJobTitle,
  saving,
  saveError,
  onSubmit,
  onCancel,
  onSkip,
  onSignOut,
}: {
  /** Đổi tiêu đề khi người dùng quay lại sửa, để họ biết mình đang sửa chứ không phải khai lại từ đầu. */
  title?: string;
  campuses: Campus[] | null;
  loadError: RepoError | null;
  initialCampusId?: string | null;
  initialJobTitle?: string;
  saving: boolean;
  saveError: string | null;
  onSubmit: (input: { campusId: string | null; jobTitle: string }) => void;
  /** Có mặt khi đang SỬA bản khai cũ: cho quay lại mà không đổi gì. */
  onCancel?: () => void;
  onSkip: () => void;
  onSignOut: () => void;
}) {
  const [q, setQ] = useState('');
  const [choice, setChoice] = useState<string>(() => {
    if (initialCampusId) return initialCampusId;
    // Phân biệt "đã khai là không thuộc trường nào" (null) với "chưa khai gì"
    // (undefined). Gộp hai thứ này thì người quay lại sửa thấy ô trống như chưa
    // từng khai, và tưởng bản khai của mình bị mất.
    if (initialCampusId === null) return KHONG_THUOC_TRUONG;
    return '';
  });
  const [jobTitle, setJobTitle] = useState(initialJobTitle ?? '');

  const active = useMemo(() => (campuses ?? []).filter((c) => c.isActive), [campuses]);
  const shown = useMemo(() => filterCampuses(active, q), [active, q]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!choice) return;
    onSubmit({
      campusId: choice === KHONG_THUOC_TRUONG ? null : choice,
      jobTitle: jobTitle.trim(),
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-lg p-8">
        <div className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-indigo-500">
            <Building2 size={ICON.xl} />
          </div>
          <h1 className="text-lg font-bold text-slate-900">{title ?? vi.unitClaim.title}</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{vi.unitClaim.subtitle}</p>
        </div>

        <form className="mt-6" onSubmit={handleSubmit}>
          {campuses === null ? (
            <StateBlock kind="loading" />
          ) : loadError ? (
            <StateBlock
              kind={loadError.kind === 'denied' ? 'denied' : 'error'}
              title={vi.unitClaim.loadFailed}
              description={loadError.message}
            />
          ) : active.length === 0 ? (
            <StateBlock kind="empty" title={vi.unitClaim.empty} description={vi.unitClaim.emptyHint} />
          ) : (
            <>
              <label className="relative block">
                <Search
                  size={ICON.md}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={vi.unitClaim.search}
                  className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </label>

              {/* Cuộn trong khung riêng: 18 cơ sở là quá dài cho một màn hình
                  điện thoại, mà nút "Gửi" thì phải luôn nhìn thấy được. */}
              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
                {shown.length === 0 ? (
                  <p className="px-4 py-6 text-center text-sm text-slate-400">
                    {vi.unitClaim.searchEmpty}
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {shown.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setChoice(c.id)}
                          className={
                            choice === c.id
                              ? 'flex w-full items-start gap-3 bg-indigo-50 px-4 py-3 text-left'
                              : 'flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50'
                          }
                        >
                          <span
                            className={
                              choice === c.id
                                ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white'
                                : 'mt-0.5 h-5 w-5 shrink-0 rounded-full border border-slate-300'
                            }
                          >
                            {choice === c.id && <Check size={12} strokeWidth={3} />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-900">
                              {c.name}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                              <span className="font-medium">{c.code}</span>
                              {(c.address || c.province) && (
                                <>
                                  <MapPin size={ICON.sm} className="shrink-0 text-slate-300" />
                                  <span className="truncate">
                                    {[c.address, c.province].filter(Boolean).join(', ')}
                                  </span>
                                </>
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {/* Nằm NGOÀI danh sách cuộn và ngoài bộ lọc: người của khối PTUD không
              thuộc trường nào cả, và họ không được phép gõ tìm mãi không ra rồi
              kết luận hệ thống này không dành cho mình. */}
          <button
            type="button"
            onClick={() => setChoice(KHONG_THUOC_TRUONG)}
            className={
              choice === KHONG_THUOC_TRUONG
                ? 'mt-3 flex w-full items-start gap-3 rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-3 text-left'
                : 'mt-3 flex w-full items-start gap-3 rounded-lg border border-slate-200 px-4 py-3 text-left hover:bg-slate-50'
            }
          >
            <span
              className={
                choice === KHONG_THUOC_TRUONG
                  ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white'
                  : 'mt-0.5 h-5 w-5 shrink-0 rounded-full border border-slate-300'
              }
            >
              {choice === KHONG_THUOC_TRUONG && <Check size={12} strokeWidth={3} />}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-900">
                {vi.unitClaim.noCampus}
              </span>
              <span className="mt-0.5 block text-xs text-slate-500">
                {vi.unitClaim.noCampusHint}
              </span>
            </span>
          </button>

          <label className="mt-5 block text-left">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {vi.unitClaim.jobTitle}
            </span>
            <input
              value={jobTitle}
              maxLength={100}
              onChange={(e) => setJobTitle(e.target.value)}
              placeholder={vi.unitClaim.jobTitlePlaceholder}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            <span className="mt-1 block text-[11px] text-slate-400">
              {vi.unitClaim.jobTitleHint}
            </span>
          </label>

          {saveError && (
            <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{saveError}</p>
          )}

          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button type="submit" variant="primary" className="flex-1" disabled={!choice || saving}>
              <Check size={ICON.md} />
              {saving ? vi.unitClaim.submitting : vi.unitClaim.submit}
            </Button>
            {onCancel && (
              <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>
                {vi.common.cancel}
              </Button>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={onSkip}
              className="text-xs font-medium text-slate-500 hover:text-slate-700 hover:underline"
            >
              {vi.unitClaim.skip}
            </button>
            <button
              type="button"
              onClick={onSignOut}
              className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600"
            >
              <LogOut size={ICON.sm} />
              {vi.gate.signOut}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}
