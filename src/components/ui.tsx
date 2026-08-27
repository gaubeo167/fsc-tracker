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
// NGÔN NGỮ HÌNH THỨC: Apple, theo DESIGN.md ở gốc repo.
//
// Ba luật của DESIGN.md quyết định gần như toàn bộ file này:
//
//   1. Bo góc pill (9999px) LÀ tín hiệu "bấm được". Nút chính là viên nang xanh
//      Action Blue; không có nút nào vuông góc mà lại là hành động chính.
//   2. Không đổ bóng lên thẻ, nút, hay chữ. Phân tầng đến từ ĐỔI MÀU NỀN và
//      đường hairline 1px, không phải từ shadow. Card vì thế bỏ `shadow-sm`.
//   3. `transform: scale(0.95)` khi nhấn — vi tương tác dùng chung toàn hệ.
//
// Thang cân chữ là 300/400/600/700, KHÔNG có 500. Chỗ nào cần "đậm vừa" thì
// dùng 600 (`font-semibold`), không phải `font-medium`.
// ===========================================================================

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Store utility card của DESIGN.md: nền trắng, hairline 1px, bo 18px
// (`rounded-xl` đã được ánh xạ về 18px trong index.css), KHÔNG bóng.
export const Card: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ children, className, ...props }) => (
  <div className={cn("bg-white rounded-xl border border-slate-200 overflow-hidden", className)} {...props}>
    {children}
  </div>
);

// Button — 5 variant hiện có, ánh xạ sang 5 "ngữ pháp nút" của DESIGN.md:
//
//   primary   → button-primary        viên nang Action Blue, chữ trắng
//   outline   → button-secondary-pill viên nang rỗng, viền + chữ Action Blue
//   secondary → button-pearl-capsule  nền pearl #fafafc, bo 11px, ring mềm
//   ghost     → text-link             không nền, chỉ chữ
//   danger    → (lệch có chủ đích)    viên nang đỏ hệ thống Apple
//
// Vì sao `danger` vẫn còn dù DESIGN.md cấm màu nhấn thứ hai: apple.com không có
// nút xoá và không có nút từ chối. App này có, và một hành động một chiều mà
// trông y hệt hành động thường là cách nhanh nhất để mất dữ liệu. Lý do đầy đủ
// nằm ở đầu src/index.css.
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
    primary: "bg-indigo-600 text-white hover:bg-indigo-700 rounded-full",
    secondary: "bg-[#fafafc] text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-md",
    ghost: "bg-transparent text-slate-600 hover:text-slate-900 rounded-full",
    danger: "bg-red-50 text-red-600 border border-red-100 hover:bg-red-100 rounded-full",
    outline: "bg-transparent text-indigo-600 border border-indigo-600/40 hover:border-indigo-600 hover:bg-indigo-50 rounded-full",
  };
  // Padding ngang rộng hơn dọc — hình viên nang chỉ đọc ra "nút" khi nó dài.
  // DESIGN.md: 11px × 22px cho nút chính, 8px × 15px cho nút tiện ích.
  const sizes = {
    sm: "px-4 py-1.5 text-[14px]",
    md: "px-5 py-2.5 text-[15px]",
  };
  return (
    <button
      className={cn(
        "font-normal transition-all duration-150 flex items-center justify-center gap-2",
        // Vi tương tác dùng chung toàn hệ Apple. `active:` chứ không `hover:`
        // — DESIGN.md §Iteration Guide: "Never document hover."
        "active:scale-95",
        "disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed",
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

// Badge — viên nang nhỏ. Bỏ `uppercase` + `tracking-wider` của bản cũ: chữ hoa
// giãn ly là ngữ pháp của Material/Bootstrap, không phải Apple. Apple viết nhãn
// ở dạng câu thường, cân 600, tracking ÂM. Nhãn tiếng Việt có dấu ("Chờ tiếp
// nhận") đọc dễ hơn hẳn khi không bị ép hoa.
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
    neutral: "bg-slate-100 text-slate-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-800",
    info: "bg-indigo-50 text-indigo-700",
    danger: "bg-red-50 text-red-600",
    primary: "bg-indigo-50 text-indigo-700",
    sky: "bg-sky-50 text-sky-700"
  };
  return (
    <span className={cn("px-2.5 py-0.5 rounded-full text-[12px] font-semibold tracking-[-0.01em] whitespace-nowrap", variants[variant], className)}>
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
  <div className={cn("animate-pulse rounded-md bg-slate-100", className)} />
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
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-14 text-center", className)}>
      <div className={p.tone}>{p.icon}</div>
      {/* 17px/600 — cỡ thân bài của Apple, không phải 14px. DESIGN.md §Do's:
          "Run body copy at 17px — not 16px. The extra pixel defines the brand's
          reading pace." Màn trống là chỗ người ta ĐỌC, không phải chỗ quét. */}
      <p className="text-[17px] font-semibold tracking-[-0.022em] text-slate-900">{title ?? p.title}</p>
      {(description ?? p.description) && (
        <p className="max-w-md text-[14px] leading-[1.43] tracking-[-0.016em] text-slate-500">{description ?? p.description}</p>
      )}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
};
