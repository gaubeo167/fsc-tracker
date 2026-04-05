import React, { useState, useEffect, createContext, useContext, Component } from 'react';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut, 
  User as FirebaseUser 
} from 'firebase/auth';
import { 
  collection, 
  query, 
  where, 
  or,
  collectionGroup,
  onSnapshot, 
  doc, 
  getDoc, 
  getDocs,
  setDoc, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  Timestamp,
  orderBy
} from 'firebase/firestore';
import { 
  LayoutDashboard, 
  Briefcase, 
  CheckSquare, 
  BarChart3, 
  Users, 
  LogOut, 
  Plus, 
  Search, 
  Bell, 
  Settings, 
  ChevronRight, 
  Clock, 
  MessageSquare, 
  Star,
  MoreVertical,
  Trash2,
  Edit2,
  Share2,
  ExternalLink,
  ArrowLeft,
  List,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Play,
  Check,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Image as ImageIcon,
  Loader2,
  Filter,
  User as UserIcon,
  AlertCircle,
  Activity,
  Info,
  X,
  Menu,
  ShieldCheck,
  Eye,
  Save,
  Edit3,
  FileText,
  Send,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  Legend
} from 'recharts';
import { format, addDays } from 'date-fns';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { auth, db, googleProvider, handleFirestoreError, OperationType } from './firebase';
import { Project, Task, SubTask, Review, UserProfile, ProjectStatus, TaskStatus, UserRole, TaskComment, Priority, Invitation } from './types';

// Utility for Tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const getProgressColor = (progress: number) => {
  if (progress <= 30) return 'bg-red-500';
  if (progress <= 70) return 'bg-blue-500';
  return 'bg-emerald-500';
};

const getProgressAccent = (progress: number) => {
  if (progress <= 30) return 'accent-red-500';
  if (progress <= 70) return 'accent-blue-500';
  return 'accent-emerald-500';
};

const getDeadlineStyle = (dateStr: string, status: TaskStatus) => {
  if (status === 'done') return 'text-slate-500';
  if (!dateStr) return 'text-slate-500';
  
  const deadline = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const diffTime = deadline.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return 'text-red-600 font-bold';
  if (diffDays <= 7) return 'text-amber-600 font-bold';
  return 'text-slate-600';
};

