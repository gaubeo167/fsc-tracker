import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScoredCandidate } from '../services/duplicateScorer';
import { findDuplicateCandidates } from '../repository/ticketRepository';
import type { SupportModuleCode, TicketIndexDoc } from '../types';

// ===========================================================================
// Quét trùng tầng 1 — chạy trong lúc người dùng đang nhập.
//
// HAI lỗi được xử lý ở đây, cả hai đều do review chỉ ra:
//
// 1. KHÔNG bắn theo nhịp gõ. Spec nói debounce 500ms sau mỗi lần gõ, nhưng gõ
//    tiếng Việt kiểu Telex ngắt quãng LIÊN TỤC — 500ms im lặng xảy ra giữa
//    chừng câu, không phải khi người ta viết xong. Kết quả là panel nhấp nháy
//    3 gợi ý rồi 1 rồi 4 trong lúc người dùng đang cố đọc, và mỗi lần bắn tốn
//    ~200 lượt đọc Firestore. Ở đây dùng ngưỡng token: chỉ quét khi đã đủ token
//    có nghĩa, và chỉ quét lại khi TẬP TOKEN đổi chứ không phải khi chuỗi đổi.
//    Gõ thêm dấu hay sửa chính tả không tạo ra lượt quét mới.
//
// 2. Chống kết quả về không đúng thứ tự. Hai lượt quét chồng nhau, lượt cũ về
//    sau sẽ ghi đè kết quả mới hơn. Dùng số thứ tự để bỏ qua kết quả cũ.
// ===========================================================================

export type DuplicateCandidate = ScoredCandidate<TicketIndexDoc & { id: string }>;

/** Đủ token mới quét: dưới ngưỡng này thì tiêu đề chưa đủ nghĩa để so khớp. */
const MIN_TOKENS = 3;
const DEBOUNCE_MS = 600;

export function useDuplicateCheck(input: {
  moduleId: SupportModuleCode | null;
  title: string;
  description?: string;
  enabled?: boolean;
}) {
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [state, setState] = useState<'idle' | 'searching' | 'done' | 'error'>('idle');

  // Số thứ tự lượt quét: chỉ kết quả của lượt MỚI NHẤT được nhận.
  const seqRef = useRef(0);
  // Tập token của lượt quét gần nhất, để bỏ qua thay đổi không đổi ý nghĩa.
  const lastKeyRef = useRef('');

  const run = useCallback(
    async (moduleId: SupportModuleCode, title: string, description?: string) => {
      const mySeq = ++seqRef.current;
      setState('searching');
      try {
        const found = await findDuplicateCandidates({ moduleId, title, description });
        if (mySeq !== seqRef.current) return; // đã có lượt mới hơn, bỏ kết quả này
        setCandidates(found);
        setState('done');
      } catch {
        if (mySeq !== seqRef.current) return;
        setCandidates([]);
        // Không hiện lỗi quét trùng thành lỗi to trên form: thiếu composite
        // index hay mất mạng KHÔNG được chặn người ta gửi phiếu. Quét trùng là
        // tiện ích, không phải điều kiện bắt buộc.
        setState('error');
      }
    },
    []
  );

  useEffect(() => {
    if (input.enabled === false || !input.moduleId) {
      setCandidates([]);
      setState('idle');
      return;
    }

    // Khoá theo TẬP TOKEN, không theo chuỗi thô. "khong dang nhap" và
    // "Không đăng nhập" cho cùng khoá nên không quét lại.
    const tokens = input.title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    if (tokens.length < MIN_TOKENS) {
      setCandidates([]);
      setState('idle');
      return;
    }

    const key = `${input.moduleId}|${[...new Set(tokens)].sort().join(',')}`;
    if (key === lastKeyRef.current) return;

    const timer = setTimeout(() => {
      lastKeyRef.current = key;
      void run(input.moduleId!, input.title, input.description);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [input.moduleId, input.title, input.description, input.enabled, run]);

  /**
   * Quét lại NGAY lập tức, không qua debounce, và trả kết quả về cho nơi gọi.
   *
   * Dùng ở đúng một chỗ: lúc bấm nút gửi. Bản quét theo nhịp gõ có hai lỗ:
   * người dùng gõ xong bấm gửi trong vòng 600ms thì lượt quét chưa kịp chạy,
   * và người DÁN cả tiêu đề vào rồi bấm gửi luôn thì cũng vậy. Cả hai trường
   * hợp phiếu trùng lọt qua mà không ai được cảnh báo.
   *
   * Trả về mảng thay vì chỉ set state: nơi gọi cần quyết định NGAY trong cùng
   * lượt xử lý sự kiện, không đợi React vẽ lại xong.
   */
  const recheck = useCallback(async (): Promise<DuplicateCandidate[]> => {
    if (input.enabled === false || !input.moduleId) return [];
    const mySeq = ++seqRef.current;
    setState('searching');
    try {
      const found = await findDuplicateCandidates({
        moduleId: input.moduleId,
        title: input.title,
        description: input.description,
      });
      if (mySeq !== seqRef.current) return found;
      setCandidates(found);
      setState('done');
      return found;
    } catch {
      if (mySeq === seqRef.current) { setCandidates([]); setState('error'); }
      // Quét hỏng thì KHÔNG chặn người ta gửi phiếu.
      return [];
    }
  }, [input.enabled, input.moduleId, input.title, input.description]);

  /** Người dùng bấm "Đây là lỗi khác" — ẩn panel, không quét lại. */
  const dismiss = useCallback(() => {
    setCandidates([]);
    setState('idle');
  }, []);

  return { candidates, state, dismiss, recheck };
}
