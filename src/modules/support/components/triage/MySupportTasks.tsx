import { collectionGroup, getDocs, query, where } from 'firebase/firestore';
import { CheckCircle2, ExternalLink, ListTodo, Loader2 } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { db } from '../../../../firebase';
import { Badge, Card, StateBlock, cn } from '../../../../components/ui';
import { ICON, TABLE } from '../../ui/tokens';

// ===========================================================================
// Công việc hỗ trợ được giao cho tôi.
//
// Đọc từ module Công việc bằng collectionGroup lọc theo `assignees` — XUYÊN
// TOÀN BỘ dự án. Một nhân viên có thể ở nhiều dự án khác nhau, nên lọc theo
// thành viên dự án sẽ bỏ sót việc của chính họ.
//
// Lọc thẻ 'ho-tro' ở CLIENT chứ không thêm vào truy vấn: Firestore chỉ cho
// MỘT mệnh đề array-contains trong một truy vấn, mà `assignees` đã dùng mất rồi.
// ===========================================================================

interface SupportTask {
  id: string;
  projectId: string;
  title: string;
  status: string;
  progress: number;
  date: string;
  priority: string;
  tags: string[];
}

const STATUS_VI: Record<string, string> = {
  pending: 'Chờ duyệt', todo: 'Chờ xử lý', 'in-progress': 'Đang làm',
  review: 'Chờ nghiệm thu', done: 'Hoàn thành', rejected: 'Bị từ chối',
};
const STATUS_VARIANT: Record<string, 'neutral' | 'warning' | 'info' | 'success' | 'danger' | 'sky'> = {
  pending: 'warning', todo: 'neutral', 'in-progress': 'info',
  review: 'sky', done: 'success', rejected: 'danger',
};

export function MySupportTasks({ actorUid }: { actorUid: string }) {
  const [tasks, setTasks] = useState<SupportTask[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const snap = await getDocs(
        query(collectionGroup(db, 'tasks'), where('assignees', 'array-contains', actorUid))
      );
      const rows = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            projectId: d.ref.parent.parent?.id ?? '',
            title: String(data.title ?? ''),
            status: String(data.status ?? ''),
            progress: Number(data.progress ?? 0),
            date: String(data.date ?? ''),
            priority: String(data.priority ?? ''),
            tags: (data.tags as string[]) ?? [],
          };
        })
        .filter((t) => t.tags.includes('ho-tro'))
        .sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0));
      setTasks(rows);
      setError(null);
    } catch (err: any) {
      setTasks([]);
      setError(err?.code === 'permission-denied' ? 'denied' : (err?.message ?? 'lỗi'));
    }
  }, [actorUid]);

  useEffect(() => { void load(); }, [load]);

  if (tasks === null) return <StateBlock kind="loading" />;

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2.5">
        <ListTodo size={ICON.xl} className="mt-0.5 shrink-0 text-slate-400" />
        <div>
        <h2 className="text-lg font-bold text-slate-900">Công việc hỗ trợ của tôi</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Công việc sinh ra từ phiếu hỗ trợ và được giao cho bạn. Cập nhật tiến độ ở mục Công việc,
          trường sẽ thấy ngay.
        </p>
        </div>
      </div>

      <Card>
        {error === 'denied' ? (
          <StateBlock kind="denied" description="Không đọc được danh sách công việc." />
        ) : error ? (
          <StateBlock kind="error" description={error} />
        ) : tasks.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Chưa có công việc hỗ trợ nào được giao cho bạn"
            description="Công việc xuất hiện ở đây sau khi một phiếu hỗ trợ được tiếp nhận và giao cho bạn."
          />
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-2.5 text-xs text-slate-500">
              <ListTodo size={ICON.sm} /> {tasks.length} công việc ·{' '}
              {tasks.filter((t) => t.status !== 'done').length} chưa xong
            </div>
            {/* Dạng BẢNG, nhất quán với mọi danh sách khác của module. */}
            <table className="w-full text-sm">
              <thead>
                <tr className={TABLE.headRow}>
                  <th className={TABLE.headCell}></th>
                  <th className={TABLE.headCell}>Công việc</th>
                  <th className={TABLE.headCell}>Trạng thái</th>
                  <th className={cn(TABLE.headCell, 'w-40')}>Tiến độ</th>
                  <th className={cn(TABLE.headCell, 'text-right')}>Hạn</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={t.id} className="border-b border-slate-50 last:border-0">
                    <td className={cn(TABLE.cell, 'w-8')}>
                      {t.status === 'done'
                        ? <CheckCircle2 size={ICON.sm} className="text-emerald-500" aria-label="Hoàn thành" />
                        : <Loader2 size={ICON.sm} className="text-sky-500" aria-label="Đang xử lý" />}
                    </td>
                    <td className={cn(TABLE.cell, 'max-w-sm')}>
                      <span className="line-clamp-1 text-slate-800">{t.title}</span>
                      {t.tags.filter((x) => x !== 'ho-tro').length > 0 && (
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {t.tags.filter((x) => x !== 'ho-tro').join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className={cn(TABLE.cell, 'whitespace-nowrap')}>
                      <Badge variant={STATUS_VARIANT[t.status] ?? 'neutral'}>
                        {STATUS_VI[t.status] ?? t.status}
                      </Badge>
                    </td>
                    <td className={TABLE.cell}>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn('h-full rounded-full transition-all',
                              t.status === 'done' ? 'bg-emerald-500' : 'bg-sky-500')}
                            style={{ width: `${Math.min(100, Math.max(0, t.progress))}%` }}
                          />
                        </div>
                        {/* tabular-nums: cột phần trăm không nhảy khi số đổi. */}
                        <span className="w-9 shrink-0 text-right text-xs tabular-nums text-slate-600">
                          {t.progress}%
                        </span>
                      </div>
                    </td>
                    <td className={cn(TABLE.cell, 'whitespace-nowrap text-right text-xs tabular-nums text-slate-500')}>
                      {t.date || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="flex items-center gap-1.5 border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">
              <ExternalLink size={ICON.xs} />
              Cập nhật tiến độ ở mục Công việc — tiến độ sẽ tự hiện trên phiếu của trường.
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
