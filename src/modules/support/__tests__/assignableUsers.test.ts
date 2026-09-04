import { describe, expect, it } from 'vitest';
import type { UserProfile } from '../../../types';
import { filterAssignableUsers } from '../services/assignableUsers';

// ===========================================================================
// Cán bộ nhà trường không được hiện ra ở các ô chọn người khi giao việc: họ vào
// hệ thống để gửi yêu cầu hỗ trợ, không nhận task.
// ===========================================================================

function user(uid: string): UserProfile {
  return {
    uid,
    displayName: `User ${uid}`,
    email: `${uid}@fpt.edu.vn`,
    role: 'user',
    photoURL: '',
    status: 'active',
  };
}

const DANH_SACH = [user('dev'), user('gv-truong'), user('quan-ly')];
const CAN_BO_TRUONG = new Set(['gv-truong']);

describe('filterAssignableUsers', () => {
  it('bỏ cán bộ nhà trường khỏi danh sách', () => {
    const con_lai = filterAssignableUsers(DANH_SACH, CAN_BO_TRUONG).map((u) => u.uid);
    expect(con_lai).toEqual(['dev', 'quan-ly']);
  });

  it('giữ nguyên danh sách khi chưa biết ai là cán bộ trường', () => {
    // Đọc support_role_assignments hỏng thì tập rỗng, và màn giao việc phải
    // hoạt động y như trước chứ không được trống trơn.
    const con_lai = filterAssignableUsers(DANH_SACH, new Set<string>()).map((u) => u.uid);
    expect(con_lai).toEqual(['dev', 'gv-truong', 'quan-ly']);
  });

  it('vẫn hiện cán bộ trường đã lỡ được gán vào task, để còn gỡ ra', () => {
    const con_lai = filterAssignableUsers(DANH_SACH, CAN_BO_TRUONG, ['gv-truong']).map((u) => u.uid);
    expect(con_lai).toEqual(['dev', 'gv-truong', 'quan-ly']);
  });
});
