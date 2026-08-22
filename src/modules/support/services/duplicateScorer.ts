import { diceCoefficient, normalizeText, tokenize, trigrams } from './textNormalize';

// ===========================================================================
// Chấm điểm trùng lặp.
//
// Spec §6 định nghĩa: 0.6 × similarity(normalized_title) + 0.4 × ts_rank(search_vector).
// Firestore không có ts_rank, nên phần đó được thay bằng độ phủ token trên
// tiêu đề + mô tả — cùng ý nghĩa (văn bản truy vấn khớp tài liệu tới đâu),
// khác cách tính.
//
// ⚠️ ĐIỂM SỐNG CÒN mà thiết kế gốc bỏ sót:
//
// Firestore `array-contains-any` trả về document khớp BẤT KỲ token nào, và
// KHÔNG xếp hạng theo số token khớp. Với 50.000 ticket, một token phổ biến như
// "loi" hay "dangnhap" khớp hàng nghìn document, và limit(200) cắt theo thứ tự
// index chứ không theo độ giống. Ticket trùng thật — cái khớp 6/8 token — về
// mặt thống kê KHÔNG nằm trong 200 cái được lấy về.
//
// Hệ quả: tính năng chạy có vẻ đúng ở 500 ticket và hỏng im lặng ở 50.000,
// đúng mức mà bộ đo hiệu năng dựng ra để chứng minh.
//
// Cách xử lý ở đây: chọn token HIẾM NHẤT để truy vấn (selectQueryTokens), dựa
// trên bảng tần suất token duy trì sẵn. Token hiếm thu hẹp tập ứng viên xuống
// đúng vùng có khả năng trùng, nên 200 document lấy về mới có ý nghĩa.
// ===========================================================================

/** Trần cứng của Firestore cho array-contains-any. */
export const MAX_ARRAY_CONTAINS_ANY = 30;

/** Ngưỡng theo §6: >= 0.45 thì gợi ý cho người dùng, >= 0.75 thì gắn cờ triage. */
export const SUGGEST_THRESHOLD = 0.45;
export const FLAG_THRESHOLD = 0.75;

export interface ScoredCandidate<T> {
  item: T;
  score: number;
  matchedTokens: string[];
}

export interface DedupDocument {
  ticketNo: string;
  normalizedTitle: string;
  titleTokens: string[];
  /** Token của phần mô tả, dùng cho vế "độ phủ" thay cho ts_rank. */
  bodyTokens?: string[];
}

/**
 * Chọn token đưa vào truy vấn Firestore.
 *
 * `frequency` là số ticket đang chứa mỗi token, duy trì trong
 * support_config/token_frequency. Thiếu bảng này thì hàm quay về lấy token dài
 * nhất — độ dài tương quan thô với độ hiếm trong tiếng Việt, đủ dùng lúc mới
 * chạy khi bảng tần suất chưa có dữ liệu.
 *
 * Giới hạn mặc định 10 chứ không phải 30: `array-contains-any` kết hợp với các
 * mệnh đề khác sẽ nhân số disjunction sau khai triển DNF, và Firestore chặn ở
 * 30. Lấy 30 token rồi thêm một điều kiện `in` nữa là query bị từ chối lúc
 * chạy, mà `tsc` không bao giờ bắt được.
 */
export function selectQueryTokens(
  tokens: string[],
  frequency: Record<string, number> | null,
  limit = 10
): string[] {
  const capped = Math.min(limit, MAX_ARRAY_CONTAINS_ANY);
  if (!frequency || Object.keys(frequency).length === 0) {
    return [...tokens].sort((a, b) => b.length - a.length).slice(0, capped);
  }
  return [...tokens]
    .sort((a, b) => (frequency[a] ?? 0) - (frequency[b] ?? 0) || b.length - a.length)
    .slice(0, capped);
}

/**
 * Điểm giống nhau giữa văn bản đang gõ và một ticket ứng viên.
 * Giữ đúng trọng số 0.6 / 0.4 của §6.
 */
export function scoreCandidate(
  query: { title: string; description?: string },
  candidate: DedupDocument
): { score: number; matchedTokens: string[] } {
  const queryTokens = new Set(tokenize(query.title));
  const candidateTokens = new Set(candidate.titleTokens);

  // Vế 1 (0.6): độ giống của tiêu đề, kết hợp so khớp theo từ và theo trigram.
  // Trigram bắt được lỗi gõ và dính từ mà so khớp theo từ bỏ lỡ.
  const tokenSim = diceCoefficient(queryTokens, candidateTokens);
  const trigramSim = diceCoefficient(
    trigrams(query.title),
    trigrams(candidate.normalizedTitle)
  );
  const titleSim = 0.5 * tokenSim + 0.5 * trigramSim;

  // Vế 2 (0.4): độ phủ — bao nhiêu phần token của truy vấn xuất hiện ở đâu đó
  // trong ticket ứng viên. Đây là thứ thay cho ts_rank của PostgreSQL.
  const haystack = new Set([...candidate.titleTokens, ...(candidate.bodyTokens ?? [])]);
  const queryAll = new Set([
    ...queryTokens,
    ...(query.description ? tokenize(query.description) : []),
  ]);
  const matched = [...queryAll].filter((t) => haystack.has(t));
  const coverage = queryAll.size === 0 ? 0 : matched.length / queryAll.size;

  return {
    score: 0.6 * titleSim + 0.4 * coverage,
    matchedTokens: matched.sort(),
  };
}

/**
 * Chấm điểm rồi xếp hạng ứng viên, chỉ giữ những cái vượt ngưỡng.
 * §6: trả tối đa 5 ứng viên có điểm >= 0.45.
 */
export function rankCandidates<T extends DedupDocument>(
  query: { title: string; description?: string },
  candidates: T[],
  opts: { threshold?: number; limit?: number } = {}
): ScoredCandidate<T>[] {
  const threshold = opts.threshold ?? SUGGEST_THRESHOLD;
  const limit = opts.limit ?? 5;
  return candidates
    .map((item) => ({ item, ...scoreCandidate(query, item) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Dữ liệu dùng cho quét trùng, sinh từ nội dung ticket lúc tạo/sửa. */
export function buildDedupFields(title: string, description: string) {
  return {
    normalizedTitle: normalizeText(title),
    titleTokens: tokenize(title),
    // Cắt 40 token: document càng to thì mỗi lần quét càng tốn băng thông, mà
    // token thứ 41 trở đi gần như không đổi được kết quả.
    bodyTokens: tokenize(description).slice(0, 40),
  };
}