const isTaskOverdue = (task: Task) => {
  if (task.status === 'done') return false;
  if (!task.date) return false;
  const deadline = new Date(task.date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return deadline < today;
};

// Contexts
interface ToastContextType {
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <AnimatePresence>
        {toast && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className={cn(
              "fixed bottom-8 left-1/2 z-[200] px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 min-w-[300px]",
              toast.type === 'success' ? "bg-emerald-600 text-white" : 
              toast.type === 'error' ? "bg-red-600 text-white" : "bg-slate-800 text-white"
            )}
          >
            {toast.type === 'success' && <CheckCircle2 size={18} />}
            {toast.type === 'error' && <AlertCircle size={18} />}
            {toast.type === 'info' && <Bell size={18} />}
            <span className="text-sm font-bold">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </ToastContext.Provider>
  );
};

const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

// Auth Context
interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const { showToast } = useToast();
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log('AuthProvider: Initializing auth state listener...');
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('AuthProvider: Auth state changed:', user?.email);
      try {
        if (user) {
          // Domain check
          const email = user.email || '';
          const isInternal = email.endsWith('@fe.edu.vn') || email.endsWith('@fpt.edu.vn');
          const isDev = email === 'viet88.nb@gmail.com';
          
          if (!isInternal && !isDev) {
            console.warn('AuthProvider: Non-internal email detected:', email);
            await signOut(auth);
            setError('Chỉ chấp nhận email nội bộ @fe.edu.vn hoặc @fpt.edu.vn. Vui lòng sử dụng tài khoản trường cấp.');
            setUser(null);
            setProfile(null);
            setLoading(false);
            return;
          }

          // Set user only after domain validation
          setUser(user);
          setError(null); // Clear error on successful login

          console.log('AuthProvider: Fetching user profile for:', user.uid);
          const userDoc = await getDoc(doc(db, 'users', user.uid));
          if (userDoc.exists()) {
            console.log('AuthProvider: Profile found');
            setProfile(userDoc.data() as UserProfile);
          } else {
            console.log('AuthProvider: Creating new profile');
            // Default role is 'user' for everyone except the hardcoded admin
            const defaultRole: UserRole = email === 'vietnb4@fpt.edu.vn' ? 'admin' : 'user';
            
            const newProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'User',
              email: email,
              photoURL: user.photoURL || '',
              role: defaultRole,
              status: 'active'
            };
            await setDoc(doc(db, 'users', user.uid), newProfile);
            setProfile(newProfile);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err: any) {
        console.error('AuthProvider: Auth state change error:', err);
        setError(err.message || 'Lỗi xác thực');
        handleFirestoreError(err, OperationType.GET, 'users');
      } finally {
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  const signIn = async () => {
    try {
      setError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.error('AuthProvider: Sign in error:', err);
      if (err.code === 'auth/network-request-failed') {
        setError('Lỗi mạng (auth/network-request-failed): Vui lòng kiểm tra kết nối hoặc đảm bảo bạn đã cho phép popup và cookie bên thứ ba trong trình duyệt.');
      } else {
        setError(err.message || 'Lỗi đăng nhập');
      }
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (err: any) {
      console.error('AuthProvider: Logout error:', err);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, error, signIn, logout }}>
      {children}
      {error && (
        <div className="fixed bottom-4 right-4 z-50 bg-red-50 border border-red-200 p-4 rounded-xl shadow-lg max-w-sm animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="text-red-500 shrink-0 mt-0.5" size={18} />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-900">Lỗi hệ thống</p>
              <p className="text-xs text-red-700 mt-1">{error}</p>
              <div className="flex gap-4 mt-3">
                <button 
                  onClick={() => window.location.reload()}
                  className="text-xs font-bold text-red-900 hover:underline"
                >
                  Tải lại trang
                </button>
                <button 
                  onClick={logout}
                  className="text-xs font-bold text-red-500 hover:underline"
                >
                  Đăng xuất
                </button>
              </div>
            </div>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </AuthContext.Provider>
  );
}

const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

// Components
const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, ...props }) => (
  <div className={cn("bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden", className)} {...props}>
    {children}
  </div>
);

// Comment Prompt Modal
const CommentPromptModal = ({ 
  title, 
  onConfirm, 
  onCancel, 
  placeholder = "Nhập ghi chú...",
  confirmText = "Xác nhận",
  variant = "primary"
}: { 
  title: string; 
  onConfirm: (comment: string) => void; 
  onCancel: () => void; 
  placeholder?: string;
  confirmText?: string;
  variant?: "primary" | "danger" | "success"
}) => {
  const [comment, setComment] = useState('');
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-bold mb-4 text-slate-900">{title}</h3>
        <textarea 
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="w-full h-32 p-3 border rounded-xl mb-4 focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
          placeholder={placeholder}
          autoFocus
        />
        <div className="flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onCancel}>Hủy</Button>
          <Button 
            variant={variant === 'danger' ? 'danger' : 'primary'} 
            className={cn("flex-1", variant === 'success' && "bg-emerald-600 hover:bg-emerald-700")}
            onClick={() => onConfirm(comment)}
          >
            {confirmText}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

const TaskCard: React.FC<{ 
  task: Task; 
  projectManagers?: string[];
  onUpdateStatus?: (task: Task, status: TaskStatus, comment?: string) => void | Promise<void> 
}> = ({ task, projectManagers = [], onUpdateStatus }) => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const isReviewer = task.reviewers?.includes(profile?.uid || '') || false;
  const isAssignee = task.assignees?.includes(profile?.uid || '') || false;
  const isManager = projectManagers.includes(profile?.uid || '');
  const [showActionCommentModal, setShowActionCommentModal] = useState<{ status: TaskStatus; title: string; variant: "primary" | "danger" | "success" } | null>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
    return unsub;
  }, []);

  const canEdit = profile?.role === 'admin' || isManager;
  const toggleSubtask = async (subtaskId: string) => {
    const newSubtasks = task.subtasks.map(s => 
      s.id === subtaskId ? { ...s, completed: !s.completed } : s
    );
    const completedCount = newSubtasks.filter(s => s.completed).length;
    const progress = Math.round((completedCount / newSubtasks.length) * 100);
    
    let newStatus = task.status;
    if (task.status !== 'pending' && task.status !== 'review' && task.status !== 'done') {
      if (progress > 0 && progress < 100) newStatus = 'in-progress';
      if (progress === 100) newStatus = 'review';
    }

    try {
      if (!task.projectId) throw new Error('Missing projectId');
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { 
        subtasks: newSubtasks,
        progress,
        status: newStatus
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const handleProgressChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (task.status === 'pending') {
      showToast('Task chưa được duyệt, không thể cập nhật tiến độ', 'error');
      return;
    }
    
    const progress = parseInt(e.target.value);
    let newStatus = task.status;
    
    if (progress === 0) {
      newStatus = 'todo';
    } else if (progress > 0 && progress < 100) {
      newStatus = 'in-progress';
    } else if (progress === 100) {
      newStatus = 'review';
    }
    
    try {
      if (!task.projectId) throw new Error('Missing projectId');
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { progress, status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  return (
    <Card 
      className="p-4 hover:shadow-md transition-shadow group space-y-3 relative cursor-pointer" 
      onClick={() => setShowEditModal(true)}
    >
      <div className="flex justify-between items-start">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={
            task.priority === 'critical' ? 'danger' : 
            task.priority === 'high' ? 'warning' : 
            task.priority === 'medium' ? 'info' : 'neutral'
          }>
            {task.priority.toUpperCase()}
          </Badge>
          


          <Badge variant={
            isTaskOverdue(task) ? 'danger' :
            task.status === 'done' ? 'success' :
            task.status === 'rejected' ? 'danger' :
            task.status === 'in-progress' ? 'info' : 
            task.status === 'review' ? 'sky' :
            task.status === 'pending' ? 'warning' : 'neutral'
          }>
            {isTaskOverdue(task) ? 'QUÁ HẠN' :
             task.status === 'pending' ? 'CHỜ DUYỆT' :
             task.status === 'todo' ? 'SẴN SÀNG' :
             task.status === 'in-progress' ? 'ĐANG LÀM' :
             task.status === 'review' ? 'CHỜ NGHIỆM THU' :
             task.status === 'rejected' ? 'BỊ TỪ CHỐI' : 'HOÀN THÀNH'}
          </Badge>
        </div>
        <span className={cn("text-[10px] font-mono whitespace-nowrap", getDeadlineStyle(task.date, task.status))}>
          {task.date}
        </span>
      </div>
      
      <div className="flex items-start gap-2">
        <h4 className="font-bold text-slate-900 text-sm leading-tight hover:text-indigo-600 flex-1">
          {task.title}
        </h4>
        <div className="flex flex-col gap-1 shrink-0">
          {task.status === 'pending' && (
            <Badge variant="warning" className="animate-pulse text-[8px] py-0 px-1">CẦN DUYỆT</Badge>
          )}
          {task.status === 'review' && (
            <Badge variant="sky" className="animate-pulse text-[8px] py-0 px-1">NGHIỆM THU</Badge>
          )}
          {isTaskOverdue(task) && (
            <Badge variant="danger" className="animate-pulse text-[8px] py-0 px-1">QUÁ HẠN</Badge>
          )}
        </div>
      </div>
      
      {(task.subtasks.length > 0 || !(isAssignee && (task.status === 'todo' || task.status === 'in-progress' || task.status === 'rejected'))) && (
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-slate-500">
            <span>{task.subtasks.length > 0 ? 'Checklist' : 'Tiến độ'}</span>
            <span>{task.subtasks.length > 0 ? `${task.subtasks.filter(s => s.completed).length}/${task.subtasks.length}` : `${task.progress || 0}%`}</span>
          </div>
          <div className="w-full bg-slate-100 h-1 rounded-full overflow-hidden">
            <div 
              className={cn("h-full transition-all", getProgressColor(task.subtasks.length > 0 ? Math.round((task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100) : (task.progress || 0)))} 
              style={{ width: `${task.subtasks.length > 0 ? (task.subtasks.filter(s => s.completed).length / task.subtasks.length) * 100 : (task.progress || 0)}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-slate-50">
        <div className="flex -space-x-1.5 items-center">
          {task.assignees?.slice(0, 5).map(uid => {
            const u = users.find(user => user.uid === uid);
            return (
              <img 
                key={uid} 
                src={u?.photoURL || `https://ui-avatars.com/api/?name=${uid}`} 
                className="w-6 h-6 rounded-full border-2 border-white shadow-sm" 
                title={u?.displayName || 'User'}
                referrerPolicy="no-referrer" 
              />
            );
          })}
          {(task.assignees?.length || 0) > 5 && (
            <div className="w-6 h-6 rounded-full bg-slate-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-slate-500">
              +{(task.assignees?.length || 0) - 5}
            </div>
          )}
        </div>
        
        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
          {task.status === 'pending' && isReviewer && onUpdateStatus && (
            <button 
              onClick={() => setShowActionCommentModal({ status: 'todo', title: 'Phê duyệt công việc', variant: 'success' })}
              className="p-1.5 bg-sky-50 text-sky-600 rounded-lg hover:bg-sky-100 transition-colors"
              title="Duyệt cho phép làm"
            >
              <Play size={14} />
            </button>
          )}
          
          {task.status === 'review' && isReviewer && onUpdateStatus && (
            <>
              <button 
                onClick={() => setShowActionCommentModal({ status: 'done', title: 'Nghiệm thu hoàn thành', variant: 'success' })}
                className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100 transition-colors"
                title="Nghiệm thu"
              >
                <Check size={14} />
              </button>
              <button 
                onClick={() => setShowActionCommentModal({ status: 'rejected', title: 'Từ chối công việc', variant: 'danger' })}
                className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                title="Từ chối"
              >
                <XCircle size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {isAssignee && (task.status === 'todo' || task.status === 'in-progress' || task.status === 'rejected') && task.subtasks.length === 0 && (
        <div className="pt-2">
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={task.progress || 0} 
            onChange={handleProgressChange}
            onClick={(e) => e.stopPropagation()}
            className={cn("w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer", getProgressAccent(task.progress || 0))}
            style={{ 
              background: `linear-gradient(to right, ${task.progress <= 50 ? '#ef4444' : task.progress <= 80 ? '#fbbf24' : '#10b981'} ${task.progress || 0}%, #f1f5f9 ${task.progress || 0}%)` 
            }}
          />
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>Tiến độ</span>
            <span>{task.progress}%</span>
          </div>
        </div>
      )}

      {showEditModal && (
        <TaskEditModal 
          task={task} 
          users={users} 
          projectManagers={projectManagers}
          onClose={() => setShowEditModal(false)} 
        />
      )}
    </Card>
  );
};

const TaskListItem: React.FC<{ 
  task: Task; 
  projectManagers?: string[];
  onUpdateStatus?: (task: Task, status: TaskStatus, comment?: string) => void | Promise<void> 
}> = ({ task, projectManagers = [], onUpdateStatus }) => {
  const { profile } = useAuth();
  const isReviewer = task.reviewers?.includes(profile?.uid || '') || false;
  const isManager = projectManagers.includes(profile?.uid || '');
  const [showEditModal, setShowEditModal] = useState(false);
  const [showActionCommentModal, setShowActionCommentModal] = useState<{ status: TaskStatus; title: string; variant: "primary" | "danger" | "success" } | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));
    return unsub;
  }, []);

  const canEdit = profile?.role === 'admin' || isManager;
  
  return (
    <Card 
      className="p-3 flex items-center gap-4 hover:bg-slate-50 transition-colors group relative cursor-pointer" 
      onClick={() => setShowEditModal(true)}
    >
      {showActionCommentModal && (
        <CommentPromptModal 
          title={showActionCommentModal.title}
          variant={showActionCommentModal.variant}
          onConfirm={(comment) => {
            if (onUpdateStatus) onUpdateStatus(task, showActionCommentModal.status, comment);
            setShowActionCommentModal(null);
          }}
          onCancel={() => setShowActionCommentModal(null)}
          placeholder={`Nhập lý do/ghi chú ${showActionCommentModal.status === 'rejected' ? 'từ chối' : 'phê duyệt'}...`}
        />
      )}

      <div className={cn("w-2 h-10 rounded-full", 
        isTaskOverdue(task) ? "bg-red-500" :
        task.status === 'pending' ? "bg-amber-400" :
        task.status === 'todo' ? "bg-slate-300" : 
        task.status === 'in-progress' ? "bg-blue-500" : 
        task.status === 'review' ? "bg-sky-400" : 
        task.status === 'rejected' ? "bg-red-500" : "bg-emerald-500"
      )} />
      
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="font-bold text-slate-900 text-sm truncate max-w-[250px]">{task.title}</h4>
          <Badge variant={
            task.priority === 'critical' ? 'danger' : 
            task.priority === 'high' ? 'warning' : 
            task.priority === 'medium' ? 'info' : 'neutral'
          }>
            {task.priority.toUpperCase()}
          </Badge>
          <Badge variant={
            isTaskOverdue(task) ? 'danger' :
            task.status === 'done' ? 'success' :
            task.status === 'rejected' ? 'danger' :
            task.status === 'in-progress' ? 'info' : 
            task.status === 'review' ? 'sky' :
            task.status === 'pending' ? 'warning' : 'neutral'
          }>
            {isTaskOverdue(task) ? 'QUÁ HẠN' :
             task.status === 'pending' ? 'CHỜ DUYỆT' :
             task.status === 'todo' ? 'SẴN SÀNG' :
             task.status === 'in-progress' ? 'ĐANG LÀM' :
             task.status === 'review' ? 'CHỜ NGHIỆM THU' :
             task.status === 'rejected' ? 'BỊ TỪ CHỐI' : 'HOÀN THÀNH'}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          {task.status === 'pending' && (
            <Badge variant="warning" className="animate-pulse text-[8px] py-0 px-1">CẦN DUYỆT</Badge>
          )}
          {task.status === 'review' && (
            <Badge variant="sky" className="animate-pulse text-[8px] py-0 px-1">NGHIỆM THU</Badge>
          )}
          {isTaskOverdue(task) && (
            <Badge variant="danger" className="animate-pulse text-[8px] py-0 px-1">QUÁ HẠN</Badge>
          )}
        </div>
        <div className="flex items-center gap-4 text-[10px]">
          <span className={cn("flex items-center gap-1", getDeadlineStyle(task.date, task.status))}>
            <Clock size={12} /> {task.date}
          </span>
          <div className="flex items-center gap-1">
            <Users size={12} className="text-slate-400" />
          <div className="flex -space-x-1.5">
            {task.assignees?.slice(0, 5).map(uid => {
              const u = users.find(user => user.uid === uid);
              return (
                <img 
                  key={uid} 
                  src={u?.photoURL || `https://ui-avatars.com/api/?name=${uid}`} 
                  className="w-5 h-5 rounded-full border-2 border-white shadow-sm" 
                  title={u?.displayName || 'User'}
                  referrerPolicy="no-referrer" 
                />
              );
            })}
          </div>
          </div>
          <span className="flex items-center gap-1 text-slate-500" title="Người kiểm duyệt"><ShieldCheck size={12} /> {task.reviewers?.length || 0}</span>
          <span className="flex items-center gap-1 text-slate-500" title="CC theo dõi"><Eye size={12} /> {task.cc?.length || 0}</span>
          <span className="flex items-center gap-1 text-slate-500"><MessageSquare size={12} /> {task.comments?.length || 0}</span>
          {task.attachedImages && task.attachedImages.length > 0 && (
            <span className="flex items-center gap-1 text-indigo-500 font-bold"><ImageIcon size={12} /> {task.attachedImages.length} ảnh</span>
          )}
        </div>
      </div>

      <div className="w-32 hidden md:block">
        <div className="flex justify-between text-[10px] text-slate-500 mb-1">
          <span>Tiến độ</span>
          <span>{task.progress}%</span>
        </div>
        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
          <div className={cn("h-full transition-all", getProgressColor(task.progress || 0))} style={{ width: `${task.progress}%` }} />
        </div>
      </div>

      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
        {task.status === 'pending' && isReviewer && onUpdateStatus && (
          <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => setShowActionCommentModal({ status: 'todo', title: 'Phê duyệt công việc', variant: 'success' })}>
            DUYỆT
          </Button>
        )}
        {task.status === 'review' && isReviewer && onUpdateStatus && (
          <div className="flex gap-1">
            <Button variant="primary" className="h-8 px-3 text-xs bg-emerald-600" onClick={() => setShowActionCommentModal({ status: 'done', title: 'Nghiệm thu hoàn thành', variant: 'success' })}>
              NGHIỆM THU
            </Button>
            <Button variant="danger" className="h-8 px-3 text-xs" onClick={() => setShowActionCommentModal({ status: 'rejected', title: 'Từ chối công việc', variant: 'danger' })}>
              TỪ CHỐI
            </Button>
          </div>
        )}
      </div>

      {showEditModal && (
        <TaskEditModal 
          task={task} 
          users={users} 
          projectManagers={projectManagers}
          onClose={() => setShowEditModal(false)} 
        />
      )}
    </Card>
  );
};

const Button = ({ 
  children, 
  variant = 'primary', 
  className, 
  ...props 
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) => {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-50",
    danger: "bg-red-50 text-red-600 hover:bg-red-100"
  };
  return (
    <button 
      className={cn("px-4 py-2 rounded-lg font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50", variants[variant], className)} 
      {...props}
    >
      {children}
    </button>
  );
};

const Badge = ({ children, variant = 'neutral', className }: { children: React.ReactNode; variant?: 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'primary' | 'sky'; className?: string }) => {
  const variants = {
    neutral: "bg-slate-100 text-slate-600",
    success: "bg-emerald-100 text-emerald-700",
    warning: "bg-amber-100 text-amber-700",
    info: "bg-blue-100 text-blue-700",
    danger: "bg-red-100 text-red-700",
    primary: "bg-indigo-100 text-indigo-700",
    sky: "bg-sky-100 text-sky-700"
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider", variants[variant], className)}>
      {children}
    </span>
  );
};

const NotificationCenter = () => {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!profile) return;
    const q = query(
      collection(db, 'notifications'), 
      where('targetUserId', '==', profile.uid)
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const notifs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setNotifications(notifs.sort((a: any, b: any) => (b.time?.toMillis() || 0) - (a.time?.toMillis() || 0)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'notifications'));
    return unsubscribe;
  }, [profile]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors relative"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden"
            >
              <div className="p-4 border-b border-slate-50 flex justify-between items-center">
                <h3 className="font-bold text-slate-900">Thông báo</h3>
                <span className="text-xs text-slate-400">{unreadCount} tin mới</span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">Không có thông báo nào</div>
                ) : (
                  notifications.map(n => (
                    <div 
                      key={n.id} 
                      onClick={() => markAsRead(n.id)}
                      className={cn("p-4 border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer", !n.read && "bg-indigo-50/30")}
                    >
                      <p className="text-sm text-slate-700 leading-snug">{n.message}</p>
                      <span className="text-[10px] text-slate-400 mt-1 block">
                        {format(n.time?.toDate() || new Date(), 'HH:mm dd/MM')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

// Views
const TaskEditModal = ({ task, users, projectManagers = [], onClose }: { task: Task; users: UserProfile[]; projectManagers?: string[]; onClose: () => void }) => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [projectName, setProjectName] = useState<string>('');
  const [editedTask, setEditedTask] = useState({ 
    ...task,
    title: task.title || '',
    description: task.description || '',
    category: task.category || '',
    priority: task.priority || 'medium',
    date: task.date || format(new Date(), 'yyyy-MM-dd'),
    assignees: task.assignees || [],
    reviewers: task.reviewers || [],
    cc: task.cc || [],
    tags: task.tags || [],
    attachedImages: task.attachedImages || [],
    progress: task.progress || 0,
    status: task.status || 'todo',
    subtasks: task.subtasks || [],
    comments: task.comments || []
  });
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentImage, setCommentImage] = useState<string | null>(null);
  const [newSubtask, setNewSubtask] = useState({ text: '', deadline: task.date || format(new Date(), 'yyyy-MM-dd') });
  const [activeSubtaskComment, setActiveSubtaskComment] = useState<string | null>(null);
  const [subtaskCommentText, setSubtaskCommentText] = useState('');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showActionCommentModal, setShowActionCommentModal] = useState<{ status: TaskStatus; title: string; variant: "primary" | "danger" | "success" } | null>(null);

  const isManager = (profile?.role === 'manager' || profile?.role === 'admin' || projectManagers.includes(profile?.uid || '')) && profile?.role !== 'director';
  const isAdmin = profile?.role === 'admin';
  const isAssignee = editedTask.assignees?.includes(profile?.uid || '') || false;

  useEffect(() => {
    if (task.projectId) {
      getDoc(doc(db, 'projects', task.projectId)).then(docSnap => {
        if (docSnap.exists()) {
          setProjectName(docSnap.data().name);
        }
      });
    }
  }, [task.projectId]);

  const calculateProgress = (subtasks: SubTask[]) => {
    if (subtasks.length === 0) return editedTask.progress;
    const completedCount = subtasks.filter(s => s.completed).length;
    return Math.round((completedCount / subtasks.length) * 100);
  };

  const addSubtaskComment = async (subtaskId: string) => {
    if (!subtaskCommentText.trim() || !profile) return;
    
    const newCommentObj: TaskComment = {
      id: Math.random().toString(36).substr(2, 9),
      userId: profile.uid,
      text: subtaskCommentText,
      time: Timestamp.now()
    };

    const newSubtasks = editedTask.subtasks.map(s => 
      s.id === subtaskId ? { ...s, comments: [...(s.comments || []), newCommentObj] } : s
    );

    setEditedTask({ ...editedTask, subtasks: newSubtasks });
    setSubtaskCommentText('');
    setActiveSubtaskComment(null);

    try {
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { subtasks: newSubtasks });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      const taskData = {
        title: editedTask.title || '',
        description: editedTask.description || '',
        category: editedTask.category || '',
        priority: editedTask.priority || 'medium',
        date: editedTask.date || '',
        assignees: editedTask.assignees || [],
        reviewers: editedTask.reviewers || [],
        cc: editedTask.cc || [],
        tags: editedTask.tags || [],
        attachedImages: editedTask.attachedImages || [],
        progress: editedTask.progress || 0,
        status: editedTask.status || 'todo',
        subtasks: (editedTask.subtasks || []).map(s => ({
          ...s,
          comments: (s.comments || []).map(c => {
            const cleanComment: any = { ...c };
            Object.keys(cleanComment).forEach(key => {
              if (cleanComment[key] === undefined) delete cleanComment[key];
            });
            return cleanComment;
          })
        })),
        comments: (editedTask.comments || []).map(c => {
          const cleanComment: any = { ...c };
          Object.keys(cleanComment).forEach(key => {
            if (cleanComment[key] === undefined) delete cleanComment[key];
          });
          return cleanComment;
        })
      };

      if (!task.projectId) throw new Error('Missing projectId');
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), taskData);

      // Send notifications for involvement changes
      const oldTargets = new Set([...(task.assignees || []), ...(task.reviewers || []), ...(task.cc || [])]);
      const newTargets = new Set([...(editedTask.assignees || []), ...(editedTask.reviewers || []), ...(editedTask.cc || [])]);
      
      const addedTargets = [...newTargets].filter(id => !oldTargets.has(id) && id !== profile?.uid);
      for (const targetId of addedTargets) {
        await addDoc(collection(db, 'notifications'), {
          targetUserId: targetId,
          message: `Bạn được thêm vào công việc: "${task.title}"`,
          taskId: task.id,
          read: false,
          time: Timestamp.now()
        });
      }

      // If status changed to review, notify reviewers and managers
      if (editedTask.status === 'review' && task.status !== 'review') {
        const reviewTargets = [...new Set([...(editedTask.reviewers || []), ...projectManagers])].filter(id => id !== profile?.uid);
        for (const targetId of reviewTargets) {
          await addDoc(collection(db, 'notifications'), {
            targetUserId: targetId,
            message: `Công việc "${task.title}" đang chờ bạn nghiệm thu`,
            taskId: task.id,
            read: false,
            time: Timestamp.now()
          });
        }
      }

      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    } finally {
      setLoading(false);
    }
  };

  const addMainComment = async () => {
    if ((!newComment.trim() && !commentImage) || !profile) return;
    const comment: TaskComment = {
      id: Math.random().toString(36).substr(2, 9),
      userId: profile.uid,
      text: newComment,
      time: Timestamp.now()
    };
    if (commentImage) comment.imageUrl = commentImage;
    
    const updatedComments = [...editedTask.comments, comment];
    setEditedTask({ ...editedTask, comments: updatedComments });
    setNewComment('');
    setCommentImage(null);

    try {
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { 
        comments: updatedComments.map(c => {
          const cleanComment: any = { ...c };
          Object.keys(cleanComment).forEach(key => {
            if (cleanComment[key] === undefined) delete cleanComment[key];
          });
          return cleanComment;
        })
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const addSubtask = async () => {
    if (!newSubtask.text.trim()) return;
    const sub: SubTask = {
      id: Math.random().toString(36).substr(2, 9),
      text: newSubtask.text,
      deadline: newSubtask.deadline,
      completed: false,
      comments: []
    };
    const newSubtasks = [...editedTask.subtasks, sub];
    const progress = calculateProgress(newSubtasks);
    
    setEditedTask({ 
      ...editedTask, 
      subtasks: newSubtasks,
      progress
    });
    setNewSubtask({ text: '', deadline: editedTask.date });

    try {
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { 
        subtasks: newSubtasks,
        progress
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const removeSubtask = async (id: string) => {
    const newSubtasks = editedTask.subtasks.filter(s => s.id !== id);
    const progress = calculateProgress(newSubtasks);
    
    setEditedTask({ 
      ...editedTask, 
      subtasks: newSubtasks,
      progress
    });

    try {
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { 
        subtasks: newSubtasks,
        progress
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const toggleSubtask = async (id: string) => {
    const newSubtasks = editedTask.subtasks.map(s => 
      s.id === id ? { ...s, completed: !s.completed } : s
    );
    const progress = calculateProgress(newSubtasks);
    let newStatus = editedTask.status;
    if (editedTask.status !== 'pending' && editedTask.status !== 'review' && editedTask.status !== 'done') {
      if (progress > 0 && progress < 100) newStatus = 'in-progress';
      if (progress === 100) newStatus = 'review';
    }
    
    setEditedTask({ 
      ...editedTask, 
      subtasks: newSubtasks,
      progress,
      status: newStatus
    });

    try {
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { 
        subtasks: newSubtasks.map(s => ({
          ...s,
          comments: (s.comments || []).map(c => {
            const cleanComment: any = { ...c };
            Object.keys(cleanComment).forEach(key => {
              if (cleanComment[key] === undefined) delete cleanComment[key];
            });
            return cleanComment;
          })
        })),
        progress,
        status: newStatus
      });

      // Notify reviewers if task reached review status
      if (newStatus === 'review' && task.status !== 'review') {
        const reviewTargets = [...new Set([...(task.reviewers || []), ...projectManagers])].filter(id => id !== profile?.uid);
        for (const targetId of reviewTargets) {
          await addDoc(collection(db, 'notifications'), {
            targetUserId: targetId,
            message: `Công việc "${task.title}" đã hoàn thành và đang chờ bạn nghiệm thu`,
            taskId: task.id,
            read: false,
            time: Timestamp.now()
          });
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const handleApprovalAction = async (newStatus: TaskStatus, actionComment?: string) => {
    if (!profile) return;
    setLoading(true);
    try {
      let finalStatus = newStatus;
      if (newStatus === 'rejected') {
        if (task.status === 'review') {
          finalStatus = 'in-progress';
        } else if (task.status === 'pending') {
          finalStatus = 'rejected';
        }
      }

      let updatedComments = editedTask.comments;
      const baseCommentText = actionComment || newComment.trim() || (newStatus === 'rejected' ? 'Từ chối công việc' : newStatus === 'todo' ? 'Đã duyệt công việc' : 'Đã nghiệm thu công việc');
      
      let finalCommentText = baseCommentText;
      if (newStatus === 'done') {
        finalCommentText = `[ĐÃ NGHIỆM THU] ${baseCommentText}`;
      } else if (newStatus === 'todo' && task.status === 'pending') {
        finalCommentText = `[ĐÃ DUYỆT] ${baseCommentText}`;
      } else if (newStatus === 'rejected') {
        finalCommentText = `[BỊ TỪ CHỐI] ${baseCommentText}`;
      }

      const comment: TaskComment = {
        id: Math.random().toString(36).substr(2, 9),
        userId: profile.uid,
        text: finalCommentText,
        time: Timestamp.now()
      };
      if (commentImage) comment.imageUrl = commentImage;
      updatedComments = [...updatedComments, comment];

      const taskData = {
        title: editedTask.title || '',
        description: editedTask.description || '',
        category: editedTask.category || '',
        priority: editedTask.priority || 'medium',
        date: editedTask.date || '',
        assignees: editedTask.assignees || [],
        reviewers: editedTask.reviewers || [],
        cc: editedTask.cc || [],
        tags: editedTask.tags || [],
        attachedImages: editedTask.attachedImages || [],
        progress: newStatus === 'done' ? 100 : (newStatus === 'rejected' && task.status === 'review' ? 90 : editedTask.progress),
        status: finalStatus,
        subtasks: (editedTask.subtasks || []).map(s => ({
          ...s,
          comments: (s.comments || []).map(c => {
            const cleanComment: any = { ...c };
            Object.keys(cleanComment).forEach(key => {
              if (cleanComment[key] === undefined) delete cleanComment[key];
            });
            return cleanComment;
          })
        })),
        comments: updatedComments.map(c => {
          const cleanComment: any = { ...c };
          Object.keys(cleanComment).forEach(key => {
            if (cleanComment[key] === undefined) delete cleanComment[key];
          });
          return cleanComment;
        })
      };

      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), taskData);

      // Send notifications
      const targets = [...new Set([...(task.assignees || []), ...(task.cc || [])])].filter(id => id !== profile.uid);
      for (const targetId of targets) {
        let message = '';
        if (newStatus === 'rejected') {
          message = `Công việc "${task.title}" bị từ chối: ${finalCommentText}`;
        } else if (newStatus === 'done') {
          message = `Công việc "${task.title}" đã được nghiệm thu hoàn thành`;
        } else if (newStatus === 'todo' && task.status === 'pending') {
          message = `Công việc "${task.title}" đã được phê duyệt`;
        } else {
          message = `Công việc "${task.title}" đã chuyển sang trạng thái: ${newStatus}`;
        }

        await addDoc(collection(db, 'notifications'), {
          targetUserId: targetId,
          message,
          taskId: task.id,
          read: false,
          time: Timestamp.now()
        });
      }

      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {showActionCommentModal && (
        <CommentPromptModal 
          title={showActionCommentModal.title}
          variant={showActionCommentModal.variant}
          onConfirm={(comment) => {
            handleApprovalAction(showActionCommentModal.status, comment);
            setShowActionCommentModal(null);
          }}
          onCancel={() => setShowActionCommentModal(null)}
          placeholder={`Nhập lý do/ghi chú ${showActionCommentModal.status === 'rejected' ? 'từ chối' : 'phê duyệt'}...`}
        />
      )}
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white rounded-3xl w-full max-w-6xl shadow-2xl max-h-[90vh] overflow-hidden flex flex-col text-left"
          onClick={(e) => e.stopPropagation()}
        >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4 bg-slate-50/50">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={
              editedTask.priority === 'critical' ? 'danger' : 
              editedTask.priority === 'high' ? 'warning' : 
              editedTask.priority === 'medium' ? 'info' : 'neutral'
            }>
              {editedTask.priority.toUpperCase()}
            </Badge>
            <Badge variant={
              isTaskOverdue(editedTask as Task) ? 'danger' :
              editedTask.status === 'done' ? 'success' :
              editedTask.status === 'rejected' ? 'danger' :
              editedTask.status === 'in-progress' ? 'warning' : 
              editedTask.status === 'todo' ? 'info' : 'neutral'
            }>
              {isTaskOverdue(editedTask as Task) ? 'QUÁ HẠN' :
               editedTask.status === 'pending' ? 'CHỜ DUYỆT' :
               editedTask.status === 'todo' ? 'SẴN SÀNG' :
               editedTask.status === 'in-progress' ? 'ĐANG LÀM' :
               editedTask.status === 'review' ? 'CHỜ NGHIỆM THU' :
               editedTask.status === 'rejected' ? 'BỊ TỪ CHỐI' : 'HOÀN THÀNH'}
            </Badge>
            <div className="flex items-center gap-2 text-slate-500">
              <Briefcase size={16} />
              <span className="text-sm font-medium">{projectName || 'Đang tải...'}</span>
            </div>
            <div className="flex items-center gap-2 text-slate-500 border-l border-slate-200 pl-3 ml-1">
              <Clock size={16} />
              <span className="text-sm font-medium">{format(new Date(editedTask.date), 'dd/MM/yyyy')}</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 ml-2">{editedTask.title}</h2>
          </div>
          <div className="flex items-center gap-2">
            {(isAdmin || isManager) && (
              <Button 
                variant={isEditingMetadata ? "success" : "outline"} 
                size="sm" 
                onClick={() => isEditingMetadata ? handleSave() : setIsEditingMetadata(true)}
                className="flex items-center gap-2"
              >
                {isEditingMetadata ? <Save size={16} /> : <Edit3 size={16} />}
                {isEditingMetadata ? 'Lưu thay đổi' : 'Sửa Task'}
              </Button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-slate-200 rounded-full text-slate-400 transition-colors">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-12">
            {/* Left Column: Main Info */}
            <div className="lg:col-span-2 space-y-8">
              {/* Progress Section */}
              <section className="bg-slate-50 p-6 rounded-2xl border border-slate-100">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <Activity size={18} className="text-indigo-500" /> Tiến độ thực tế
                  </h3>
                  <span className="text-lg font-bold text-indigo-600">{editedTask.progress}%</span>
                </div>
                <div className="pt-2">
                  <input 
                    type="range" 
                    min="0" max="100" 
                    value={editedTask.progress}
                    disabled={editedTask.subtasks.length > 0 || profile?.role === 'director'}
                    onChange={async (e) => {
                      if (editedTask.status === 'pending') {
                        showToast('Task chưa được duyệt, không thể cập nhật tiến độ', 'error');
                        return;
                      }
                      const progress = parseInt(e.target.value);
                      let newStatus = editedTask.status;
                      if (progress === 0) {
                        newStatus = 'todo';
                      } else if (progress > 0 && progress < 100) {
                        newStatus = 'in-progress';
                      } else if (progress === 100) {
                        newStatus = 'review';
                      }
                      setEditedTask({ ...editedTask, progress, status: newStatus });
                      
                      try {
                        await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { progress, status: newStatus });
                      } catch (error) {
                        handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
                      }
                    }}
                    className={cn("w-full h-3 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600", getProgressAccent(editedTask.progress || 0))}
                    style={{ 
                      background: `linear-gradient(to right, ${editedTask.progress <= 50 ? '#ef4444' : editedTask.progress <= 80 ? '#fbbf24' : '#10b981'} ${editedTask.progress}%, #e2e8f0 ${editedTask.progress}%)` 
                    }}
                  />
                  {editedTask.subtasks.length > 0 && (
                    <p className="text-[10px] text-slate-400 mt-2 italic flex items-center gap-1">
                      <Info size={10} /> Tự động tính theo checklist công việc bên dưới
                    </p>
                  )}
                </div>
              </section>

              {/* People Section */}
              <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Người thực hiện</label>
                  <div className="flex flex-wrap gap-2">
                    {isEditingMetadata ? (
                      <div className="w-full max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                        {users.map(u => (
                          <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-white rounded cursor-pointer transition-colors">
                            <input 
                              type="checkbox" 
                              checked={editedTask.assignees?.includes(u.uid)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEditedTask({ ...editedTask, assignees: [...(editedTask.assignees || []), u.uid] });
                                } else {
                                  setEditedTask({ ...editedTask, assignees: (editedTask.assignees || []).filter(id => id !== u.uid) });
                                }
                              }}
                            />
                            <span>{u.displayName}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      editedTask.assignees?.map(uid => {
                        const u = users.find(user => user.uid === uid);
                        return u ? (
                          <div key={uid} className="flex items-center gap-1.5 bg-indigo-50 text-indigo-700 px-2 py-1 rounded-full text-[11px] font-semibold">
                            <img src={u.photoURL} alt={u.displayName} className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
                            {u.displayName}
                          </div>
                        ) : null;
                      })
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Kiểm duyệt</label>
                  <div className="flex flex-wrap gap-2">
                    {isEditingMetadata ? (
                      <div className="w-full max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                        {users.filter(u => u.role === 'admin' || u.role === 'manager' || u.role === 'director').map(u => (
                          <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-white rounded cursor-pointer transition-colors">
                            <input 
                              type="checkbox" 
                              checked={(editedTask.reviewers || []).includes(u.uid)}
                              onChange={(e) => {
                                const currentReviewers = editedTask.reviewers || [];
                                if (e.target.checked) {
                                  setEditedTask({ ...editedTask, reviewers: [...currentReviewers, u.uid] });
                                } else {
                                  setEditedTask({ ...editedTask, reviewers: currentReviewers.filter(id => id !== u.uid) });
                                }
                              }}
                            />
                            <span>{u.displayName}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      editedTask.reviewers?.map(uid => {
                        const u = users.find(user => user.uid === uid);
                        return u ? (
                          <div key={uid} className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-2 py-1 rounded-full text-[11px] font-semibold">
                            <img src={u.photoURL} alt={u.displayName} className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
                            {u.displayName}
                          </div>
                        ) : null;
                      })
                    )}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Theo dõi (CC)</label>
                  <div className="flex flex-wrap gap-2">
                    {isEditingMetadata ? (
                      <div className="w-full max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                        {users.map(u => (
                          <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-white rounded cursor-pointer transition-colors">
                            <input 
                              type="checkbox" 
                              checked={(editedTask.cc || []).includes(u.uid)}
                              onChange={(e) => {
                                const currentCC = editedTask.cc || [];
                                if (e.target.checked) {
                                  setEditedTask({ ...editedTask, cc: [...currentCC, u.uid] });
                                } else {
                                  setEditedTask({ ...editedTask, cc: currentCC.filter(id => id !== u.uid) });
                                }
                              }}
                            />
                            <span>{u.displayName}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      editedTask.cc?.map(uid => {
                        const u = users.find(user => user.uid === uid);
                        return u ? (
                          <div key={uid} className="flex items-center gap-1.5 bg-slate-100 text-slate-700 px-2 py-1 rounded-full text-[11px] font-semibold">
                            <img src={u.photoURL} alt={u.displayName} className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
                            {u.displayName}
                          </div>
                        ) : null;
                      })
                    )}
                  </div>
                </div>
              </section>

              {/* Description Section */}
              <section className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-bold text-slate-900 flex items-center gap-2">
                    <FileText size={18} className="text-indigo-500" /> Mô tả chi tiết
                  </h3>
                  {isEditingMetadata && (
                    <label className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg cursor-pointer transition-all flex items-center gap-2 text-xs font-bold">
                      <ImageIcon size={14} />
                      Thêm ảnh
                      <input 
                        type="file" 
                        className="hidden" 
                        accept="image/*" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setEditedTask({ 
                                ...editedTask, 
                                attachedImages: [...(editedTask.attachedImages || []), reader.result as string] 
                              });
                            };
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
                {isEditingMetadata ? (
                  <textarea 
                    value={editedTask.description}
                    onChange={(e) => setEditedTask({ ...editedTask, description: e.target.value })}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none h-32 text-sm"
                    placeholder="Nhập mô tả công việc..."
                  />
                ) : (
                  <div className="bg-slate-50 p-4 rounded-xl text-sm text-slate-600 leading-relaxed whitespace-pre-wrap min-h-[100px]">
                    {editedTask.description || 'Không có mô tả chi tiết.'}
                    {editedTask.attachedImages && editedTask.attachedImages.length > 0 && (
                      <div className="grid grid-cols-3 gap-2 mt-4">
                        {editedTask.attachedImages.map((img, idx) => (
                          <div key={idx} className="relative group rounded-lg overflow-hidden border border-slate-200">
                            <img 
                              src={img} 
                              alt="attached" 
                              className="w-full h-24 object-cover cursor-zoom-in" 
                              onClick={() => setZoomedImage(img)}
                              referrerPolicy="no-referrer"
                            />
                            {isEditingMetadata && (
                              <button 
                                onClick={() => setEditedTask({ ...editedTask, attachedImages: editedTask.attachedImages.filter((_, i) => i !== idx) })}
                                className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X size={10} />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {/* Sub-tasks Section */}
              <section className="space-y-4">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <CheckSquare size={18} className="text-indigo-500" /> Đầu công việc (Checklist)
                </h3>
                <div className="space-y-2">
                  {editedTask.subtasks.map(s => (
                    <div key={s.id} className="group bg-white border border-slate-100 p-3 rounded-xl hover:shadow-sm transition-all">
                      <div className="flex items-center gap-3">
                        <button 
                          onClick={() => profile?.role !== 'director' && toggleSubtask(s.id)}
                          className={cn(
                            "w-5 h-5 rounded-md border flex items-center justify-center transition-colors",
                            s.completed ? "bg-emerald-500 border-emerald-500 text-white" : "border-slate-300 hover:border-indigo-500",
                            profile?.role === 'director' && "cursor-not-allowed opacity-70"
                          )}
                        >
                          {s.completed && <Check size={12} />}
                        </button>
                        <span className={cn("text-sm flex-1", s.completed && "text-slate-400 line-through")}>{s.text}</span>
                        <div className="flex items-center gap-2">
                          <button 
                            onClick={() => setActiveSubtaskComment(activeSubtaskComment === s.id ? null : s.id)}
                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all relative"
                          >
                            <MessageSquare size={14} />
                            {s.comments && s.comments.length > 0 && (
                              <span className="absolute -top-1 -right-1 bg-indigo-500 text-white text-[8px] w-3.5 h-3.5 rounded-full flex items-center justify-center">
                                {s.comments.length}
                              </span>
                            )}
                          </button>
                          <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-1 rounded uppercase">
                            {format(new Date(s.deadline), 'dd/MM')}
                          </span>
                          {isEditingMetadata && (
                            <button onClick={() => removeSubtask(s.id)} className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      
                      {/* Sub-task Comments Section */}
                      {activeSubtaskComment === s.id && (
                        <div className="mt-3 ml-8 pl-3 border-l-2 border-indigo-100 space-y-3">
                          <div className="space-y-2">
                            {s.comments?.map(c => (
                              <div key={c.id} className="bg-slate-50 p-2 rounded-lg text-[11px]">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="font-bold text-slate-700">{users.find(u => u.uid === c.userId)?.displayName}</span>
                                  <span className="text-[9px] text-slate-400">{format(c.time?.toDate() || new Date(), 'HH:mm dd/MM')}</span>
                                </div>
                                <p className="text-slate-600">{c.text}</p>
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              value={subtaskCommentText}
                              onChange={(e) => setSubtaskCommentText(e.target.value)}
                              placeholder="Viết trao đổi..."
                              className="flex-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] outline-none focus:ring-2 focus:ring-indigo-500"
                              onKeyPress={(e) => e.key === 'Enter' && addSubtaskComment(s.id)}
                            />
                            <button 
                              onClick={() => addSubtaskComment(s.id)}
                              className="p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all"
                            >
                              <Send size={14} />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                    {profile?.role !== 'director' && (
                      <div className="flex gap-2 mt-4">
                        <input 
                          type="text" 
                          placeholder="Thêm đầu công việc mới..." 
                          className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                          value={newSubtask.text}
                          onChange={(e) => setNewSubtask({ ...newSubtask, text: e.target.value })}
                          onKeyPress={(e) => e.key === 'Enter' && addSubtask()}
                        />
                        <input 
                          type="date" 
                          className="px-4 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                          value={newSubtask.deadline}
                          onChange={(e) => setNewSubtask({ ...newSubtask, deadline: e.target.value })}
                        />
                        <Button onClick={addSubtask} size="sm" className="px-4"><Plus size={18} /></Button>
                      </div>
                    )}
                </div>
              </section>

              {/* Metadata Edit Section (Only visible when editing) */}
              {isEditingMetadata && (
                <section className="pt-8 border-t border-slate-100 grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Tiêu đề công việc</label>
                      <input 
                        type="text" 
                        value={editedTask.title}
                        onChange={(e) => setEditedTask({ ...editedTask, title: e.target.value })}
                        className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Danh mục</label>
                      <input 
                        type="text" 
                        value={editedTask.category}
                        onChange={(e) => setEditedTask({ ...editedTask, category: e.target.value })}
                        className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Mức độ ưu tiên</label>
                        <select 
                          value={editedTask.priority}
                          onChange={(e) => setEditedTask({ ...editedTask, priority: e.target.value as any })}
                          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        >
                          <option value="low">Thấp</option>
                          <option value="medium">Trung bình</option>
                          <option value="high">Cao</option>
                          <option value="critical">Khẩn cấp</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-slate-700 mb-1">Trạng thái</label>
                        <select 
                          value={editedTask.status}
                          onChange={(e) => {
                            const newStatus = e.target.value as TaskStatus;
                            let newProgress = editedTask.progress;
                            if (newStatus === 'done') newProgress = 100;
                            else if (newStatus === 'todo' && editedTask.status === 'pending') newProgress = 0;
                            else if (newStatus === 'rejected' && editedTask.status === 'review') newProgress = 90;
                            setEditedTask({ ...editedTask, status: newStatus, progress: newProgress });
                          }}
                          className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                        >
                          <option value="pending">Chờ duyệt</option>
                          <option value="todo">Sẵn sàng</option>
                          <option value="in-progress">Đang làm</option>
                          <option value="review">Chờ nghiệm thu</option>
                          <option value="rejected">Bị từ chối</option>
                          <option value="overdue">Quá hạn</option>
                          <option value="done">Hoàn thành</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">Hạn hoàn thành</label>
                      <input 
                        type="date" 
                        value={editedTask.date}
                        onChange={(e) => setEditedTask({ ...editedTask, date: e.target.value })}
                        className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      />
                    </div>
                  </div>
                </section>
              )}
            </div>

            {/* Right Column: Exchange & Update */}
            <div className="lg:col-span-1 flex flex-col h-full border-l border-slate-100 pl-8">
              <h3 className="font-bold text-slate-900 flex items-center gap-2 mb-6">
                <MessageSquare size={18} className="text-indigo-500" /> Trao đổi & Cập nhật
              </h3>
              
              <div className="flex-1 space-y-4 overflow-y-auto pr-2 mb-6">
                {editedTask.comments.length === 0 ? (
                  <div className="text-center py-12 text-slate-400">
                    <MessageSquare className="mx-auto mb-2 opacity-20" size={32} />
                    <p className="text-xs">Chưa có trao đổi nào.</p>
                  </div>
                ) : (
                  editedTask.comments.map(c => (
                    <div key={c.id} className={cn("p-3 rounded-2xl space-y-2", c.userId === profile?.uid ? "bg-indigo-50 ml-4" : "bg-slate-50 mr-4")}>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-bold text-slate-700">{users.find(u => u.uid === c.userId)?.displayName || 'User'}</span>
                        <span className="text-[8px] text-slate-400">{format(c.time?.toDate() || new Date(), 'dd/MM HH:mm')}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        {c.text.startsWith('[ĐÃ NGHIỆM THU]') && <Badge variant="success" className="w-fit text-[8px] py-0 px-1">ĐÃ NGHIỆM THU</Badge>}
                        {c.text.startsWith('[ĐÃ DUYỆT]') && <Badge variant="info" className="w-fit text-[8px] py-0 px-1">ĐÃ DUYỆT</Badge>}
                        {c.text.startsWith('[BỊ TỪ CHỐI]') && <Badge variant="danger" className="w-fit text-[8px] py-0 px-1">BỊ TỪ CHỐI</Badge>}
                        <p className="text-xs text-slate-600 leading-relaxed">
                          {c.text.replace(/^\[(ĐÃ NGHIỆM THU|ĐÃ DUYỆT|BỊ TỪ CHỐI)\]\s*/, '')}
                        </p>
                      </div>
                      {c.imageUrl && (
                        <img 
                          src={c.imageUrl} 
                          alt="comment" 
                          className="w-full h-32 object-cover rounded-lg cursor-zoom-in" 
                          onClick={() => setZoomedImage(c.imageUrl!)}
                          referrerPolicy="no-referrer"
                        />
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="mt-auto space-y-3">
                {commentImage && (
                  <div className="relative w-20 h-20 rounded-lg overflow-hidden border border-slate-200">
                    <img src={commentImage} alt="preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                    <button onClick={() => setCommentImage(null)} className="absolute top-0 right-0 bg-red-500 text-white p-1 rounded-bl">
                      <X size={12} />
                    </button>
                  </div>
                )}
                <div className="relative">
                  <textarea 
                    placeholder="Nhập nội dung trao đổi..." 
                    className="w-full px-4 py-3 pr-12 rounded-2xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none text-sm h-24 resize-none"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                  />
                  <div className="absolute bottom-3 right-3 flex gap-2">
                    <label className="p-2 text-slate-400 hover:text-indigo-500 cursor-pointer transition-colors">
                      <ImageIcon size={18} />
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="hidden" 
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) {
                            const reader = new FileReader();
                            reader.onloadend = () => setCommentImage(reader.result as string);
                            reader.readAsDataURL(file);
                          }
                        }}
                      />
                    </label>
                    <button 
                      onClick={addMainComment}
                      className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                    >
                      <Send size={18} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions (Approval) */}
        {(isAdmin || isManager || editedTask.reviewers?.includes(profile?.uid || '') || isAssignee) && (
          <div className="p-6 border-t border-slate-100 bg-slate-50/50 flex justify-end gap-3">
            {editedTask.status === 'pending' && (isAdmin || isManager) && (
              <>
                <Button variant="danger" onClick={() => setShowActionCommentModal({ status: 'rejected', title: 'Từ chối công việc', variant: 'danger' })} disabled={loading}>Từ chối</Button>
                <Button variant="success" onClick={() => setShowActionCommentModal({ status: 'todo', title: 'Phê duyệt công việc', variant: 'success' })} disabled={loading}>Duyệt công việc</Button>
              </>
            )}
            {editedTask.status === 'review' && (isAdmin || isManager || (editedTask.reviewers?.includes(profile?.uid || '') && profile?.role !== 'director')) && (
              <>
                <Button variant="danger" onClick={() => setShowActionCommentModal({ status: 'rejected', title: 'Yêu cầu sửa lại', variant: 'danger' })} disabled={loading}>Yêu cầu sửa lại</Button>
                <Button variant="success" onClick={() => setShowActionCommentModal({ status: 'done', title: 'Nghiệm thu hoàn thành', variant: 'success' })} disabled={loading}>Nghiệm thu</Button>
              </>
            )}
            {!isEditingMetadata && (
              <div className="flex gap-3">
                <Button variant="ghost" onClick={onClose}>Thoát</Button>
                {profile?.role !== 'director' && (
                  <Button variant="primary" onClick={handleSave} disabled={loading}>Cập nhật tiến độ</Button>
                )}
              </div>
            )}
          </div>
        )}

        {zoomedImage && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-8 bg-black/90 backdrop-blur-md" onClick={(e) => { e.stopPropagation(); setZoomedImage(null); }}>
            <img src={zoomedImage} alt="zoomed" className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" referrerPolicy="no-referrer" />
            <button className="absolute top-8 right-8 text-white hover:text-slate-300 transition-colors" onClick={(e) => { e.stopPropagation(); setZoomedImage(null); }}>
              <X size={32} />
            </button>
          </div>
        )}
      </motion.div>
    </div>

    {showActionCommentModal && (
      <CommentPromptModal 
        title={showActionCommentModal.title}
        variant={showActionCommentModal.variant}
        onConfirm={(comment) => {
          handleApprovalAction(showActionCommentModal.status, comment);
          setShowActionCommentModal(null);
        }}
        onCancel={() => setShowActionCommentModal(null)}
        placeholder={`Nhập lý do/ghi chú ${showActionCommentModal.status === 'rejected' ? 'từ chối' : 'phê duyệt'}...`}
      />
    )}
    </>
  );
};

const ConfirmationModal = ({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  variant = 'danger' 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  onConfirm: () => void; 
  title: string; 
  message: string; 
  variant?: 'danger' | 'warning' | 'info' 
}) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={cn("flex items-center gap-3", variant === 'danger' ? "text-red-600" : "text-amber-600")}>
          <AlertTriangle size={24} />
          <h3 className="text-xl font-bold text-slate-900">{title}</h3>
        </div>
        <p className="text-slate-500 text-sm leading-relaxed">{message}</p>
        <div className="flex gap-3 pt-2">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Hủy</Button>
          <Button 
            className={cn("flex-1", variant === 'danger' ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700")} 
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Xác nhận
          </Button>
        </div>
      </motion.div>
    </div>
  );
};

const Dashboard = ({ onSelectProject }: { onSelectProject: (id: string) => void }) => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newProject, setNewProject] = useState({ name: '', description: '', managers: [] as string[] });
  const [showHidden, setShowHidden] = useState(false);
  const [activeExtraView, setActiveExtraView] = useState<'priority' | 'deadline' | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'overdue' | 'all'>('all');

  useEffect(() => {
    const q = collection(db, 'projects');
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const projectsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project))
        .sort((a, b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0));
      setProjects(projectsData);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'projects'));

    // Real-time tasks across all projects
    const tasksQ = query(collectionGroup(db, 'tasks'));
    const tasksUnsubscribe = onSnapshot(tasksQ, (snapshot) => {
      const tasksData = snapshot.docs.map(doc => ({ 
        id: doc.id, 
        projectId: doc.ref.parent.parent?.id || '', 
        ...doc.data() 
      } as Task));
      setAllTasks(tasksData);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks (collectionGroup)');
      setLoading(false);
    });

    const unsubUsers = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    return () => {
      unsubscribe();
      tasksUnsubscribe();
      unsubUsers();
    };
  }, []);

  const deleteProject = async (id: string) => {
    if (!profile || profile.role !== 'admin') return;
    try {
      setIsDeleting(true);
      // Delete all tasks first
      const tasksSnap = await getDocs(collection(db, `projects/${id}/tasks`));
      const deleteTasksPromises = tasksSnap.docs.map(d => deleteDoc(doc(db, `projects/${id}/tasks`, d.id)));
      await Promise.all(deleteTasksPromises);
      
      // Delete project
      await deleteDoc(doc(db, 'projects', id));
      showToast('Đã xóa dự án thành công!');
      if (editingProject?.id === id) setEditingProject(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${id}`);
    } finally {
      setIsDeleting(false);
      setProjectToDelete(null);
    }
  };

  const filteredProjects = projects.filter(p => {
    if (profile?.role === 'admin' || profile?.role === 'director') return showHidden ? true : p.status === 'active';
    if (profile?.role === 'manager') return p.managers.includes(profile.uid) && (showHidden ? true : p.status === 'active');
    
    // For regular users, only show projects where they have tasks
    const hasTasksInProject = allTasks.some(t => 
      t.projectId === p.id && 
      (t.assignees.includes(profile?.uid || '') || 
       t.reviewers?.includes(profile?.uid || '') || 
       t.cc?.includes(profile?.uid || ''))
    );
    return p.status === 'active' && hasTasksInProject;
  });

  const isUser = profile?.role === 'user';
  const dashboardTasks = allTasks.filter(t => {
    const isProjectVisible = new Set(filteredProjects.map(p => p.id)).has(t.projectId);
    if (!isProjectVisible) return false;
    if (isUser) {
      return t.assignees.includes(profile?.uid || '') || 
             t.reviewers?.includes(profile?.uid || '') || 
             t.cc?.includes(profile?.uid || '');
    }
    return true;
  });

  const stats = {
    totalProjects: filteredProjects.length,
    totalTasks: dashboardTasks.length,
    pending: dashboardTasks.filter(t => t.status === 'pending').length,
    todo: dashboardTasks.filter(t => t.status === 'todo').length,
    inProgress: dashboardTasks.filter(t => t.status === 'in-progress').length,
    review: dashboardTasks.filter(t => t.status === 'review').length,
    rejected: dashboardTasks.filter(t => t.status === 'rejected').length,
    completed: dashboardTasks.filter(t => t.status === 'done').length,
    overdue: dashboardTasks.filter(t => isTaskOverdue(t)).length,
  };

  const filteredDashboardTasks = dashboardTasks.filter(t => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'overdue') return isTaskOverdue(t);
    return t.status === filterStatus;
  });

  const priorityTasks = [...dashboardTasks].sort((a, b) => {
    const priorityMap = { critical: 4, high: 3, medium: 2, low: 1 };
    return (priorityMap[b.priority] || 0) - (priorityMap[a.priority] || 0);
  }).slice(0, 10);

  const deadlineTasks = [...dashboardTasks]
    .filter(t => t.status !== 'done' && t.date)
    .sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (isNaN(dateA)) return 1;
      if (isNaN(dateB)) return -1;
      return dateA - dateB;
    }).slice(0, 10);

  const tableTasks = activeExtraView === 'priority' 
    ? priorityTasks 
    : activeExtraView === 'deadline' 
      ? deadlineTasks 
      : allTasks.slice(0, 10);

  const seedData = async () => {
    if (!profile || profile.role !== 'admin') return;
    try {
      setLoading(true);
      // 1. Create a sample project
      const projectRef = await addDoc(collection(db, 'projects'), {
        name: 'Dự án Mẫu FSC FPT',
        description: 'Dự án mẫu để kiểm tra các tính năng của hệ thống FSC Tracker.',
        managers: [profile.uid],
        status: 'active',
        createdAt: Timestamp.now()
      });

      // 2. Create tasks with different priorities and deadlines
      const tasks = [
        { 
          title: 'Thiết kế giao diện Dashboard', 
          description: 'Hoàn thiện UI/UX cho màn hình tổng quan.', 
          priority: 'high', 
          date: format(addDays(new Date(), 2), 'yyyy-MM-dd'),
          status: 'in-progress',
          progress: 45,
          assignees: [profile.uid],
          subtasks: [
            { id: '1', text: 'Wireframe', deadline: format(addDays(new Date(), 1), 'yyyy-MM-dd'), completed: true, comments: [] }, 
            { id: '2', text: 'Mockup', deadline: format(addDays(new Date(), 2), 'yyyy-MM-dd'), completed: false, comments: [] }
          ],
          comments: [],
          attachedImages: [],
          createdAt: Timestamp.now()
        },
        { 
          title: 'Fix lỗi bảo mật hệ thống', 
          description: 'Kiểm tra và vá các lỗ hổng bảo mật nghiêm trọng.', 
          priority: 'critical', 
          date: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
          status: 'todo',
          progress: 0,
          assignees: [profile.uid],
          subtasks: [],
          comments: [],
          attachedImages: [],
          createdAt: Timestamp.now()
        },
        { 
          title: 'Viết tài liệu hướng dẫn sử dụng', 
          description: 'Tài liệu cho người dùng cuối và quản trị viên.', 
          priority: 'low', 
          date: format(addDays(new Date(), 10), 'yyyy-MM-dd'),
          status: 'pending',
          progress: 10,
          assignees: [profile.uid],
          subtasks: [],
          comments: [],
          attachedImages: [],
          createdAt: Timestamp.now()
        },
        { 
          title: 'Kiểm thử hiệu năng (Load test)', 
          description: 'Đảm bảo hệ thống chịu được 1000 users đồng thời.', 
          priority: 'medium', 
          date: format(addDays(new Date(), 5), 'yyyy-MM-dd'),
          status: 'todo',
          progress: 0,
          assignees: [profile.uid],
          subtasks: [],
          comments: [],
          attachedImages: [],
          createdAt: Timestamp.now()
        },
        { 
          title: 'Họp nghiệm thu giai đoạn 1', 
          description: 'Báo cáo tiến độ và demo các tính năng đã hoàn thành.', 
          priority: 'critical', 
          date: format(new Date(), 'yyyy-MM-dd'),
          status: 'review',
          progress: 90,
          assignees: [profile.uid],
          subtasks: [],
          comments: [],
          attachedImages: [],
          createdAt: Timestamp.now()
        }
      ];

      for (const task of tasks) {
        await addDoc(collection(db, `projects/${projectRef.id}/tasks`), task);
      }

      showToast('Đã tạo dữ liệu mẫu thành công!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'seed-data');
    } finally {
      setLoading(false);
    }
  };

  const createProject = async () => {
    if (!newProject.name || !profile || profile.role !== 'admin') return;
    try {
      await addDoc(collection(db, 'projects'), {
        name: newProject.name,
        description: newProject.description || 'Dự án FSC FPT School',
        managers: newProject.managers.length > 0 ? newProject.managers : [profile.uid],
        status: 'active',
        createdAt: Timestamp.now()
      });
      setNewProject({ name: '', description: '', managers: [] });
      setIsNewProjectModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'projects');
    }
  };

  const updateProject = async () => {
    if (!editingProject || !profile || profile.role !== 'admin') return;
    try {
      await updateDoc(doc(db, 'projects', editingProject.id), {
        name: editingProject.name,
        description: editingProject.description,
        managers: editingProject.managers || [],
        status: editingProject.status
      });
      setEditingProject(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${editingProject.id}`);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="animate-spin text-indigo-600" size={40} />
    </div>
  );

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Tổng quan hệ thống</h1>
          <p className="text-slate-500">Chào mừng, {profile?.displayName}. Đây là báo cáo tổng thể dự án FSC.</p>
        </div>
        <div className="flex gap-3">
          {profile?.role === 'admin' && (
            <Button variant="outline" onClick={seedData} className="border-indigo-200 text-indigo-600 hover:bg-indigo-50">
              <Star size={14} className="mr-2" /> Tạo dữ liệu mẫu
            </Button>
          )}
          {(profile?.role === 'admin' || profile?.role === 'director') && (
            <Button variant="secondary" onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? 'Ẩn dự án đóng' : 'Hiện dự án đóng'}
            </Button>
          )}
          {profile?.role === 'admin' && (
            <Button onClick={() => setIsNewProjectModalOpen(true)}>
              <Plus size={20} /> Dự án mới
            </Button>
          )}
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className={cn("grid gap-4", isUser ? "grid-cols-2 md:grid-cols-3 lg:grid-cols-6" : "grid-cols-2 md:grid-cols-3 lg:grid-cols-5")}>
        {isUser ? (
          // User Dashboard Stats
          [
            { label: 'Tổng Task', value: stats.totalTasks, icon: List, color: 'bg-slate-50 text-slate-600', status: 'all' },
            { label: 'Đang làm', value: stats.inProgress, icon: Play, color: 'bg-amber-50 text-amber-600', status: 'in-progress' },
            { label: 'Chờ duyệt', value: stats.pending, icon: Clock, color: 'bg-indigo-50 text-indigo-600', status: 'pending' },
            { label: 'Nghiệm thu', value: stats.review, icon: Search, color: 'bg-blue-50 text-blue-600', status: 'review' },
            { label: 'Hoàn thành', value: stats.completed, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600', status: 'done' },
            { label: 'Quá hạn', value: stats.overdue, icon: AlertTriangle, color: 'bg-red-50 text-red-600', status: 'overdue' },
          ].map((stat, i) => (
            <Card 
              key={i} 
              onClick={() => setFilterStatus(stat.status as any)}
              className={cn(
                "p-4 flex flex-col items-center justify-center text-center space-y-2 border-none shadow-sm cursor-pointer transition-all hover:scale-105",
                filterStatus === stat.status ? "ring-2 ring-indigo-500 bg-white" : "bg-white"
              )}
            >
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon size={20} />
              </div>
              <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{stat.label}</div>
            </Card>
          ))
        ) : (
          // Manager/Admin Dashboard Stats
          [
            { label: 'Dự án', value: stats.totalProjects, icon: Briefcase, color: 'bg-blue-50 text-blue-600' },
            { label: 'Tổng Task', value: stats.totalTasks, icon: List, color: 'bg-slate-50 text-slate-600' },
            { label: 'Đang làm', value: stats.inProgress, icon: Play, color: 'bg-amber-50 text-amber-600' },
            { label: 'Quá hạn', value: stats.overdue, icon: AlertTriangle, color: 'bg-red-50 text-red-600' },
            { label: 'Hoàn thành', value: stats.completed, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600' },
          ].map((stat, i) => (
            <Card key={i} className="p-4 flex flex-col items-center justify-center text-center space-y-2 border-none shadow-sm bg-white">
              <div className={`p-2 rounded-lg ${stat.color}`}>
                <stat.icon size={20} />
              </div>
              <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
              <div className="text-xs text-slate-500 font-medium uppercase tracking-wider">{stat.label}</div>
            </Card>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 gap-8">
        {isUser ? (
          // User Task List View
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <CheckSquare size={20} className="text-indigo-600" />
                Công việc của tôi 
                {filterStatus !== 'all' && (
                  <span className="text-sm font-normal text-slate-500 ml-2">
                    (Lọc: {filterStatus === 'overdue' ? 'Quá hạn' : filterStatus.toUpperCase()})
                  </span>
                )}
              </h2>
              {filterStatus !== 'all' && (
                <Button variant="ghost" size="sm" onClick={() => setFilterStatus('all')} className="text-indigo-600">
                  Xóa lọc
                </Button>
              )}
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredDashboardTasks.length === 0 ? (
                <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-dashed border-slate-200 shadow-sm">
                  <CheckCircle2 className="mx-auto text-slate-200 mb-4" size={48} />
                  <p className="text-slate-500 font-medium">Không tìm thấy công việc nào phù hợp.</p>
                </div>
              ) : (
                filteredDashboardTasks.map((task) => (
                  <TaskCard 
                    key={task.id} 
                    task={task} 
                    projectManagers={projects.find(p => p.id === task.projectId)?.managers || []}
                    onUpdateStatus={async (t, s, c) => {
                      try {
                        await updateDoc(doc(db, `projects/${t.projectId}/tasks`, t.id), { status: s });
                      } catch (error) {
                        handleFirestoreError(error, OperationType.UPDATE, `projects/${t.projectId}/tasks/${t.id}`);
                      }
                    }} 
                  />
                ))
              )}
            </div>
          </div>
        ) : (
          // Manager/Admin Project List View
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <Briefcase size={20} className="text-indigo-600" />
                Danh sách dự án
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredProjects.map((project) => {
                const projectTasks = allTasks.filter(t => t.projectId === project.id);
                const totalTasks = projectTasks.length;
                const completedTasks = projectTasks.filter(t => t.status === 'done').length;
                const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
                const projectManagers = users.filter(u => project.managers.includes(u.uid));

                return (
                  <motion.div 
                    key={project.id} 
                    whileHover={{ y: -4 }}
                    className="cursor-pointer relative group"
                    onClick={() => onSelectProject(project.id)}
                  >
                    {profile?.role === 'admin' && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingProject({
                            ...project,
                            name: project.name || '',
                            description: project.description || '',
                            status: project.status || 'active',
                            managers: project.managers || []
                          });
                        }}
                        className="absolute top-2 right-2 z-10 p-2 bg-white/80 backdrop-blur-sm rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-indigo-100 hover:text-indigo-600 shadow-sm"
                      >
                        <Settings size={14} />
                      </button>
                    )}
                    <Card className="p-5 hover:border-indigo-300 transition-colors h-full flex flex-col bg-white">
                      <div className="flex justify-between items-start mb-3">
                        <h3 className="font-bold text-slate-900 line-clamp-1">{project.name}</h3>
                        <div className="flex items-center gap-2">
                          <Badge variant={project.status === 'active' ? 'success' : 'neutral'} className="text-[9px] px-1.5 py-0.5 flex items-center gap-1">
                            {project.status === 'active' ? <Activity size={10} /> : <Info size={10} />}
                            {project.status === 'active' ? 'HOẠT ĐỘNG' : 'ĐÃ ĐÓNG'}
                          </Badge>
                          {profile?.role === 'admin' && (
                            <button 
                              onClick={(e) => {
                                e.stopPropagation();
                                setProjectToDelete(project.id);
                              }}
                              className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                              title="Xóa dự án"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-slate-500 text-xs line-clamp-2 mb-4">{project.description}</p>
                      
                      {/* Project Managers */}
                      <div className="mb-4">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Quản lý</p>
                        <div className="flex -space-x-1.5">
                          {projectManagers.map((m, i) => (
                            <img 
                              key={i} 
                              src={m.photoURL} 
                              className="w-5 h-5 rounded-full border-2 border-white" 
                              title={m.displayName}
                              referrerPolicy="no-referrer"
                            />
                          ))}
                        </div>
                      </div>

                      {/* Project Progress */}
                      <div className="mt-auto space-y-2">
                        <div className="flex justify-between items-end">
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Công việc</p>
                            <p className="text-xs font-bold text-slate-700">{completedTasks}/{totalTasks} Hoàn thành</p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">Tiến độ</p>
                            <p className="text-xs font-bold text-indigo-600">{progress}%</p>
                          </div>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={cn("h-full transition-all duration-500", getProgressColor(progress))} style={{ width: `${progress}%` }} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-4 pt-4 border-t border-slate-50">
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> {format(project.createdAt?.toDate() || new Date(), 'dd/MM/yyyy')}
                        </span>
                        <span className="flex items-center gap-1">
                          <List size={12} /> {totalTasks} tasks
                        </span>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <ConfirmationModal 
        isOpen={!!projectToDelete}
        onClose={() => setProjectToDelete(null)}
        onConfirm={() => projectToDelete && deleteProject(projectToDelete)}
        title="Xác nhận xóa dự án"
        message="Bạn có chắc chắn muốn xóa dự án này? Toàn bộ công việc bên trong sẽ bị xóa và không thể khôi phục."
      />

      {isDeleting && (
        <div className="fixed inset-0 z-[150] bg-white/50 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-indigo-600" size={40} />
            <p className="text-sm font-bold text-slate-900">Đang xóa dự án...</p>
          </div>
        </div>
      )}

      {/* Task List Table (Only for Admin/Director/Manager) */}
      {!isUser && (
        <div className="space-y-4 mt-8">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <CheckSquare size={20} className="text-indigo-600" />
              Danh sách công việc tổng thể
            </h2>
            <div className="flex gap-2">
              <button 
                onClick={() => setActiveExtraView(activeExtraView === 'priority' ? null : 'priority')}
                className={cn(
                  "px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center gap-2",
                  activeExtraView === 'priority' 
                    ? "bg-amber-500 border-amber-500 text-white shadow-sm" 
                    : "bg-white border-slate-200 text-slate-500 hover:border-amber-200 hover:bg-amber-50"
                )}
              >
                <Star size={14} />
                Ưu tiên
              </button>
              <button 
                onClick={() => setActiveExtraView(activeExtraView === 'deadline' ? null : 'deadline')}
                className={cn(
                  "px-3 py-1.5 rounded-xl border text-[10px] font-bold uppercase transition-all flex items-center gap-2",
                  activeExtraView === 'deadline' 
                    ? "bg-rose-500 border-rose-500 text-white shadow-sm" 
                    : "bg-white border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50"
                )}
              >
                <Clock size={14} />
                Sắp hết hạn
              </button>
            </div>
          </div>
          <Card className="overflow-hidden bg-white">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Công việc</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Người phụ trách</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Tiến độ</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider text-center">Ưu tiên</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Deadline</th>
                    <th className="px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Trạng thái</th>
                  </tr>
                </thead>
                <motion.tbody 
                  key={activeExtraView || 'default'}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="divide-y divide-slate-100"
                >
                  {tableTasks.length > 0 ? tableTasks.map((task) => {
                    const assigneeProfiles = users.filter(u => task.assignees?.includes(u.uid));
                    return (
                      <tr 
                        key={task.id} 
                        className="hover:bg-slate-50 transition-colors cursor-pointer"
                        onClick={() => setEditingTask(task)}
                      >
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium text-slate-900 mb-1">{task.title}</div>
                          <div className="flex flex-wrap gap-1 mb-1">
                            {task.status === 'pending' && (
                              <Badge variant="warning" className="animate-pulse text-[8px] py-0 px-1">CẦN DUYỆT</Badge>
                            )}
                            {task.status === 'review' && (
                              <Badge variant="sky" className="animate-pulse text-[8px] py-0 px-1">NGHIỆM THU</Badge>
                            )}
                            {isTaskOverdue(task) && (
                              <Badge variant="danger" className="animate-pulse text-[8px] py-0 px-1">QUÁ HẠN</Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400">{projects.find(p => p.id === task.projectId)?.name}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex -space-x-2 overflow-hidden">
                            {assigneeProfiles.map((u, i) => (
                              <img key={i} src={u.photoURL} className="w-6 h-6 rounded-full border-2 border-white" title={u.displayName} referrerPolicy="no-referrer" />
                            ))}
                            {assigneeProfiles.length === 0 && <span className="text-xs text-slate-400 italic">Chưa giao</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className={cn("h-full", getProgressColor(task.progress || 0))} style={{ width: `${task.progress}%` }} />
                            </div>
                            <span className="text-[10px] font-bold text-slate-600">{task.progress}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                            task.priority === 'critical' ? 'bg-purple-100 text-purple-600' :
                            task.priority === 'high' ? 'bg-red-100 text-red-600' : 
                            task.priority === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                          }`}>
                            {task.priority.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("text-xs", getDeadlineStyle(task.date, task.status))}>{task.date}</span>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={
                            task.status === 'done' ? 'success' :
                            task.status === 'review' ? 'sky' :
                            task.status === 'rejected' ? 'danger' :
                            task.status === 'in-progress' ? 'info' : 
                            task.status === 'pending' ? 'warning' : 'neutral'
                          }>
                            {task.status === 'pending' ? 'CHỜ DUYỆT' :
                             task.status === 'todo' ? 'SẴN SÀNG' :
                             task.status === 'in-progress' ? 'ĐANG LÀM' :
                             task.status === 'review' ? 'CHỜ NGHIỆM THU' :
                             task.status === 'rejected' ? 'BỊ TỪ CHỐI' : 'HOÀN THÀNH'}
                          </Badge>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">Chưa có công việc nào</td>
                    </tr>
                  )}
                </motion.tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {/* New Project Modal */}
      <AnimatePresence>
        {isNewProjectModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-6">Tạo dự án mới</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tên dự án</label>
                  <input 
                    type="text" 
                    value={newProject.name}
                    onChange={(e) => setNewProject({ ...newProject, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Ví dụ: App Quản lý Thư viện"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả</label>
                  <textarea 
                    value={newProject.description}
                    onChange={(e) => setNewProject({ ...newProject, description: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    placeholder="Mô tả ngắn gọn về dự án..."
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Gán Manager</label>
                  <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {users.filter(u => u.role === 'manager' || u.role === 'admin').map(u => (
                      <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-slate-50 rounded cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={newProject.managers.includes(u.uid)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewProject({ ...newProject, managers: [...newProject.managers, u.uid] });
                            } else {
                              setNewProject({ ...newProject, managers: newProject.managers.filter(id => id !== u.uid) });
                            }
                          }}
                        />
                        <span>{u.displayName} ({u.role})</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <Button variant="ghost" className="flex-1" onClick={() => setIsNewProjectModalOpen(false)}>Hủy</Button>
                  <Button className="flex-1" onClick={createProject}>Tạo ngay</Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Project Modal */}
      <AnimatePresence>
        {editingProject && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl"
            >
              <h2 className="text-2xl font-bold mb-6">Chỉnh sửa dự án</h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Tên dự án</label>
                  <input 
                    type="text" 
                    value={editingProject.name}
                    onChange={(e) => setEditingProject({ ...editingProject, name: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả</label>
                  <textarea 
                    value={editingProject.description}
                    onChange={(e) => setEditingProject({ ...editingProject, description: e.target.value })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Trạng thái</label>
                  <select 
                    value={editingProject.status}
                    onChange={(e) => setEditingProject({ ...editingProject, status: e.target.value as any })}
                    className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  >
                    <option value="active">Đang chạy</option>
                    <option value="hidden">Ẩn dự án</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Quản lý bởi</label>
                  <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {users.filter(u => u.role === 'manager' || u.role === 'admin').map(u => (
                      <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-slate-50 rounded cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={(editingProject.managers || []).includes(u.uid)}
                          onChange={(e) => {
                            const currentManagers = editingProject.managers || [];
                            if (e.target.checked) {
                              setEditingProject({ ...editingProject, managers: [...currentManagers, u.uid] });
                            } else {
                              setEditingProject({ ...editingProject, managers: currentManagers.filter(id => id !== u.uid) });
                            }
                          }}
                        />
                        <span>{u.displayName} ({u.role})</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col gap-3 pt-4">
                  <div className="flex gap-3">
                    <Button variant="ghost" className="flex-1" onClick={() => setEditingProject(null)}>Hủy</Button>
                    <Button className="flex-1" onClick={updateProject}>Lưu thay đổi</Button>
                  </div>
                  {profile?.role === 'admin' && (
                    <Button 
                      variant="outline" 
                      className="w-full border-red-200 text-red-600 hover:bg-red-50" 
                      onClick={() => setProjectToDelete(editingProject.id)}
                      disabled={isDeleting}
                    >
                      {isDeleting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Trash2 size={16} className="mr-2" />}
                      Xóa dự án
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {editingTask && (
        <TaskEditModal 
          task={editingTask} 
          users={users} 
          projectManagers={projects.find(p => p.id === editingTask.projectId)?.managers || []}
          onClose={() => setEditingTask(null)} 
        />
      )}
    </div>
  );
};

const MyTasksView = () => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'priority' | 'deadline'>('newest');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'overdue' | 'all'>('all');

  useEffect(() => {
    if (!profile) return;
    
    // Fetch projects to get names
    const projectsUnsub = onSnapshot(collection(db, 'projects'), (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
    });

    // Use collectionGroup to listen to all tasks across projects
    const q = query(
      collectionGroup(db, 'tasks'),
      or(
        where('assignees', 'array-contains', profile.uid),
        where('reviewers', 'array-contains', profile.uid),
        where('cc', 'array-contains', profile.uid)
      )
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const myTasks = snapshot.docs.map(doc => {
        const data = doc.data() as Task;
        const projectId = doc.ref.parent.parent?.id || '';
        return { id: doc.id, projectId, ...data };
      });
      
      setTasks(myTasks);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks (collectionGroup)');
      setLoading(false);
    });

    return () => {
      projectsUnsub();
      unsubscribe();
    };
  }, [profile]);

  const stats = {
    total: tasks.length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    pending: tasks.filter(t => t.status === 'pending').length,
    review: tasks.filter(t => t.status === 'review').length,
    done: tasks.filter(t => t.status === 'done').length,
    overdue: tasks.filter(t => isTaskOverdue(t)).length,
  };

  const filteredTasks = tasks.filter(t => {
    if (filterStatus === 'all') return true;
    if (filterStatus === 'overdue') return isTaskOverdue(t);
    return t.status === filterStatus;
  });

  const sortedTasks = [...filteredTasks].sort((a, b) => {
    if (sortBy === 'newest') {
      return (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0);
    }
    if (sortBy === 'priority') {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    if (sortBy === 'deadline') {
      return (a.date || '').localeCompare(b.date || '');
    }
    return 0;
  });

    const updateTaskStatus = async (task: Task, newStatus: TaskStatus, commentText?: string) => {
      const updates: any = { status: newStatus };
      
      if (newStatus === 'rejected' && task.status === 'review') {
        updates.progress = 90;
      } else if (newStatus === 'done') {
        updates.progress = 100;
      } else if (newStatus === 'todo' && task.status === 'pending') {
        updates.progress = 0;
      }

      if (commentText) {
        const newComment: TaskComment = {
          id: Math.random().toString(36).substr(2, 9),
          userId: profile?.uid || '',
          text: `[${newStatus === 'rejected' ? 'BỊ TỪ CHỐI' : 'ĐÃ PHÊ DUYỆT'}] ${commentText}`,
          time: Timestamp.now()
        };
        updates.comments = [...(task.comments || []), newComment];
      }

      try {
        await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), updates);
        
        // Send notifications for status change
        const targets = [...new Set([...task.assignees, ...(task.reviewers || []), ...(task.cc || [])])].filter(id => id !== profile?.uid);
        for (const targetId of targets) {
          let message = '';
          if (newStatus === 'rejected') {
            message = `Công việc "${task.title}" bị từ chối: ${commentText || ''}`;
          } else if (newStatus === 'done') {
            message = `Công việc "${task.title}" đã được nghiệm thu hoàn thành`;
          } else if (newStatus === 'todo' && task.status === 'pending') {
            message = `Công việc "${task.title}" đã được phê duyệt`;
          } else if (newStatus === 'review') {
            message = `Công việc "${task.title}" đang chờ bạn nghiệm thu`;
          } else {
            message = `Công việc "${task.title}" đã chuyển sang trạng thái: ${newStatus}`;
          }

          await addDoc(collection(db, 'notifications'), {
            targetUserId: targetId,
            message,
            taskId: task.id,
            read: false,
            time: Timestamp.now()
          });
        }
        
        // Update local state if needed (MyTasksView is not real-time yet, but we can refresh)
        setTasks(prev => prev.map(t => t.id === task.id ? { ...t, ...updates } : t));
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
      }
    };

  if (loading) return <div className="p-8 text-center">Đang tải công việc của bạn...</div>;

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Công việc của tôi</h1>
          <p className="text-slate-500">Tất cả các công việc bạn được gán hoặc cần review.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-slate-200 shadow-sm">
            <Filter size={16} className="text-slate-400" />
            <select 
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-sm font-medium text-slate-600 outline-none bg-transparent"
            >
              <option value="newest">Mới nhất</option>
              <option value="priority">Độ ưu tiên</option>
              <option value="deadline">Hạn chót</option>
            </select>
          </div>
          {profile?.role !== 'director' && (
            <Button onClick={() => setIsNewTaskModalOpen(true)} className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100">
              <Plus size={18} className="mr-2" /> Tạo công việc
            </Button>
          )}
        </div>
      </div>

      {/* Stats Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Tổng Task', value: stats.total, icon: List, color: 'bg-slate-50 text-slate-600', status: 'all' },
          { label: 'Đang làm', value: stats.inProgress, icon: Play, color: 'bg-amber-50 text-amber-600', status: 'in-progress' },
          { label: 'Chờ duyệt', value: stats.pending, icon: Clock, color: 'bg-indigo-50 text-indigo-600', status: 'pending' },
          { label: 'Nghiệm thu', value: stats.review, icon: Search, color: 'bg-blue-50 text-blue-600', status: 'review' },
          { label: 'Hoàn thành', value: stats.done, icon: CheckCircle2, color: 'bg-emerald-50 text-emerald-600', status: 'done' },
          { label: 'Quá hạn', value: stats.overdue, icon: AlertTriangle, color: 'bg-red-50 text-red-600', status: 'overdue' },
        ].map((stat, i) => (
          <Card 
            key={i} 
            onClick={() => setFilterStatus(stat.status as any)}
            className={cn(
              "p-4 flex flex-col items-center justify-center text-center space-y-2 border-none shadow-sm cursor-pointer transition-all hover:scale-105",
              filterStatus === stat.status ? "ring-2 ring-indigo-500 bg-white" : "bg-white"
            )}
          >
            <div className={`p-2 rounded-lg ${stat.color}`}>
              <stat.icon size={20} />
            </div>
            <div className="text-2xl font-bold text-slate-900">{stat.value}</div>
            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-wider">{stat.label}</div>
          </Card>
        ))}
      </div>

      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CheckSquare size={20} className="text-indigo-600" />
            Danh sách công việc
            {filterStatus !== 'all' && (
              <span className="text-sm font-normal text-slate-500 ml-2">
                (Lọc: {filterStatus === 'overdue' ? 'Quá hạn' : filterStatus.toUpperCase()})
              </span>
            )}
          </h2>
          {filterStatus !== 'all' && (
            <Button variant="ghost" size="sm" onClick={() => setFilterStatus('all')} className="text-indigo-600">
              Xóa lọc
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sortedTasks.length === 0 ? (
            <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-dashed border-slate-200">
              <CheckCircle2 className="mx-auto text-slate-200 mb-4" size={48} />
              <p className="text-slate-500 font-medium">Không tìm thấy công việc nào phù hợp.</p>
            </div>
          ) : (
            sortedTasks.map(task => (
              <TaskCard 
                key={task.id} 
                task={task} 
                projectManagers={projects.find(p => p.id === task.projectId)?.managers || []}
                onUpdateStatus={updateTaskStatus} 
              />
            ))
          )}
        </div>
      </div>

      <AnimatePresence>
        {isNewTaskModalOpen && (
          <TaskCreateModal onClose={() => setIsNewTaskModalOpen(false)} />
        )}
      </AnimatePresence>
    </div>
  );
};

const TeamView = () => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('user');

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('displayName'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      setLoading(false);
    });

    const inviteUnsub = onSnapshot(query(collection(db, 'invitations'), orderBy('invitedAt', 'desc')), (snapshot) => {
      setInvitations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invitation)));
    });

    return () => {
      unsubscribe();
      inviteUnsub();
    };
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    if (!inviteEmail.endsWith('@fe.edu.vn') && !inviteEmail.endsWith('@fpt.edu.vn')) {
      showToast('Chỉ chấp nhận email @fe.edu.vn hoặc @fpt.edu.vn', 'error');
      return;
    }
    try {
      await addDoc(collection(db, 'invitations'), {
        email: inviteEmail,
        role: inviteRole,
        invitedBy: profile?.uid,
        invitedAt: Timestamp.now(),
        status: 'pending'
      });
      setShowInviteModal(false);
      setInviteEmail('');
      showToast('Đã gửi thư mời!');
    } catch (err) {
      console.error(err);
      showToast('Lỗi khi gửi thư mời', 'error');
    }
  };

  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    userId: string;
  }>({ isOpen: false, userId: '' });

  const updateRole = async (userId: string, newRole: UserRole) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: newRole });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const updateUserStatus = async (userId: string, newStatus: 'active' | 'disabled') => {
    try {
      await updateDoc(doc(db, 'users', userId), { status: newStatus });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userId}`);
    }
  };

  const deleteUser = async (userId: string) => {
    try {
      await deleteDoc(doc(db, 'users', userId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
    }
  };

  if (loading) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto mb-2" /> Đang tải danh sách...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <ConfirmationModal 
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, userId: '' })}
        onConfirm={() => deleteUser(confirmModal.userId)}
        title="Xóa người dùng"
        message="Bạn có chắc chắn muốn xóa người dùng này? Thao tác này không thể hoàn tác và sẽ xóa toàn bộ dữ liệu hồ sơ của họ."
      />
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Quản lý thành viên</h1>
          <p className="text-slate-500">Phân quyền và quản lý tài khoản người dùng trong hệ thống.</p>
        </div>
        <Button onClick={() => setShowInviteModal(true)} className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-100">
          <Plus size={18} className="mr-2" /> Mời thành viên
        </Button>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 w-full max-w-md shadow-2xl space-y-6"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-slate-900">Mời thành viên mới</h3>
              <button onClick={() => setShowInviteModal(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Email FPT Education</label>
                <input 
                  type="email" 
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="example@fe.edu.vn"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Vai trò mặc định</label>
                <select 
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="director">Director</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="ghost" className="flex-1" onClick={() => setShowInviteModal(false)}>Hủy</Button>
              <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" onClick={handleInvite}>Gửi thư mời</Button>
            </div>
          </motion.div>
        </div>
      )}

      {invitations.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
            <Clock size={18} className="text-amber-500" />
            Thư mời đang chờ ({invitations.filter(i => i.status === 'pending').length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {invitations.filter(i => i.status === 'pending').map(invite => (
              <Card key={invite.id} className="p-4 border-dashed border-2 border-slate-200 bg-slate-50/50">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="text-sm font-bold text-slate-900">{invite.email}</p>
                    <p className="text-xs text-slate-500 mt-1 capitalize">Vai trò: {invite.role}</p>
                  </div>
                  <button 
                    onClick={async () => {
                      if (confirm('Xóa thư mời này?')) {
                        await deleteDoc(doc(db, 'invitations', invite.id));
                      }
                    }}
                    className="text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Thành viên</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Email</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Vai trò</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Trạng thái</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {users.map(user => (
              <tr key={user.uid} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-slate-200" />
                    <span className="font-medium text-slate-900">{user.displayName}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-slate-500">{user.email}</td>
                <td className="px-6 py-4">
                  <Badge variant={user.role === 'admin' ? 'danger' : user.role === 'director' ? 'warning' : user.role === 'manager' ? 'info' : 'neutral'}>
                    {user.role.toUpperCase()}
                  </Badge>
                </td>
                <td className="px-6 py-4">
                  <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", user.status === 'active' ? "text-emerald-600" : "text-slate-400")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full", user.status === 'active' ? "bg-emerald-500" : "bg-slate-300")} />
                    {user.status === 'active' ? 'Hoạt động' : 'Vô hiệu'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <select 
                      value={user.role}
                      onChange={(e) => updateRole(user.uid, e.target.value as UserRole)}
                      className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                      <option value="user">User</option>
                      <option value="manager">Manager</option>
                      <option value="director">Director</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button 
                      onClick={() => updateUserStatus(user.uid, user.status === 'active' ? 'disabled' : 'active')}
                      className={cn(
                        "p-1.5 rounded-lg transition-colors",
                        user.status === 'active' ? "text-amber-600 hover:bg-amber-50" : "text-emerald-600 hover:bg-emerald-50"
                      )}
                      title={user.status === 'active' ? "Vô hiệu hóa" : "Kích hoạt"}
                    >
                      {user.status === 'active' ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                    </button>
                    <button 
                      onClick={() => setConfirmModal({ isOpen: true, userId: user.uid })}
                      className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                      title="Xóa người dùng"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const ReportsView = () => {
  const [stats, setStats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Real-time stats using collectionGroup
    const q = query(collectionGroup(db, 'tasks'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const allTasks = snapshot.docs.map(doc => doc.data() as Task);
      
      const statusCounts = allTasks.reduce((acc: any, task: any) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      }, {});

      const overdueCount = allTasks.filter(t => isTaskOverdue(t)).length;
      
      const data = [
        { name: 'Chờ duyệt', value: statusCounts.pending || 0, color: '#94a3b8' },
        { name: 'Sẵn sàng', value: statusCounts.todo || 0, color: '#3b82f6' },
        { name: 'Đang làm', value: statusCounts['in-progress'] || 0, color: '#f59e0b' },
        { name: 'Quá hạn', value: overdueCount, color: '#ef4444' },
        { name: 'Chờ nghiệm thu', value: statusCounts.review || 0, color: '#0ea5e9' },
        { name: 'Hoàn thành', value: statusCounts.done || 0, color: '#10b981' },
        { name: 'Bị từ chối', value: statusCounts.rejected || 0, color: '#ef4444' },
      ];
      setStats(data);
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'tasks (collectionGroup)');
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  if (loading) return <div className="p-8 text-center">Đang tổng hợp dữ liệu...</div>;

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold text-slate-900 mb-8">Báo cáo hệ thống</h1>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="p-6">
          <h3 className="font-bold text-slate-900 mb-6">Phân bổ trạng thái công việc</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {stats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="font-bold text-slate-900 mb-6">Số lượng công việc theo trạng thái</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                <Tooltip cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {stats.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
};

const TaskCreateModal = ({ 
  projectId: initialProjectId, 
  onClose 
}: { 
  projectId?: string; 
  onClose: () => void;
}) => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [projectId, setProjectId] = useState(initialProjectId || '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTask, setNewTask] = useState({ 
    title: '', 
    description: '', 
    reviewers: [] as string[], 
    assignees: profile ? [profile.uid] : [] as string[], 
    cc: [] as string[],
    priority: 'medium' as Priority, 
    date: format(new Date(), 'yyyy-MM-dd'),
    attachedImages: [] as string[]
  });

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    if (!initialProjectId) {
      const unsubProjects = onSnapshot(collection(db, 'projects'), (snapshot) => {
        setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project)));
      });
      return () => {
        unsubUsers();
        unsubProjects();
      };
    } else {
      const unsubProject = onSnapshot(doc(db, 'projects', initialProjectId), (doc) => {
        if (doc.exists()) setProject({ id: doc.id, ...doc.data() } as Project);
      });
      return () => {
        unsubUsers();
        unsubProject();
      };
    }
  }, [initialProjectId]);

  useEffect(() => {
    if (projectId && !initialProjectId) {
      const unsubProject = onSnapshot(doc(db, 'projects', projectId), (doc) => {
        if (doc.exists()) setProject({ id: doc.id, ...doc.data() } as Project);
      });
      return unsubProject;
    }
  }, [projectId, initialProjectId]);

  const addTask = async () => {
    if (!newTask.title || !profile || !projectId || newTask.reviewers.length === 0) {
      showToast('Vui lòng nhập đầy đủ thông tin (bao gồm người phê duyệt)', 'error');
      return;
    }
    setLoading(true);
    try {
      const isRegularUser = profile.role !== 'admin' && profile.role !== 'manager' && profile.role !== 'director';
      const assignees = isRegularUser ? [profile.uid] : newTask.assignees;
      
      const taskData = {
        projectId,
        title: newTask.title,
        description: newTask.description,
        status: 'pending',
        priority: newTask.priority,
        progress: 0,
        date: newTask.date,
        assignees: assignees,
        reviewers: newTask.reviewers,
        cc: newTask.cc,
        tags: [],
        attachedImages: newTask.attachedImages,
        subtasks: [],
        comments: [],
        createdAt: Timestamp.now()
      };
      const taskRef = await addDoc(collection(db, `projects/${projectId}/tasks`), taskData);

      // Send notifications to all involved users
      const targets = [...new Set([...assignees, ...newTask.reviewers, ...newTask.cc])].filter(id => id !== profile.uid);
      for (const targetId of targets) {
        await addDoc(collection(db, 'notifications'), {
          targetUserId: targetId,
          message: `Bạn được gán/liên quan đến công việc mới: "${newTask.title}"`,
          taskId: taskRef.id,
          read: false,
          time: Timestamp.now()
        });
      }

      showToast('Đã tạo công việc mới, đang chờ phê duyệt!');
      onClose();
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, `projects/${projectId}/tasks`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
      <motion.div 
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto space-y-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold">Tạo công việc mới</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
        </div>
        <div className="space-y-4">
          {!initialProjectId && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Chọn dự án</label>
              <select 
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none"
              >
                <option value="">-- Chọn dự án --</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Tiêu đề</label>
            <input 
              type="text" 
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Tên công việc..."
            />
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mô tả chi tiết</label>
              <textarea 
                value={newTask.description}
                onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                placeholder="Mô tả chi tiết công việc..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                <ImageIcon size={16} /> Thêm ảnh minh họa
              </label>
              <div className="flex flex-wrap gap-2 mb-2">
                {newTask.attachedImages.map((img, idx) => (
                  <div key={idx} className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200 group">
                    <img src={img} alt="attached" className="w-full h-full object-cover" />
                    <button 
                      onClick={() => setNewTask({ ...newTask, attachedImages: newTask.attachedImages.filter((_, i) => i !== idx) })}
                      className="absolute inset-0 bg-black/40 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <label className="w-16 h-16 rounded-lg border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 hover:border-indigo-500 hover:text-indigo-500 cursor-pointer transition-colors">
                  <Plus size={20} />
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          setNewTask({ ...newTask, attachedImages: [...newTask.attachedImages, reader.result as string] });
                        };
                        reader.readAsDataURL(file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Mức độ ưu tiên</label>
              <select 
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as Priority })}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none"
              >
                <option value="low">Thấp</option>
                <option value="medium">Trung bình</option>
                <option value="high">Cao</option>
                <option value="critical">Rất cao</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Hạn hoàn thành</label>
              <input 
                type="date" 
                value={newTask.date}
                min={new Date().toISOString().split('T')[0]}
                onChange={(e) => setNewTask({ ...newTask, date: e.target.value })}
                className="w-full px-4 py-2 rounded-lg border border-slate-200 outline-none"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Người thực hiện (Assignees)</label>
              {profile?.role !== 'admin' && profile?.role !== 'manager' && profile?.role !== 'director' ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 border rounded-lg text-xs">
                  <img src={profile?.photoURL} className="w-5 h-5 rounded-full" referrerPolicy="no-referrer" />
                  <span className="font-medium">{profile?.displayName} (Tự gán)</span>
                </div>
              ) : (
                <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                  {users.map(u => (
                    <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-white rounded cursor-pointer transition-colors">
                      <input 
                        type="checkbox" 
                        checked={newTask.assignees?.includes(u.uid)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setNewTask({ ...newTask, assignees: [...(newTask.assignees || []), u.uid] });
                          } else {
                            setNewTask({ ...newTask, assignees: (newTask.assignees || []).filter(id => id !== u.uid) });
                          }
                        }}
                      />
                      <span>{u.displayName} ({u.role})</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Người phê duyệt (Reviewers)</label>
              <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                {users.filter(u => (project?.managers || []).includes(u.uid) || u.role === 'admin').map(u => (
                  <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-white rounded cursor-pointer transition-colors">
                    <input 
                      type="checkbox" 
                      checked={newTask.reviewers.includes(u.uid)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewTask({ ...newTask, reviewers: [...newTask.reviewers, u.uid] });
                        } else {
                          setNewTask({ ...newTask, reviewers: newTask.reviewers.filter(id => id !== u.uid) });
                        }
                      }}
                    />
                    <span>{u.displayName} {project?.managers.includes(u.uid) ? '(Quản lý dự án)' : '(Admin)'}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Theo dõi (CC)</label>
              <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                {users.map(u => (
                  <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-white rounded cursor-pointer transition-colors">
                    <input 
                      type="checkbox" 
                      checked={newTask.cc.includes(u.uid)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setNewTask({ ...newTask, cc: [...newTask.cc, u.uid] });
                        } else {
                          setNewTask({ ...newTask, cc: newTask.cc.filter(id => id !== u.uid) });
                        }
                      }}
                    />
                    <span>{u.displayName}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 pt-4">
            <Button variant="ghost" className="flex-1" onClick={onClose}>Hủy</Button>
            <Button className="flex-1" onClick={addTask} disabled={loading}>{loading ? 'Đang tạo...' : 'Tạo Task'}</Button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const ProjectDetail = ({ projectId, onBack }: { projectId: string; onBack: () => void }) => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const [activeTab, setActiveTab] = useState<TaskStatus | 'all' | 'reports' | 'reviews'>('all');
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isNewReviewModalOpen, setIsNewReviewModalOpen] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');

  const stats = [
    { name: 'Pending', value: tasks.filter(t => t.status === 'pending').length, color: '#94a3b8' },
    { name: 'Todo', value: tasks.filter(t => t.status === 'todo').length, color: '#3b82f6' },
    { name: 'In Progress', value: tasks.filter(t => t.status === 'in-progress').length, color: '#f59e0b' },
    { name: 'Overdue', value: tasks.filter(t => isTaskOverdue(t)).length, color: '#ef4444' },
    { name: 'Review', value: tasks.filter(t => t.status === 'review').length, color: '#0ea5e9' },
    { name: 'Done', value: tasks.filter(t => t.status === 'done').length, color: '#10b981' },
    { name: 'Rejected', value: tasks.filter(t => t.status === 'rejected').length, color: '#ef4444' },
  ];

  useEffect(() => {
    const q = query(collection(db, 'reviews'), where('projectId', '==', projectId), orderBy('time', 'desc'));
    const unsubReviews = onSnapshot(q, (snapshot) => {
      setReviews(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Review)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'reviews'));
    return unsubReviews;
  }, [projectId]);

  const addReview = async () => {
    if (!profile) return;
    try {
      await addDoc(collection(db, 'reviews'), {
        projectId,
        userId: profile.uid,
        rating: newReview.rating,
        comment: newReview.comment,
        time: Timestamp.now()
      });
      setIsNewReviewModalOpen(false);
      setNewReview({ rating: 5, comment: '' });
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const unsubProject = onSnapshot(doc(db, 'projects', projectId), (doc) => {
      if (doc.exists()) setProject({ id: doc.id, ...doc.data() } as Project);
    }, (error) => handleFirestoreError(error, OperationType.GET, `projects/${projectId}`));

    const q = query(collection(db, `projects/${projectId}/tasks`), orderBy('createdAt', 'desc'));
    const unsubTasks = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, projectId, ...doc.data() } as Task)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, `projects/${projectId}/tasks`));

    const unsubUsers = onSnapshot(collection(db, 'users'), (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

    return () => {
      unsubProject();
      unsubTasks();
      unsubUsers();
    };
  }, [projectId]);

  const updateTaskStatus = async (task: Task, newStatus: TaskStatus, commentText?: string) => {
    const updates: any = { status: newStatus };
    
    if (newStatus === 'rejected') {
      // If rejected from review, go back to in-progress
      if (task.status === 'review') {
        updates.status = 'in-progress';
        updates.progress = 90;
      } else if (task.status === 'pending') {
        // If rejected from pending, stay pending but with rejected status?
        // Actually, let's keep it as 'rejected' status
        updates.status = 'rejected';
      }
    } else if (newStatus === 'done') {
      updates.progress = 100;
    } else if (newStatus === 'todo' && task.status === 'pending') {
      // Approved from pending
      updates.progress = 0;
    }

    if (commentText) {
      const newComment: TaskComment = {
        id: Math.random().toString(36).substr(2, 9),
        userId: profile?.uid || '',
        text: `[${newStatus === 'rejected' ? 'BỊ TỪ CHỐI' : 'ĐÃ PHÊ DUYỆT'}] ${commentText}`,
        time: Timestamp.now()
      };
      updates.comments = [...(task.comments || []), newComment].map(c => {
        const cleanComment: any = { ...c };
        Object.keys(cleanComment).forEach(key => {
          if (cleanComment[key] === undefined) delete cleanComment[key];
        });
        return cleanComment;
      });
    }

    try {
      await updateDoc(doc(db, `projects/${projectId}/tasks`, task.id), updates);
      
      // Send notifications for status change
      const targets = [...new Set([...task.assignees, ...(task.reviewers || []), ...(task.cc || [])])].filter(id => id !== profile?.uid);
      for (const targetId of targets) {
        let message = '';
        if (newStatus === 'rejected') {
          message = `Công việc "${task.title}" bị từ chối: ${commentText || ''}`;
        } else if (newStatus === 'done') {
          message = `Công việc "${task.title}" đã được nghiệm thu hoàn thành`;
        } else if (newStatus === 'todo' && task.status === 'pending') {
          message = `Công việc "${task.title}" đã được phê duyệt`;
        } else if (newStatus === 'review') {
          message = `Công việc "${task.title}" đang chờ bạn nghiệm thu`;
        } else {
          message = `Công việc "${task.title}" đã chuyển sang trạng thái: ${newStatus}`;
        }

        await addDoc(collection(db, 'notifications'), {
          targetUserId: targetId,
          message,
          taskId: task.id,
          read: false,
          time: Timestamp.now()
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${projectId}/tasks/${task.id}`);
    }
  };

  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  if (!project) return <div className="flex items-center justify-center h-64"><Loader2 className="animate-spin text-indigo-600" /></div>;

  const handleDeleteProject = async () => {
    try {
      setIsDeleting(true);
      const tasksSnap = await getDocs(collection(db, `projects/${projectId}/tasks`));
      const deleteTasksPromises = tasksSnap.docs.map(d => deleteDoc(doc(db, `projects/${projectId}/tasks`, d.id)));
      await Promise.all(deleteTasksPromises);
      await deleteDoc(doc(db, 'projects', projectId));
      showToast('Đã xóa dự án thành công!');
      onBack(); // Go back to dashboard after delete
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${projectId}`);
    } finally {
      setIsDeleting(false);
    }
  };

  const filteredTasks = tasks.filter(t => {
    if (activeTab !== 'all' && activeTab !== 'reports' && activeTab !== 'reviews') {
      if (activeTab === 'overdue') {
        if (!isTaskOverdue(t)) return false;
      } else if (t.status !== activeTab) {
        return false;
      }
    }

    if (searchQuery && !t.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (assigneeFilter !== 'all' && !t.assignees.includes(assigneeFilter)) return false;

    // Data isolation
    if (profile?.role === 'admin' || profile?.role === 'director') return true;
    if (profile?.role === 'manager' && project.managers.includes(profile.uid)) return true;
    return (t.assignees || []).includes(profile?.uid || '') || (t.reviewers || []).includes(profile?.uid || '') || (t.cc || []).includes(profile?.uid || '');
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" className="p-2" onClick={onBack}><ArrowLeft size={20} /></Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-slate-900">{project.name}</h1>
              <Badge variant={project.status === 'active' ? 'success' : 'neutral'}>
                {project.status === 'active' ? 'ĐANG HOẠT ĐỘNG' : 'ĐÃ ĐÓNG'}
              </Badge>
              {profile?.role === 'admin' && (
                <Button 
                  variant="outline"
                  className="border-red-200 text-red-600 hover:bg-red-50 h-9 px-3"
                  onClick={() => setShowConfirmDelete(true)}
                  disabled={isDeleting}
                  title="Xóa dự án"
                >
                  {isDeleting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Trash2 size={16} className="mr-2" />}
                  Xóa dự án
                </Button>
              )}
            </div>
            <p className="text-slate-500 text-sm">{project.description}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => {
            const url = `${window.location.origin}?project=${projectId}`;
            navigator.clipboard.writeText(url);
            showToast('Đã sao chép liên kết dự án!');
          }}>
            <Share2 size={18} /> Chia sẻ
          </Button>
          <Button variant={viewMode === 'list' ? 'primary' : 'secondary'} onClick={() => setViewMode('list')}>
            <List size={18} /> Danh sách
          </Button>
          <Button variant={viewMode === 'board' ? 'primary' : 'secondary'} onClick={() => setViewMode('board')}>
            <LayoutDashboard size={18} /> Kanban
          </Button>
          {profile?.role !== 'director' && (
            <Button onClick={() => setIsNewTaskModalOpen(true)}>
              <Plus size={18} /> Task mới
            </Button>
          )}
        </div>
      </div>

      {/* Project Dashboard Stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { label: 'Tổng Task', value: tasks.length, icon: <Briefcase size={16} />, color: 'bg-slate-50 text-slate-600' },
          { label: 'Chờ duyệt', value: tasks.filter(t => t.status === 'pending').length, icon: <Clock size={16} />, color: 'bg-amber-50 text-amber-600' },
          { label: 'Đang làm', value: tasks.filter(t => t.status === 'in-progress').length, icon: <Activity size={16} />, color: 'bg-blue-50 text-blue-600' },
          { label: 'Nghiệm thu', value: tasks.filter(t => t.status === 'review').length, icon: <Search size={16} />, color: 'bg-sky-50 text-sky-600' },
          { label: 'Quá hạn', value: tasks.filter(t => isTaskOverdue(t)).length, icon: <AlertTriangle size={16} />, color: 'bg-red-50 text-red-600' },
          { label: 'Hoàn thành', value: tasks.filter(t => t.status === 'done').length, icon: <CheckCircle2 size={16} />, color: 'bg-emerald-50 text-emerald-600' },
        ].map((stat, i) => (
          <Card key={i} className={cn("p-4 border-none shadow-sm flex items-center gap-3", stat.color)}>
            <div className="p-2 bg-white/50 rounded-lg">{stat.icon}</div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider opacity-70">{stat.label}</div>
              <div className="text-xl font-black">{stat.value}</div>
            </div>
          </Card>
        ))}
      </div>

      <ConfirmationModal 
        isOpen={showConfirmDelete}
        onClose={() => setShowConfirmDelete(false)}
        onConfirm={handleDeleteProject}
        title="Xác nhận xóa dự án"
        message="Bạn có chắc chắn muốn xóa dự án này? Toàn bộ công việc bên trong sẽ bị xóa và không thể khôi phục."
      />

      {isDeleting && (
        <div className="fixed inset-0 z-[150] bg-white/50 backdrop-blur-sm flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-indigo-600" size={40} />
            <p className="text-sm font-bold text-slate-900">Đang xóa dự án...</p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit overflow-x-auto">
          {(['all', 'pending', 'todo', 'in-progress', 'overdue', 'review', 'rejected', 'done', 'reports', 'reviews'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-medium transition-all capitalize whitespace-nowrap",
                activeTab === tab ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {tab === 'all' ? 'Tất cả' : 
               tab === 'pending' ? 'Chờ duyệt' :
               tab === 'todo' ? 'Sẵn sàng' :
               tab === 'in-progress' ? 'Đang làm' :
               tab === 'overdue' ? 'Quá hạn' :
               tab === 'review' ? 'Chờ nghiệm thu' :
               tab === 'rejected' ? 'Bị từ chối' :
               tab === 'done' ? 'Hoàn thành' :
               tab === 'reports' ? 'Báo cáo' : 'Đánh giá'}
              {tab !== 'reports' && tab !== 'reviews' && (
                <span className="ml-2 opacity-50">({tasks.filter(t => tab === 'all' ? true : (tab === 'overdue' ? isTaskOverdue(t) : t.status === tab)).length})</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
            <input 
              type="text" 
              placeholder="Tìm kiếm task..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 pr-4 py-1.5 rounded-lg bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-indigo-500 w-48"
            />
          </div>
          <select 
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-slate-50 text-xs outline-none focus:ring-2 focus:ring-indigo-500 border-none"
          >
            <option value="all">Tất cả người phụ trách</option>
            {users.map(u => (
              <option key={u.uid} value={u.uid}>{u.displayName}</option>
            ))}
          </select>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {activeTab !== 'reports' && activeTab !== 'reviews' && (
          viewMode === 'board' ? (
            <motion.div 
              key="board"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4"
            >
              {(['pending', 'todo', 'in-progress', 'overdue', 'review', 'rejected', 'done'] as TaskStatus[]).map((status) => (
                <div key={status} className="flex flex-col gap-4">
                  <div className="flex items-center justify-between px-2">
                    <h3 className="font-bold text-slate-700 text-xs uppercase tracking-wider flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", 
                        status === 'pending' ? "bg-slate-300" :
                        status === 'todo' ? "bg-blue-500" : 
                        status === 'in-progress' ? "bg-amber-500" : 
                        status === 'overdue' ? "bg-red-500" :
                        status === 'review' ? "bg-sky-500" : 
                        status === 'rejected' ? "bg-red-500" : "bg-emerald-500"
                      )} />
                      {status === 'pending' ? 'CHỜ DUYỆT' :
                       status === 'todo' ? 'SẴN SÀNG' :
                       status === 'in-progress' ? 'ĐANG LÀM' :
                       status === 'overdue' ? 'QUÁ HẠN' :
                       status === 'review' ? 'CHỜ NGHIỆM THU' :
                       status === 'rejected' ? 'BỊ TỪ CHỐI' : 'HOÀN THÀNH'}
                    </h3>
                  </div>
                  <div className="flex-1 space-y-3 min-h-[500px] bg-slate-100/50 p-2 rounded-xl">
                    {tasks.filter(t => status === 'overdue' ? isTaskOverdue(t) : (t.status === status && !isTaskOverdue(t))).map((task) => (
                      <TaskCard key={task.id} task={task} projectManagers={project.managers} onUpdateStatus={updateTaskStatus} />
                    ))}
                  </div>
                </div>
              ))}
            </motion.div>
          ) : (
            <motion.div 
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2"
            >
              {filteredTasks.map(task => (
                <TaskListItem key={task.id} task={task} projectManagers={project.managers} onUpdateStatus={updateTaskStatus} />
              ))}
            </motion.div>
          )
        )}

        {activeTab === 'reports' && (
          <motion.div 
            key="reports"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="grid grid-cols-1 lg:grid-cols-2 gap-6"
          >
            <Card className="p-6">
              <h3 className="text-lg font-bold mb-6">Phân bổ trạng thái công việc</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stats}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="value"
                    >
                      {stats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex justify-center gap-4 mt-4">
                {stats.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs text-slate-500">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.name}: {s.value}
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-bold mb-6">Tiến độ tổng thể</h3>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {stats.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </motion.div>
        )}

        {activeTab === 'reviews' && (
          <motion.div 
            key="reviews"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-4xl mx-auto space-y-6"
          >
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold">Đánh giá từ cộng đồng</h3>
              <Button onClick={() => setIsNewReviewModalOpen(true)}>
                <Star size={18} /> Viết đánh giá
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reviews.length === 0 ? (
                <Card className="col-span-full p-12 text-center text-slate-400">
                  Chưa có đánh giá nào cho dự án này.
                </Card>
              ) : (
                reviews.map(review => (
                  <Card key={review.id} className="p-6 space-y-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center font-bold text-slate-500">
                          {users.find(u => u.uid === review.userId)?.displayName?.substring(0, 2).toUpperCase() || '??'}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900">{users.find(u => u.uid === review.userId)?.displayName || 'Người dùng'}</p>
                          <p className="text-[10px] text-slate-400">{format(review.time.toDate(), 'dd/MM/yyyy HH:mm')}</p>
                        </div>
                      </div>
                      <div className="flex gap-0.5">
                        {[1,2,3,4,5].map(s => (
                          <Star key={s} size={12} className={cn(s <= review.rating ? "text-amber-400 fill-amber-400" : "text-slate-200")} />
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-slate-600 leading-relaxed italic">"{review.comment}"</p>
                  </Card>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modals */}
      <AnimatePresence>
        {isNewReviewModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Đánh giá dự án</h2>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Xếp hạng</label>
                  <div className="flex gap-2">
                    {[1,2,3,4,5].map(s => (
                      <button key={s} onClick={() => setNewReview({...newReview, rating: s})}>
                        <Star size={24} className={cn(s <= newReview.rating ? "text-amber-400 fill-amber-400" : "text-slate-200")} />
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Nhận xét</label>
                  <textarea 
                    value={newReview.comment}
                    onChange={(e) => setNewReview({...newReview, comment: e.target.value})}
                    className="w-full px-4 py-3 bg-slate-50 border border-slate-100 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none h-32"
                    placeholder="Chia sẻ cảm nghĩ của bạn về dự án..."
                  />
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" className="flex-1" onClick={() => setIsNewReviewModalOpen(false)}>Hủy</Button>
                  <Button className="flex-1" onClick={addReview}>Gửi đánh giá</Button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {isNewTaskModalOpen && (
          <TaskCreateModal 
            projectId={projectId} 
            onClose={() => setIsNewTaskModalOpen(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
};

// Main App
// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends (Component as any) {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    const { hasError, error } = (this as any).state;
    if (hasError) {
      let errorDetails = null;
      try {
        if (error?.message) {
          errorDetails = JSON.parse(error.message);
        }
      } catch (e) {
        // Not a JSON error
      }

      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <Card className="max-w-xl w-full p-10 text-center space-y-6">
            <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
              <AlertCircle size={40} />
            </div>
            <div className="space-y-2">
              <h1 className="text-2xl font-bold text-slate-900">Đã có lỗi xảy ra</h1>
              <p className="text-slate-500">Hệ thống gặp sự cố không mong muốn. Vui lòng thử tải lại trang.</p>
            </div>
            
            {errorDetails && (
              <div className="bg-slate-100 p-4 rounded-xl text-left overflow-auto max-h-48">
                <p className="text-xs font-mono text-slate-600 whitespace-pre-wrap">
                  {JSON.stringify(errorDetails, null, 2)}
                </p>
              </div>
            )}

            <div className="flex gap-3">
              <Button onClick={() => window.location.reload()} className="flex-1">
                <RotateCcw size={18} className="mr-2" /> Tải lại trang
              </Button>
              <Button variant="outline" onClick={() => (this as any).setState({ hasError: false, error: null })} className="flex-1">
                Thử lại
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

export default function App() {
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  const [activeNav, setActiveNav] = useState('dashboard');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const pId = params.get('project');
    if (pId) {
      setCurrentProjectId(pId);
    }
  }, []);

  return (
    <ErrorBoundary>
      <ToastProvider>
        <AuthProvider>
          <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
            <AuthConsumer 
              currentProjectId={currentProjectId} 
              setCurrentProjectId={setCurrentProjectId}
              activeNav={activeNav}
              setActiveNav={setActiveNav}
            />
          </div>
        </AuthProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}

function AuthConsumer({ 
  currentProjectId, 
  setCurrentProjectId,
  activeNav,
  setActiveNav
}: { 
  currentProjectId: string | null; 
  setCurrentProjectId: (id: string | null) => void;
  activeNav: string;
  setActiveNav: (nav: string) => void;
}) {
  const { user, profile, loading, error, signIn, logout } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    // No redirect for users, let them see the overview dashboard if they want
  }, [profile, activeNav, setActiveNav]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full mb-4"
      />
      <p className="text-slate-500 text-sm font-medium animate-pulse">Đang tải hệ thống...</p>
      
      <div className="mt-8 flex flex-col items-center gap-4">
        <p className="text-xs text-slate-400">Nếu quá trình này diễn ra quá lâu, hãy thử:</p>
        <div className="flex gap-3">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
            <RotateCcw size={14} className="mr-2" /> Tải lại
          </Button>
          <Button variant="ghost" size="sm" onClick={logout} className="text-red-500 hover:bg-red-50">
            <LogOut size={14} className="mr-2" /> Đăng xuất
          </Button>
        </div>
      </div>
    </div>
  );

  if (!user) return (
    <div className="flex items-center justify-center h-screen p-4">
      <Card className="max-w-md w-full p-10 text-center space-y-8">
        <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mx-auto shadow-xl shadow-indigo-200 rotate-3">
          <Briefcase size={40} className="text-white -rotate-3" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">FSC Tracker</h1>
          <p className="text-slate-500">Hệ thống quản lý dự án FPT School</p>
        </div>

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-red-600 text-xs text-left space-y-2">
            <p className="font-bold flex items-center gap-2">
              <AlertCircle size={14} /> Lỗi hệ thống:
            </p>
            <p className="break-words font-mono">{error}</p>
            {error.toLowerCase().includes('network-request-failed') && (
              <div className="mt-2 text-[10px] text-red-500 italic space-y-1">
                <p>* Gợi ý: Kiểm tra kết nối mạng, tắt các trình chặn quảng cáo (AdBlock) hoặc thử lại sau vài phút.</p>
                <p>* Nếu bạn đang dùng remix app, hãy yêu cầu admin setup lại Firebase.</p>
              </div>
            )}
          </div>
        )}

        <Button onClick={signIn} className="w-full py-4 text-lg">
          <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
          Đăng nhập với Google
        </Button>
        <div className="space-y-4">
          <p className="text-xs text-slate-400">Dành riêng cho học sinh và giáo viên FPT School</p>
          <p className="text-[10px] text-slate-400 italic">Lưu ý: Vui lòng cho phép bật cửa sổ bật lên (popup) để đăng nhập.</p>
        </div>
      </Card>
    </div>
  );

  if (user && !profile && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
        <AlertCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Không thể tải hồ sơ người dùng</h2>
        <p className="text-slate-500 mb-6 text-center max-w-xs">Hệ thống không thể tìm thấy hoặc tạo hồ sơ cho tài khoản của bạn. Vui lòng thử đăng xuất và đăng nhập lại.</p>
        <Button onClick={logout} className="bg-red-600 hover:bg-red-700">
          <LogOut size={18} className="mr-2" /> Đăng xuất
        </Button>
      </div>
    );
  }

  if (profile?.status === 'disabled') {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-50">
        <XCircle size={48} className="text-red-500 mb-4" />
        <h2 className="text-xl font-bold text-slate-900 mb-2">Tài khoản đã bị vô hiệu hóa</h2>
        <p className="text-slate-500 mb-6 text-center max-w-xs">Tài khoản của bạn đã bị quản trị viên vô hiệu hóa. Vui lòng liên hệ quản trị viên để biết thêm chi tiết.</p>
        <Button onClick={logout} className="bg-red-600 hover:bg-red-700">
          <LogOut size={18} className="mr-2" /> Đăng xuất
        </Button>
      </div>
    );
  }

  const navItems = [
    { id: 'dashboard', icon: LayoutDashboard, label: 'Tổng quan' },
    { id: 'projects', icon: Briefcase, label: 'Dự án', roles: ['admin', 'director', 'manager'] },
    { id: 'tasks', icon: CheckSquare, label: 'Công việc' },
    { id: 'reports', icon: BarChart3, label: 'Báo cáo', roles: ['admin', 'director'] },
    { id: 'team', icon: Users, label: 'Thành viên', roles: ['admin'] },
  ].filter(item => !item.roles || item.roles.includes(profile?.role || ''));

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Mobile Sidebar Overlay */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsMobileMenuOpen(false)}
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 lg:hidden"
            />
            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed inset-y-0 left-0 w-72 bg-white z-50 lg:hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                    <Briefcase size={16} />
                  </div>
                  <span className="font-bold text-lg">FSC Tracker</span>
                </div>
                <button onClick={() => setIsMobileMenuOpen(false)} className="p-2 text-slate-400">
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                <nav className="space-y-1">
                  {navItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActiveNav(item.id);
                        setCurrentProjectId(null);
                        setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                        activeNav === item.id && !currentProjectId ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      <item.icon size={18} />
                      {item.label}
                    </button>
                  ))}
                </nav>
              </div>
              <div className="p-6 border-t border-slate-100">
                <div className="flex items-center gap-3 mb-6">
                  <img src={profile?.photoURL} className="w-10 h-10 rounded-full border-2 border-indigo-50" alt="Avatar" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 truncate">{profile?.displayName}</p>
                    <p className="text-xs text-slate-500 truncate capitalize">{profile?.role}</p>
                  </div>
                </div>
                <Button variant="ghost" className="w-full justify-start text-red-500 hover:bg-red-50" onClick={logout}>
                  <LogOut size={18} /> Đăng xuất
                </Button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Desktop Sidebar */}
      <aside className="w-72 bg-white border-r border-slate-200 flex flex-col hidden lg:flex">
        <div className="p-8">
          <div className="flex items-center gap-3 mb-10">
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-100">
              <Briefcase size={20} />
            </div>
            <span className="font-bold text-xl tracking-tight">FSC Tracker</span>
          </div>

          <nav className="space-y-1">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  setActiveNav(item.id);
                  setCurrentProjectId(null);
                }}
                className={cn(
                  "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all",
                  activeNav === item.id && !currentProjectId ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <item.icon size={18} />
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-8 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-6">
            <img src={profile?.photoURL} className="w-10 h-10 rounded-full border-2 border-indigo-50" alt="Avatar" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-900 truncate">{profile?.displayName}</p>
              <p className="text-xs text-slate-500 truncate capitalize">{profile?.role}</p>
            </div>
          </div>
          <Button variant="ghost" className="w-full justify-start text-red-500 hover:bg-red-50" onClick={logout}>
            <LogOut size={18} /> Đăng xuất
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto flex flex-col">
        <header className="h-16 lg:h-20 bg-white/80 backdrop-blur-md border-b border-slate-200 sticky top-0 z-30 px-4 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3 lg:hidden">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-lg"
            >
              <Menu size={20} />
            </button>
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
              <Briefcase size={16} />
            </div>
          </div>

          <div className="flex items-center gap-4 flex-1 max-w-xl mx-4 lg:mx-0">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input 
                type="text" 
                placeholder="Tìm kiếm..." 
                className="w-full pl-9 pr-4 py-1.5 lg:py-2 bg-slate-100 border-none rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 lg:gap-3">
            <NotificationCenter />
            <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors hidden sm:block">
              <Settings size={20} />
            </button>
            <div className="lg:hidden">
              <img src={profile?.photoURL} className="w-8 h-8 rounded-full border border-slate-200" alt="Avatar" />
            </div>
          </div>
        </header>

        <div className="flex-1 pb-20 lg:pb-0">
          {currentProjectId ? (
            <div className="p-4 lg:p-8 max-w-7xl mx-auto">
              <ProjectDetail projectId={currentProjectId} onBack={() => setCurrentProjectId(null)} />
            </div>
          ) : (
            <div className="p-4 lg:p-8 max-w-7xl mx-auto">
              {activeNav === 'dashboard' && <Dashboard onSelectProject={setCurrentProjectId} />}
              {activeNav === 'projects' && <Dashboard onSelectProject={setCurrentProjectId} />}
              {activeNav === 'tasks' && <MyTasksView />}
              {activeNav === 'reports' && <ReportsView />}
              {activeNav === 'team' && <TeamView />}
            </div>
          )}
        </div>

        {/* Mobile Bottom Nav */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 flex items-center justify-around lg:hidden z-40">
          {navItems.slice(0, 4).map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveNav(item.id);
                setCurrentProjectId(null);
              }}
              className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-lg transition-colors",
                activeNav === item.id && !currentProjectId ? "text-indigo-600" : "text-slate-400"
              )}
            >
              <item.icon size={20} />
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          ))}
          <button
            onClick={logout}
            className="flex flex-col items-center gap-1 p-2 text-red-400"
          >
            <LogOut size={20} />
            <span className="text-[10px] font-medium">Thoát</span>
          </button>
        </nav>
      </main>
    </div>
  );
}
