import { clsx, type ClassValue } from 'clsx';
import { AlertTriangle, Inbox, Loader2, WifiOff } from 'lucide-react';
import React from 'react';
import { twMerge } from 'tailwind-merge';

// ===========================================================================
// Primitive dùng chung cho cả App.tsx và src/modules/*.
//
// Trước đây Card/Button/Badge/cn nằm private bên trong App.tsx, không export,
// nên module mới không tái sử dụng được và buộc phải tự dựng bản sao —
// dẫn tới hai bộ nút, hai bộ badge, lệch nhau dần theo thời gian.
//
// Class của Card/Button/Badge giữ NGUYÊN VĂN như bản cũ trong App.tsx để giao
// diện đang chạy không đổi một pixel nào.
// ===========================================================================

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, ...props }) => (
  <div className={cn("bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden", className)} {...props}>
    {children}
  </div>
);

// Button — có sửa 2 lỗi thật đang tồn tại trong codebase:
//
//   1. 4 chỗ gọi variant="outline" nhưng bản cũ chỉ định nghĩa 4 variant
//      primary|secondary|ghost|danger → variants["outline"] là undefined →
//      những nút đó render KHÔNG CÓ STYLE.
//   2. 8 chỗ truyền size="sm" nhưng bản cũ không khai prop `size` → React
//      forward xuống thẻ <button> thành attribute HTML không hợp lệ.
//
// Thêm 'outline' và `size` vào đây là 12 chỗ đó hiện đúng như tác giả định làm.
// Mặc định size='md' giữ nguyên "px-4 py-2" nên mọi chỗ gọi cũ không đổi.
export const Button = ({
  children,
  variant = 'primary',
  size = 'md',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md';
}) => {
  const variants = {
    primary: "bg-indigo-600 text-white hover:bg-indigo-700",
    secondary: "bg-slate-100 text-slate-900 hover:bg-slate-200",
    ghost: "bg-transparent text-slate-600 hover:bg-slate-50",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    outline: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50",
  };
  const sizes = {
    sm: "px-3 py-1.5 text-sm",
    md: "px-4 py-2",
  };
  return (
    <button
      className={cn(
        "rounded-lg font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50",
        sizes[size],
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};

export const Badge = ({
  children,
  variant = 'neutral',
  className,
}: {
  children: React.ReactNode;
  variant?: 'neutral' | 'success' | 'warning' | 'info' | 'danger' | 'primary' | 'sky';
  className?: string;
}) => {
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

// ---------------------------------------------------------------------------
// Skeleton + StateBlock
//
// Vì sao cần: app hiện có BA kiểu loading khác nhau (text giữa màn ở App.tsx:3095,
// spinner trần ở 2359, kiểu thứ ba ở 3277) và không có kiểu nào cho "rỗng",
// "lỗi", hay "mất mạng".
//
// Quan trọng nhất là tách "rỗng" khỏi "lỗi". Trong codebase này, rules sai,
// thiếu biến môi trường, thiếu composite index và sai database ĐỀU hiện ra thành
// một danh sách rỗng giống hệt nhau. Bốn nguyên nhân, một triệu chứng.
// Mọi danh sách phải đi qua StateBlock để lỗi hiện ra LÀ LỖI, không phải "chưa có gì".
// ---------------------------------------------------------------------------

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn("animate-pulse rounded-lg bg-slate-100", className)} />
);

export type StateKind = 'loading' | 'empty' | 'error' | 'denied' | 'offline';

export const StateBlock = ({
  kind,
  title,
  description,
  action,
  className,
}: {
  kind: StateKind;
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) => {
  const preset: Record<StateKind, { icon: React.ReactNode; title: string; description: string; tone: string }> = {
    loading: {
      icon: <Loader2 size={22} className="animate-spin" />,
      title: 'Đang tải…',
      description: '',
      tone: 'text-slate-400',
    },
    empty: {
      icon: <Inbox size={22} />,
      title: 'Chưa có dữ liệu',
      description: '',
      tone: 'text-slate-400',
    },
    error: {
      icon: <AlertTriangle size={22} />,
      title: 'Không tải được dữ liệu',
      description: 'Thử tải lại trang. Nếu vẫn lỗi, gửi ảnh chụp màn hình này cho đội kỹ thuật.',
      tone: 'text-red-500',
    },
    // Tách riêng khỏi 'error': permission-denied nghĩa là rules chặn, KHÔNG phải
    // không có dữ liệu và cũng không phải lỗi mạng. Gộp chung là mất hàng giờ
    // đi tìm nhầm chỗ.
    denied: {
      icon: <AlertTriangle size={22} />,
      title: 'Bạn không có quyền xem dữ liệu này',
      // Cố ý KHÔNG đoán lý do ở đây. Bản trước ghi "chưa được gán vào trường",
      // đúng với cán bộ trường nhưng vô nghĩa với cán bộ PTUD — họ không thuộc
      // trường nào cả, và thông báo đó khiến họ đi tìm sai chỗ.
      // Nơi gọi biết ngữ cảnh thì truyền description cụ thể vào.
      description: 'Đây là lỗi phân quyền, không phải không có dữ liệu. Liên hệ quản trị viên nếu bạn cho rằng mình phải xem được.',
      tone: 'text-amber-500',
    },
    offline: {
      icon: <WifiOff size={22} />,
      title: 'Mất kết nối mạng',
      description: 'Kiểm tra wifi hoặc 4G rồi thử lại.',
      tone: 'text-slate-400',
    },
  };
  const p = preset[kind];
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <div className={p.tone}>{p.icon}</div>
      <p className="text-sm font-semibold text-slate-700">{title ?? p.title}</p>
      {(description ?? p.description) && (
        <p className="max-w-sm text-xs leading-relaxed text-slate-500">{description ?? p.description}</p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
};
