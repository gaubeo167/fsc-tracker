import { describe, expect, it } from 'vitest';
import {
  FLAG_THRESHOLD,
  SUGGEST_THRESHOLD,
  buildDedupFields,
  rankCandidates,
  scoreCandidate,
  selectQueryTokens,
  type DedupDocument,
} from '../services/duplicateScorer';
import { normalizeText, removeDiacritics, tokenize, trigrams } from '../services/textNormalize';

function docOf(ticketNo: string, title: string, body = ''): DedupDocument {
  return { ticketNo, ...buildDedupFields(title, body) };
}

describe('chuẩn hoá tiếng Việt', () => {
  it('bỏ dấu đầy đủ, gồm cả chữ đ', () => {
    // đ KHÔNG phân rã bằng NFD, phải thay tay. Bỏ sót là "đăng nhập" ra "ăng nhập".
    expect(removeDiacritics('Đăng nhập')).toBe('Dang nhap');
    expect(removeDiacritics('Không gửi được điểm')).toBe('Khong gui duoc diem');
    expect(removeDiacritics('Tự động cập nhật học phí')).toBe('Tu dong cap nhat hoc phi');
  });

  it('có dấu và không dấu quy về CÙNG một chuỗi', () => {
    // Đây là yêu cầu cốt lõi của §6: người dùng gõ cả hai kiểu.
    expect(normalizeText('Không đăng nhập được')).toBe(normalizeText('Khong dang nhap duoc'));
  });

  it('bỏ stopword theo §6', () => {
    const t = tokenize('Học sinh của lớp 3A bị lỗi khi xem điểm');
    expect(t).not.toContain('cua');
    expect(t).not.toContain('bi');
    expect(t).not.toContain('khi');
    expect(t).toContain('hoc');
    expect(t).toContain('sinh');
    expect(t).toContain('diem');
  });

  it('mở viết tắt hay gặp khi gõ trên điện thoại', () => {
    // "ko dang nhap dc" là cách gõ thường gặp nhất. Không mở viết tắt thì nó
    // bị coi là lỗi hoàn toàn khác với "khong dang nhap duoc".
    expect(tokenize('ko dang nhap dc')).toEqual(tokenize('khong dang nhap duoc'));
  });

  it('viết tắt nở ra CÙNG token với dạng viết đầy đủ', () => {
    // Lỗi đã gặp: hs -> 'hocsinh' (một token) trong khi "học sinh" -> hoc + sinh.
    // Bảng viết tắt khi đó lại TẠO RA chỗ không khớp thay vì xoá nó.
    expect(tokenize('hs lop 3A')).toEqual(tokenize('hoc sinh lop 3A'));
    expect(tokenize('gv ko dn dc')).toEqual(tokenize('giao vien khong dang nhap duoc'));
  });

  it('ghi nhận dương tính giả đã biết: sửa/sữa/sưa cùng ra "sua"', () => {
    // Không phải bug, là đánh đổi bắt buộc để khớp văn bản không dấu.
    // Vì vậy quét trùng chỉ GỢI Ý, người quyết định gộp.
    expect(normalizeText('sửa')).toBe('sua');
    expect(normalizeText('sữa')).toBe('sua');
    expect(normalizeText('sưa')).toBe('sua');
  });

  it('trigram bắt được trường hợp dính từ mà so khớp theo từ bỏ lỡ', () => {
    const a = trigrams('dang nhap');
    const b = trigrams('dangnhap');
    let shared = 0;
    for (const g of a) if (b.has(g)) shared++;
    expect(shared).toBeGreaterThan(4);
  });
});

describe('chọn token truy vấn — chống bug limit(200)', () => {
  it('ưu tiên token HIẾM khi có bảng tần suất', () => {
    // Cốt lõi của việc sửa: "loi" xuất hiện ở 4000 ticket, truy vấn bằng nó thì
    // 200 document lấy về là ngẫu nhiên. "hocphi" chỉ có ở 12 ticket, truy vấn
    // bằng nó thì tập ứng viên nằm đúng vùng có khả năng trùng.
    const tokens = ['loi', 'hocphi', 'dangnhap'];
    const freq = { loi: 4000, dangnhap: 900, hocphi: 12 };
    expect(selectQueryTokens(tokens, freq, 2)).toEqual(['hocphi', 'dangnhap']);
  });

  it('chưa có bảng tần suất thì quay về lấy token dài nhất', () => {
    const picked = selectQueryTokens(['loi', 'capnhathocphi', 'diem'], null, 2);
    expect(picked[0]).toBe('capnhathocphi');
  });

  it('không bao giờ vượt trần 30 của array-contains-any', () => {
    const many = Array.from({ length: 60 }, (_, i) => `token${i}`);
    expect(selectQueryTokens(many, null, 99).length).toBe(30);
  });

  it('mặc định lấy 10 token, chừa chỗ cho mệnh đề khác trong DNF', () => {
    // array-contains-any(30) × status in [3 giá trị] = 90 disjunction > trần 30
    // → Firestore từ chối lúc CHẠY, tsc không bắt được.
    const many = Array.from({ length: 60 }, (_, i) => `token${i}`);
    expect(selectQueryTokens(many, null).length).toBe(10);
  });
});

