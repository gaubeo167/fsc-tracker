import { useEffect, useState } from 'react';
import { getMyAssignment } from '../repository/userAdminRepository';
import { CAMPUS_SIDE_ROLES } from '../types';
import type { SupportRole, SupportRoleAssignment } from '../types';

// ===========================================================================
// Đọc vai trò hỗ trợ của người đang đăng nhập.
//
// Vì sao phải bất đồng bộ: vai trò hỗ trợ nằm ở collection riêng
// `support_role_assignments` (§3 spec cấm thêm field vào bảng user gốc), nên
// KHÔNG suy ra được từ `profile.role` vốn có sẵn ngay trong bộ nhớ.
//
// Hệ quả kéo theo: thanh điều hướng của app phải chờ một lượt đọc mạng mới biết
// hiện mục nào. Trạng thái `loading` dưới đây tồn tại vì lý do đó — không có nó
// thì menu sẽ nhấp nháy: hiện đủ mục rồi đột ngột mất bớt.
// ===========================================================================

/** Vai trò phía PTUD — làm task, xử lý yêu cầu. */
const PTUD_SIDE_ROLES: SupportRole[] = [
  'MODULE_OWNER',
  'DEVELOPER',
  'PTUD_MANAGER',
  'SYS_ADMIN',
];

export interface SupportRoleState {
  loading: boolean;
  assignment: SupportRoleAssignment | null;
  /** true khi người dùng là cán bộ trường: chỉ được thấy module hỗ trợ. */
  isCampusSide: boolean;
  /** true khi người dùng thuộc đội PTUD: thấy cả task lẫn hỗ trợ. */
  isPtudSide: boolean;
}

export function useSupportRole(uid: string | undefined): SupportRoleState {
  const [state, setState] = useState<SupportRoleState>({
    loading: true,
    assignment: null,
    isCampusSide: false,
    isPtudSide: false,
  });

  useEffect(() => {
    if (!uid) {
      setState({ loading: false, assignment: null, isCampusSide: false, isPtudSide: false });
      return;
    }
    let alive = true;
    void getMyAssignment(uid)
      .then((a) => {
        if (!alive) return;
        setState({
          loading: false,
          assignment: a,
          isCampusSide: !!a && CAMPUS_SIDE_ROLES.includes(a.supportRole),
          isPtudSide: !!a && PTUD_SIDE_ROLES.includes(a.supportRole),
        });
      })
      .catch(() => {
        // Không đọc được (mất mạng, rules chặn) thì coi như CHƯA gán vai trò.
        // Đây là mặc định an toàn theo hướng không-thay-đổi: 8 tài khoản có sẵn
        // trong hệ thống chưa ai được gán vai trò hỗ trợ, và họ phải tiếp tục
        // dùng app y như cũ chứ không bị khoá bớt menu vì một lỗi mạng.
        if (!alive) return;
        setState({ loading: false, assignment: null, isCampusSide: false, isPtudSide: false });
      });
    return () => {
      alive = false;
    };
  }, [uid]);

  return state;
}
