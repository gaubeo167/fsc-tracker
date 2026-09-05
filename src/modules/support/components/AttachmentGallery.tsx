import {
  Download, ExternalLink, FileSpreadsheet, FileText, FileType, ImageIcon, Link2, Paperclip,
} from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { ICON } from '../ui/tokens';
import { downloadAttachment, loadAttachmentUrl } from '../services/attachmentUpload';
import type { Ticket } from '../types';

// ===========================================================================
// Hiển thị đính kèm: ảnh xem ngay, tài liệu tải về, link mở tab mới.
//
// Tách khỏi TicketDetail để mục trao đổi dùng lại được. Nhập ngược từ
// TicketDetail sẽ tạo vòng phụ thuộc, vì TicketDetail nhập TicketThread.
//
// Ảnh KHÔNG dùng getDownloadURL: link đó vĩnh viễn và ai cầm cũng mở được, kể
// cả người ngoài trường. Ở đây tải blob qua storage.rules bằng chính danh tính
// người đang xem, nên phần cách ly được thực thi thật.
// ===========================================================================

function typeIcon(contentType: string) {
  const c = 'h-5 w-5';
  if (contentType === 'text/uri-list') return <Link2 className={`${c} text-sky-500`} />;
  if (contentType.startsWith('image/')) return <ImageIcon className={`${c} text-emerald-500`} />;
  if (contentType === 'application/pdf') return <FileType className={`${c} text-red-500`} />;
  if (contentType.includes('spreadsheet') || contentType.includes('excel') || contentType === 'text/csv')
    return <FileSpreadsheet className={`${c} text-emerald-600`} />;
  return <FileText className={`${c} text-indigo-500`} />;
}

export function AttachmentGallery({
  paths,
  title = 'Đính kèm',
}: {
  paths: Ticket['attachments'];
  /**
   * Tiêu đề nhỏ phía trên. Đặt null khi nhúng vào bong bóng tin nhắn: ở đó
   * người đọc đã thấy rõ đây là tệp gửi kèm câu vừa nói, thêm một dòng chữ nữa
   * chỉ làm bong bóng dày lên.
   */
  title?: string | null;
}) {
  const [urls, setUrls] = useState<Record<string, string | 'error'>>({});
  // Link không cần tải gì; chỉ file mới phải lấy blob qua storage.rules.
  const files = paths.filter((a) => a.kind !== 'link');
  const links = paths.filter((a) => a.kind === 'link');
  const images = files.filter((a) => a.contentType.startsWith('image/'));
  const docs = files.filter((a) => !a.contentType.startsWith('image/'));

  useEffect(() => {
    let alive = true;
    const made: string[] = [];
    void Promise.all(
      images.map(async (a) => {
        try {
          const url = await loadAttachmentUrl(a.path);
          if (!alive) { URL.revokeObjectURL(url); return; }
          made.push(url);
          setUrls((p) => ({ ...p, [a.path]: url }));
        } catch {
          if (alive) setUrls((p) => ({ ...p, [a.path]: 'error' }));
        }
      })
    );
    return () => {
      alive = false;
      // Thu hồi object URL, nếu không mỗi lần mở phiếu là rò bộ nhớ bằng đúng
      // tổng dung lượng ảnh.
      made.forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paths]);

  return (
    <div className="mt-4">
      {title && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          <Paperclip size={ICON.sm} /> {title} ({paths.length})
        </p>
      )}

      {images.length > 0 && (
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((a) => {
            const u = urls[a.path];
            return (
              <li key={a.path} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-100">
                {u === 'error' ? (
                  <div className="flex h-full items-center justify-center p-2 text-center text-[10px] leading-tight text-amber-600">
                    Không xem được ảnh này
                  </div>
                ) : u ? (
                  <>
                    <a href={u} target="_blank" rel="noreferrer" title="Xem ảnh gốc">
                      <img src={u} alt={a.name} className="h-full w-full object-cover" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void downloadAttachment(a.path, a.name)}
                      title={`Tải về: ${a.name}`}
                      className="absolute bottom-1 right-1 rounded-md bg-slate-900/70 p-1.5 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    >
                      <Download size={ICON.sm} />
                    </button>
                  </>
                ) : (
                  <div className="h-full w-full animate-pulse bg-slate-200" />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(docs.length > 0 || links.length > 0) && (
        <ul className="mt-2 space-y-1.5">
          {docs.map((a) => (
            <li key={a.path} className="flex items-center gap-2.5 rounded-lg border border-slate-200 p-2">
              {typeIcon(a.contentType)}
              <span className="min-w-0 flex-1 truncate text-sm text-slate-800">{a.name}</span>
              <span className="shrink-0 text-[11px] text-slate-400">
                {a.sizeBytes < 1024 * 1024
                  ? `${Math.round(a.sizeBytes / 1024)} KB`
                  : `${(a.sizeBytes / 1024 / 1024).toFixed(1)} MB`}
              </span>
              {/* Tài liệu không xem trực tiếp trong trang được (PDF/Word), nên
                  đường duy nhất để đọc chi tiết là tải về. */}
              <button
                type="button"
                onClick={() => void downloadAttachment(a.path, a.name)}
                title={`Tải về: ${a.name}`}
                className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <Download size={ICON.md} />
              </button>
            </li>
          ))}
          {links.map((a) => (
            <li key={a.url} className="flex items-center gap-2.5 rounded-lg border border-sky-200 bg-sky-50 p-2">
              {typeIcon(a.contentType)}
              <a
                href={a.url}
                target="_blank"
                // noreferrer bắt buộc: thiếu nó thì trang đích đọc được
                // document.referrer và biết đường dẫn nội bộ của hệ thống.
                rel="noreferrer noopener"
                className="min-w-0 flex-1 truncate text-sm text-sky-700 hover:underline"
              >
                {a.name}
              </a>
              <ExternalLink size={ICON.sm} className="shrink-0 text-sky-400" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
