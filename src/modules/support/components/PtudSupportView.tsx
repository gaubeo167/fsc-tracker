import { ClipboardList, Headset, Inbox, ListTodo } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { cn } from '../../../components/ui';
import { ICON } from '../ui/tokens';
import { MyModuleTickets } from './triage/MyModuleTickets';
import { MySupportTasks } from './triage/MySupportTasks';
import { TriageQueue } from './triage/TriageQueue';

// ===========================================================================
// Màn hỗ trợ cho cán bộ phụ trách hệ thống (không phải admin).
//
// Hai phần rõ ràng, đúng như hai việc họ thật sự làm:
//
//   ĐƠN YÊU CẦU  — yêu cầu thuộc hệ thống mình phụ trách: tiếp nhận, theo dõi
//   CÔNG VIỆC    — task sinh ra từ phiếu và được giao cho mình
//
// Không trộn hai thứ vào một danh sách: tiếp nhận là việc của người phụ trách
// hệ thống, còn xử lý là việc của người được giao — cùng một người vẫn phải
// tách, vì hai việc đó diễn ra ở hai thời điểm khác nhau.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

// Ba icon KHÁC NHAU. Trước đây "Chờ tiếp nhận" và "Đơn yêu cầu" dùng chung
// Inbox, nên hai tab cạnh nhau trông như một — icon giống nhau thì icon không
// còn giúp phân biệt được gì.
const TABS = [
  { id: 'inbox', label: 'Chờ tiếp nhận', icon: Inbox },
  { id: 'requests', label: 'Đơn yêu cầu', icon: ClipboardList },
  { id: 'tasks', label: 'Công việc của tôi', icon: ListTodo },
] as const;

export function PtudSupportView({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  // Mặc định mở hàng đợi chờ tiếp nhận: đó là thứ có TRƯỜNG ĐANG CHỜ trả lời.
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('inbox');
  // Số phiếu đang chờ, do TriageQueue báo lên. Hiện ngay trên tab để người ta
  // biết có việc mà không phải bấm vào xem.
  const [choTiepNhan, setChoTiepNhan] = useState(0);

  // Mở phiếu từ chuông hoặc từ màn Công việc: phải chuyển sang tab Đơn yêu cầu
  // thì màn đó mới được dựng và mới nghe được sự kiện.
  useEffect(() => {
    const h = (e: Event) => {
      setTab('requests');
      // Phát lại ở nhịp sau: lúc này màn danh sách phiếu mới vừa được dựng và
      // đã kịp đăng ký lắng nghe.
      const no = (e as CustomEvent).detail;
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('fsc:open-ticket-relay', { detail: no }));
      }, 0);
    };
    window.addEventListener('fsc:open-ticket', h);
    return () => window.removeEventListener('fsc:open-ticket', h);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Headset size={ICON.xl} />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Hỗ trợ Campus</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Tiếp nhận yêu cầu từ các trường và xử lý công việc được giao
          </p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.id
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            )}
          >
            <t.icon size={ICON.md} />
            {t.label}
            {t.id === 'inbox' && choTiepNhan > 0 && (
              <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                {choTiepNhan}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Luôn dựng TriageQueue, chỉ ẩn đi khi ở tab khác: tháo ra rồi gắn lại
          thì số trên tab về 0 mỗi lần chuyển tab, rồi nhảy lại khi quay về. */}
      <div className={cn(tab !== 'inbox' && 'hidden')}>
        <TriageQueue actorUid={actorUid} isAdmin={false} onToast={onToast} onCount={setChoTiepNhan} />
      </div>
      {tab === 'requests' && <MyModuleTickets actorUid={actorUid} onToast={onToast} />}
      {tab === 'tasks' && <MySupportTasks actorUid={actorUid} />}
    </div>
  );
}
