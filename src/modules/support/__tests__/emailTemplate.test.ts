import { describe, expect, it } from 'vitest';
import { choDienLa, dienMau } from '../services/emailTemplate';

const NGAY = new Date('2026-09-09T03:00:00Z'); // 10:00 giờ Việt Nam
const NGUOI_GUI = 'Phòng Phát triển ứng dụng';

describe('dienMau', () => {
  it('điền tên, email, ngày và người gửi', () => {
    const out = dienMau(
      'Kính gửi {{ten}} ({{email}}),\nNgày {{ngay}}.\n{{nguoigui}}',
      { recipient: { email: 'a@fpt.edu.vn', name: 'Nguyễn Văn A' }, senderName: NGUOI_GUI },
      NGAY
    );
    expect(out).toBe(
      'Kính gửi Nguyễn Văn A (a@fpt.edu.vn),\nNgày 09/09/2026.\nPhòng Phát triển ứng dụng'
    );
  });

  it('không có tên thì lấy phần trước @, KHÔNG để "Kính gửi ,"', () => {
    const out = dienMau('Kính gửi {{ten}},', {
      recipient: { email: 'hieutruong.hn@fpt.edu.vn', name: '' }, senderName: NGUOI_GUI,
    }, NGAY);
    expect(out).toBe('Kính gửi hieutruong.hn,');
  });

  it('chỗ điền gõ sai được GIỮ NGUYÊN để nhìn thấy ở khung xem trước', () => {
    // Thay bằng rỗng thì "Kính gửi {{tên}}" thành "Kính gửi " — một câu cụt
    // nghĩa gửi cho 300 người mà không ai kịp phát hiện.
    const out = dienMau('Kính gửi {{tên}} và {{chuc_vu}}', {
      recipient: { email: 'a@fpt.edu.vn', name: 'A' }, senderName: NGUOI_GUI,
    }, NGAY);
    expect(out).toBe('Kính gửi {{tên}} và {{chuc_vu}}');
  });

  it('chấp nhận khoảng trắng trong dấu ngoặc', () => {
    const out = dienMau('{{ ten }}', {
      recipient: { email: 'a@fpt.edu.vn', name: 'A' }, senderName: NGUOI_GUI,
    }, NGAY);
    expect(out).toBe('A');
  });
});

describe('choDienLa', () => {
  it('chỉ ra chỗ điền không hợp lệ, bỏ qua chỗ điền đúng', () => {
    expect(choDienLa('{{ten}} {{chuc_vu}} {{ngay}} {{sai}}').sort()).toEqual(['chuc_vu', 'sai']);
  });

  it('mẫu sạch thì không cảnh báo gì', () => {
    expect(choDienLa('{{ten}} {{email}} {{ngay}} {{nguoigui}}')).toEqual([]);
  });
});
