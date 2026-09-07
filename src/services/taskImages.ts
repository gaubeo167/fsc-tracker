import { deleteObject, getBlob, ref, uploadBytes } from 'firebase/storage';
import { storage } from '../firebase';

// ============================================================================
// Ảnh đính kèm của task.
//
// Vì sao có file này: trước đây ảnh được đọc bằng FileReader.readAsDataURL rồi
// nhét thẳng chuỗi base64 vào document Firestore. Một ảnh chụp màn hình 780KB
// thành ~1,04MB base64 là đã vượt trần 1 MiB/document, và lượt ghi bị TỪ CHỐI
// với thông báo 'The value of property "array" is longer than 1048487 bytes'.
// Người dùng không tạo được task, không hiểu vì sao, và mất luôn cả phần đã gõ.
//
// Trần đó tính trên TOÀN BỘ document, mà document task còn chứa cả mảng
// comments — mỗi bình luận lại có thể kèm một ảnh nữa. Nên nén ảnh cho nhỏ lại
// chỉ dời được ngày chết, không sửa được lỗi. Ảnh phải rời khỏi Firestore.
//
// Cách làm giống hệt module hỗ trợ (services/attachmentUpload.ts), kể cả lý do:
//
// 1. Firestore chỉ lưu ĐƯỜNG DẪN Storage, không lưu nội dung ảnh. Document task
//    trở lại vài KB, và mỗi lượt đọc task không còn kéo theo toàn bộ ảnh.
//
// 2. Đọc ảnh bằng getBlob() chứ KHÔNG phải getDownloadURL(). getDownloadURL trả
//    về link kèm token, VĨNH VIỄN và ai cầm link cũng mở được — kể cả người
//    ngoài trường. getBlob đi qua storage.rules với token của người đang xem.
// ============================================================================

/** §10: tối đa 10MB mỗi ảnh, khớp với ngưỡng đang chốt trong storage.rules. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export class TaskImageError extends Error {}

export function validateImageFile(file: File): void {
  if (!file.type.startsWith('image/')) {
    throw new TaskImageError(`"${file.name}" không phải ảnh. Chỉ nhận file ảnh.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new TaskImageError(
      `"${file.name}" nặng ${(file.size / 1024 / 1024).toFixed(1)}MB, vượt giới hạn 10MB`
    );
  }
}

/** Nén ảnh phía client trước khi tải lên. */
async function compress(file: File, maxEdge = 1600, quality = 0.82): Promise<Blob> {
  // Ảnh camera điện thoại thường 3-6MB. Nén xuống cạnh dài 1600px vẫn đọc được
  // chữ trên ảnh chụp màn hình mà chỉ còn vài trăm KB, và lượt tải lên qua 4G
  // không còn đứt giữa chừng.
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
 * Mã thư mục cho ảnh chọn TRƯỚC khi task tồn tại (màn tạo task).
 *
 * Sinh ở client vì lúc người dùng bấm thêm ảnh thì chưa có id task nào. Ảnh vẫn
 * nằm gọn trong một thư mục riêng nên soi bucket vẫn đọc ra được nhóm.
 */
export function newDraftId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Giá trị cũ lưu thẳng trong Firestore (base64 hoặc link ngoài).
 *
 * Task tạo trước hôm nay vẫn còn nguyên chuỗi data: trong attachedImages. Chúng
 * phải tiếp tục hiện được, nếu không thì sửa một lỗi lại làm mất ảnh của mọi
 * task cũ.
 */
function laGiaTriHienNgay(value: string): boolean {
  return (
    value.startsWith('data:') ||
    value.startsWith('blob:') ||
    value.startsWith('http://') ||
    value.startsWith('https://')
  );
}

// Bộ nhớ đệm đường dẫn -> object URL.
//
// Cố ý KHÔNG thu hồi từng URL khi component unmount: mở một task rồi đóng rồi
// mở lại là chuyện xảy ra liên tục, thu hồi thì lần nào cũng phải tải lại ảnh
// qua mạng và người dùng nhìn thấy ô trống nhấp nháy. Đổi lại, bộ nhớ giữ bằng
// đúng số ảnh ĐÃ XEM trong phiên, mỗi ảnh vài trăm KB sau nén — chấp nhận được.
const cache = new Map<string, string>();
const dangTai = new Map<string, Promise<string>>();

/** Nạp sẵn ảnh vừa tải lên để màn hình khỏi phải tải lại nó ngay sau đó. */
function primeCache(path: string, blob: Blob): void {
  if (!cache.has(path)) cache.set(path, URL.createObjectURL(blob));
}

/**
 * Lấy src NGAY nếu đã có sẵn, không đợi vòng lặp sự kiện nào.
 *
 * Dùng làm giá trị khởi tạo của hook hiển thị: ảnh cũ (data:) và ảnh đã xem
 * trong phiên đều có ngay, nên mở ô phóng to không còn chớp một khung xám trước
 * khi ảnh hiện lại.
 */
export function peekTaskImage(value: string | null | undefined): string | null {
  if (!value) return null;
  if (laGiaTriHienNgay(value)) return value;
  return cache.get(value) ?? null;
}

/**
 * Đổi giá trị lưu trong Firestore thành src dùng được cho thẻ <img>.
 *
 * Nhận cả hai dạng: đường dẫn Storage (mới) và chuỗi data:/http (cũ).
 */
export function resolveTaskImage(value: string): Promise<string> {
  if (!value) return Promise.reject(new TaskImageError('Ảnh rỗng'));
  if (laGiaTriHienNgay(value)) return Promise.resolve(value);

  const sanCo = cache.get(value);
  if (sanCo) return Promise.resolve(sanCo);

  // Một task hiện nhiều lần trên màn hình (lưới ảnh + ô phóng to) sẽ hỏi cùng
  // một đường dẫn cùng lúc. Gộp lại một lượt tải.
  const dangCho = dangTai.get(value);
  if (dangCho) return dangCho;

  const p = getBlob(ref(storage, value))
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      cache.set(value, url);
      dangTai.delete(value);
      return url;
    })
    .catch((err) => {
      dangTai.delete(value);
      throw err;
    });
  dangTai.set(value, p);
  return p;
}

