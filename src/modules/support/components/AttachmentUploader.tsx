import {
  FileSpreadsheet, FileText, FileType, ImageIcon, ImagePlus, Link2, Loader2, Plus, X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../../components/ui';
import { ICON } from '../ui/tokens';
import {
  makeLinkAttachment, uploadAttachment, validateFile, type AcceptMode,
} from '../services/attachmentUpload';
import {
  ATTACHMENT_LIMITS, DOCUMENT_TYPES, DomainError, IMAGE_TYPES, type TicketAttachment,
} from '../types';

// ===========================================================================
// Chọn và đính kèm.
//
// Hai chế độ:
//   'image'            -> báo lỗi: chỉ ảnh chụp lỗi
//   'imageAndDocument' -> đề xuất tính năng: thêm PDF/Word/Excel/PowerPoint,
//                         và cho DÁN LINK.
//
// Vì sao có link: tài liệu đề xuất thường đã nằm sẵn ở Google Docs, Drive hay
// Figma. Bắt tải xuống rồi tải lên lại là tạo một bản sao chết ngay lúc sinh —
// bản gốc còn sửa tiếp, bản đính kèm thì đứng yên và sai dần.
// ===========================================================================

interface PendingItem {
  id: string;
  file: File | null;
  previewUrl: string;
  progress: number;
  error: string | null;
  attachment: TicketAttachment | null;
}

/** Icon theo loại file — nhìn là biết ngay đang đính kèm cái gì. */
function typeIcon(contentType: string, className = '') {
  if (contentType === 'text/uri-list') return <Link2 className={cn('text-sky-500', className)} />;
  if (contentType.startsWith('image/')) return <ImageIcon className={cn('text-emerald-500', className)} />;
  if (contentType === 'application/pdf') return <FileType className={cn('text-red-500', className)} />;
  if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType === 'text/csv')
    return <FileSpreadsheet className={cn('text-emerald-600', className)} />;
  return <FileText className={cn('text-indigo-500', className)} />;
}

