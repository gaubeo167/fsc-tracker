import React, { useEffect, useState } from 'react';
import { useWorkingCalendar } from '../../hooks/useWorkingCalendar';
import {
  fetchMyTriageScope, fetchPtudStaff, fetchSupportModules, type ModuleScope,
} from '../../repository/userAdminRepository';
import { TriageActions, type TriageMode } from './TriageActions';
import type { SupportModuleConfig, Ticket } from '../../types';

// ===========================================================================
// Ba thao tác tiếp nhận, tự lo lấy dữ liệu của mình.
//
// Vì sao tồn tại: TriageActions cần năm thứ (dự án của phân hệ, ai được gán
// việc, danh sách người, bảng tên, lịch làm việc). Hàng đợi tiếp nhận vốn đã
// tải sẵn cả năm để vẽ danh sách, nên nó tự truyền vào được. Nhưng hai màn còn
// lại thì không, và hậu quả là:
//
//   Hỏi thêm thông tin -> mở phiếu ra đọc câu trả lời của trường
//   -> muốn từ chối -> KHÔNG CÓ NÚT NÀO.
//
// Người dùng báo đúng chuyện đó: "sau khi trao đổi đang không cho từ chối yêu
// cầu". Phiếu vẫn từ chối được, rules vẫn cho, chỉ là màn hình họ đang đứng
// không có nút. Mà đó lại là màn hình tự nhiên nhất để quyết định: chỗ đọc được
// cuộc trao đổi.
//
// Component này gói phần tải dữ liệu lại để mọi nơi mở màn chi tiết đều gắn
// được ba nút bằng một dòng, thay vì chép năm lượt tải sang từng màn.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

export function TriageActionsFor({
  ticket, actorUid, isAdmin, onDone, onToast,
}: {
  ticket: Ticket;
  actorUid: string;
  /** Admin gán việc được cho bất kỳ ai; đầu mối chỉ trong dự án của mình. */
  isAdmin: boolean;
  onDone: () => void | Promise<void>;
  onToast: Toast;
}) {
  const [mode, setMode] = useState<TriageMode>(null);
  const [modules, setModules] = useState<SupportModuleConfig[]>([]);
  const [staff, setStaff] = useState<Array<{ uid: string; displayName: string }>>([]);
  const [directory, setDirectory] = useState<Record<string, string>>({});
  const [byModule, setByModule] = useState<Record<string, ModuleScope>>({});
  const calendar = useWorkingCalendar();

  useEffect(() => {
    let alive = true;
    void Promise.all([fetchSupportModules(), fetchPtudStaff(), fetchMyTriageScope(actorUid)])
      .then(([mod, ptud, scope]) => {
        if (!alive) return;
        setModules(mod.modules);
        setStaff(ptud.staff);
        setDirectory(ptud.directory);
        setByModule(scope.byModule);
      })
      // Nuốt lỗi có chủ đích: hỏng một lượt đọc phụ trợ thì các nút vẫn phải
      // hiện. Cùng lắm ô "người xử lý" rỗng, còn từ chối và hỏi thêm thì không
      // cần tới danh sách đó.
      .catch(() => {});
    return () => { alive = false; };
  }, [actorUid]);

  // Chỉ phiếu CHƯA được tiếp nhận mới còn ba thao tác này. Phiếu đã nhận mà vẫn
  // hiện nút "Tiếp nhận công việc" là mời người ta sinh ra công việc thứ hai cho
  // cùng một yêu cầu.
  if (ticket.status !== 'TRIAGE' && ticket.status !== 'NEEDS_INFO') return null;

  const ms = byModule[ticket.moduleId];
  const cfg = modules.find((m) => m.code === ticket.moduleId);
  const people = ms?.people?.length ? ms.people : isAdmin ? staff.map((x) => x.uid) : [];

  return (
    <TriageActions
      ticket={ticket}
      actorUid={actorUid}
      mode={mode}
      onModeChange={setMode}
      projectId={cfg?.projectId ?? null}
      canAssignOthers={isAdmin || !!ms?.isManager}
      people={people}
      nameOf={(uid) => directory[uid] ?? uid}
      calendar={calendar}
      onDone={onDone}
      onToast={onToast}
    />
  );
}
