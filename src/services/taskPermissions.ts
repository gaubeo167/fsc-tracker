import type { UserRole } from '../types';

// ===========================================================================
// Ai được duyệt / nghiệm thu / sửa một công việc.
//
// Vì sao là file riêng: câu trả lời phải khớp TỪNG CHỮ với firestore.rules.
// Giao diện rộng hơn rules thì người dùng thấy nút, bấm vào, và nhận
// "Bạn không có quyền thực hiện thao tác này" — nút hỏng chứ không phải quyền
// bị từ chối, theo cảm nhận của họ. Giao diện hẹp hơn rules thì mất tính năng
// một cách âm thầm. Cả hai đều là bug, và cả hai đều bắt đầu từ việc chép tay
// điều kiện quyền vào giữa JSX.
// ===========================================================================

/**
 * "Quản lý" của MỘT dự án cụ thể — không phải người mang vai trò 'manager'.
 *
 * ⚠️ Đây là chỗ đã sinh ra lỗi thật: giao diện từng coi mọi tài khoản role
 * 'manager' là quản lý của MỌI dự án. Một người vai trò 'manager' được giao
 * việc trong dự án mà họ KHÔNG quản lý vẫn thấy đủ nút "Sửa Task", "Duyệt công
 * việc", "Nghiệm thu" trên việc của chính mình — trong khi
 * firestore.rules::isManager(projectId) đòi vai trò 'manager' VÀ có tên trong
 * projects/{id}.managers. Bấm nút nào cũng permission-denied.
 *
 * Giữ đúng hai vế đó ở đây. Admin thì mọi dự án (khớp isAdmin()). Director cố ý
 * KHÔNG tính: rules cho họ ghi, nhưng sản phẩm chốt là họ chỉ xem.
 */
export function laQuanLyDuAn(
  profile: { uid: string; role?: UserRole } | null | undefined,
  projectManagers: string[] = []
): boolean {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  return profile.role === 'manager' && projectManagers.includes(profile.uid);
}
