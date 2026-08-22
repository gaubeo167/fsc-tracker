import { Check, Copy, List } from 'lucide-react';
import React from 'react';
import { Button, Card } from '../../../../components/ui';
import { ICON } from '../../ui/tokens';
import type { Ticket } from '../../types';

// ===========================================================================
// Màn xác nhận sau khi gửi phiếu.
//
// Ba thứ bắt buộc phải có, theo đúng §10:
//   1. Mã phiếu     -> để nhắc lại khi trao đổi qua Zalo/điện thoại
//   2. Link phiếu   -> để dán vào Zalo, đây là thứ khiến campus theo dõi được
//   3. Hạn phản hồi -> để họ biết KHI NÀO được trả lời, thay vì chờ mơ hồ
//
// Không có (3) thì người gửi rơi đúng vào trạng thái cũ: gửi xong rồi không
// biết bao giờ có người xem, và quay lại nhắn Zalo cho chắc.
// ===========================================================================

export function SubmitSuccess({
  ticket,
  slaText,
  onToast,
  onAnother,
  onBackToList,
}: {
  ticket: Ticket;
  slaText: string;
  onToast: (m: string, t?: 'success' | 'error' | 'info') => void;
  onAnother: () => void;
  onBackToList: () => void;
}) {
  const link = `${window.location.origin}?ticket=${ticket.ticketNo}`;

  return (
    <Card className="p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
        <Check size={ICON.xl} />
      </div>
      <h2 className="text-lg font-bold text-slate-900">Đã gửi yêu cầu</h2>
      <p className="mt-1 text-sm text-slate-500">
        Yêu cầu đã được chuyển tới đầu mối phụ trách phân hệ.
      </p>

      <div className="mx-auto mt-4 max-w-xs space-y-3">
        <div className="rounded-lg bg-slate-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-slate-400">Mã yêu cầu</p>
          <p className="mt-0.5 font-mono text-base font-bold text-slate-900">{ticket.ticketNo}</p>
        </div>
        <div className="rounded-lg bg-sky-50 px-4 py-3">
          <p className="text-[11px] uppercase tracking-wider text-sky-500">Dự kiến phản hồi</p>
          <p className="mt-0.5 text-sm font-semibold text-sky-900">{slaText}</p>
        </div>
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            navigator.clipboard?.writeText(link);
            onToast('Đã sao chép link yêu cầu', 'success');
          }}
        >
          <Copy size={ICON.md} /> Sao chép link
        </Button>
        <Button variant="outline" size="sm" onClick={onBackToList}>
          <List size={ICON.md} /> Về danh sách
        </Button>
        <Button size="sm" onClick={onAnother}>
          Gửi yêu cầu khác
        </Button>
      </div>
    </Card>
  );
}