function humanSize(bytes: number): string {
  if (bytes <= 0) return '';
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function AttachmentUploader({
  campusId, draftId, uploaderUid, mode = 'image', onChange,
}: {
  campusId: string;
  draftId: string;
  uploaderUid: string;
  mode?: AcceptMode;
  onChange: (attachments: TicketAttachment[]) => void;
}) {
  const [items, setItems] = useState<PendingItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkLabel, setLinkLabel] = useState('');
  const [linkError, setLinkError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const allowDocs = mode === 'imageAndDocument';

  // Thu hồi object URL khi rời màn, nếu không mỗi ảnh xem trước rò một khối bộ
  // nhớ đúng bằng kích thước ảnh.
  //
  // Đọc từ REF chứ không phải từ state. Bản cũ dùng deps [] nên hàm dọn dẹp
  // đóng gói mảng `items` của lần vẽ ĐẦU TIÊN — lúc đó mảng rỗng — nên nó
  // duyệt qua một mảng rỗng và không thu hồi gì cả. Đúng cái rò rỉ mà dòng chú
  // thích bên trên nói là đã chặn.
  const urlRef = useRef<string[]>([]);
  useEffect(() => {
    urlRef.current = items.map((i) => i.previewUrl).filter(Boolean);
  }, [items]);
  useEffect(() => () => { urlRef.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  const publish = useCallback(
    (list: PendingItem[]) =>
      onChange(list.map((x) => x.attachment).filter(Boolean) as TicketAttachment[]),
    [onChange]
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = ATTACHMENT_LIMITS.maxFiles - items.length;
      if (room <= 0) return;

      const accepted: PendingItem[] = [];
      for (const file of files.slice(0, room)) {
        const id = `${file.name}-${file.size}-${Math.round(performance.now())}-${accepted.length}`;
        try {
          validateFile(file, mode);
          accepted.push({
            id, file,
            previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
            progress: 0, error: null, attachment: null,
          });
        } catch (err) {
          // File hỏng vẫn hiện kèm lý do thay vì im lặng bỏ qua — chọn 5 file mà
          // chỉ thấy 4 thì người dùng tưởng app nuốt mất.
          accepted.push({
            id, file, previewUrl: '', progress: 0,
            error: err instanceof DomainError ? err.message : 'Không dùng được file này',
            attachment: null,
          });
        }
      }
      setItems((prev) => [...prev, ...accepted]);

      for (const item of accepted) {
        if (item.error || !item.file) continue;
        try {
          const attachment = await uploadAttachment({
            file: item.file, campusId, draftId, uploaderUid, mode,
            onProgress: (p) =>
              setItems((prev) => prev.map((x) => (x.id === item.id ? { ...x, progress: p } : x))),
          });
          // Không gọi publish() BÊN TRONG hàm cập nhật state: hàm đó chạy ở
          // pha vẽ, nên nó cập nhật component cha trong lúc component này đang
          // vẽ — React cảnh báo, và ở StrictMode hàm chạy hai lần nên onChange
          // bắn hai lượt.
          setItems((prev) => {
            const next = prev.map((x) => (x.id === item.id ? { ...x, attachment, progress: 100 } : x));
            queueMicrotask(() => publish(next));
            return next;
          });
        } catch (err: any) {
          setItems((prev) => prev.map((x) => x.id === item.id ? {
            ...x,
            // Câu này phải khớp ĐÚNG điều kiện của storage.rules đang chạy, nếu
            // không nó gửi người đọc đi sửa thứ không hỏng.
            //
            // Rules hiện tại chỉ đòi: đăng nhập bằng mail nội bộ đã xác thực,
            // file dưới 10MB, đúng định dạng. Nó KHÔNG còn kiểm trạng thái duyệt
            // hay bản gán trường — hai thứ đó từng nằm trong rules và đã bị gỡ,
            // vì phép kiểm ấy đọc Firestore từ trong storage rules mà lượt đọc
            // đó không chạy trên project này (xem đầu file storage.rules).
            //
            // Bản trước của câu này vẫn nói "chưa được gán trường", và nó đã dẫn
            // cả một buổi đi lục tài khoản trong khi lỗi nằm ở chỗ khác hẳn.
            error: err?.code === 'storage/unauthorized'
              ? 'Không có quyền tải lên. Chỉ tài khoản @fpt.edu.vn hoặc @fe.edu.vn đăng nhập bằng Google mới tải tệp lên được.'
              : `Tải lên thất bại (${err?.code ?? 'lỗi mạng'})`,
          } : x));
        }
      }
    },
    [campusId, draftId, uploaderUid, mode, items.length, publish]
  );

  // Dán: chụp màn hình rồi Ctrl+V là đường nhanh nhất trên máy tính.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = (Array.from(e.clipboardData?.files ?? []) as File[]).filter((f) =>
        allowDocs ? true : f.type.startsWith('image/')
      );
      if (files.length) {
        e.preventDefault();
        void addFiles(files);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addFiles, allowDocs]);

  function addLink() {
    setLinkError(null);
    try {
      const attachment = makeLinkAttachment(linkUrl, linkLabel, uploaderUid);
      setItems((prev) => {
        const next = [...prev, {
          id: `link-${Date.now()}`, file: null, previewUrl: '',
          progress: 100, error: null, attachment,
        }];
        publish(next);
        return next;
      });
      setLinkUrl(''); setLinkLabel(''); setLinkOpen(false);
    } catch (err) {
      setLinkError(err instanceof DomainError ? err.message : 'Đường dẫn không hợp lệ');
    }
  }

  function remove(id: string) {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      const next = prev.filter((x) => x.id !== id);
      publish(next);
      return next;
    });
  }

  const full = items.length >= ATTACHMENT_LIMITS.maxFiles;
  const accept = allowDocs ? [...IMAGE_TYPES, ...DOCUMENT_TYPES].join(',') : 'image/*';

  return (
    <div>
      <span className="text-[11px] text-slate-400">
        {items.length}/{ATTACHMENT_LIMITS.maxFiles} · tối đa 10MB mỗi file
      </span>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragOver(false);
          void addFiles(Array.from(e.dataTransfer.files) as File[]);
        }}
        className={cn(
          'mt-1.5 rounded-lg border-2 border-dashed p-4 text-center transition-colors',
          dragOver ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200'
        )}
      >
        <input
          ref={inputRef} type="file" accept={accept} multiple hidden
          // capture chỉ bật ở chế độ ảnh: với tài liệu thì mở camera là vô nghĩa.
          {...(allowDocs ? {} : { capture: 'environment' as const })}
          onChange={(e) => { void addFiles(Array.from(e.target.files ?? []) as File[]); e.target.value = ''; }}
        />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button" disabled={full} onClick={() => inputRef.current?.click()}
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50"
          >
            <ImagePlus size={ICON.lg} />
            {full ? 'Đã đủ 10 mục' : allowDocs ? 'Chọn ảnh hoặc tài liệu' : 'Chụp ảnh hoặc chọn từ máy'}
          </button>

          {allowDocs && (
            <button
              type="button" disabled={full} onClick={() => setLinkOpen((v) => !v)}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 disabled:opacity-50"
            >
              <Link2 size={ICON.md} /> Gửi link
            </button>
          )}
        </div>

        <p className="mt-2 hidden text-[11px] text-slate-400 sm:block">
          Hoặc kéo thả vào đây{allowDocs ? '' : ', hoặc chụp màn hình rồi nhấn Ctrl+V'}
        </p>
      </div>

      {linkOpen && (
        <div className="mt-2 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Đường dẫn</span>
            <input
              value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="https://docs.google.com/document/d/..."
              inputMode="url" autoCapitalize="none" spellCheck={false}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="block">
            <span className="text-[11px] font-semibold text-slate-600">Tên gợi nhớ (không bắt buộc)</span>
            <input
              value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)}
              placeholder="Bản mô tả tính năng"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
          </label>
          {linkError && <p className="text-[11px] text-red-600">{linkError}</p>}
          <div className="flex gap-2">
            <button
              type="button" onClick={addLink}
              className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white"
            >
              <Plus size={ICON.sm} /> Thêm link
            </button>
            <button
              type="button" onClick={() => { setLinkOpen(false); setLinkError(null); }}
              className="rounded-lg px-3 py-1.5 text-sm text-slate-500"
            >
              Huỷ
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Nhớ đặt quyền xem cho người có link, nếu không đội kỹ thuật sẽ mở không được.
          </p>
        </div>
      )}

      {items.length > 0 && (
        <ul className="mt-3 space-y-2">
          {items.map((it) => {
            const a = it.attachment;
            const ct = a?.contentType ?? it.file?.type ?? '';
            return (
              <li
                key={it.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg border p-2',
                  it.error ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-white'
                )}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-50">
                  {it.previewUrl
                    ? <img src={it.previewUrl} alt="" className="h-full w-full object-cover" />
                    : typeIcon(ct, 'h-5 w-5')}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-slate-800">{a?.name ?? it.file?.name}</p>
                  {it.error ? (
                    <p className="text-[11px] leading-tight text-red-600">{it.error}</p>
                  ) : a?.kind === 'link' ? (
                    <p className="truncate text-[11px] text-sky-600">{a.url}</p>
                  ) : (
                    <p className="text-[11px] text-slate-400">
                      {a ? humanSize(a.sizeBytes) : 'Đang tải lên…'}
                    </p>
                  )}
                </div>
                {!a && !it.error && <Loader2 size={ICON.md} className="shrink-0 animate-spin text-indigo-500" />}
                <button
                  type="button" onClick={() => remove(it.id)}
                  className="shrink-0 rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Bỏ mục này"
                >
                  <X size={ICON.md} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
