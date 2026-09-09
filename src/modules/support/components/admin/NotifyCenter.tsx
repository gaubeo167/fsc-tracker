import { FileText, Megaphone, Send, Users } from 'lucide-react';
import React, { useState } from 'react';
import { cn } from '../../../../components/ui';
import { vi } from '../../i18n/vi';
import { ICON } from '../../ui/tokens';
import { AnnouncementCenter } from './AnnouncementCenter';
import { EmailTemplateManager } from './EmailTemplateManager';
import { NotifyGroupManager } from './NotifyGroupManager';

// ===========================================================================
// Gom ba màn của việc thông báo vào MỘT tab.
//
// Thanh tab của phần quản trị đã có bảy mục và từng có chuyện hai mục cuối bị
// đẩy ra ngoài màn hình, không cách nào bấm tới (xem ghi chú ở SupportAdminView).
// Thêm ba tab nữa là lặp lại đúng lỗi đó. Ba màn này lại thuộc cùng một việc:
// gửi thông báo cho ai, bằng nội dung gì.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

const SUB_TABS = [
  { id: 'compose', label: vi.notify.tabCompose, icon: Send },
  { id: 'groups', label: vi.notify.tabGroups, icon: Users },
  { id: 'templates', label: vi.notify.tabTemplates, icon: FileText },
] as const;

export function NotifyCenter({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  // Mở thẳng màn gửi: đó là việc người ta vào đây để làm. Nhóm và mẫu là thứ
  // dựng một lần rồi thỉnh thoảng mới sửa.
  const [tab, setTab] = useState<(typeof SUB_TABS)[number]['id']>('compose');

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
          <Megaphone size={ICON.lg} />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">{vi.notify.title}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{vi.notify.subtitle}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors',
              tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <t.icon size={ICON.md} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'compose' && <AnnouncementCenter actorUid={actorUid} onToast={onToast} />}
      {tab === 'groups' && <NotifyGroupManager actorUid={actorUid} onToast={onToast} />}
      {tab === 'templates' && <EmailTemplateManager actorUid={actorUid} onToast={onToast} />}
    </div>
  );
}
