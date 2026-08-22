import { ArrowLeft, Bug, Lightbulb } from 'lucide-react';
import React from 'react';
import { Card } from '../../../components/ui';
import { ICON } from '../ui/tokens';
import type { TicketType } from '../types';

// ===========================================================================
// Bước chọn loại yêu cầu, đứng trước form.
//
// Vì sao tách thành một bước riêng thay vì để hai nút radio trong form: hai
// loại này cần HAI form khác hẳn nhau.
//
//   Báo lỗi        -> cần ảnh, các bước tái hiện, thời điểm, mức ảnh hưởng,
//                     đầu mối để kỹ thuật viên gọi lại. Có SLA, có hạn xử lý.
//   Đề xuất tính năng -> cần bối cảnh và giá trị mang lại. KHÔNG có SLA hoàn
//                     thành (§7), chỉ có SLA phản hồi.
//
// Nhồi cả hai vào một form là bắt người báo lỗi cuộn qua những ô không liên
// quan, và bắt người đề xuất tính năng điền "các bước tái hiện" cho một thứ
// chưa tồn tại.
// ===========================================================================

export function RequestTypeChooser({
  onPick,
  onBack,
}: {
  onPick: (type: TicketType) => void;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft size={ICON.md} /> Quay lại
      </button>

      <div>
        <h2 className="text-lg font-bold text-slate-900">Bạn muốn gửi loại yêu cầu nào?</h2>
        <p className="mt-0.5 text-sm text-slate-500">
          Chọn đúng loại để chúng tôi hỏi bạn đúng thông tin cần thiết.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <button type="button" onClick={() => onPick('BUG')} className="text-left">
          <Card className="h-full p-5 transition-colors hover:border-red-300">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
              <Bug size={ICON.xl} />
            </div>
            <h3 className="mt-3 text-base font-bold text-slate-900">Báo lỗi</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Có chức năng đang chạy sai, không dùng được, hoặc ra kết quả không đúng.
            </p>
            <p className="mt-3 text-[11px] text-slate-400">
              Cần ảnh chụp lỗi và đầu mối liên hệ. Có hạn xử lý theo mức độ ảnh hưởng.
            </p>
          </Card>
        </button>

        <button type="button" onClick={() => onPick('FEATURE_REQUEST')} className="text-left">
          <Card className="h-full p-5 transition-colors hover:border-indigo-300">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
              <Lightbulb size={ICON.xl} />
            </div>
            <h3 className="mt-3 text-base font-bold text-slate-900">Đề xuất tính năng mới</h3>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">
              Hệ thống chạy đúng nhưng bạn muốn có thêm chức năng, hoặc cải tiến cách làm hiện tại.
            </p>
            <p className="mt-3 text-[11px] text-slate-400">
              Sẽ được phản hồi trong 3 ngày làm việc và xếp vào kế hoạch theo quý.
            </p>
          </Card>
        </button>
      </div>
    </div>
  );
}
