import { describe, expect, it } from 'vitest';
import { shouldActivateOnAssign } from '../repository/userAdminRepository';

// ===========================================================================
// ISSUE-003 — regression.
//
// Gán loại thành viên ở màn Nhân sự phải kích hoạt luôn tài khoản chưa được
// kích hoạt. Bản cũ hỏi `userStatus === 'pending'`, nên nó bỏ sót đúng nhóm
// tài khoản KHÔNG có cách nào duyệt được nữa: hàng đợi "Duyệt tài khoản" truy
// vấn status == 'pending' nên cũng không thấy họ. Gán xong, huy hiệu loại thành
// viên hiện lên, admin tưởng đã duyệt — còn người kia thì vào được form gửi
// phiếu mà tải ảnh lên báo "không có quyền".
// ===========================================================================

describe('shouldActivateOnAssign', () => {
  it('KHÔNG đụng tới tài khoản đã hoạt động', () => {
    expect(shouldActivateOnAssign('active')).toBe(false);
  });

  it('KHÔNG âm thầm bật lại tài khoản đã bị từ chối', () => {
    // 'disabled' là quyết định có chủ đích của admin (rejectUser). Gán loại
    // thành viên không được phép lật lại nó sau lưng người đã bấm từ chối.
    expect(shouldActivateOnAssign('disabled')).toBe(false);
  });

  it('kích hoạt tài khoản đang chờ duyệt', () => {
    expect(shouldActivateOnAssign('pending')).toBe(true);
  });

  it('kích hoạt hồ sơ THIẾU field status — đây là ISSUE-003', () => {
    // Hồ sơ cũ sinh ra trước khi có cổng duyệt. Không có nhánh này thì không
    // còn chỗ nào trong giao diện duyệt được cho họ.
    expect(shouldActivateOnAssign(undefined)).toBe(true);
  });

  it('kích hoạt hồ sơ có status lạ, không nằm trong ba giá trị đã biết', () => {
    expect(shouldActivateOnAssign('approved')).toBe(true);
    expect(shouldActivateOnAssign('')).toBe(true);
  });
});
