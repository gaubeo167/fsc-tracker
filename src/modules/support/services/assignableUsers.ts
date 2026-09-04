import type { UserProfile, UserRole } from '../../../types';

/**
 * Ai được phép ĐỌC bảng phân vai hỗ trợ — khớp đúng isTaskLeader() trong
 * firestore.rules cộng admin.
 *
 * Phải chặn ở client chứ không phó mặc cho rules: một listener bị
 * permission-denied KHÔNG chỉ trả về rỗng, nó làm hỏng luôn client Firestore
 * của cả trang ("INTERNAL ASSERTION FAILED (ID: ca9)") và kéo sập mọi listener
 * khác. Cán bộ trường mở app lên là màn hình trắng, menu hiện nhầm mục.
 * Không mở listener còn hơn mở rồi bắt lỗi.
 */
const CAN_READ_ASSIGNMENTS: UserRole[] = ['admin', 'manager', 'director'];

/**
 * true khi tài khoản này đọc được support_role_assignments.
 *
 * Hai vế, đúng bằng hai nhánh của rules:
 *   - vai trò module Công việc là quản lý/giám đốc/admin  -> isTaskLeader/isAdmin
 *   - hoặc là nhân sự PTUD (lập trình viên, đầu mối phân hệ…) -> isPtudStaff
 *
 * Vế thứ hai KHÔNG thừa: nhân viên dự án có `users.role` là 'user' y hệt cán bộ
 * trường, nhưng họ vẫn có ô CC khi tạo công việc. Bỏ vế này thì ô đó lại liệt kê
 * cán bộ trường — đúng thứ tính năng này sinh ra để bỏ đi.
 */
export function canReadRoleAssignments(
  role?: UserRole | null,
  isPtudStaff = false
): boolean {
  if (isPtudStaff) return true;
  return !!role && CAN_READ_ASSIGNMENTS.includes(role);
}

/**
 * Bỏ cán bộ nhà trường khỏi danh sách người chọn được.
 *
 * `selected` là những uid đang được tick sẵn trên task. Chúng luôn được giữ
 * lại trong danh sách kể cả khi là cán bộ trường: task cũ lỡ gán nhầm thì phải
 * còn nhìn thấy để bỏ tick, chứ lọc thẳng tay là người đó dính vĩnh viễn vào
 * task mà không ai gỡ ra được nữa.
 */
export function filterAssignableUsers(
  users: UserProfile[],
  campusStaff: ReadonlySet<string>,
  selected: readonly string[] = []
): UserProfile[] {
  return users.filter((u) => !campusStaff.has(u.uid) || selected.includes(u.uid));
}
