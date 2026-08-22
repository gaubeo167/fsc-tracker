import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../../../firebase';
import { ATTACHMENT_LIMITS, DOCUMENT_TYPES, DomainError, IMAGE_TYPES, type TicketAttachment } from '../types';

// ===========================================================================
// Upload ảnh lỗi.
//
// Hai điểm khác cách app hiện tại đang làm:
//
// 1. KHÔNG nhét base64 vào Firestore. App hiện tại dùng FileReader.readAsDataURL
//    rồi lưu chuỗi vào document (App.tsx:1736, 3804). Một ảnh chụp điện thoại
//    2MB thành ~2,7MB base64, vượt trần 1 MiB/document của Firestore và lượt
//    ghi bị TỪ CHỐI. Ảnh lỗi lại đúng là thứ giá trị nhất của phiếu, nên nó
//    phải đi Storage.
//
// 2. Đọc ảnh bằng getBlob() chứ KHÔNG phải getDownloadURL().
//    getDownloadURL trả về link kèm token, VĨNH VIỄN và ai cầm link cũng mở
//    được — kể cả người ngoài trường. Với ảnh dễ chứa thông tin học sinh thì
//    đó là rò rỉ. getBlob đi qua storage.rules với token đăng nhập của người
//    xem, nên cách ly theo trường được thực thi thật.
// ===========================================================================

/** Nén ảnh phía client trước khi tải lên. */
async function compress(file: File, maxEdge = 1600, quality = 0.82): Promise<Blob> {
  // Ảnh camera điện thoại thường 3-6MB. Cán bộ trường dùng 4G của trường, tải
  // 6MB mất 30-60 giây và rất dễ đứt giữa chừng. Nén xuống cạnh dài 1600px vẫn
  // đọc được chữ trên ảnh chụp màn hình mà chỉ còn vài trăm KB.
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 800 * 1024) return file;

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', quality)
    );
    // Nén xong mà to hơn bản gốc (ảnh PNG phẳng chẳng hạn) thì giữ bản gốc.
    return blob && blob.size < file.size ? blob : file;
  } catch {
    // createImageBitmap không hỗ trợ định dạng (HEIC trên vài trình duyệt) —
    // tải nguyên bản, đừng chặn người dùng chỉ vì không nén được.
    return file;
  }
}

/** Loại file được chấp nhận, khác nhau theo loại phiếu. */
export type AcceptMode = 'image' | 'imageAndDocument';

export function validateFile(file: File, mode: AcceptMode = 'image'): void {
  if (file.size > ATTACHMENT_LIMITS.maxBytes) {
    throw new DomainError(
      'ATTACHMENT_TOO_LARGE',
      `"${file.name}" nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt giới hạn 10MB`,
      { size: file.size }
    );
  }
  const allowed =
    mode === 'image' ? IMAGE_TYPES : [...IMAGE_TYPES, ...DOCUMENT_TYPES];
  if (!allowed.includes(file.type)) {
    throw new DomainError(
      'ATTACHMENT_BAD_TYPE',
      mode === 'image'
        ? `"${file.name}" không phải ảnh. Chỉ nhận ảnh chụp màn hình hoặc ảnh chụp lỗi.`
        : `"${file.name}" không dùng được. Chỉ nhận ảnh, PDF, Word, Excel, PowerPoint hoặc text.`,
      { type: file.type }
    );
  }
}

/**
 * Kiểm tra link đính kèm.
 *
 * Chỉ nhận http/https. Chặn javascript:, data:, file: — những thứ biến một ô
 * nhập link thành đường tấn công khi người khác bấm vào từ màn chi tiết phiếu.
 */
