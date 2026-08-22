import React from 'react';

// ===========================================================================
// Đầu mối hỗ trợ tại trường — người kỹ thuật viên sẽ liên hệ về phiếu này.
//
// CHỈ họ tên và email FPT. Cố ý không có số điện thoại: Nghị định 13/2023 coi
// số điện thoại là dữ liệu cá nhân cần cơ sở pháp lý để thu thập và xử lý, còn
// email công vụ @fpt.edu.vn đủ để liên hệ và ít nhạy cảm hơn hẳn.
//
// Vì sao bắt buộc: không có đầu mối thì kỹ thuật viên gặp câu hỏi "lỗi này xảy
// ra lúc nào, thao tác gì" là tắc — họ phải đi tìm xem ai ở trường biết chuyện.
// Đó chính là vòng lặp mà module này sinh ra để cắt bỏ.
// ===========================================================================

const FPT_DOMAINS = ['@fpt.edu.vn', '@fe.edu.vn'];

export function isValidFptEmail(email: string): boolean {
  const e = email.trim().toLowerCase();
  // Phải có phần tên trước @, không chấp nhận chuỗi rỗng như "@fpt.edu.vn".
  return FPT_DOMAINS.some((d) => e.endsWith(d) && e.length > d.length);
}

export function ContactFields({
  name,
  email,
  onChange,
  errors,
}: {
  name: string;
  email: string;
  onChange: (patch: { contactName?: string; contactEmail?: string }) => void;
  errors?: { name?: string; email?: string };
}) {
  return (
    // Khung và tiêu đề do FormSection bọc bên ngoài lo — ở đây chỉ có các ô,
    // nếu không sẽ lồng hai lớp viền chồng lên nhau.
    <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">Họ và tên</span>
          <input
            value={name}
            onChange={(e) => onChange({ contactName: e.target.value })}
            placeholder="Nguyễn Văn A"
            autoComplete="name"
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {errors?.name && <span className="mt-1 block text-[11px] text-red-600">{errors.name}</span>}
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold text-slate-600">Email FPT</span>
          <input
            value={email}
            onChange={(e) => onChange({ contactEmail: e.target.value })}
            placeholder="nguyenvana@fpt.edu.vn"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {errors?.email ? (
            <span className="mt-1 block text-[11px] text-red-600">{errors.email}</span>
          ) : (
            <span className="mt-1 block text-[11px] text-slate-400">
              Chỉ nhận email @fpt.edu.vn hoặc @fe.edu.vn
            </span>
          )}
        </label>
    </div>
  );
}
