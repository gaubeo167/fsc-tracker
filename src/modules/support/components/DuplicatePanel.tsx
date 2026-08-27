import { AlertCircle, AlertTriangle, Building2, CalendarDays, ChevronDown, ChevronUp, Search } from 'lucide-react';
import React, { useState } from 'react';
import { Button, cn } from '../../../components/ui';
import { FLAG_THRESHOLD } from '../services/duplicateScorer';
import { ICON, StatusBadge, TypeBadge, fmtDateTime } from '../ui/tokens';
import type { DuplicateCandidate } from '../hooks/useDuplicateCheck';

// ===========================================================================
// Cảnh báo phiếu trùng.
//
// Bản trước là một THANH GẤP LẠI, ghi "Có 1 phiếu tương tự đã được báo", phải
// bấm mới mở. Kết quả đúng như dự đoán: không ai bấm, và phiếu trùng vẫn được
// gửi đều — trong dữ liệu mẫu có hai phiếu giống nhau 95% cùng một phân hệ.
//
// Bản này chia làm hai mức, theo đúng điểm giống nhau:
//
//   >= FLAG_THRESHOLD (75%)  -> CẢNH BÁO, mở sẵn, hiện NỘI DUNG phiếu đã có,
//                               và người dùng phải tự tay xác nhận "đây là lỗi
//                               khác" thì nút gửi mới bật lên.
//   45% - 75%                -> gợi ý nhẹ, gấp lại, không chặn gì.
//
// Vì sao phải bắt xác nhận: đọc rồi vẫn muốn gửi là quyền của họ — người ở
// trường biết rõ hơn máy. Nhưng "đã đọc" phải là một hành động có thật, không
// phải một dòng chữ trôi qua mắt.
//
// Chiều cao vẫn cố định ở trạng thái đang quét, để form không nhảy dưới ngón
// tay người đang gõ trên điện thoại.
// ===========================================================================

/** Có ứng viên nào đủ giống để phải chặn lại và bắt đọc không. */
export function hasStrongDuplicate(candidates: DuplicateCandidate[]): boolean {
  return candidates.some((c) => c.score >= FLAG_THRESHOLD);
}

function CandidateCard({
  c, campusNames, onMeToo,
}: {
  c: DuplicateCandidate;
  campusNames: Record<string, string>;
  onMeToo: (c: DuplicateCandidate) => void;
}) {
  const item = c.item as typeof c.item & { title?: string; type?: 'BUG' | 'FEATURE_REQUEST' };
  return (
    <div className="bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Nhãn có chữ, không phải icon trần: người đang gửi phiếu cần biết
            cái "có thể trùng" kia là LỖI hay ĐỀ XUẤT thì mới quyết được là
            bấm "tôi cũng bị" hay bỏ qua. Hàng này flex-wrap nên không chật. */}
        {item.type && <TypeBadge type={item.type} />}
        <span className="font-mono text-[10px] font-bold text-slate-500">{item.ticketNo}</span>
        <StatusBadge status={item.status} />
        <span
          className={cn(
            'ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold',
            c.score >= FLAG_THRESHOLD ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-500'
          )}
          title={`Từ khoá khớp: ${c.matchedTokens.join(', ')}`}
        >
          giống {Math.round(c.score * 100)}%
        </span>
      </div>

      {/* Tiêu đề NGUYÊN VĂN. Bản gương cũ chỉ có tiêu đề đã bỏ dấu, đọc rất
          khó và không ai dám dựa vào đó để kết luận trùng. */}
      <p className="mt-1.5 text-sm font-medium leading-snug text-slate-900">
        {item.title || item.normalizedTitle}
      </p>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Building2 size={ICON.xs} />
          {campusNames[item.campusId] ?? item.campusId}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarDays size={ICON.xs} />
          {fmtDateTime(item.createdAt)}
        </span>
      </div>

      {c.matchedTokens.length > 0 && (
        <p className="mt-1.5 text-[10px] text-slate-400">
          Từ khoá trùng: {c.matchedTokens.slice(0, 8).join(' · ')}
        </p>
      )}

      <Button size="sm" variant="outline" className="mt-2 w-full sm:w-auto" onClick={() => onMeToo(c)}>
        Trường tôi cũng gặp lỗi này — theo dõi phiếu {item.ticketNo}
      </Button>
    </div>
  );
}

