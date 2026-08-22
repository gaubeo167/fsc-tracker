import React from 'react';
import { cn } from '../../../../components/ui';

// ===========================================================================
// Khối có tiêu đề và icon trong form.
//
// Vì sao cần: form báo lỗi có tới 12 ô. Đổ thẳng 12 ô liên tiếp thành một cột
// thì người dùng không nhìn ra ô nào thuộc nhóm nào, và trên điện thoại chỉ
// thấy một dải xám dài vô tận.
//
// Chia thành khối có icon giải quyết ba việc cùng lúc: mắt bắt được ranh giới
// nhóm, người dùng biết mình đang ở đâu trong biểu mẫu, và icon cho biết khối
// đó nói về chuyện gì trước cả khi đọc chữ.
// ===========================================================================

export type SectionTone = 'slate' | 'red' | 'indigo' | 'amber' | 'sky' | 'emerald';

const TONES: Record<SectionTone, string> = {
  slate: 'bg-slate-100 text-slate-600',
  red: 'bg-red-50 text-red-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  amber: 'bg-amber-50 text-amber-600',
  sky: 'bg-sky-50 text-sky-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

export function FormSection({
  icon,
  title,
  description,
  tone = 'slate',
  required,
  children,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  tone?: SectionTone;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-xl border border-slate-200 bg-white p-4', className)}>
      <header className="flex items-start gap-3">
        <div
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
            TONES[tone]
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-slate-900">
            {title}
            {/* Dấu sao đặt cạnh tiêu đề KHỐI chứ không rải trên từng ô: người
                dùng cần biết "khối này bắt buộc", không cần đếm từng dấu sao. */}
            {required && <span className="ml-1 text-red-500">*</span>}
          </h3>
          {description && (
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{description}</p>
          )}
        </div>
      </header>
      <div className="mt-3.5 space-y-3">{children}</div>
    </section>
  );
}
