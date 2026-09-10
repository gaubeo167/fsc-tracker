import { describe, expect, it } from 'vitest';
import { laQuanLyDuAn } from '../taskPermissions';

// ===========================================================================
// Giao diện phải khớp firestore.rules::isManager(projectId), không rộng hơn.
// Rộng hơn một chút thôi là người dùng bấm nút rồi nhận "Bạn không có quyền
// thực hiện thao tác này" — với họ, nút đó hỏng.
// ===========================================================================

const DU_AN = { managers: ['pm-uid', 'admin-uid'] };

describe('laQuanLyDuAn', () => {
  it('⭐ role "manager" nhưng KHÔNG quản lý dự án này thì không phải quản lý', () => {
    // Đúng tài khoản đã gặp lỗi thật: được giao việc trong một dự án mà mình
    // không quản lý, và thấy đủ nút Sửa/Duyệt/Nghiệm thu.
    expect(laQuanLyDuAn({ uid: 'tin-uid', role: 'manager' }, DU_AN.managers)).toBe(false);
  });

  it('role "manager" VÀ có tên trong managers thì đúng là quản lý', () => {
    expect(laQuanLyDuAn({ uid: 'pm-uid', role: 'manager' }, DU_AN.managers)).toBe(true);
  });

  it('admin thì mọi dự án, kể cả không có tên trong managers', () => {
    expect(laQuanLyDuAn({ uid: 'ai-do', role: 'admin' }, DU_AN.managers)).toBe(true);
  });

  it('⭐ có tên trong managers nhưng role "user" thì KHÔNG', () => {
    // rules::isManager đòi cả hai vế. Nhận ở đây mà rules từ chối thì lại đúng
    // cái vòng "nút hỏng" nhưng ngược chiều.
    expect(laQuanLyDuAn({ uid: 'pm-uid', role: 'user' }, ['pm-uid'])).toBe(false);
  });

  it('director chỉ xem, không phải quản lý', () => {
    expect(laQuanLyDuAn({ uid: 'sep', role: 'director' }, ['sep'])).toBe(false);
  });

  it('chưa đăng nhập, hoặc dự án chưa nạp xong danh sách managers', () => {
    expect(laQuanLyDuAn(null, DU_AN.managers)).toBe(false);
    expect(laQuanLyDuAn({ uid: 'pm-uid', role: 'manager' })).toBe(false);
  });
});