/**
 * Tải một ảnh của task lên Storage, trả về đường dẫn để lưu vào Firestore.
 *
 * `taskId` dùng id task thật khi task đã tồn tại, hoặc mã draft từ newDraftId()
 * khi người dùng đang ở màn tạo task.
 */
export async function uploadTaskImage(input: {
  file: File;
  projectId: string;
  taskId: string;
  uploaderUid: string;
}): Promise<string> {
  validateImageFile(input.file);
  if (!input.projectId) {
    throw new TaskImageError('Chọn dự án trước khi thêm ảnh');
  }

  const blob = await compress(input.file);
  const fileName = `${Date.now()}_${safeName(input.file.name)}`;
  const path = `task-images/${input.projectId}/${input.taskId}/${fileName}`;

  await uploadBytes(ref(storage, path), blob, {
    contentType: blob.type || input.file.type,
    // Giữ tên gốc để người xem biết người gửi đặt tên gì, còn đường dẫn thật thì
    // dùng tên đã làm sạch.
    customMetadata: { originalName: input.file.name, uploadedBy: input.uploaderUid },
  });

  primeCache(path, blob);
  return path;
}

/**
 * Xoá một ảnh vừa tải lên nhưng người dùng gỡ ra trước khi lưu.
 *
 * CHỈ dùng ở màn TẠO task, nơi chưa có document nào trỏ tới file. Ở màn sửa
 * task thì đừng gọi: người dùng gỡ ảnh rồi bấm Huỷ là chuyện thường, xoá file
 * ngay lúc gỡ sẽ để lại một document trỏ vào file không còn tồn tại.
 *
 * Nuốt lỗi có chủ đích: đây là dọn dẹp, hỏng thì cùng lắm còn một file mồ côi —
 * không đáng để chặn người dùng bằng một thông báo lỗi họ không làm gì được.
 */
export async function removeTaskImage(value: string): Promise<void> {
  if (!value || laGiaTriHienNgay(value)) return;
  try {
    await deleteObject(ref(storage, value));
    const url = cache.get(value);
    if (url) {
      URL.revokeObjectURL(url);
      cache.delete(value);
    }
  } catch (err) {
    console.warn('[taskImages] Không xoá được ảnh mồ côi:', value, err);
  }
}
