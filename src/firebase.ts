import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);

// 📊 Enum cho tracking operation
export enum OperationType {
  GET = "GET",
  LIST = "LIST",
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
}

// ⚠️ Error handler chuẩn hoá
export const handleFirestoreError = (
  error: any,
  type: OperationType,
  path: string
) => {
  console.error(`[Firestore ${type}] Path: ${path}`, error);

  // Optional: bạn có thể extend thêm sau này
  return {
    success: false,
    error: error?.message || "Unknown error",
  };
};