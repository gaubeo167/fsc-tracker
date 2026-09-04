import type { UserProfile } from '../../../types';

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
