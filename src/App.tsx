import React, { useState, useEffect, useMemo, createContext, useContext, Component } from 'react';
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
  writeBatch,
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
  Calendar,
  LifeBuoy,
  Copy,
  RefreshCw,
  ChevronLeft,
  ArrowUpDown
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
import { auth, db, googleProvider, handleFirestoreError, setFirestoreErrorReporter, OperationType } from './firebase';
import { Project, Task, SubTask, Review, UserProfile, ProjectStatus, TaskStatus, UserRole, TaskComment, Priority, Invitation } from './types';

// Primitive dùng chung với src/modules/*. Trước đây cn/Card/Button/Badge được
// định nghĩa private ngay trong file này nên module khác không dùng lại được.
// Bản trong components/ui.tsx giữ nguyên class, và vá thêm variant "outline"
// cùng prop "size" mà file này vốn đã gọi ở 12 chỗ nhưng chưa từng được khai báo.
import { Badge, Button, Card, StateBlock, cn } from './components/ui';

/**
 * Chuẩn hoá task đọc từ Firestore.
 *
 * Vì sao cần: giao diện đọc thẳng `task.subtasks.length`, `task.comments.map(...)`
 * ở khoảng 15 chỗ. Một document THIẾU bất kỳ mảng nào trong số đó sẽ ném
 * TypeError và ErrorBoundary nuốt trọn cả màn Công việc — người dùng chỉ thấy
 * "Đã có lỗi xảy ra", không biết vì sao và mất luôn quyền dùng phần đó.
 *
 * Document thiếu field là chuyện có thật: task tạo từ luồng khác, dữ liệu di
 * trú, hoặc ghi bằng script. Vá ở ĐÂY — nơi duy nhất dữ liệu đi từ Firestore
 * vào React — thay vì rải optional chaining khắp 15 chỗ và vẫn sót.
 */
function normalizeTask(raw: any): Task {
  return {
    ...raw,
    subtasks: raw?.subtasks ?? [],
    comments: raw?.comments ?? [],
    attachedImages: raw?.attachedImages ?? [],
    assignees: raw?.assignees ?? [],
    reviewers: raw?.reviewers ?? [],
    cc: raw?.cc ?? [],
    tags: raw?.tags ?? [],
    progress: raw?.progress ?? 0,
  } as Task;
}
import { PendingGate } from './modules/support/components/PendingGate';
import { SupportAdminView } from './modules/support/components/admin/SupportAdminView';
import { SupportView } from './modules/support/components/SupportView';
import { PtudSupportView } from './modules/support/components/PtudSupportView';
import { useSupportRole } from './modules/support/hooks/useSupportRole';
import { useCampusStaffUids } from './modules/support/hooks/useCampusStaff';
import { filterAssignableUsers } from './modules/support/services/assignableUsers';
import { useNavBadges } from './modules/support/hooks/useNavBadges';
import { finishInvitation, readUsableInvitation } from './modules/support/repository/invitationRepository';

import { syncTicketFromTask } from './modules/support/repository/ticketRepository';
import { MemberScopeCell } from './modules/support/components/admin/MemberScopeCell';
import { watchRoleAssignments } from './modules/support/repository/userAdminRepository';
import { watchCampuses } from './modules/support/repository/campusRepository';
import { DomainError, ROLES_REQUIRING_CAMPUS, type Campus, type SupportRole, type SupportRoleAssignment } from './modules/support/types';
import {
  createInvitation, deleteInvitation, watchInvitations, type Invitation as PreAuth,
} from './modules/support/repository/invitationRepository';

/**
 * Màu biểu đồ theo trạng thái công việc.
 *
 * Vì sao phải khai một chỗ bằng hex thay vì dùng class Tailwind: Recharts nhận
 * màu qua thuộc tính `fill`/`color` dạng chuỗi, không qua className. Nên tầng
 * token Apple ở index.css — thứ đã đổi màu cho toàn bộ phần còn lại của app —
 * KHÔNG với tới được biểu đồ. Trước khi có hằng số này, hai mảng màu chép tay
 * nằm ở ReportsView và ProjectDetail vẫn giữ nguyên thang Tailwind cũ, nên màn
 * Báo cáo là màn duy nhất trong app còn dùng bảng màu khác.
 *
 * Giá trị lấy từ hệ màu hệ thống của Apple (HIG) và ánh xạ ĐÚNG với variant của
 * Badge, để một trạng thái luôn mang một màu dù nó xuất hiện ở biểu đồ hay ở
 * nhãn trong bảng.
 *
 * NGOẠI LỆ CÓ CHỦ ĐÍCH — `rejected` là NÂU, không phải đỏ như Badge của nó.
 *
 * Badge ánh xạ CẢ `overdue` LẪN `rejected` vào variant "danger" (đỏ). Trong
 * bảng thì không sao: hai thứ đó là hai nhãn riêng đứng cạnh nhau, đọc chữ là
 * biết. Trong biểu đồ tròn thì chúng là hai LÁT phải phân biệt bằng màu, mà
 * bản cũ cho cả hai đúng một mã #ef4444 nên chú giải trở thành vô dụng.
 *
 * Thử hồng hệ thống #ff2d55 trước — vẫn hỏng: cạnh #ff3b30 trong ô chú giải
 * 10px, mắt không tách được hai sắc đỏ ấm đó. Nâu #a2845e (cũng thuộc HIG)
 * khác hẳn ở mọi kích thước, và sắc trầm đọc đúng nghĩa "đã đóng, không làm
 * nữa" — trong khi đỏ để dành cho thứ đang cháy là `overdue`.
 *
 * Trong biểu đồ, đọc được lát nào là lát nào quan trọng hơn việc trung thành
 * với màu badge.
 */
const MAU_TRANG_THAI = {
  pending:       '#ff9500', // cam  — khớp Badge "warning"
  todo:          '#86868b', // xám  — khớp Badge "neutral"
  'in-progress': '#0066cc', // lam  — khớp Badge "info"
  overdue:       '#ff3b30', // đỏ   — thứ đang cháy
  review:        '#32ade6', // xanh biển — khớp Badge "sky"
  done:          '#34c759', // lục  — khớp Badge "success"
  rejected:      '#a2845e', // nâu  — xem ghi chú ngoại lệ ở trên
} as const;

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

/**
 * Chữ hiện ở ô hạn khi task chưa có hạn.
 *
 * Task sinh từ phiếu hỗ trợ được tiếp nhận với hạn "chưa xác định" có date rỗng
 * — và một ô trống trông y hệt lỗi tải dữ liệu. Nói thẳng ra là chưa có hạn.
 */