describe('chấm điểm', () => {
  it('tiêu đề y hệt cho điểm rất cao', () => {
    const { score } = scoreCandidate(
      { title: 'Không đăng nhập được vào hệ thống' },
      docOf('FSC-WEB_FSB-2608-0001', 'Không đăng nhập được vào hệ thống')
    );
    expect(score).toBeGreaterThan(0.95);
  });

  it('cùng lỗi nhưng một bên gõ không dấu vẫn vượt ngưỡng gắn cờ', () => {
    const { score } = scoreCandidate(
      { title: 'khong dang nhap duoc vao he thong' },
      docOf('FSC-WEB_FSB-2608-0001', 'Không đăng nhập được vào hệ thống')
    );
    expect(score).toBeGreaterThanOrEqual(FLAG_THRESHOLD);
  });

  it('lỗi hoàn toàn khác cho điểm dưới ngưỡng gợi ý', () => {
    const { score } = scoreCandidate(
      { title: 'Không đăng nhập được' },
      docOf('FSC-FINANCE-2608-0002', 'Xuất báo cáo học phí ra file Excel bị sai định dạng')
    );
    expect(score).toBeLessThan(SUGGEST_THRESHOLD);
  });

  it('trả về token khớp để người dùng biết VÌ SAO bị coi là trùng', () => {
    // Không có phần này thì detector báo trùng mà không giải thích được,
    // và không ai phân biệt được lỗi tinh chỉnh ngưỡng với bug.
    const { matchedTokens } = scoreCandidate(
      { title: 'Không xem được điểm học sinh' },
      docOf('FSC-WEB_FSB-2608-0003', 'Lỗi xem điểm học sinh lớp 3A')
    );
    expect(matchedTokens).toContain('diem');
    expect(matchedTokens).toContain('hoc');
    expect(matchedTokens).toContain('sinh');
  });
});

describe('xếp hạng ứng viên (§6)', () => {
  const candidates = [
    docOf('FSC-WEB_FSB-2608-0001', 'Không đăng nhập được vào hệ thống'),
    docOf('FSC-WEB_FSB-2608-0002', 'Khong dang nhap duoc he thong'),
    docOf('FSC-WEB_FSB-2608-0003', 'Xuất báo cáo học phí sai định dạng'),
    docOf('FSC-WEB_FSB-2608-0004', 'Trang chủ tải chậm trên điện thoại'),
  ];

  it('chỉ trả ứng viên vượt ngưỡng 0.45, xếp theo điểm giảm dần', () => {
    const ranked = rankCandidates({ title: 'Không đăng nhập được' }, candidates);
    expect(ranked.length).toBeGreaterThanOrEqual(2);
    expect(ranked.every((r) => r.score >= SUGGEST_THRESHOLD)).toBe(true);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    // Hai ticket về đăng nhập phải đứng đầu, không phải ticket học phí.
    expect(ranked.slice(0, 2).map((r) => r.item.ticketNo).sort()).toEqual([
      'FSC-WEB_FSB-2608-0001',
      'FSC-WEB_FSB-2608-0002',
    ]);
  });

  it('trả tối đa 5 ứng viên theo §6', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      docOf(`FSC-X-2608-${i}`, 'Không đăng nhập được vào hệ thống')
    );
    expect(rankCandidates({ title: 'Không đăng nhập được' }, many).length).toBe(5);
  });

  it('không có ứng viên nào giống thì trả mảng rỗng, không trả rác', () => {
    const ranked = rankCandidates({ title: 'Máy in phòng y tế hết mực' }, candidates);
    expect(ranked).toEqual([]);
  });
});
