import {
  Building2, ClipboardList, FolderGit2, Headset, Inbox, Layers, ListTodo, UserCheck,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { cn } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import { MySupportTasks } from '../triage/MySupportTasks';
import { TriageQueue } from '../triage/TriageQueue';
import { AllTicketsView } from './AllTicketsView';
import { ModuleManager } from './ModuleManager';
import { ProjectManager } from './ProjectManager';
import { CampusManager } from './CampusManager';
import { UserApprovalQueue } from './UserApprovalQueue';

// ===========================================================================
// Điểm vào duy nhất của phần quản trị module hỗ trợ.
// Gộp ở đây để App.tsx chỉ phải thêm đúng một nhánh render, thay vì biết về
// từng màn con.
// ===========================================================================

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

// Trường chỉ là bên GỬI yêu cầu; admin nhìn thấy toàn bộ và quản trị toàn bộ.
// Nên tab đầu tiên là phiếu, không phải cấu hình — đó là việc hằng ngày.
// Bảy tab chữ trần thì mắt phải ĐỌC từng cái mới tìm được tab cần. Mỗi tab một
// icon riêng, và icon dùng lại đúng biểu tượng của từng hạng mục ở các màn khác
// (Inbox = hàng đợi, FolderGit2 = dự án, Building2 = trường…) để cùng một khái
// niệm luôn mang cùng một hình ở mọi nơi.
// Bảy tab chia hai nhóm, có vạch ngăn ở giữa:
//
//   VẬN HÀNH  — việc hằng ngày, có trường đang chờ
//   THIẾT LẬP — cấu hình, làm theo đợt
//
// Không chia nhóm thì "Trường" nằm lẫn giữa bảy tab chữ và admin không tìm ra —
// đó chính là chuyện đã xảy ra.
const TABS = [
  { id: 'triage', label: 'Chờ tiếp nhận', icon: Inbox, nhom: 'van-hanh' },
  { id: 'tickets', label: 'Tất cả phiếu', icon: ClipboardList, nhom: 'van-hanh' },
  { id: 'tasks', label: 'Công việc hỗ trợ', icon: ListTodo, nhom: 'van-hanh' },
  { id: 'campus', label: 'Trường học', icon: Building2, nhom: 'thiet-lap' },
  { id: 'projects', label: 'Dự án', icon: FolderGit2, nhom: 'thiet-lap' },
  { id: 'modules', label: 'Phân hệ', icon: Layers, nhom: 'thiet-lap' },
  { id: 'approval', label: 'Duyệt tài khoản', icon: UserCheck, nhom: 'thiet-lap' },
] as const;

export function SupportAdminView({ actorUid, onToast }: { actorUid: string; onToast: Toast }) {
  // Mặc định mở tab phiếu: đó là công việc vận hành hằng ngày. Duyệt tài khoản
  // và quản lý trường là việc thiết lập, làm theo đợt.
  // Mặc định mở hàng đợi chờ tiếp nhận: đó là việc CÓ TÍNH THỜI GIAN — có
  // trường đang chờ được trả lời. Xem tất cả phiếu là việc tra cứu.
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('triage');

  // Mở phiếu từ chuông hoặc từ màn Công việc: chuyển sang tab Tất cả phiếu thì
  // màn đó mới được dựng và mới nghe được sự kiện.
  useEffect(() => {
    const h = (e: Event) => {
      setTab('tickets');
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
            Toàn bộ yêu cầu của các trường, công việc và cấu hình hệ thống
          </p>
        </div>
      </div>

      {/* overflow-x-auto BẮT BUỘC.
          Trước đây thanh này là flex thường với shrink-0 trên từng tab: bảy tab
          rộng hơn vùng nội dung trên màn 1280px, và hai tab cuối — Duyệt tài
          khoản, Trường học — bị đẩy ra ngoài, KHÔNG có cách nào bấm tới. Admin
          báo "chưa có mục quản lý danh sách trường" chính là vì vậy: mục có
          thật, chỉ là không nhìn thấy và không cuộn tới được. */}
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
        {TABS.map((t, i) => (
          <React.Fragment key={t.id}>
            {/* Vạch ngăn giữa nhóm vận hành và nhóm thiết lập. */}
            {i > 0 && TABS[i - 1].nhom !== t.nhom && (
              <span className="my-2 w-px shrink-0 self-stretch bg-slate-200" aria-hidden />
            )}
            <button
              onClick={() => setTab(t.id)}
              className={cn(
                '-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2 text-sm font-medium transition-colors',
                tab === t.id
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              )}
            >
              <t.icon size={ICON.md} />
              {t.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {tab === 'triage' && <TriageQueue actorUid={actorUid} isAdmin onToast={onToast} />}
      {tab === 'tickets' && <AllTicketsView actorUid={actorUid} onToast={onToast} />}
      {tab === 'tasks' && <MySupportTasks actorUid={actorUid} />}
      {tab === 'projects' && <ProjectManager actorUid={actorUid} onToast={onToast} />}
      {tab === 'modules' && <ModuleManager onToast={onToast} />}
      {tab === 'approval' && <UserApprovalQueue actorUid={actorUid} onToast={onToast} />}
      {tab === 'campus' && <CampusManager actorUid={actorUid} onToast={onToast} />}
    </div>
  );
}