const CHUA_CO_HAN = 'Chưa có hạn';

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

  // Nối tầng dữ liệu vào tầng hiện thông báo.
  //
  // handleFirestoreError nằm ở firebase.ts (tầng dưới cùng, không biết gì về
  // React) nên nó không tự hiện toast được. Trước đây nó chỉ console.error, và
  // mọi lượt GHI hỏng đều im lặng tuyệt đối: bấm "Nghiệm thu" xong màn hình
  // không đổi gì, người dùng tưởng nút hỏng.
  //
  // 6 giây chứ không phải 3: thông báo lỗi có mã lỗi cần đọc và chụp lại.
  useEffect(() => {
    setFirestoreErrorReporter((message) => {
      setToast({ message, type: 'error' });
      setTimeout(() => setToast(null), 6000);
    });
    return () => setFirestoreErrorReporter(null);
  }, []);

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
              // bottom-24 trên mobile: nav dưới cùng nằm ở bottom-0, để bottom-8
              // thì mọi toast đều đè lên thanh điều hướng. Desktop không có nav
              // dưới nên giữ bottom-8.
              "fixed bottom-24 lg:bottom-8 left-1/2 z-[200] px-6 py-3 rounded-full shadow-2xl flex items-center gap-3 min-w-[300px] max-w-[calc(100vw-2rem)]",
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
          const email = (user.email || '').toLowerCase().trim();
          const isInternal = email.endsWith('@fe.edu.vn') || email.endsWith('@fpt.edu.vn');
          const isDev = email === 'viet88.nb@gmail.com' || email === 'vietnb4@fpt.edu.vn';
          
          console.log('AuthProvider: Email check:', { email, isInternal, isDev });

          if (!isInternal && !isDev) {
            console.warn('AuthProvider: Non-internal email detected:', email);
            await signOut(auth);
            setError(`Email "${email}" không được phép. Chỉ chấp nhận email nội bộ @fe.edu.vn hoặc @fpt.edu.vn. Vui lòng sử dụng tài khoản trường cấp.`);
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
            const cu = userDoc.data() as UserProfile;
            // Người đã thử đăng nhập TRƯỚC khi được cấp quyền: hồ sơ họ đang
            // 'pending'. Nếu sau đó admin cấp quyền trước cho email này thì lần
            // đăng nhập tiếp theo phải nhận được, không thì họ kẹt mãi ở màn chờ
            // và admin tưởng đã xong việc.
            if (cu.status === 'pending') {
              const inv = await readUsableInvitation(email);
              if (inv) {
                // Thứ tự bắt buộc: hồ sơ TRƯỚC, rồi mới tới bản gán và đóng thư
                // mời. Rules đòi thư mời còn 'pending' cho cả hai lượt ghi đầu.
                await updateDoc(doc(db, 'users', user.uid), {
                  role: inv.role,
                  status: 'active',
                });
                await finishInvitation({ uid: user.uid, email, invitation: inv });
                setProfile({ ...cu, role: inv.role, status: 'active' });
                setLoading(false);
                return;
              }
            }
            setProfile(cu);
          } else {
            console.log('AuthProvider: Creating new profile');
            // Default role is 'user' for everyone except the hardcoded admin
            const isBootstrapAdmin = email === 'vietnb4@fpt.edu.vn';
            const defaultRole: UserRole = isBootstrapAdmin ? 'admin' : 'user';

            // CỔNG DUYỆT: tài khoản mới ra đời ở trạng thái 'pending'. Chỉ admin
            // mới chuyển sang 'active' được, và việc đó đi kèm gán trường
            // (xem UserApprovalQueue). firestore.rules ép đúng điều này ở tầng dữ
            // liệu — sửa dòng này thành 'active' cũng không qua được rules.
            //
            // Ngoại lệ DUY NHẤT là tài khoản admin gốc: nếu nó cũng phải chờ duyệt
            // thì không còn ai trên đời duyệt được cho nó, hệ thống tự khoá chính mình.
            // firestore.rules cho phép đúng ngoại lệ này qua isAdmin().
            // Duyệt trước: admin đã ghi sẵn quyền cho email này thì nhận luôn,
            // khỏi phải chờ ai bấm duyệt.
            const inv = await readUsableInvitation(email);

            const newProfile: UserProfile = {
              uid: user.uid,
              displayName: user.displayName || 'User',
              email: email,
              photoURL: user.photoURL || '',
              role: inv?.role ?? defaultRole,
              status: (isBootstrapAdmin || inv) ? 'active' : 'pending'
            };
            await setDoc(doc(db, 'users', user.uid), newProfile);
            // Đóng thư mời SAU khi hồ sơ đã ghi xong, xem ghi chú trong repository.
            if (inv) await finishInvitation({ uid: user.uid, email, invitation: inv });
            setProfile(newProfile);
          }
        } else {
          setUser(null);
          setProfile(null);
        }
      } catch (err: any) {
        console.error('AuthProvider: Auth state change error:', err);
        setError(err.message || 'Lỗi xác thực');
        // Don't throw here to avoid crashing the auth listener
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
      } else if (err.code === 'auth/unauthorized-domain') {
        setError('Tên miền này chưa được cấp phép trong Firebase Console. Nếu bạn đã triển khai lên tên miền riêng, hãy thêm nó vào danh sách "Authorized domains" trong Firebase Auth.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Cửa sổ đăng nhập bị chặn. Vui lòng cho phép popup cho trang web này.');
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
                  onClick={() => {
                    navigator.clipboard.writeText(error);
                    showToast('Đã sao chép mã lỗi!');
                  }}
                  className="text-xs font-bold text-indigo-600 hover:underline"
                >
                  Sao chép lỗi
                </button>
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
      // Phiếu hỗ trợ chạy theo công việc: tiến độ >0 = đang xử lý, 100% =
      // đã khắc phục, nghiệm thu xong = hoàn tất. Best-effort, không chặn.
      void syncTicketFromTask(task.projectId, task.id);

      // Send notifications for status/progress change
      if (newStatus !== task.status || progress !== task.progress) {
        const targets = [...new Set([...(task.assignees || []), ...(task.reviewers || []), ...(task.cc || []), ...projectManagers])].filter(id => id !== profile?.uid);
        for (const targetId of targets) {
          let message = `Công việc "${task.title}" đã được cập nhật tiến độ: ${progress}%`;
          if (newStatus === 'review' && task.status !== 'review') {
            message = `Công việc "${task.title}" đã hoàn thành 100% và đang chờ bạn nghiệm thu`;
          } else if (newStatus !== task.status) {
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
      }
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
      // Phiếu hỗ trợ chạy theo công việc: tiến độ >0 = đang xử lý, 100% =
      // đã khắc phục, nghiệm thu xong = hoàn tất. Best-effort, không chặn.
      void syncTicketFromTask(task.projectId, task.id);

      // Send notifications for progress change
      if (progress !== task.progress || newStatus !== task.status) {
        const targets = [...new Set([...(task.assignees || []), ...(task.reviewers || []), ...(task.cc || []), ...projectManagers])].filter(id => id !== profile?.uid);
        for (const targetId of targets) {
          let message = `Công việc "${task.title}" đã được cập nhật tiến độ: ${progress}%`;
          if (newStatus === 'review' && task.status !== 'review') {
            message = `Công việc "${task.title}" đã đạt 100% và đang chờ bạn nghiệm thu`;
          }
          await addDoc(collection(db, 'notifications'), {
            targetUserId: targetId,
            message,
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
          {task.date || CHUA_CO_HAN}
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
            <Clock size={12} /> {task.date || CHUA_CO_HAN}
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

/**
 * Bảng công việc dùng chung.
 *
 * Trước đây "Công việc của tôi" ở Tổng quan và màn Công việc render dạng THẺ,
 * trong khi Tổng quan lại đã có sẵn một bảng cho danh sách khác — hai kiểu trình
 * bày cho cùng một loại dữ liệu, trên cùng một màn hình.
 *
 * Bảng đọc nhanh hơn thẻ khi cần so sánh nhiều dòng: mắt quét theo cột (hạn,
 * tiến độ, trạng thái) thay vì phải đọc lại nhãn ở từng thẻ.
 * Kiểu dáng bám đúng bảng vốn có của app, không tự đặt kiểu mới.
 */
const TaskTable: React.FC<{
  tasks: Task[];
  users: UserProfile[];
  projects: Project[];
  onOpen: (task: Task) => void;
  emptyText?: string;
}> = ({ tasks, users, projects, onOpen, emptyText = 'Chưa có công việc nào' }) => (
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
      <tbody className="divide-y divide-slate-100">
        {tasks.length > 0 ? tasks.map((task) => {
          const assigneeProfiles = users.filter(u => task.assignees?.includes(u.uid));
          return (
            <tr
              key={task.id}
              className="hover:bg-slate-50 transition-colors cursor-pointer"
              onClick={() => onOpen(task)}
            >
              <td className="px-4 py-3">
                <div className="text-sm font-medium text-slate-900 mb-1">{task.title}</div>
                <div className="flex flex-wrap gap-1 mb-1">
                  {task.status === 'pending' && (
                    <Badge variant="warning" className="text-[8px] py-0 px-1">CẦN DUYỆT</Badge>
                  )}
                  {task.status === 'review' && (
                    <Badge variant="sky" className="text-[8px] py-0 px-1">NGHIỆM THU</Badge>
                  )}
                  {isTaskOverdue(task) && (
                    <Badge variant="danger" className="text-[8px] py-0 px-1">QUÁ HẠN</Badge>
                  )}
                  {task.tags?.includes('ho-tro') && (
                    <Badge variant="primary" className="text-[8px] py-0 px-1">HỖ TRỢ</Badge>
                  )}
                </div>
                <div className="text-[10px] text-slate-400">{projects.find(p => p.id === task.projectId)?.name}</div>
              </td>
              <td className="px-4 py-3">
                <div className="flex -space-x-2 overflow-hidden">
                  {assigneeProfiles.map((u, i) => (
                    <Avatar key={i} name={u.displayName} photoURL={u.photoURL} size={6} title={u.displayName} className="border-2 border-white" />
                  ))}
                  {assigneeProfiles.length === 0 && <span className="text-xs text-slate-400 italic">Chưa giao</span>}
                </div>
              </td>
              <td className="px-4 py-3">
                <div className="flex items-center justify-center gap-2">
                  <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className={cn("h-full", getProgressColor(task.progress || 0))} style={{ width: `${task.progress || 0}%` }} />
                  </div>
                  {/* tabular-nums: cột phần trăm không nhảy khi số đổi bề rộng */}
                  <span className="text-[10px] font-bold text-slate-600 tabular-nums w-8 text-right">{task.progress || 0}%</span>
                </div>
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                  task.priority === 'critical' ? 'bg-purple-100 text-purple-600' :
                  task.priority === 'high' ? 'bg-red-100 text-red-600' :
                  task.priority === 'medium' ? 'bg-amber-100 text-amber-600' : 'bg-blue-100 text-blue-600'
                }`}>
                  {(task.priority || 'low').toUpperCase()}
                </span>
              </td>
              <td className="px-4 py-3">
                <span className={cn("text-xs tabular-nums", getDeadlineStyle(task.date, task.status))}>{task.date || CHUA_CO_HAN}</span>
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
            <td colSpan={6} className="px-4 py-8 text-center text-slate-400 text-sm">{emptyText}</td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
);

const NotificationCenter = () => {
  const { profile } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [marking, setMarking] = useState(false);

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

  /**
   * Cán bộ trường không có nút nào khác để hạ số xuống.
   *
   * Với họ thanh điều hướng chỉ có một mục và họ bị đẩy thẳng vào đó, nên quy
   * tắc "mở mục nào thì mục đó coi như đã xem" không áp dụng được. Không có nút
   * này thì số trên chuông chỉ có tăng.
   */
  const markAllAsRead = async () => {
    const ids = notifications.filter(n => !n.read).map(n => n.id).slice(0, 400);
    if (ids.length === 0) return;
    setMarking(true);
    try {
      const batch = writeBatch(db);
      for (const id of ids) batch.update(doc(db, 'notifications', id), { read: true });
      await batch.commit();
    } catch (error) {
      console.error(error);
    } finally {
      setMarking(false);
    }
  };

  /**
   * Bấm vào thông báo của một phiếu thì MỞ phiếu đó, không chỉ đánh dấu đã đọc.
   *
   * Dùng sự kiện window thay vì đổi URL rồi tải lại trang: tải lại làm mất
   * trạng thái đang gõ dở của người dùng, mà thông báo thì hay đến giữa lúc
   * họ đang làm việc khác.
   */
  const openNotification = (n: any) => {
    void markAsRead(n.id);
    if (n.ticketNo) {
      setIsOpen(false);
      window.dispatchEvent(new CustomEvent('fsc:open-ticket', { detail: String(n.ticketNo) }));
    }
  };

  /** Icon và màu suy từ nội dung: phiếu hỗ trợ hay công việc. */
  const kindOf = (n: any) => {
    if (n.ticketId) return { Icon: LifeBuoy, cls: 'bg-sky-50 text-sky-600', label: 'Yêu cầu hỗ trợ' };
    if (n.taskId) return { Icon: CheckSquare, cls: 'bg-indigo-50 text-indigo-600', label: 'Công việc' };
    return { Icon: Bell, cls: 'bg-slate-100 text-slate-500', label: 'Thông báo' };
  };

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        aria-label={unreadCount > 0 ? `${unreadCount} thông báo chưa đọc` : 'Thông báo'}
        className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors relative"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 bg-red-500 text-white text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-white">
            {unreadCount > 99 ? '99+' : unreadCount}
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
              className="absolute right-0 mt-2 w-[22rem] bg-white rounded-2xl shadow-2xl border border-slate-100 z-50 overflow-hidden"
            >
              <div className="p-4 border-b border-slate-100 flex justify-between items-center gap-2">
                <h3 className="font-bold text-slate-900">Thông báo</h3>
                {unreadCount > 0 ? (
                  <button
                    onClick={markAllAsRead}
                    disabled={marking}
                    className="text-xs font-semibold text-indigo-600 hover:underline disabled:opacity-50"
                  >
                    {marking ? 'Đang lưu…' : `Đánh dấu tất cả đã đọc (${unreadCount})`}
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">Đã đọc hết</span>
                )}
              </div>
              <div className="max-h-[26rem] overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center">
                    <Bell size={22} className="mx-auto mb-2 text-slate-300" />
                    <p className="text-sm text-slate-500">Chưa có thông báo nào</p>
                    <p className="mt-1 text-xs text-slate-400">
                      Khi yêu cầu của bạn được tiếp nhận hoặc xử lý xong, thông báo sẽ hiện ở đây.
                    </p>
                  </div>
                ) : (
                  notifications.map(n => {
                    const k = kindOf(n);
                    return (
                      <button
                        key={n.id}
                        onClick={() => openNotification(n)}
                        className={cn(
                          "w-full flex gap-3 p-3.5 border-b border-slate-50 text-left hover:bg-slate-50 transition-colors",
                          !n.read && "bg-indigo-50/40"
                        )}
                      >
                        <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", k.cls)}>
                          <k.Icon size={15} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              {k.label}
                            </span>
                            {n.ticketNo && (
                              <span className="font-mono text-[10px] font-bold text-slate-500">{n.ticketNo}</span>
                            )}
                            {!n.read && <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />}
                          </span>
                          <span className="mt-0.5 block text-sm leading-snug text-slate-700">{n.message}</span>
                          <span className="mt-1 block text-[10px] text-slate-400">
                            {format(n.time?.toDate() || new Date(), 'HH:mm dd/MM')}
                            {n.ticketNo && ' · Bấm để mở yêu cầu'}
                          </span>
                        </span>
                      </button>
                    );
                  })
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
  // Cán bộ nhà trường chỉ vào hệ thống để gửi yêu cầu hỗ trợ, không nhận việc.
  const campusStaff = useCampusStaffUids(profile?.role);
  const [isEditingMetadata, setIsEditingMetadata] = useState(false);
  const [projectName, setProjectName] = useState<string>('');
  const [editedTask, setEditedTask] = useState({ 
    ...task,
    title: task.title || '',
    description: task.description || '',
    category: task.category || '',
    priority: task.priority || 'medium',
    // KHÔNG lấy hôm nay làm mặc định cho ba mốc thời gian dưới đây.
    //
    // Task sinh từ phiếu hỗ trợ tiếp nhận với hạn "chưa xác định" cố ý không có
    // hạn: nó chỉ mang số ngày dự kiến, và hạn hình thành khi người xử lý chọn
    // ngày bắt đầu. Điền sẵn hôm nay thì mở màn chi tiết ra là thấy một cái hạn
    // chưa ai đặt, và chỉ cần bấm Lưu vì bất kỳ lý do gì là nó thành hạn thật.
    date: task.date || '',
    assignees: task.assignees || [],
    reviewers: task.reviewers || [],
    cc: task.cc || [],
    tags: task.tags || [],
    attachedImages: task.attachedImages || [],
    progress: task.progress || 0,
    status: task.status || 'todo',
    startDate: task.startDate || '',
    estimatedDuration: task.estimatedDuration || 0,
    estimatedDeadline: task.estimatedDeadline || '',
    subtasks: task.subtasks || [],
    comments: task.comments || []
  });
  const [loading, setLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [commentImage, setCommentImage] = useState<string | null>(null);
  const today = format(new Date(), 'yyyy-MM-dd');
  const [newSubtask, setNewSubtask] = useState({ text: '', deadline: (task.date && today > task.date) ? task.date : today });
  const [activeSubtaskComment, setActiveSubtaskComment] = useState<string | null>(null);
  const [subtaskCommentText, setSubtaskCommentText] = useState('');
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [showActionCommentModal, setShowActionCommentModal] = useState<{ status: TaskStatus; title: string; variant: "primary" | "danger" | "success" } | null>(null);
  const [editingSubtask, setEditingSubtask] = useState<{ id: string; text: string; deadline: string } | null>(null);

  useEffect(() => {
    if (editedTask.startDate && editedTask.estimatedDuration > 0) {
      const start = new Date(editedTask.startDate);
      const end = addDays(start, editedTask.estimatedDuration);
      const formattedEnd = format(end, 'yyyy-MM-dd');
      setEditedTask(prev => ({ 
        ...prev, 
        estimatedDeadline: formattedEnd,
        date: formattedEnd
      }));
    }
  }, [editedTask.startDate, editedTask.estimatedDuration]);

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
    // Validate that task deadline is not earlier than any subtask deadline
    // Chỉ so khi task lớn có hạn: task chưa chốt hạn (date rỗng) thì mọi hạn của
    // công việc nhỏ đều "lớn hơn" chuỗi rỗng, và người dùng không lưu nổi gì.
    const invalidSubtask = editedTask.date
      ? editedTask.subtasks.find(s => s.deadline > editedTask.date)
      : undefined;
    if (invalidSubtask) {
      showToast(`Hạn của task lớn không được sớm hơn hạn của công việc nhỏ: "${invalidSubtask.text}" (${format(new Date(invalidSubtask.deadline), 'dd/MM/yyyy')})`, 'error');
      return;
    }

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
        startDate: editedTask.startDate || '',
        estimatedDuration: editedTask.estimatedDuration || 0,
        estimatedDeadline: editedTask.estimatedDeadline || '',
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

      // Phiếu hỗ trợ phải biết công việc vừa đổi gì.
      //
      // Trước đây chỉ những nút đổi tiến độ / trạng thái mới gọi đồng bộ, nên
      // lưu bằng nút "Lưu" của màn chi tiết không kéo được gì về phiếu. Việc đó
      // giờ quan trọng hơn: phiếu tiếp nhận ở chế độ "chưa xác định hạn" chỉ có
      // hạn thật khi người xử lý đặt ngày bắt đầu và bấm lưu ở đúng đây.
      void syncTicketFromTask(task.projectId, task.id);

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

      // If status or progress changed, notify all involved users
      if (editedTask.status !== task.status || editedTask.progress !== task.progress) {
        const updateTargets = [...new Set([...(editedTask.assignees || []), ...(editedTask.reviewers || []), ...(editedTask.cc || []), ...projectManagers])].filter(id => id !== profile?.uid);
        console.log('Sending update notifications to targets:', updateTargets);
        for (const targetId of updateTargets) {
          let message = `Công việc "${task.title}" đã được cập nhật tiến độ: ${editedTask.progress}%`;
          if (editedTask.status === 'review' && task.status !== 'review') {
            message = `Công việc "${task.title}" đang chờ bạn nghiệm thu (100%)`;
          } else if (editedTask.status === 'done' && task.status !== 'done') {
            message = `Công việc "${task.title}" đã được nghiệm thu hoàn thành`;
          } else if (editedTask.status === 'rejected' && task.status !== 'rejected') {
            message = `Công việc "${task.title}" đã bị từ chối`;
          } else if (editedTask.status !== task.status) {
            message = `Công việc "${task.title}" đã chuyển sang trạng thái: ${editedTask.status.toUpperCase()}`;
          }

          try {
            await addDoc(collection(db, 'notifications'), {
              targetUserId: targetId,
              message,
              taskId: task.id,
              read: false,
              time: Timestamp.now()
            });
            console.log('Update notification sent to:', targetId);
          } catch (err) {
            console.error('Failed to send update notification to:', targetId, err);
          }
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
    
    // Validate subtask deadline
    if (editedTask.date && newSubtask.deadline > editedTask.date) {
      showToast(`Hạn hoàn thành của công việc nhỏ không được vượt quá hạn của task lớn (${format(new Date(editedTask.date), 'dd/MM/yyyy')})`, 'error');
      return;
    }

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
    // Task lớn chưa có hạn thì lấy hôm nay, không để ô hạn rỗng — công việc nhỏ
    // không hạn rơi thẳng vào chỗ hiển thị ngày và in ra "Invalid Date".
    setNewSubtask({ text: '', deadline: editedTask.date || today });

    try {
      await updateDoc(doc(db, `projects/${task.projectId}/tasks`, task.id), { 
        subtasks: newSubtasks,
        progress
      });
      void syncTicketFromTask(task.projectId, task.id);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `projects/${task.projectId}/tasks/${task.id}`);
    }
  };

  const saveEditedSubtask = async () => {
    if (!editingSubtask || !editingSubtask.text.trim()) return;

    // Validate subtask deadline
    if (editedTask.date && editingSubtask.deadline > editedTask.date) {
      showToast(`Hạn hoàn thành của công việc nhỏ không được vượt quá hạn của task lớn (${format(new Date(editedTask.date), 'dd/MM/yyyy')})`, 'error');
      return;
    }

    const newSubtasks = editedTask.subtasks.map(s => 
      s.id === editingSubtask.id ? { ...s, text: editingSubtask.text, deadline: editingSubtask.deadline } : s
    );

    setEditedTask({ ...editedTask, subtasks: newSubtasks });
    setEditingSubtask(null);

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
        }))
      });
      showToast('Đã cập nhật đầu công việc!');
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
      void syncTicketFromTask(task.projectId, task.id);
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
              <span className="text-sm font-medium">
                {editedTask.date ? format(new Date(editedTask.date), 'dd/MM/yyyy') : CHUA_CO_HAN}
              </span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 ml-2">{editedTask.title}</h2>
            {/* Đường về phiếu hỗ trợ đã sinh ra công việc này. Không có nó thì
                người xử lý muốn đọc lại mô tả gốc phải tự đi tìm mã phiếu
                trong tiêu đề rồi gõ tay vào ô tìm kiếm bên module Hỗ trợ. */}
            {(task as any).supportTicketNo && (
              <button
                type="button"
                title="Mở phiếu hỗ trợ gốc"
                onClick={() => {
                  onClose();
                  window.dispatchEvent(new CustomEvent('fsc:goto-support', {
                    detail: String((task as any).supportTicketNo),
                  }));
                }}
                className="ml-1 inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1 font-mono text-[11px] font-bold text-sky-700 transition-colors hover:bg-sky-100"
              >
                <LifeBuoy size={13} /> {(task as any).supportTicketNo}
              </button>
            )}
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
                        void syncTicketFromTask(task.projectId, task.id);
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
                        {filterAssignableUsers(users, campusStaff, editedTask.assignees || []).map(u => (
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
                            <Avatar name={u.displayName} photoURL={u.photoURL} size={4} title={u.displayName} />
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
                        {filterAssignableUsers(users.filter(u => u.role === 'admin' || u.role === 'manager' || u.role === 'director'), campusStaff, editedTask.reviewers || []).map(u => (
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
                            <Avatar name={u.displayName} photoURL={u.photoURL} size={4} title={u.displayName} />
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
                        {filterAssignableUsers(users, campusStaff, editedTask.cc || []).map(u => (
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
                            <Avatar name={u.displayName} photoURL={u.photoURL} size={4} title={u.displayName} />
                            {u.displayName}
                          </div>
                        ) : null;
                      })
                    )}
                  </div>
                </div>
              </section>

              {/* Timeline Section */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Ngày bắt đầu (Dự kiến)</label>
                  {isEditingMetadata ? (
                    <input 
                      type="date" 
                      value={editedTask.startDate}
                      onChange={(e) => setEditedTask({ ...editedTask, startDate: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-700 font-medium">
                      <Calendar size={16} className="text-slate-400" />
                      {editedTask.startDate ? format(new Date(editedTask.startDate), 'dd/MM/yyyy') : 'Chưa thiết lập'}
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Thời gian dự kiến (Ngày)</label>
                  {isEditingMetadata ? (
                    <input 
                      type="number" 
                      value={editedTask.estimatedDuration}
                      onChange={(e) => setEditedTask({ ...editedTask, estimatedDuration: Number(e.target.value) })}
                      className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                      min="0"
                    />
                  ) : (
                    <div className="flex items-center gap-2 text-slate-700 font-medium">
                      <Clock size={16} className="text-slate-400" />
                      {editedTask.estimatedDuration} Ngày
                    </div>
                  )}
                </div>
              </section>

              <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Deadline dự kiến</label>
                  <div className="flex items-center gap-2 text-slate-700 font-medium">
                    <Calendar size={16} className="text-slate-400" />
                    {editedTask.estimatedDeadline ? format(new Date(editedTask.estimatedDeadline), 'dd/MM/yyyy') : 'Chưa thiết lập'}
                  </div>
                </div>
                <div className="space-y-3">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Hạn hoàn thành (Deadline)</label>
                  {isEditingMetadata ? (
                    <input 
                      type="date" 
                      value={editedTask.date}
                      onChange={(e) => setEditedTask({ ...editedTask, date: e.target.value })}
                      className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600"
                    />
                  ) : (
                    <div className={cn(
                      "flex items-center gap-2 font-bold",
                      isTaskOverdue(editedTask) ? "text-red-600" : "text-indigo-600"
                    )}>
                      <Calendar size={16} />
                      {editedTask.date ? format(new Date(editedTask.date), 'dd/MM/yyyy') : 'Chưa thiết lập'}
                    </div>
                  )}
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
                      {editingSubtask?.id === s.id ? (
                        <div className="space-y-3">
                          <input 
                            type="text" 
                            value={editingSubtask.text}
                            onChange={(e) => setEditingSubtask({ ...editingSubtask, text: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                            placeholder="Tên đầu việc..."
                            autoFocus
                          />
                          <div className="flex items-center gap-2">
                            <div className="relative flex-1">
                              <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} />
                              <input 
                                type="date" 
                                value={editingSubtask.deadline}
                                max={editedTask.date}
                                onChange={(e) => setEditingSubtask({ ...editingSubtask, deadline: e.target.value })}
                                className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                            <Button size="sm" variant="ghost" onClick={() => setEditingSubtask(null)}>Hủy</Button>
                            <Button size="sm" onClick={saveEditedSubtask}>Lưu</Button>
                          </div>
                        </div>
                      ) : (
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
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button 
                                  onClick={() => setEditingSubtask({ id: s.id, text: s.text, deadline: s.deadline })} 
                                  className="p-1 text-slate-300 hover:text-indigo-600"
                                  title="Chỉnh sửa"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button 
                                  onClick={() => removeSubtask(s.id)} 
                                  className="p-1 text-slate-300 hover:text-red-500"
                                  title="Xóa"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      
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
                          max={editedTask.date}
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
                        min={new Date().toISOString().split('T')[0]}
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

/**
 * Hai màn dùng chung một bộ dữ liệu: "Tổng quan" và "Dự án".
 *
 * Trước đây App render <Dashboard/> cho CẢ HAI mục menu với cùng props, nên
 * admin/quản lý bấm "Tổng quan" hay "Dự án" đều ra một màn y hệt nhau — menu
 * hứa hai nơi rồi đưa tới cùng một chỗ.
 *
 * Vì sao tách bằng prop chứ không tách thành hai component: cả hai đều cần
 * projects + toàn bộ tasks + users. Tách đôi là nhân đôi ba listener Firestore
 * cho cùng một dữ liệu, và người dùng chuyển qua lại giữa hai mục liên tục.
 *
 *   overview → số liệu + việc cần chú ý.   KHÔNG có danh sách dự án.
 *   projects → danh sách + quản lý dự án.  KHÔNG có dãy thẻ số liệu.
 */
const Dashboard = ({
  onSelectProject,
  variant = 'overview',
}: {
  onSelectProject: (id: string) => void;
  variant?: 'overview' | 'projects';
}) => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  // Cán bộ nhà trường không phải nhân sự dự án — không đưa vào ô chọn thành viên,
  // vì thành viên dự án chính là nguồn của danh sách giao việc ở màn Task.
  const campusStaff = useCampusStaffUids(profile?.role);
  const [projects, setProjects] = useState<Project[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [newProject, setNewProject] = useState({ name: '', description: '', managers: [] as string[], members: [] as string[] });
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
      const tasksData = snapshot.docs.map(doc => normalizeTask({
        id: doc.id,
        projectId: doc.ref.parent.parent?.id || '',
        ...doc.data()
      }));
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
    
    const isManager = p.managers.includes(profile?.uid || '');
    const isMember = (p.members || []).includes(profile?.uid || '');
    
    if (isManager || isMember) return showHidden ? true : p.status === 'active';
    
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
  const laTongQuan = variant === 'overview';
  const laDuAn = variant === 'projects';
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


  const createProject = async () => {
    if (!newProject.name || !profile || profile.role !== 'admin') return;
    try {
      await addDoc(collection(db, 'projects'), {
        name: newProject.name,
        description: newProject.description || 'Dự án FSC FPT School',
        managers: newProject.managers.length > 0 ? newProject.managers : [profile.uid],
        members: newProject.members || [],
        status: 'active',
        createdAt: Timestamp.now()
      });
      setNewProject({ name: '', description: '', managers: [], members: [] });
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
        members: editingProject.members || [],
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
          {/* font-semibold thay cho font-bold: thang cân của hệ Apple là
              300/400/600/700 và tiêu đề nằm ở 600 — xem DESIGN.md §Typography. */}
          <h1 className="text-3xl font-semibold tracking-[-0.022em] text-slate-900">
            {laDuAn ? 'Dự án' : 'Tổng quan hệ thống'}
          </h1>
          <p className="text-slate-500">
            {laDuAn
              ? 'Danh sách dự án, tiến độ và phân công quản lý.'
              : `Chào mừng, ${profile?.displayName}. Đây là báo cáo tổng thể dự án FSC.`}
          </p>
        </div>
        {/* Nút thao tác dự án chỉ ở màn Dự án. Để cả ở Tổng quan thì "Dự án mới"
            đứng cạnh dãy số liệu — một hành động quản trị nằm giữa một bản báo
            cáo, và đó chính là thứ khiến hai màn trông như một. */}
        {laDuAn && (
          <div className="flex gap-3">
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
        )}
      </div>

      {/* Dãy thẻ số liệu — CHỈ ở Tổng quan. Đây là thứ trả lời "hệ thống đang
          thế nào", không phải thứ giúp quản lý một dự án cụ thể. */}
      {laTongQuan && (
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
      )}

      {/* Khối nội dung chính. Tổng quan chỉ dựng khối này cho role=user (họ
          không có mục "Dự án" trong menu nên đây là chỗ duy nhất thấy việc của
          mình); màn Dự án dựng danh sách dự án. Quản lý/admin ở Tổng quan
          không dựng gì ở đây — bảng "cần chú ý" bên dưới lo phần đó. */}
      {((isUser && laTongQuan) || (!isUser && laDuAn)) && (
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
            
            {/* Dạng BẢNG, giống hệt bảng mà admin/quản lý đang thấy.
                Trước đây role='user' render dạng thẻ còn role khác render bảng —
                cùng một loại dữ liệu, hai kiểu trình bày, tuỳ vai trò. Người
                dùng thường là người có NHIỀU việc nhất, mà thẻ lại là dạng khó
                so sánh nhiều dòng nhất. */}
            <Card>
              <TaskTable
                tasks={filteredDashboardTasks}
                users={users}
                projects={projects}
                onOpen={setEditingTask}
                emptyText="Không tìm thấy công việc nào phù hợp."
              />
            </Card>
          </div>
        ) : (
          // Manager/Admin Project List View
          //
          // Bỏ tiêu đề phụ "Danh sách dự án": nó từng cần thiết khi khối này nằm
          // lẫn giữa dãy số liệu và bảng công việc trên cùng một màn. Nay nó là
          // nội dung DUY NHẤT của màn Dự án, đứng ngay dưới h1 "Dự án" — nhắc
          // lại đúng một điều hai lần liền nhau.
          <div className="space-y-6">
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
                            <Avatar
                              key={i}
                              name={m.displayName}
                              photoURL={m.photoURL}
                              size={5}
                              title={m.displayName}
                              className="border-2 border-white"
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
      )}

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

      {/* Bảng việc cần chú ý — quản lý/admin, CHỈ ở Tổng quan.
          Đây là thứ thay chỗ danh sách dự án vừa dọn đi: Tổng quan giờ trả lời
          "có gì đang cháy", còn "dự án nào đang chạy" là câu hỏi của màn Dự án.

          Các modal bên dưới (xoá/tạo/sửa dự án) cố ý KHÔNG gán cờ variant: chúng
          chỉ mở được từ thẻ dự án, mà thẻ dự án nay chỉ có ở màn Dự án — ở Tổng
          quan chúng đứng im, không dựng ra gì. */}
      {!isUser && laTongQuan && (
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
                              <Avatar key={i} name={u.displayName} photoURL={u.photoURL} size={6} title={u.displayName} className="border-2 border-white" />
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
                          <span className={cn("text-xs", getDeadlineStyle(task.date, task.status))}>{task.date || CHUA_CO_HAN}</span>
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
                    {filterAssignableUsers(users.filter(u => u.role === 'manager' || u.role === 'admin' || u.role === 'director'), campusStaff, newProject.managers).map(u => (
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
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Thành viên dự án</label>
                  <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {filterAssignableUsers(users, campusStaff, newProject.members).map(u => (
                      <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-slate-50 rounded cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={newProject.members.includes(u.uid)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setNewProject({ ...newProject, members: [...newProject.members, u.uid] });
                            } else {
                              setNewProject({ ...newProject, members: newProject.members.filter(id => id !== u.uid) });
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
                    {filterAssignableUsers(users.filter(u => u.role === 'manager' || u.role === 'admin' || u.role === 'director'), campusStaff, editingProject.managers || []).map(u => (
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
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Thành viên dự án</label>
                  <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1">
                    {filterAssignableUsers(users, campusStaff, editingProject.members || []).map(u => (
                      <label key={u.uid} className="flex items-center gap-2 text-xs p-1 hover:bg-slate-50 rounded cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={(editingProject.members || []).includes(u.uid)}
                          onChange={(e) => {
                            const currentMembers = editingProject.members || [];
                            if (e.target.checked) {
                              setEditingProject({ ...editingProject, members: [...currentMembers, u.uid] });
                            } else {
                              setEditingProject({ ...editingProject, members: currentMembers.filter(id => id !== u.uid) });
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

const MyTasksView = ({ openTaskId, onOpened }: { openTaskId?: string | null; onOpened?: () => void }) => {
  const { profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  // Bảng công việc hiện avatar người phụ trách nên cần danh bạ người dùng.
  const [users, setUsers] = useState<UserProfile[]>([]);
  // Bấm một dòng trong bảng mở đúng modal chỉnh sửa mà mọi màn khác dùng.
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'priority' | 'deadline'>('newest');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'overdue' | 'all'>('all');

  // Mở thẳng một công việc khi người dùng bấm "Mở công việc" từ phiếu hỗ trợ.
  // Chờ danh sách về rồi mới mở: lúc bấm thì màn này còn chưa dựng xong.
  useEffect(() => {
    if (!openTaskId) return;
    const t = tasks.find((x) => x.id === openTaskId);
    if (!t) return;
    setEditingTask(t);
    // Dọn yêu cầu NGAY sau khi mở. Không dọn thì mỗi lượt onSnapshot của
    // collectionGroup (tức mỗi lần bất kỳ công việc nào của mình đổi, kể cả do
    // chính mình kéo thanh tiến độ) lại chạy lại effect này và bật lại modal
    // vừa đóng — người dùng đóng bao nhiêu lần nó mở lại bấy nhiêu lần.
    onOpened?.();
  }, [openTaskId, tasks, onOpened]);

  useEffect(() => {
    if (!profile) return;
    
    const usersUnsub = onSnapshot(collection(db, 'users'), (snap) => {
      setUsers(snap.docs.map(d => d.data() as UserProfile));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'users'));

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
        const data = normalizeTask(doc.data());
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
      usersUnsub();
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
        void syncTicketFromTask(task.projectId, task.id);
        
        // Send notifications for status change
        const projectManagers = projects.find(p => p.id === task.projectId)?.managers || [];
        const targets = [...new Set([...task.assignees, ...(task.reviewers || []), ...(task.cc || []), ...projectManagers])].filter(id => id !== profile?.uid);
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

        {/* Dạng BẢNG, giống bảng "Danh sách công việc tổng thể" mà quản lý
            đang dùng. Cùng một loại dữ liệu thì phải cùng một cách trình bày,
            bất kể vai trò người xem. */}
        <Card>
          <TaskTable
            tasks={sortedTasks}
            users={users}
            projects={projects}
            onOpen={setEditingTask}
            emptyText="Không tìm thấy công việc nào phù hợp."
          />
        </Card>
      </div>

      <AnimatePresence>
        {isNewTaskModalOpen && (
          <TaskCreateModal onClose={() => setIsNewTaskModalOpen(false)} />
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

/**
 * Cỡ avatar. Phải là bảng tra CỨNG chứ không nội suy `h-${n}`: Tailwind quét
 * mã nguồn ở dạng chuỗi tĩnh, class ghép động không bao giờ được sinh ra và
 * avatar sẽ co về 0px.
 */
const CO_AVATAR: Record<number, string> = {
  4: 'h-4 w-4 text-[7px]',
  5: 'h-5 w-5 text-[8px]',
  6: 'h-6 w-6 text-[9px]',
  8: 'h-8 w-8 text-[11px]',
  10: 'h-10 w-10 text-xs',
};

/**
 * Ảnh đại diện: dùng ảnh Google nếu có, không thì hai chữ cái đầu.
 *
 * Bản cũ luôn render <img src={photoURL}> — tài khoản không có ảnh (mọi tài
 * khoản tạo trên emulator, và cả tài khoản thật chưa đặt ảnh) cho ra một ô vỡ
 * hình. Chữ cái thì luôn có, và màu suy từ tên nên cùng một người luôn cùng
 * một màu, mắt nhận ra dòng của họ mà không phải đọc.
 *
 * VÌ SAO PHẢI DÙNG Ở MỌI CHỖ: AuthProvider ghi `photoURL: user.photoURL || ''`,
 * nên tài khoản không có ảnh mang chuỗi RỖNG chứ không phải undefined. Render
 * thẳng <img src=""> thì trình duyệt coi src rỗng là "chính trang này" và TẢI
 * LẠI TOÀN BỘ TRANG cho mỗi thẻ ảnh — QA đếm được 13 lỗi console và 5 lượt tải
 * thừa chỉ riêng màn Tổng quan. Đó là lý do component này nhận `size`: trước
 * đây nó bị khoá cứng 40px nên 10 chỗ khác không dùng được và phải tự render
 * <img> trần.
 */
const Avatar: React.FC<{
  name?: string;
  photoURL?: string;
  /** Cạnh avatar theo thang Tailwind (4/5/6/8/10). */
  size?: keyof typeof CO_AVATAR | number;
  className?: string;
  title?: string;
}> = ({ name, photoURL, size = 10, className, title }) => {
  const co = CO_AVATAR[size as number] ?? CO_AVATAR[10];
  const chu = (name ?? '?')
    .trim().split(/\s+/).slice(-2).map((w) => w[0] ?? '').join('').toUpperCase() || '?';
  const mau = ['bg-indigo-100 text-indigo-700', 'bg-sky-100 text-sky-700',
               'bg-amber-100 text-amber-700', 'bg-emerald-100 text-emerald-700',
               'bg-rose-100 text-rose-700', 'bg-violet-100 text-violet-700'];
  let h = 0;
  for (const c of name ?? '') h = (h * 31 + c.charCodeAt(0)) % 997;
  // Chuỗi rỗng phải rơi về chữ cái, nên kiểm tra độ dài chứ không chỉ truthy
  // trên biến có thể là ''. `.trim()` chặn cả trường hợp chuỗi toàn khoảng trắng.
  if (photoURL && photoURL.trim().length > 0) {
    return (
      <img
        src={photoURL}
        alt=""
        title={title}
        referrerPolicy="no-referrer"
        className={cn(co, 'shrink-0 rounded-full border border-slate-200 object-cover', className)}
      />
    );
  }
  return (
    <span
      title={title}
      className={cn('flex shrink-0 items-center justify-center rounded-full font-bold', co, mau[h % mau.length], className)}
    >
      {chu}
    </span>
  );
};

/** Bỏ dấu tiếng Việt để tìm kiếm khớp cả khi người dùng gõ không dấu. */
function boDauVN(s: string): string {
  return s.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // đ không phải tổ hợp dấu nên NFD không tách ra được, phải thay tay.
    .replace(/đ/g, 'd');
}

/**
 * Con số "có gì mới" trên một mục điều hướng.
 *
 * Vẽ ở ba chỗ: thanh bên máy tính, ngăn kéo điện thoại, thanh dưới điện thoại.
 * Tách ra component để ba chỗ không bao giờ lệch kiểu — trước đây mỗi chỗ tự vẽ
 * là ba biến thể khác nhau sau vài tháng.
 *
 * 99+ thay vì số thật: quá ba chữ số thì con số không còn là thông tin, nó chỉ
 * còn là "nhiều", mà lại phá vỡ bề rộng của mục.
 */
const NavBadge = ({ count, muted }: { count: number; muted?: boolean }) => {
  if (!count) return null;
  return (
    <span
      className={cn(
        "min-w-5 rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none text-white text-center",
        muted ? "bg-slate-400" : "bg-red-500"
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
};

const TeamView = () => {
  const { profile } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [invitations, setInvitations] = useState<Array<PreAuth & { id: string }>>([]);
  // Quyền trong module hỗ trợ nằm ở collection riêng, không phải users.role.
  // Nạp ở đây để mỗi dòng hiện được người đó là cán bộ trường nào, hay đang
  // phụ trách hệ thống.
  const [scopes, setScopes] = useState<Record<string, SupportRoleAssignment>>({});
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('user');
  // Loại thành viên phía Hỗ trợ + trường. Rỗng = không cấp quyền hỗ trợ.
  const [inviteSupportRole, setInviteSupportRole] = useState<SupportRole | ''>('');
  const [inviteCampus, setInviteCampus] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'users'), orderBy('displayName'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setUsers(snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
      setLoading(false);
    });

    const inviteUnsub = watchInvitations(setInvitations, () => setInvitations([]));

    const scopeUnsub = watchRoleAssignments(
      (rows) => setScopes(Object.fromEntries(rows.map((r) => [r.uid, r]))),
      () => setScopes({})
    );
    const campusUnsub = watchCampuses(setCampuses, () => setCampuses([]));

    return () => {
      unsubscribe();
      inviteUnsub();
      scopeUnsub();
      campusUnsub();
    };
  }, []);

  const handleInvite = async () => {
    setInviteError(null);
    setInviting(true);
    try {
      const email = await createInvitation({
        email: inviteEmail,
        role: inviteRole,
        supportRole: inviteSupportRole,
        campusId: inviteCampus || null,
        actorUid: profile?.uid ?? '',
      });
      setShowInviteModal(false);
      setInviteEmail('');
      setInviteSupportRole('');
      setInviteCampus('');
      // Nói ĐÚNG việc vừa làm. Câu cũ là "Đã gửi thư mời!" trong khi hệ thống
      // không hề gửi email nào — người bấm tưởng đối phương đã nhận được thư.
      showToast(`Đã cấp quyền trước cho ${email}. Báo giúp họ đăng nhập để nhận.`);
    } catch (err: any) {
      setInviteError(
        err instanceof DomainError ? err.message : `Không lưu được (${err?.code ?? 'lỗi'})`
      );
    } finally {
      setInviting(false);
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

  // ---- Lọc, tìm, sắp xếp, phân trang ----
  //
  // Bốn tài khoản thì cuộn tay được. 200 tài khoản — quy mô thật của 18 trường
  // cộng đội PTUD — thì không: admin cần tìm đúng một người để đổi trường cho
  // họ, và cuộn qua 200 dòng là cách chắc chắn nhất để đổi nhầm người.
  const [q, setQ] = useState('');
  const [fRole, setFRole] = useState('all');
  const [fScope, setFScope] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [rowMenu, setRowMenu] = useState<string | null>(null);

  /** Nhóm loại thành viên của một người, dùng cho ô lọc. */
  const scopeGroup = (uid: string): string => {
    const r = scopes[uid]?.supportRole;
    if (!r) return 'none';
    if (r === 'CAMPUS_REPORTER' || r === 'CAMPUS_FOCAL') return 'campus';
    if (r === 'MODULE_OWNER' || r === 'PTUD_MANAGER') return 'owner';
    if (r === 'DEVELOPER') return 'staff';
    return 'admin';
  };

  const shown = useMemo(() => {
    const needle = boDauVN(q.trim());
    let list = users.filter((u) => {
      if (fRole !== 'all' && u.role !== fRole) return false;
      if (fStatus !== 'all' && u.status !== fStatus) return false;
      if (fScope !== 'all' && scopeGroup(u.uid) !== fScope) return false;
      if (!needle) return true;
      const campus = scopes[u.uid]?.campusId ?? '';
      return boDauVN(`${u.displayName} ${u.email} ${u.role} ${campus}`).includes(needle);
    });
    list = [...list].sort((a, b) =>
      (a.displayName ?? '').localeCompare(b.displayName ?? '', 'vi') * (sortAsc ? 1 : -1)
    );
    return list;
  }, [users, scopes, q, fRole, fScope, fStatus, sortAsc]);

  // Đổi bộ lọc mà vẫn đứng ở trang 3 thì bảng trống trơn.
  useEffect(() => { setPage(1); }, [q, fRole, fScope, fStatus, pageSize]);

  const totalPages = Math.max(1, Math.ceil(shown.length / pageSize));
  const pageSafe = Math.min(page, totalPages);
  const from = (pageSafe - 1) * pageSize;
  const rows = shown.slice(from, from + pageSize);

  const selectCls =
    "rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none";

  if (loading) return <div className="p-8 text-center"><Loader2 className="animate-spin mx-auto mb-2" /> Đang tải danh sách...</div>;

  return (
    <div className="p-6 lg:p-8 max-w-7xl mx-auto">
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal({ isOpen: false, userId: '' })}
        onConfirm={() => deleteUser(confirmModal.userId)}
        title="Xóa người dùng"
        message="Bạn có chắc chắn muốn xóa người dùng này? Thao tác này không thể hoàn tác và sẽ xóa toàn bộ dữ liệu hồ sơ của họ."
      />

      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Users size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quản lý thành viên</h1>
            <p className="text-sm text-slate-500">Phân quyền và quản lý tài khoản người dùng trong hệ thống.</p>
          </div>
        </div>
        <Button onClick={() => setShowInviteModal(true)} className="shadow-lg shadow-indigo-100">
          <Plus size={18} /> Cấp quyền trước
        </Button>
      </div>

      {/* Hai cột quyền, hai module khác nhau. Không nói rõ ở đây thì admin đổi
          nhầm cột và không hiểu vì sao người kia vẫn không vào được. */}
      <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
        <Info size={16} className="mt-0.5 shrink-0 text-indigo-500" />
        <p className="text-xs leading-relaxed text-slate-600">
          <span className="font-semibold text-slate-800">Vai trò</span> quyết định quyền trong module Công việc.{' '}
          <span className="font-semibold text-slate-800">Loại thành viên</span> quyết định quyền trong module Hỗ trợ
          — cán bộ nhà trường phải chọn trường thì mới gửi được yêu cầu.
        </p>
      </div>

      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex justify-between items-start">
              <div>
                <h3 className="text-xl font-bold text-slate-900">Cấp quyền trước cho một email</h3>
                {/* Nói thẳng hệ thống KHÔNG gửi email. Câu cũ là "Mời thành viên
                    mới" kèm toast "Đã gửi thư mời!" trong khi không có một dòng
                    mã nào gửi thư — người bấm tưởng đối phương đã nhận được. */}
                <p className="mt-1 text-xs leading-relaxed text-slate-500">
                  Ghi sẵn quyền cho một địa chỉ. Người đó đăng nhập lần đầu là có ngay quyền này,
                  không phải chờ duyệt. <strong>Hệ thống không gửi email</strong> — anh báo giúp họ
                  qua Zalo hoặc Teams.
                </p>
              </div>
              <button onClick={() => { setShowInviteModal(false); setInviteError(null); }} className="text-slate-400 hover:text-slate-600">
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
                  placeholder="nguyenvana@fpt.edu.vn"
                  autoFocus
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Phải khớp CHÍNH XÁC email họ dùng để đăng nhập Google.
                </p>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Vai trò (module Công việc)</label>
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

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Loại thành viên (module Hỗ trợ)</label>
                <select
                  value={inviteSupportRole}
                  onChange={(e) => {
                    const v = e.target.value as SupportRole | '';
                    setInviteSupportRole(v);
                    if (!v || !ROLES_REQUIRING_CAMPUS.includes(v as SupportRole)) setInviteCampus('');
                  }}
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all text-sm"
                >
                  <option value="">— Không cấp quyền Hỗ trợ —</option>
                  <option value="CAMPUS_FOCAL">Cán bộ nhà trường</option>
                  <option value="MODULE_OWNER">Cán bộ phụ trách</option>
                  <option value="DEVELOPER">Nhân viên dự án</option>
                </select>
              </div>

              {inviteSupportRole && ROLES_REQUIRING_CAMPUS.includes(inviteSupportRole as SupportRole) && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-1.5">
                    Trường <span className="text-red-500">*</span>
                  </label>
                  {campuses.length === 0 ? (
                    <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Chưa có trường nào. Vào <strong>Hỗ trợ → Trường học</strong> thêm trường trước.
                    </p>
                  ) : (
                    <select
                      value={inviteCampus}
                      onChange={(e) => setInviteCampus(e.target.value)}
                      className={cn(
                        "w-full px-4 py-2.5 rounded-xl border outline-none transition-all text-sm focus:ring-2 focus:ring-indigo-500",
                        inviteCampus ? "border-slate-200" : "border-red-300 bg-red-50"
                      )}
                    >
                      <option value="">— Chọn trường —</option>
                      {campuses.filter(c => c.isActive).map(c => (
                        <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                  )}
                  <p className="mt-1 text-[11px] text-slate-400">
                    Không có trường thì họ đăng nhập vào và không thấy yêu cầu nào cả.
                  </p>
                </div>
              )}

              {inviteError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-600">{inviteError}</p>
              )}
            </div>

            <div className="flex gap-3 pt-1">
              <Button variant="ghost" className="flex-1" onClick={() => { setShowInviteModal(false); setInviteError(null); }}>Hủy</Button>
              <Button className="flex-1 bg-indigo-600 hover:bg-indigo-700" disabled={inviting} onClick={handleInvite}>
                {inviting ? 'Đang lưu…' : 'Cấp quyền trước'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {invitations.filter(i => i.status === 'pending').length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
            <Clock size={16} className="text-amber-500" />
            Đã cấp quyền trước, chờ họ đăng nhập ({invitations.filter(i => i.status === 'pending').length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {invitations.filter(i => i.status === 'pending').map(invite => {
              const hetHan = (invite.expiresAt ?? 0) <= Date.now();
              const truong = campuses.find(c => c.id === invite.campusId);
              return (
                <Card key={invite.id} className={cn("p-4 border-dashed border-2", hetHan ? "border-red-200 bg-red-50/40" : "border-slate-200 bg-slate-50/50")}>
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-slate-900 truncate">{invite.email}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant={invite.role === 'admin' ? 'danger' : invite.role === 'manager' ? 'info' : 'neutral'}>
                          {String(invite.role).toUpperCase()}
                        </Badge>
                        {invite.supportRole && (
                          <Badge variant="sky">
                            {invite.supportRole === 'CAMPUS_FOCAL' ? 'Cán bộ nhà trường'
                              : invite.supportRole === 'MODULE_OWNER' ? 'Cán bộ phụ trách' : 'Nhân viên dự án'}
                            {truong ? ` · ${truong.code}` : ''}
                          </Badge>
                        )}
                      </div>
                      <p className={cn("mt-1.5 text-[11px]", hetHan ? "text-red-600 font-semibold" : "text-slate-400")}>
                        {hetHan ? 'Đã hết hạn — cấp lại nếu vẫn cần' : `Hết hạn ${format(new Date(invite.expiresAt), 'dd/MM/yyyy')}`}
                      </p>
                    </div>
                    <button
                      onClick={async () => {
                        if (confirm(`Gỡ quyền đã cấp trước cho ${invite.email}?`)) {
                          await deleteInvitation(invite.email);
                        }
                      }}
                      className="shrink-0 text-slate-400 hover:text-red-500 transition-colors"
                      title="Gỡ"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
          <div className="relative min-w-56 flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tìm kiếm theo tên, email, vai trò..."
              className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </div>
          <select value={fRole} onChange={(e) => setFRole(e.target.value)} className={selectCls}>
            <option value="all">Vai trò: Tất cả</option>
            <option value="user">Vai trò: User</option>
            <option value="manager">Vai trò: Manager</option>
            <option value="director">Vai trò: Director</option>
            <option value="admin">Vai trò: Admin</option>
          </select>
          <select value={fScope} onChange={(e) => setFScope(e.target.value)} className={selectCls}>
            <option value="all">Loại thành viên: Tất cả</option>
            <option value="campus">Cán bộ nhà trường</option>
            <option value="owner">Cán bộ phụ trách</option>
            <option value="staff">Nhân viên dự án</option>
            <option value="admin">Quản trị hệ thống</option>
            <option value="none">Chưa gán</option>
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={selectCls}>
            <option value="all">Trạng thái: Tất cả</option>
            <option value="active">Đang hoạt động</option>
            <option value="pending">Chờ duyệt</option>
            <option value="disabled">Vô hiệu</option>
          </select>
          <button
            onClick={() => { setQ(''); setFRole('all'); setFScope('all'); setFStatus('all'); }}
            title="Xoá hết bộ lọc"
            className="rounded-xl border border-slate-200 p-2.5 text-slate-500 transition-colors hover:bg-slate-50"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        {rows.length === 0 ? (
          <StateBlock
            kind="empty"
            title="Không tìm thấy thành viên nào"
            description="Thử xoá bớt bộ lọc hoặc dùng từ khoá ngắn hơn."
          />
        ) : (
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-left">
          <thead className="bg-slate-50 border-b border-slate-100">
            <tr>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">
                <button
                  onClick={() => setSortAsc((v) => !v)}
                  className="inline-flex items-center gap-1 hover:text-slate-600"
                  title="Đổi thứ tự sắp xếp"
                >
                  Thành viên <ArrowUpDown size={12} />
                </button>
              </th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Email</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Vai trò</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Loại thành viên</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Trạng thái</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase">Hành động</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {rows.map(user => {
              const asg = scopes[user.uid] ?? null;
              const campus = asg?.campusId ? campuses.find(c => c.id === asg.campusId) : null;
              // Dòng phụ dưới tên: trường nếu là cán bộ nhà trường, còn lại là
              // tên ngắn của loại. Nó trả lời "người này là ai" nhanh hơn đọc
              // ngang sang hai cột khác.
              const phu = campus?.code
                ?? (scopeGroup(user.uid) === 'owner' ? 'Cán bộ phụ trách'
                  : scopeGroup(user.uid) === 'staff' ? 'NV dự án'
                  : scopeGroup(user.uid) === 'admin' ? 'Admin tổng' : '');
              return (
              <tr key={user.uid} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <Avatar name={user.displayName} photoURL={user.photoURL} />
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{user.displayName}</p>
                      {phu && <p className="text-xs text-slate-500">({phu})</p>}
                      {/* UID chứ không phải mã nhân sự — hệ thống chưa có mã
                          nhân sự. Ghi đúng tên để không ai hiểu nhầm. */}
                      <p className="mt-0.5 font-mono text-[10px] text-slate-300">
                        UID: {user.uid.slice(0, 10)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-slate-500">{user.email}</span>
                    <button
                      onClick={() => {
                        navigator.clipboard?.writeText(user.email);
                        showToast('Đã sao chép email');
                      }}
                      title="Sao chép email"
                      className="rounded p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-500"
                    >
                      <Copy size={13} />
                    </button>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <Badge variant={user.role === 'admin' ? 'danger' : user.role === 'director' ? 'warning' : user.role === 'manager' ? 'info' : 'primary'}>
                    {user.role.toUpperCase()}
                  </Badge>
                </td>
                {/* Loại thành viên trong module hỗ trợ — khác với cột Vai trò
                    bên trái, vốn là quyền của module Công việc. */}
                <td className="px-6 py-4">
                  <MemberScopeCell
                    uid={user.uid}
                    userStatus={user.status}
                    assignment={asg}
                    campuses={campuses}
                    actorUid={profile?.uid ?? ''}
                    onToast={showToast}
                  />
                </td>
                <td className="px-6 py-4">
                  <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium",
                    user.status === 'active' ? "text-emerald-600"
                    : user.status === 'pending' ? "text-amber-600" : "text-slate-400")}>
                    <span className={cn("w-1.5 h-1.5 rounded-full",
                      user.status === 'active' ? "bg-emerald-500"
                      : user.status === 'pending' ? "bg-amber-500" : "bg-slate-300")} />
                    {user.status === 'active' ? 'Hoạt động' : user.status === 'pending' ? 'Chờ duyệt' : 'Vô hiệu'}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <select
                      value={user.role}
                      onChange={(e) => updateRole(user.uid, e.target.value as UserRole)}
                      className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-indigo-500 focus:outline-none"
                    >
                      <option value="user">User</option>
                      <option value="manager">Manager</option>
                      <option value="director">Director</option>
                      <option value="admin">Admin</option>
                    </select>

                    {/* Vô hiệu hoá và xoá nằm trong menu, không phơi thành hai
                        nút cạnh ô chọn vai trò: chúng là thao tác hiếm và nguy
                        hiểm, đứng cạnh một thao tác hằng ngày là mời bấm nhầm. */}
                    <div className="relative">
                      <button
                        onClick={() => setRowMenu(rowMenu === user.uid ? null : user.uid)}
                        aria-label={`Thao tác với ${user.displayName}`}
                        className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                      >
                        <MoreVertical size={16} />
                      </button>
                      {rowMenu === user.uid && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setRowMenu(null)} />
                          <div className="absolute right-0 z-20 mt-1 w-52 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg">
                            <button
                              onClick={() => {
                                updateUserStatus(user.uid, user.status === 'active' ? 'disabled' : 'active');
                                setRowMenu(null);
                              }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                            >
                              {user.status === 'active'
                                ? <><XCircle size={14} className="text-amber-500" /> Vô hiệu hoá tài khoản</>
                                : <><CheckCircle2 size={14} className="text-emerald-500" /> Kích hoạt tài khoản</>}
                            </button>
                            <div className="my-1 border-t border-slate-100" />
                            <button
                              onClick={() => { setConfirmModal({ isOpen: true, userId: user.uid }); setRowMenu(null); }}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={14} /> Xoá người dùng
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
        </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
          <p className="text-xs text-slate-500">
            Hiển thị {shown.length === 0 ? 0 : from + 1} – {Math.min(from + pageSize, shown.length)} trong {shown.length} thành viên
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={pageSafe === 1}
              aria-label="Trang trước"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40">
              <ChevronLeft size={16} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(n => (
              <button key={n} onClick={() => setPage(n)}
                className={cn("min-w-8 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors",
                  n === pageSafe ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100")}>
                {n}
              </button>
            ))}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={pageSafe === totalPages}
              aria-label="Trang sau"
              className="rounded-lg border border-slate-200 p-1.5 text-slate-500 disabled:opacity-40">
              <ChevronRight size={16} />
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Hiển thị
            <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-700 focus:border-indigo-500 focus:outline-none">
              {[10, 20, 50].map(n => <option key={n} value={n}>{n} / trang</option>)}
            </select>
          </label>
        </div>
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
      const allTasks = snapshot.docs.map(doc => normalizeTask(doc.data()));
      
      const statusCounts = allTasks.reduce((acc: any, task: any) => {
        acc[task.status] = (acc[task.status] || 0) + 1;
        return acc;
      }, {});

      const overdueCount = allTasks.filter(t => isTaskOverdue(t)).length;
      
      const data = [
        { name: 'Chờ duyệt', value: statusCounts.pending || 0, color: MAU_TRANG_THAI.pending },
        { name: 'Sẵn sàng', value: statusCounts.todo || 0, color: MAU_TRANG_THAI.todo },
        { name: 'Đang làm', value: statusCounts['in-progress'] || 0, color: MAU_TRANG_THAI['in-progress'] },
        { name: 'Quá hạn', value: overdueCount, color: MAU_TRANG_THAI.overdue },
        { name: 'Chờ nghiệm thu', value: statusCounts.review || 0, color: MAU_TRANG_THAI.review },
        { name: 'Hoàn thành', value: statusCounts.done || 0, color: MAU_TRANG_THAI.done },
        { name: 'Bị từ chối', value: statusCounts.rejected || 0, color: MAU_TRANG_THAI.rejected },
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
  // Cán bộ nhà trường chỉ vào hệ thống để gửi yêu cầu hỗ trợ, không nhận việc.
  const campusStaff = useCampusStaffUids(profile?.role);
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
    startDate: format(new Date(), 'yyyy-MM-dd'),
    estimatedDuration: 0,
    estimatedDeadline: format(new Date(), 'yyyy-MM-dd'),
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

  useEffect(() => {
    if (newTask.startDate && newTask.estimatedDuration > 0) {
      const start = new Date(newTask.startDate);
      const end = addDays(start, newTask.estimatedDuration);
      const formattedEnd = format(end, 'yyyy-MM-dd');
      setNewTask(prev => ({ 
        ...prev, 
        estimatedDeadline: formattedEnd,
        date: formattedEnd
      }));
    }
  }, [newTask.startDate, newTask.estimatedDuration]);

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
        startDate: newTask.startDate,
        estimatedDuration: newTask.estimatedDuration,
        estimatedDeadline: newTask.estimatedDeadline,
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
      const projectManagers = projects.find(p => p.id === projectId)?.managers || [];
      const targets = [...new Set([...assignees, ...newTask.reviewers, ...newTask.cc, ...projectManagers])].filter(id => id !== profile.uid);
      console.log('Sending notifications to targets:', targets);
      for (const targetId of targets) {
        try {
          await addDoc(collection(db, 'notifications'), {
            targetUserId: targetId,
            message: `Bạn được gán/liên quan đến công việc mới: "${newTask.title}"`,
            taskId: taskRef.id,
            read: false,
            time: Timestamp.now()
          });
          console.log('Notification sent to:', targetId);
        } catch (err) {
          console.error('Failed to send notification to:', targetId, err);
        }
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ngày bắt đầu (Dự kiến)</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="date" 
                    value={newTask.startDate}
                    onChange={(e) => setNewTask({ ...newTask, startDate: e.target.value })}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Thời gian (Ngày)</label>
                <input 
                  type="number" 
                  value={newTask.estimatedDuration}
                  onChange={(e) => setNewTask({ ...newTask, estimatedDuration: Number(e.target.value) })}
                  className="w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
                  min="0"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Deadline (Dự kiến)</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="date" 
                    value={newTask.estimatedDeadline}
                    readOnly
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 bg-slate-50 outline-none"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Hạn hoàn thành (Deadline)</label>
                <div className="relative">
                  <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input 
                    type="date" 
                    value={newTask.date}
                    onChange={(e) => setNewTask({ ...newTask, date: e.target.value })}
                    className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-indigo-600"
                  />
                </div>
              </div>
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
                  <Avatar name={profile?.displayName} photoURL={profile?.photoURL} size={5} />
                  <span className="font-medium">{profile?.displayName} (Tự gán)</span>
                </div>
              ) : (
                <div className="max-h-32 overflow-y-auto border rounded-lg p-2 space-y-1 bg-slate-50">
                  {filterAssignableUsers(users, campusStaff, newTask.assignees || []).map(u => (
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
                {filterAssignableUsers(users.filter(u => (project?.managers || []).includes(u.uid) || u.role === 'admin'), campusStaff, newTask.reviewers).map(u => (
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
                {filterAssignableUsers(users, campusStaff, newTask.cc).map(u => (
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
  const [activeTab, setActiveTab] = useState<TaskStatus | 'all' | 'reports' | 'reviews' | 'waiting'>('all');
  const [isNewTaskModalOpen, setIsNewTaskModalOpen] = useState(false);
  const [isNewReviewModalOpen, setIsNewReviewModalOpen] = useState(false);
  const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all');

  const stats = [
    { name: 'Pending', value: tasks.filter(t => t.status === 'pending').length, color: MAU_TRANG_THAI.pending },
    { name: 'Todo', value: tasks.filter(t => t.status === 'todo').length, color: MAU_TRANG_THAI.todo },
    { name: 'In Progress', value: tasks.filter(t => t.status === 'in-progress').length, color: MAU_TRANG_THAI['in-progress'] },
    { name: 'Overdue', value: tasks.filter(t => isTaskOverdue(t)).length, color: MAU_TRANG_THAI.overdue },
    { name: 'Review', value: tasks.filter(t => t.status === 'review').length, color: MAU_TRANG_THAI.review },
    { name: 'Done', value: tasks.filter(t => t.status === 'done').length, color: MAU_TRANG_THAI.done },
    { name: 'Rejected', value: tasks.filter(t => t.status === 'rejected').length, color: MAU_TRANG_THAI.rejected },
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
      setTasks(snapshot.docs.map(doc => normalizeTask({ id: doc.id, projectId, ...doc.data() })));
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
      // Phiếu hỗ trợ chạy theo công việc: tiến độ >0 = đang xử lý, 100% =
      // đã khắc phục, nghiệm thu xong = hoàn tất. Best-effort, không chặn.
      void syncTicketFromTask(projectId, task.id);
      
      // Send notifications for status change
      const targets = [...new Set([...task.assignees, ...(task.reviewers || []), ...(task.cc || []), ...(project?.managers || [])])].filter(id => id !== profile?.uid);
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

  const today = format(new Date(), 'yyyy-MM-dd');
  const waitingTasksCount = tasks.filter(t => t.startDate && t.startDate > today && t.status !== 'done' && t.status !== 'rejected').length;

  const filteredTasks = tasks.filter(t => {
    // Waiting list logic
    const isWaiting = t.startDate && t.startDate > today && t.status !== 'done' && t.status !== 'rejected';
    
    if (activeTab === 'waiting') {
      return isWaiting;
    }
    
    // Hide waiting tasks from other status tabs to avoid confusion
    if (isWaiting && activeTab !== 'all' && activeTab !== 'reports' && activeTab !== 'reviews') return false;

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
          {(['all', 'waiting', 'pending', 'todo', 'in-progress', 'overdue', 'review', 'rejected', 'done', 'reports', 'reviews'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-medium transition-all capitalize whitespace-nowrap flex items-center gap-2",
                activeTab === tab ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {tab === 'all' ? 'Tất cả' : 
               tab === 'waiting' ? 'Danh sách chờ' :
               tab === 'pending' ? 'Chờ duyệt' :
               tab === 'todo' ? 'Sẵn sàng' :
               tab === 'in-progress' ? 'Đang làm' :
               tab === 'overdue' ? 'Quá hạn' :
               tab === 'review' ? 'Chờ nghiệm thu' :
               tab === 'rejected' ? 'Bị từ chối' :
               tab === 'done' ? 'Hoàn thành' :
               tab === 'reports' ? 'Báo cáo' : 'Đánh giá'}
              {tab !== 'reports' && tab !== 'reviews' && (
                <span className={cn(
                  "opacity-50 text-[10px]",
                  tab === 'waiting' && waitingTasksCount > 0 ? "bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full opacity-100" : ""
                )}>
                  ({tab === 'all' ? tasks.length : 
                    tab === 'waiting' ? waitingTasksCount :
                    tab === 'overdue' ? tasks.filter(t => isTaskOverdue(t)).length : 
                    tasks.filter(t => t.status === tab).length})
                </span>
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
  const { showToast } = useToast();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  // Vai trò hỗ trợ nằm ở collection riêng nên phải đọc bất đồng bộ.
  // Nó quyết định thanh điều hướng hiện những mục nào.
  const supportRole = useSupportRole(profile?.uid);
  // Số "có gì mới" trên từng mục điều hướng, đếm từ thông báo chưa đọc.
  const navBadges = useNavBadges(profile?.uid);
  /** Công việc cần mở ngay sau khi chuyển sang mục Công việc. */
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  // Bấm "Mở công việc" ở phiếu hỗ trợ: chuyển sang mục Công việc rồi mở đúng
  // task đó. Dùng sự kiện window thay vì đổi URL: không tải lại trang nên
  // không mất thứ người dùng đang gõ dở ở màn khác.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail ?? {};
      if (!d.taskId) return;
      setActiveNav('tasks');
      setCurrentProjectId(null);
      setOpenTaskId(String(d.taskId));
    };
    window.addEventListener('fsc:open-task', h);
    return () => window.removeEventListener('fsc:open-task', h);
  }, [setActiveNav, setCurrentProjectId]);

  // Chiều ngược lại: từ công việc quay về phiếu hỗ trợ gốc.
  useEffect(() => {
    const h = (e: Event) => {
      const no = String((e as CustomEvent).detail ?? '');
      if (!no) return;
      setActiveNav('support');
      setCurrentProjectId(null);
      // Đợi màn Hỗ trợ dựng xong rồi mới bảo nó mở phiếu.
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('fsc:open-ticket', { detail: no }));
      }, 0);
    };
    window.addEventListener('fsc:goto-support', h);
    return () => window.removeEventListener('fsc:goto-support', h);
  }, [setActiveNav, setCurrentProjectId]);

  useEffect(() => {
    // No redirect for users, let them see the overview dashboard if they want
  }, [profile, activeNav, setActiveNav]);

  // Đang mở mục nào thì thông báo của mục đó coi như đã xem.
  //
  // CHỈ áp dụng cho người có nhiều mục để chọn. Cán bộ trường bị đẩy THẲNG vào
  // mục Hỗ trợ ngay khi đăng nhập, không hề bấm gì — với họ điều kiện "đang mở
  // mục Hỗ trợ" luôn đúng, nên quy tắc này xoá sạch thông báo của họ ngay lập
  // tức và cái chuông không bao giờ hiện số. Họ đánh dấu đã đọc bằng cách bấm
  // vào từng thông báo trong chuông, hoặc bấm "Đánh dấu tất cả đã đọc".
  //
  // Phải nằm TRÊN mọi return sớm bên dưới — hook không được gọi có điều kiện.
  const navDangMo = supportRole.isCampusSide ? null : activeNav;
  useEffect(() => {
    if (navDangMo === 'support' && navBadges.support > 0) void navBadges.markSeen('support');
    if (navDangMo === 'tasks' && navBadges.tasks > 0) void navBadges.markSeen('tasks');
  }, [navDangMo, navBadges]);

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
            <button 
              onClick={() => {
                navigator.clipboard.writeText(error);
                showToast('Đã sao chép mã lỗi!');
              }}
              className="text-[10px] font-bold text-indigo-600 hover:underline mt-1"
            >
              Sao chép mã lỗi
            </button>
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

  // Cổng duyệt tài khoản.
  // 'pending' = mới đăng nhập lần đầu, chờ admin duyệt và gán trường.
  // 'disabled' = đã bị từ chối hoặc vô hiệu hoá.
  // Cả hai đều KHÔNG được vào ứng dụng. firestore.rules mới là chỗ chặn thật;
  // màn này chỉ để người dùng hiểu chuyện gì đang xảy ra thay vì thấy toàn màn trống.
  if (profile && (profile.status === 'pending' || profile.status === 'disabled')) {
    return <PendingGate profile={profile} onSignOut={logout} />;
  }

  // Chờ biết vai trò hỗ trợ rồi mới dựng menu. Không chờ thì menu hiện đủ mục
  // rồi đột ngột mất bớt khi dữ liệu về — nhấp nháy và gây hiểu nhầm về quyền.
  if (supportRole.loading) return (
    <div className="flex h-screen items-center justify-center bg-slate-50">
      <Loader2 size={28} className="animate-spin text-indigo-500" />
    </div>
  );

  // Cán bộ trường CHỈ thấy module hỗ trợ.
  //
  // Họ không tham gia vận hành task: không có dự án nào của họ, không có công
  // việc nào giao cho họ, và bảng tổng quan là số liệu nội bộ đội PTUD. Hiện
  // những mục đó ra chỉ tạo ra màn hình trống và câu hỏi "sao tôi không thấy gì".
  // Việc làm task thuộc về cán bộ phụ trách từng hệ thống.
  const navItems = supportRole.isCampusSide
    ? [{ id: 'support', icon: LifeBuoy, label: 'Yêu cầu hỗ trợ' }]
    : [
        { id: 'dashboard', icon: LayoutDashboard, label: 'Tổng quan' },
        { id: 'projects', icon: Briefcase, label: 'Dự án', roles: ['admin', 'director', 'manager'] },
        { id: 'tasks', icon: CheckSquare, label: 'Công việc' },
        { id: 'reports', icon: BarChart3, label: 'Báo cáo', roles: ['admin', 'director'] },
        { id: 'team', icon: Users, label: 'Thành viên', roles: ['admin'] },
        { id: 'support', icon: LifeBuoy, label: 'Hỗ trợ' },
      ].filter(item => !item.roles || item.roles.includes(profile?.role || ''));

  // Cán bộ trường vào thẳng màn hỗ trợ. Không ép thì họ rơi vào 'dashboard' —
  // một mục không còn trong menu của họ, và màn hình sẽ trống trơn.
  const effectiveNav = supportRole.isCampusSide ? 'support' : activeNav;


  const badgeOf = (id: string) =>
    id === 'support' ? navBadges.support : id === 'tasks' ? navBadges.tasks : 0;


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
                        effectiveNav === item.id && !currentProjectId ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"
                      )}
                    >
                      <item.icon size={18} />
                      <span className="flex-1 text-left">{item.label}</span>
                      <NavBadge count={badgeOf(item.id)} muted={effectiveNav === item.id} />
                    </button>
                  ))}
                </nav>
              </div>
              <div className="p-6 border-t border-slate-100">
                <div className="flex items-center gap-3 mb-6">
                  <Avatar name={profile?.displayName} photoURL={profile?.photoURL} size={10} className="border-2 border-indigo-50" />
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
                  effectiveNav === item.id && !currentProjectId ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"
                )}
              >
                <item.icon size={18} />
                <span className="flex-1 text-left">{item.label}</span>
                <NavBadge count={badgeOf(item.id)} muted={effectiveNav === item.id} />
              </button>
            ))}
          </nav>
        </div>

        <div className="mt-auto p-8 border-t border-slate-100">
          <div className="flex items-center gap-3 mb-6">
            <Avatar name={profile?.displayName} photoURL={profile?.photoURL} size={10} className="border-2 border-indigo-50" />
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
              <Avatar name={profile?.displayName} photoURL={profile?.photoURL} size={8} />
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
              {effectiveNav === 'dashboard' && (
                <Dashboard onSelectProject={setCurrentProjectId} variant="overview" />
              )}
              {effectiveNav === 'projects' && (
                <Dashboard onSelectProject={setCurrentProjectId} variant="projects" />
              )}
              {effectiveNav === 'tasks' && (
                <MyTasksView openTaskId={openTaskId} onOpened={() => setOpenTaskId(null)} />
              )}
              {effectiveNav === 'reports' && <ReportsView />}
              {effectiveNav === 'team' && <TeamView />}
              {/* Admin thấy màn quản trị (duyệt tài khoản, quản lý trường).
                  Mọi người khác thấy màn của trường mình: danh sách phiếu, gửi
                  phiếu mới, và đích đến của deep link ?ticket=. */}
              {effectiveNav === 'support' && profile && (
                profile.role === 'admin' ? (
                  <SupportAdminView actorUid={profile.uid} onToast={showToast} />
                ) : supportRole.isPtudSide ? (
                  // Cán bộ PTUD: hàng đợi tiếp nhận, không phải màn gửi phiếu.
                  <PtudSupportView actorUid={profile.uid} onToast={showToast} />
                ) : (
                  <SupportView
                    userId={profile.uid}
                    userName={profile.displayName}
                    userEmail={profile.email}
                    onToast={showToast}
                  />
                )
              )}
            </div>
          )}
        </div>

        {/* Mobile Bottom Nav */}
        {/* Trước đây render navItems.slice(0, 4): với admin (6 mục) và director
            (5 mục) thì mục cuối bị CẮT KHỎI nav mobile mà không có dấu hiệu gì —
            người dùng không có cách nào biết là còn mục nữa. Đổi sang cuộn ngang
            để không mục nào bị giấu, bất kể sau này thêm bao nhiêu mục. */}
        <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-2 py-2 flex items-center gap-1 overflow-x-auto lg:hidden z-40">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveNav(item.id);
                setCurrentProjectId(null);
              }}
              className={cn(
                "relative flex shrink-0 flex-col items-center gap-1 px-3 py-2 rounded-lg transition-colors",
                effectiveNav === item.id && !currentProjectId ? "text-indigo-600" : "text-slate-400"
              )}
            >
              <item.icon size={20} />
              {/* Trên thanh dưới không có chỗ cho badge đứng cạnh chữ, nên nó
                  nổi lên góc icon như huy hiệu ứng dụng trên điện thoại. */}
              {badgeOf(item.id) > 0 && (
                <span className="absolute right-1 top-1 min-w-4 rounded-full bg-red-500 px-1 py-0.5 text-[9px] font-bold leading-none text-white">
                  {badgeOf(item.id) > 99 ? '99+' : badgeOf(item.id)}
                </span>
              )}
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
