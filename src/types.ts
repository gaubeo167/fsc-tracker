import { Timestamp } from 'firebase/firestore';

export type ProjectStatus = 'active' | 'hidden';
/**
 * Trạng thái công việc.
 *
 * 'todo' ("Sẵn sàng") ĐÃ BỎ khỏi vòng đời: giao việc là bắt đầu làm, không còn
 * bước chờ ở giữa. Ứng dụng KHÔNG bao giờ ghi giá trị này nữa, nhưng nó vẫn
 * nằm trong union vì task tạo trước thay đổi này còn mang nó trong Firestore.
 * normalizeTask() ở App.tsx quy đổi 'todo' -> 'in-progress' ngay lúc đọc.
 *
 * 'overdue' KHÔNG được lưu: nó suy ra từ hạn chót (isTaskOverdue).
 */
export type TaskStatus = 'pending' | 'todo' | 'in-progress' | 'review' | 'rejected' | 'done' | 'overdue';
export type UserRole = 'admin' | 'director' | 'manager' | 'user';
export type Priority = 'low' | 'medium' | 'high' | 'critical';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  role: UserRole;
  photoURL: string;
  status: 'active' | 'disabled' | 'pending';
}

export interface Project {
  id: string;
  name: string;
  description: string;
  managers: string[]; // userIds
  members: string[]; // userIds
  status: ProjectStatus;
  createdAt: Timestamp;
}

export interface SubTask {
  id: string;
  text: string;
  deadline: string;
  completed: boolean;
  comments: TaskComment[];
}

export interface TaskComment {
  id: string;
  userId: string;
  text: string;
  imageUrl?: string;
  time: Timestamp;
}

/**
 * Một lần đổi hạn hoàn thành của công việc.
 *
 * Hạn không phải một ô ngày mà là một CHUỖI các mốc: việc bị chen ngang, bị
 * kéo dài, và ba tháng sau không ai nhớ hạn ban đầu là bao giờ hay vì sao nó
 * trượt. Mỗi lần đổi ghi lại một bản ghi, không bao giờ sửa lại bản ghi cũ —
 * firestore.rules chặn mọi lượt ghi làm danh sách này ngắn đi.
 *
 * `hanCu` rỗng nghĩa là trước đó việc chưa có hạn (phiếu hỗ trợ tiếp nhận ở
 * chế độ "chưa xác định hạn" sinh ra task như vậy).
 */
export interface DeadlineChange {
  id: string;
  hanCu: string;   // yyyy-MM-dd, '' nếu trước đó chưa có hạn
  hanMoi: string;  // yyyy-MM-dd
  lyDo: string;
  userId: string;
  time: Timestamp;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string;
  priority: Priority;
  status: TaskStatus;
  progress: number;
  date: string; // Deadline
  startDate?: string;
  estimatedDuration?: number; // In days
  estimatedDeadline?: string;
  assignees: string[]; // userIds
  reviewers: string[]; // userIds
  cc: string[]; // userIds
  tags: string[];
  attachedImages: string[];
  subtasks: SubTask[];
  comments: TaskComment[];
  createdAt: Timestamp;

  /** Lịch sử đổi hạn, cũ nhất trước. Chỉ được thêm vào, không được sửa hay xoá. */
  deadlineHistory?: DeadlineChange[];

  /**
   * Ngày nghiệm thu (yyyy-MM-dd) và việc đó có trễ hạn không.
   *
   * Phải LƯU chứ không suy ra được: isTaskOverdue() so hạn với hôm nay và luôn
   * trả false cho việc đã xong, nên ngay khi nghiệm thu xong thì dấu vết trễ
   * hạn biến mất vĩnh viễn. Không có hai field này thì không thống kê nổi câu
   * hỏi đầu tiên ai cũng hỏi: trong số việc đã xong, bao nhiêu việc xong muộn.
   */
  doneAt?: string;
  doneLate?: boolean;
}

export interface Review {
  id: string;
  projectId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  rating: number;
  comment: string;
  time: Timestamp;
}

export interface Invitation {
  id: string;
  email: string;
  role: UserRole;
  invitedBy: string;
  invitedAt: Timestamp;
  status: 'pending' | 'accepted';
}

export interface Notification {
  id: string;
  targetUser: string;
  message: string;
  taskId?: string;
  time: Timestamp;
  read: boolean;
}
