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
