import { Loader2, MessagesSquare, Send, Wrench } from 'lucide-react';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Button, StateBlock, cn } from '../../../components/ui';
import { ICON } from '../ui/tokens';
import { vi } from '../i18n/vi';
import {
  fetchMessageIdentity,
  postTicketMessage,
  watchTicketMessages,
} from '../repository/messageRepository';
import type { RepoError } from '../repository/campusRepository';
import { AttachmentUploader } from './AttachmentUploader';
import { AttachmentGallery } from './AttachmentGallery';
import {
  DomainError,
  MESSAGE_MAX_LENGTH,
  type Ticket,
  type TicketAttachment,
  type TicketMessage,
} from '../types';

// ===========================================================================
// Trao đổi giữa cán bộ trường và người xử lý, ngay trên phiếu.
//
// Vì sao tính năng này tồn tại: trước nó, cả hệ thống chỉ có MỘT ô chữ để hỏi
// thêm thông tin, hỏi câu thứ hai là đè mất câu thứ nhất, và câu trả lời của
// trường không được lưu ở đâu. Nên mọi cuộc trao đổi thật đều rơi sang Zalo —
// đúng chỗ mà hệ thống này sinh ra để thay thế. Một phiếu không có đoạn hội
// thoại đi kèm thì ba tháng sau không ai dựng lại được vì sao nó được xử lý như
// vậy.
//
// Bố cục theo bên: tin của phía kỹ thuật nằm bên trái kèm icon cờ lê, tin của
// phía trường nằm bên phải. Nhìn một cái là biết ai đang nói, không phải đọc
// tên. Trong một cuộc trao đổi sự cố, biết "đây là câu của bên kia hay bên
// mình" quan trọng hơn biết chính xác tên người.
// ===========================================================================

type Toast = (m: string, t?: 'success' | 'error' | 'info') => void;