export function DuplicatePanel({
  candidates, state, onMeToo, onDismiss, campusNames, acknowledged, onAcknowledge,
}: {
  candidates: DuplicateCandidate[];
  state: 'idle' | 'searching' | 'done' | 'error';
  onMeToo: (c: DuplicateCandidate) => void;
  onDismiss: () => void;
  campusNames: Record<string, string>;
  /** Người dùng đã tự tay xác nhận "đây là lỗi khác" chưa. */
  acknowledged?: boolean;
  onAcknowledge?: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  if (state === 'idle' || (state === 'done' && candidates.length === 0)) return null;

  if (state === 'searching') {
    return (
      <div className="mt-2 flex h-11 items-center gap-2 rounded-lg bg-slate-50 px-3 text-xs text-slate-500">
        <Search size={ICON.sm} className="animate-pulse" />
        Đang kiểm tra xem yêu cầu này đã có ai tạo chưa…
      </div>
    );
  }

  if (state === 'error') {
    // Quét trùng hỏng KHÔNG được chặn người ta gửi phiếu. Báo nhẹ rồi thôi.
    return (
      <div className="mt-2 flex h-11 items-center gap-2 rounded-lg bg-slate-50 px-3 text-xs text-slate-400">
        <AlertCircle size={ICON.sm} />
        Không kiểm tra được yêu cầu trùng. Bạn vẫn gửi bình thường.
      </div>
    );
  }

  const strong = hasStrongDuplicate(candidates);

  // ----- Mức nhẹ: gợi ý, gấp lại, không chặn -----
  if (!strong) {
    return (
      <div className="mt-2 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex h-11 w-full items-center gap-2 px-3 text-left text-xs font-medium text-slate-600"
        >
          <Search size={ICON.sm} className="shrink-0" />
          <span className="flex-1 truncate">
            Có {candidates.length} yêu cầu gần giống — bấm để xem trước khi gửi
          </span>
          {open ? <ChevronUp size={ICON.md} /> : <ChevronDown size={ICON.md} />}
        </button>
        {open && (
          <ul className="divide-y divide-slate-100 border-t border-slate-200">
            {candidates.map((c) => (
              <li key={c.item.id}>
                <CandidateCard c={c} campusNames={campusNames} onMeToo={onMeToo} />
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ----- Mức nặng: mở sẵn, hiện nội dung, bắt xác nhận -----
  return (
    <div className="mt-2 overflow-hidden rounded-lg border-2 border-amber-300 bg-amber-50">
      <div className="flex items-start gap-2 px-3 py-2.5">
        <AlertTriangle size={ICON.lg} className="mt-0.5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-900">
            Yêu cầu này có thể đã được tạo rồi
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
            Hệ thống tìm thấy {candidates.length} yêu cầu cùng phân hệ có nội dung rất giống.
            Đọc qua bên dưới: nếu đúng là việc đang được xử lý, bấm “Trường tôi cũng gặp lỗi
            này” để theo dõi thay vì tạo phiếu mới — phiếu trùng làm đội kỹ thuật xử lý chậm đi.
          </p>
        </div>
      </div>

      <ul className="divide-y divide-slate-100 border-t border-amber-200">
        {candidates.map((c) => (
          <li key={c.item.id}>
            <CandidateCard c={c} campusNames={campusNames} onMeToo={onMeToo} />
          </li>
        ))}
      </ul>

      <label className="flex cursor-pointer items-start gap-2 border-t border-amber-200 bg-amber-100/60 px-3 py-2.5">
        <input
          type="checkbox"
          checked={!!acknowledged}
          onChange={(e) => { onAcknowledge?.(e.target.checked); if (e.target.checked) onDismiss(); }}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400 accent-amber-600"
        />
        <span className="text-xs font-medium leading-relaxed text-amber-900">
          Tôi đã đọc các yêu cầu trên và xác nhận đây là <strong>vấn đề khác</strong>, cần tạo yêu cầu mới.
        </span>
      </label>
    </div>
  );
}
