import { useEffect, useState } from 'react';
import type { UserRole } from '../../../types';
import { watchRoleAssignments } from '../repository/userAdminRepository';
import { canReadRoleAssignments } from '../services/assignableUsers';
import { CAMPUS_SIDE_ROLES } from '../types';
import { useSupportRole } from './useSupportRole';

// ===========================================================================
// Ai là cán bộ nhà trường — dùng để LOẠI họ khỏi các ô chọn người khi giao việc.
//
// Cán bộ trường (CAMPUS_REPORTER / CAMPUS_FOCAL) vào hệ thống chỉ để gửi và
// theo dõi yêu cầu hỗ trợ. Họ không nhận task, không nghiệm thu task, không
// theo dõi task. Trước đây mọi ô "Người thực hiện / Kiểm duyệt / CC" đổ thẳng
// toàn bộ collection users ra, nên danh sách trộn lẫn hàng chục cán bộ trường
// với vài người thực sự làm việc — chọn nhầm là task rơi vào một người không
// bao giờ mở màn Công việc.
//
// Vì sao không suy ra từ `users.role`: vai trò hỗ trợ nằm ở collection riêng
// `support_role_assignments` (§3 spec cấm thêm field vào `users`), còn
// `users.role` của cán bộ trường là 'user' — giống hệt nhân viên dự án thường.
// ===========================================================================

const EMPTY: ReadonlySet<string> = new Set<string>();

/**
 * Tập uid của cán bộ nhà trường. Cập nhật theo thời gian thực vì admin gán và
 * gỡ vai trò ngay trong app.
 *
 * Nhận cả hồ sơ người đang đăng nhập vì quyền đọc bảng này có hai nguồn: vai
 * trò module Công việc (`profile.role`) và vai trò hỗ trợ (PTUD hay không).
 * Ai không đọc được thì KHÔNG mở listener — xem canReadRoleAssignments().
 *
 * Đọc hỏng (mất mạng) thì trả tập RỖNG, tức là không lọc ai cả. Mặc định an
 * toàn theo hướng không-thay-đổi: thà hiện thừa như trước còn hơn hiện ra một
 * danh sách trống và người dùng không giao được việc cho ai.
 */
export function useCampusStaffUids(
  profile?: { uid?: string; role?: UserRole } | null
): ReadonlySet<string> {
  const [uids, setUids] = useState<ReadonlySet<string>>(EMPTY);
  const { isPtudSide } = useSupportRole(profile?.uid);
  const allowed = canReadRoleAssignments(profile?.role, isPtudSide);

  useEffect(() => {
    if (!allowed) {
      setUids(EMPTY);
      return;
    }
    return watchRoleAssignments(
      (rows) =>
        setUids(
          new Set(
            rows
              .filter((r) => CAMPUS_SIDE_ROLES.includes(r.supportRole))
              .map((r) => r.uid)
          )
        ),
      () => setUids(EMPTY)
    );
  }, [allowed]);

  return uids;
}
