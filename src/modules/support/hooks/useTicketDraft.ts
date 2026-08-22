import { useCallback, useEffect, useRef, useState } from 'react';

// ===========================================================================
// Lưu nháp phiếu vào localStorage.
//
// Vì sao đây không phải tính năng phụ: người báo lỗi là cán bộ trường đang gõ
// trên điện thoại, trên 4G của trường. Rớt mạng, hết pin, có cuộc gọi đến, hay
// bấm nhầm nút back — nháp bay sạch. Một người mất phiếu đã gõ xong sẽ KHÔNG
// gõ lại lần hai; họ quay lại nhắn Zalo, và cả module trở nên vô nghĩa.
//
// Bọc try/catch mọi lượt đọc/ghi: localStorage ném lỗi ở chế độ riêng tư của
// Safari và khi trình duyệt chặn lưu trữ. Sập form vì không lưu được nháp còn
// tệ hơn không có tính năng lưu nháp.
// ===========================================================================

const KEY_PREFIX = 'fsc-support-draft:';
/** Nháp quá hạn này thì bỏ, tránh gợi lại phiếu từ nhiều tuần trước. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Stored<T> {
  savedAt: number;
  data: T;
}

export function useTicketDraft<T extends Record<string, unknown>>(
  campusId: string,
  initial: T
) {
  const key = `${KEY_PREFIX}${campusId}`;
  const [draft, setDraft] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const loadedRef = useRef(false);

  // Khôi phục một lần lúc mount.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Stored<T>;
      if (Date.now() - parsed.savedAt > MAX_AGE_MS) {
        localStorage.removeItem(key);
        return;
      }
      // Nháp rỗng thì không báo "đã khôi phục" — người dùng sẽ bối rối vì
      // không thấy gì được khôi phục cả.
      const hasContent = Object.values(parsed.data ?? {}).some(
        (v) => typeof v === 'string' && v.trim().length > 0
      );
      if (!hasContent) return;
      setDraft({ ...initial, ...parsed.data });
      setRestored(true);
    } catch {
      // Chế độ riêng tư, lưu trữ bị chặn, hoặc JSON hỏng — bỏ qua im lặng.
    }
  }, [key, initial]);

  // Ghi mỗi lần thay đổi.
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), data: draft }));
    } catch {
      // Hết dung lượng hoặc bị chặn. Người dùng vẫn gửi phiếu được bình thường.
    }
  }, [key, draft]);

  const patch = useCallback((p: Partial<T>) => setDraft((d) => ({ ...d, ...p })), []);

  /** Gọi sau khi gửi phiếu THÀNH CÔNG. Không gọi khi gửi lỗi — nháp phải còn đó. */
  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* bỏ qua */
    }
    setDraft(initial);
    setRestored(false);
  }, [key, initial]);

  return { draft, patch, clear, restored, dismissRestoredNotice: () => setRestored(false) };
}
