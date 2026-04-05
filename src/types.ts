import { Timestamp } from 'firebase/firestore';

export type ProjectStatus = 'active' | 'hidden';
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