/** Giờ Việt Nam. Hôm nay thì chỉ hiện giờ, khác ngày mới hiện thêm ngày. */
function khiNao(ms: number): string {
  const d = new Date(ms + 7 * 3600_000);
  const now = new Date(Date.now() + 7 * 3600_000);
  const gio = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  const cungNgay =
    d.getUTCDate() === now.getUTCDate() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCFullYear() === now.getUTCFullYear();
  if (cungNgay) return gio;
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${gio}`;
}

export function TicketThread({
  ticket,
  actorUid,
  onToast,
}: {
  ticket: Ticket;
  /** Không có uid thì chỉ đọc — không dựng ô soạn tin. */
  actorUid?: string;
  onToast: Toast;
}) {
  const [messages, setMessages] = useState<TicketMessage[] | null>(null);
  const [loadError, setLoadError] = useState<RepoError | null>(null);
  const [me, setMe] = useState<{ name: string; side: 'CAMPUS' | 'PTUD' } | null>(null);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [sending, setSending] = useState(false);
  /**
   * Đổi sau mỗi lần gửi để ô đính kèm được dựng lại từ đầu.
   *
   * Cũng là thứ tách thư mục ảnh của từng lượt gửi: dùng lại một draftId cho
   * mọi tin nhắn thì ảnh của các lượt khác nhau nằm chung một thư mục, và
   * không còn cách nào biết tệp nào thuộc câu nào.
   */
  const [luot, setLuot] = useState(0);
  const cuoiDanhSach = useRef<HTMLDivElement | null>(null);

  useEffect(
    () => watchTicketMessages(ticket.id, (rows) => { setMessages(rows); setLoadError(null); },
      (err) => { setMessages([]); setLoadError(err); }),
    [ticket.id]
  );

  useEffect(() => {
    if (!actorUid) return;
    let alive = true;
    void fetchMessageIdentity(actorUid)
      .then((x) => { if (alive) setMe(x); })
      // Không chặn cả khung trao đổi vì một lượt đọc tên hỏng: vẫn cho gõ, chỉ
      // là tin sẽ mang tên rơi về email. Đọc được lịch sử vẫn quan trọng hơn.
      .catch(() => { if (alive) setMe({ name: actorUid, side: 'CAMPUS' }); });
    return () => { alive = false; };
  }, [actorUid]);

  // Cuộn xuống tin mới nhất. Không cuộn ở lần vẽ đầu tiên của một phiếu dài thì
  // người ta mở ra thấy câu chào từ hai tuần trước và tưởng không có gì mới.
  const soTin = messages?.length ?? 0;
  useEffect(() => {
    if (soTin > 0) cuoiDanhSach.current?.scrollIntoView({ block: 'nearest' });
  }, [soTin]);

  const draftId = useMemo(
    () => `${ticket.id}-msg-${luot}-${Date.now().toString(36)}`,
    [ticket.id, luot]
  );

  const conLai = MESSAGE_MAX_LENGTH - draft.trim().length;
  const guiDuoc = !sending && !!me && (draft.trim().length > 0 || attachments.length > 0);

  async function gui() {
    if (!me || !actorUid || !guiDuoc) return;
    setSending(true);
    try {
      const { ok, error } = await postTicketMessage({
        ticket,
        body: draft,
        attachments,
        author: { uid: actorUid, name: me.name, side: me.side },
      });
      if (!ok) {
        onToast(error?.kind === 'denied' ? vi.errors.permissionDenied : vi.errors.saveFailed, 'error');
        return;
      }
      setDraft('');
      setAttachments([]);
      setLuot((n) => n + 1);
    } catch (err) {
      onToast(err instanceof DomainError ? err.message : vi.errors.saveFailed, 'error');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
        <MessagesSquare size={ICON.sm} /> Trao đổi {soTin > 0 && `(${soTin})`}
      </p>

      {messages === null ? (
        <div className="mt-3"><StateBlock kind="loading" /></div>
      ) : loadError ? (
        <div className="mt-3">
          <StateBlock
            kind={loadError.kind === 'denied' ? 'denied' : 'error'}
            description={
              loadError.kind === 'denied'
                ? vi.errors.permissionDeniedHint
                : `${vi.errors.loadFailed} — ${loadError.message}`
            }
          />
        </div>
      ) : messages.length === 0 ? (
        <p className="mt-2 rounded-lg bg-slate-50 px-3 py-2.5 text-[13px] leading-relaxed text-slate-500">
          Chưa có trao đổi nào. Hỏi thêm hoặc bổ sung thông tin ngay tại đây thay vì nhắn Zalo —
          mọi câu ở đây đều gắn với phiếu và người tiếp nhận sau vẫn đọc lại được.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {messages.map((m) => {
            const cuaToi = m.authorUid === actorUid;
            const phiaKyThuat = m.authorSide === 'PTUD';

            // Tin ghi việc: một dòng giữa khung, không phải bong bóng. Nó là
            // dấu mốc của quy trình chứ không phải lời của một con người.
            if (m.isSystem) {
              return (
                <li key={m.id} className="flex items-center gap-2 text-[11px] text-slate-400">
                  <Wrench size={ICON.sm} className="shrink-0" />
                  <span className="flex-1">
                    <span className="font-medium text-slate-500">{m.authorName}</span> {m.body}
                  </span>
                  <span className="shrink-0">{khiNao(m.createdAt)}</span>
                </li>
              );
            }

            return (
              <li key={m.id} className={cn('flex', cuaToi ? 'justify-end' : 'justify-start')}>
                <div className="max-w-[85%] min-w-0">
                  <div className={cn('flex items-baseline gap-2', cuaToi && 'justify-end')}>
                    <span className="text-[11px] font-semibold text-slate-600">
                      {cuaToi ? 'Bạn' : m.authorName}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1 py-px text-[10px] font-medium',
                        phiaKyThuat ? 'bg-indigo-50 text-indigo-600' : 'bg-emerald-50 text-emerald-700'
                      )}
                    >
                      {phiaKyThuat ? 'Kỹ thuật' : 'Nhà trường'}
                    </span>
                    <span className="text-[10px] text-slate-400">{khiNao(m.createdAt)}</span>
                  </div>

                  <div
                    className={cn(
                      'mt-1 rounded-xl px-3 py-2 text-sm leading-relaxed',
                      cuaToi
                        ? 'bg-indigo-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-800'
                    )}
                  >
                    {/* whitespace-pre-wrap: người ta xuống dòng để liệt kê các
                        bước tái hiện lỗi, gộp hết thành một đoạn là mất ý. */}
                    {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                    {m.attachments.length > 0 && (
                      <div className={cn(m.body && 'mt-2', cuaToi && 'rounded-lg bg-white/10 p-1.5')}>
                        <AttachmentGallery paths={m.attachments} title={null} />
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
          <div ref={cuoiDanhSach} />
        </ul>
      )}

      {actorUid && (
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            // Enter là xuống dòng, Ctrl/Cmd+Enter mới gửi. Ngược lại thì mọi
            // đoạn mô tả nhiều bước đều bị gửi đi dở dang ở dòng thứ nhất.
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void gui(); }
            }}
            rows={3}
            placeholder="Nhập nội dung trao đổi. Ctrl+Enter để gửi."
            className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none"
          />

          {/* key nằm trên thẻ bọc chứ không nằm trên AttachmentUploader: kiểu
              props của component đó là một object literal trần nên TypeScript
              không nhận `key`. Đổi key ở đây vẫn dựng lại toàn bộ cây con, tức
              là ô đính kèm được xoá sạch sau mỗi lượt gửi. */}
          <div className="mt-2" key={draftId}>
            <AttachmentUploader
              campusId={ticket.campusId}
              draftId={draftId}
              uploaderUid={actorUid}
              mode="imageAndDocument"
              onChange={setAttachments}
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <span className={cn('text-[11px]', conLai < 0 ? 'text-red-600' : 'text-slate-400')}>
              {conLai < 200 ? `Còn ${conLai} ký tự` : ''}
            </span>
            <Button size="sm" disabled={!guiDuoc} onClick={() => void gui()}>
              {sending ? <Loader2 size={ICON.md} className="animate-spin" /> : <Send size={ICON.md} />}
              {sending ? 'Đang gửi…' : 'Gửi'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
