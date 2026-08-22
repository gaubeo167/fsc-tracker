import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

// ---------------------------------------------------------------------------
// Kiểm tra ENV trước khi init — fail nhanh, fail to.
//
// Vì sao cần: nếu thiếu VITE_FIREBASE_*, Firebase KHÔNG ném lỗi. Nó im lặng trả
// về snapshot rỗng kèm câu "Could not reach Cloud Firestore backend... your device
// does not have a healthy Internet connection" — một câu SAI SỰ THẬT về mạng.
// Người mới vào dự án sẽ mất hàng giờ đi tìm bug không tồn tại, vì màn hình trống
// trông y hệt "chưa có dữ liệu", "rules chặn", hay "sai database".
// Thà crash ngay với danh sách biến thiếu.
// ---------------------------------------------------------------------------
const REQUIRED_ENV = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
] as const;

const missing = REQUIRED_ENV.filter((key) => !import.meta.env[key]);
if (missing.length > 0) {
  throw new Error(
    `Thiếu ${missing.length} biến môi trường Firebase:\n` +
      missing.map((k) => `  - ${k}`).join("\n") +
      `\n\nTạo file .env.local ở thư mục gốc dự án rồi điền giá trị.` +
      `\nXem mẫu đầy đủ ở .env.example, hoặc lấy giá trị tại:` +
      `\nhttps://console.firebase.google.com/project/fsc-tracker-2128a/settings/general`
  );
}

// 🔐 Firebase config dùng ENV (chuẩn cho Vite + Vercel)
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// 🚀 Init Firebase
const app = initializeApp(firebaseConfig);

// 🔑 Auth
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// 🗄 Firestore
//
// Project có HAI database:
//   (default)  — nam5 (Mỹ), là database app đang chạy thật
//   fsc-asia   — asia-southeast1 (Singapore), bản đã di trú, chờ cutover
//
// Để trống VITE_FIREBASE_DATABASE_ID = dùng (default). Đổi giá trị này là toàn bộ
// app chuyển database, nên đây là công tắc cutover.
// Kiểm tra danh sách: gcloud firestore databases list --project=fsc-tracker-2128a
export const DATABASE_ID = import.meta.env.VITE_FIREBASE_DATABASE_ID || "(default)";
export const db =
  DATABASE_ID === "(default)" ? getFirestore(app) : getFirestore(app, DATABASE_ID);

// 📎 Storage — bucket fsc-tracker-2128a.firebasestorage.app @ asia-southeast1.
// Bucket là private (publicAccessPrevention = enforced). Ảnh đính kèm ticket có
// thể chứa thông tin cá nhân học sinh nên KHÔNG dùng getDownloadURL (link vĩnh
// viễn); mọi lượt xem phải qua signed URL hết hạn 15 phút do api/ cấp (§12).
export const storage = getStorage(app);

// 🧪 Emulator — bật bằng VITE_USE_EMULATOR=true trong .env.local, rồi `npm run emulators`.
// Cho phép test firestore.rules mà không phải deploy lên production.
if (import.meta.env.VITE_USE_EMULATOR === "true") {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  console.info("[firebase] Đang dùng emulator local (auth:9099, firestore:8080, storage:9199)");
}

// 📊 Enum cho tracking operation
export enum OperationType {
  GET = "GET",
  LIST = "LIST",
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
}

/**
 * Nơi nhận thông báo lỗi để HIỆN RA cho người dùng.
 *
 * handleFirestoreError trước đây chỉ console.error. Hậu quả gặp thật: admin bấm
 * "Nghiệm thu" một công việc, lượt ghi hỏng, và màn hình không đổi gì cả — không
 * toast, không dòng chữ nào. Người dùng bấm lại vài lần rồi kết luận nút hỏng,
 * còn người sửa thì không có gì để lần theo.
 *
 * Không nhập trực tiếp ToastProvider vào đây: firebase.ts là tầng dưới cùng,
 * kéo React vào là vòng phụ thuộc. App.tsx đăng ký hàm hiện toast lúc khởi động.
 */
type BaoLoi = (message: string) => void;
let baoLoi: BaoLoi | null = null;
export function setFirestoreErrorReporter(fn: BaoLoi | null) {
  baoLoi = fn;
}

// ⚠️ Error handler chuẩn hoá
export const handleFirestoreError = (
  error: any,
  type: OperationType,
  path: string
) => {
  console.error(`[Firestore ${type}] Path: ${path}`, error);

  // permission-denied là chế độ hỏng tốn kém nhất của codebase này: rules sai sẽ
  // hiện ra thành "danh sách rỗng", không phân biệt được với "chưa có dữ liệu".
  // Đánh dấu riêng để tầng gọi phân biệt được và hiện lỗi rõ ràng thay vì màn trống.
  const isPermissionDenied = error?.code === "permission-denied";
  if (isPermissionDenied) {
    console.error(
      `[Firestore ${type}] PERMISSION_DENIED tại "${path}" — rules đang chặn, ` +
        `KHÔNG phải không có dữ liệu. Kiểm tra firestore.rules và database đang dùng (${DATABASE_ID}).`
    );
  }

  // Nói cho người dùng biết, bằng tiếng Việt và kèm mã lỗi để ảnh chụp màn hình
  // đủ dùng làm báo lỗi. Lượt ĐỌC hỏng thì im lặng — danh sách rỗng đã có
  // StateBlock lo; chỉ lượt GHI mới cần hét lên, vì người dùng vừa bấm một nút
  // và đang chờ chuyện gì đó xảy ra.
  const laLuotGhi =
    type === OperationType.CREATE ||
    type === OperationType.UPDATE ||
    type === OperationType.DELETE;
  if (laLuotGhi && baoLoi) {
    baoLoi(
      isPermissionDenied
        ? `Bạn không có quyền thực hiện thao tác này (${path}).`
        : `Không lưu được: ${error?.message || error?.code || "lỗi không rõ"}`
    );
  }

  return {
    success: false,
    isPermissionDenied,
    error: error?.message || "Unknown error",
  };
};