export function validateLink(raw: string): string {
  const value = raw.trim();
  if (!value) throw new DomainError('LINK_EMPTY', 'Chưa nhập đường dẫn');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new DomainError('LINK_INVALID', 'Đường dẫn không hợp lệ. Ví dụ: https://docs.google.com/...');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DomainError(
      'LINK_BAD_PROTOCOL',
      'Chỉ nhận đường dẫn bắt đầu bằng http:// hoặc https://',
      { protocol: parsed.protocol }
    );
  }
  return parsed.toString();
}

export function makeLinkAttachment(url: string, label: string, uid: string): TicketAttachment {
  const safe = validateLink(url);
  return {
    kind: 'link',
    path: '',
    url: safe,
    // Không có nhãn thì hiện tên miền — dễ nhận ra hơn một URL dài loằng ngoằng.
    name: label.trim() || new URL(safe).hostname,
    sizeBytes: 0,
    contentType: 'text/uri-list',
    uploadedBy: uid,
    uploadedAt: Date.now(),
  };
}

/** Tên file an toàn: bỏ dấu, bỏ ký tự lạ, tránh đụng đường dẫn Storage. */
function safeName(name: string): string {
  const clean = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-60);
  return clean || 'anh.jpg';
}

/**
 * Tải một ảnh lên.
 *
 * `draftId` là id tạm sinh ở client trước khi phiếu tồn tại. Đường dẫn có mã
 * trường vì storage.rules khoá quyền theo trường (xem ghi chú trong storage.rules).
 */
export async function uploadAttachment(input: {
  file: File;
  campusId: string;
  draftId: string;
  uploaderUid: string;
  mode?: AcceptMode;
  onProgress?: (percent: number) => void;
}): Promise<TicketAttachment> {
  validateFile(input.file, input.mode ?? 'image');

  input.onProgress?.(5);
  // Chỉ nén ẢNH. Nén một file PDF qua canvas là phá hỏng nó.
  const blob = input.file.type.startsWith('image/') ? await compress(input.file) : input.file;
  input.onProgress?.(30);

  const fileName = `${Date.now()}_${safeName(input.file.name)}`;
  const path = `support-tickets/${input.campusId}/${input.draftId}/${fileName}`;

  await uploadBytes(ref(storage, path), blob, {
    contentType: blob.type || input.file.type,
    // Giữ tên gốc để người xử lý biết người dùng đặt tên gì, nhưng đường dẫn
    // thật thì dùng tên đã làm sạch.
    customMetadata: { originalName: input.file.name, uploadedBy: input.uploaderUid },
  });
  input.onProgress?.(100);

  return {
    kind: 'file',
    path,
    url: '',
    name: input.file.name,
    sizeBytes: blob.size,
    contentType: blob.type || input.file.type,
    uploadedBy: input.uploaderUid,
    uploadedAt: Date.now(),
  };
}

/**
 * Lấy ảnh về để hiển thị, ĐI QUA storage.rules.
 *
 * Trả về object URL — nhớ gọi URL.revokeObjectURL khi component unmount, nếu
 * không mỗi lần mở phiếu là rò một khối bộ nhớ bằng đúng kích thước ảnh.
 */
export async function loadAttachmentUrl(path: string): Promise<string> {
  const blob = await getBlob(ref(storage, path));
  return URL.createObjectURL(blob);
}

/**
 * Tải file đính kèm về máy.
 *
 * Vì sao không dùng thẻ <a href={storageUrl} download>: bucket là private nên
 * URL trực tiếp không mở được. Phải lấy blob QUA storage.rules bằng danh tính
 * người đang xem, rồi mới tạo link tải từ blob đó.
 *
 * Kèm luôn tên file gốc — không có thuộc tính download thì trình duyệt đặt tên
 * theo chuỗi ngẫu nhiên của blob URL và người nhận không biết file là gì.
 */
export async function downloadAttachment(path: string, fileName: string): Promise<void> {
  const blob = await getBlob(ref(storage, path));
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'tai-lieu';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Thu hồi sau một nhịp: revoke ngay lập tức thì Safari huỷ luôn lượt tải
    // đang bắt đầu.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}
