import { describe, expect, it } from 'vitest';
import { ticketStatusFromTask } from '../repository/ticketRepository';

// ===========================================================================
// Phiếu chạy theo công việc, đúng cách người vận hành mô tả:
//
//   tiến độ > 0        -> Đang xử lý
//   tiến độ 100%       -> Đã khắc phục
//   task được nghiệm thu -> Hoàn tất
//
// Phần khó không nằm ở ba dòng trên mà ở những lần KHÔNG được đổi: sửa vặt một
// task đã xong, hay công việc còn đứng ở 100% sau khi trường vừa báo còn lỗi.
// ===========================================================================

describe('ánh xạ tiến độ công việc sang trạng thái phiếu', () => {
  it('chưa làm gì thì không đổi', () => {
    expect(ticketStatusFromTask('todo', 0, 'ACCEPTED')).toBeNull();
  });

  it('bắt đầu có tiến độ -> Đang xử lý', () => {
    expect(ticketStatusFromTask('in-progress', 1, 'ACCEPTED')).toBe('IN_PROGRESS');
    expect(ticketStatusFromTask('in-progress', 83, 'ACCEPTED')).toBe('IN_PROGRESS');
  });

  it('đủ 100% -> Đã khắc phục', () => {
    expect(ticketStatusFromTask('review', 100, 'IN_PROGRESS')).toBe('RESOLVED');
  });

  it('nghiệm thu xong -> Hoàn tất', () => {
    expect(ticketStatusFromTask('done', 100, 'RESOLVED')).toBe('CLOSED');
  });

  it('nhảy thẳng từ đã duyệt lên hoàn tất được, không phải đi từng bước', () => {
    // Người xử lý làm xong rồi mới vào cập nhật một lần: phiếu phải theo kịp
    // chứ không kẹt lại ở "đang xử lý".
    expect(ticketStatusFromTask('done', 100, 'ACCEPTED')).toBe('CLOSED');
  });
});

describe('chỉ đi tới, không lùi', () => {
  it('⭐ sửa vặt một task đã xong KHÔNG kéo phiếu về đang xử lý', () => {
    // Đây là ca thật: ai đó mở task đã hoàn tất, sửa một dòng mô tả, tiến độ
    // vẫn 100 nhưng nếu tính sai thì phiếu tụt hạng và trường nhận thông báo
    // "đang được xử lý" cho một việc đã xong từ tuần trước.
    expect(ticketStatusFromTask('in-progress', 50, 'RESOLVED')).toBeNull();
    expect(ticketStatusFromTask('in-progress', 50, 'CLOSED')).toBeNull();
    expect(ticketStatusFromTask('review', 100, 'CLOSED')).toBeNull();
  });

  it('trạng thái giữ nguyên thì không ghi lại và không bắn thông báo', () => {
    expect(ticketStatusFromTask('in-progress', 40, 'IN_PROGRESS')).toBeNull();
    expect(ticketStatusFromTask('review', 100, 'RESOLVED')).toBeNull();
    expect(ticketStatusFromTask('done', 100, 'CLOSED')).toBeNull();
  });
});

describe('tôn trọng tiếng nói của trường', () => {
  it('⭐ trường báo còn lỗi mà công việc vẫn 100% thì KHÔNG tự đóng lại', () => {
    expect(ticketStatusFromTask('review', 100, 'REOPENED')).toBeNull();
  });

  it('người xử lý làm lại thật (tiến độ tụt) thì phiếu chạy tiếp', () => {
    expect(ticketStatusFromTask('in-progress', 30, 'REOPENED')).toBeNull(); // cùng hạng
    expect(ticketStatusFromTask('review', 100, 'IN_PROGRESS')).toBe('RESOLVED');
  });

  it('⭐ nghiệm thu công việc CŨ không đóng được phiếu vừa bị mở lại', () => {
    // Trường bấm "vẫn còn lỗi" nhưng công việc vẫn nằm ở 100% chờ nghiệm thu.
    // Người nghiệm thu duyệt công việc cũ đó => phiếu KHÔNG được nhảy sang
    // hoàn tất. Nếu cho qua, trường nhận câu "đã hoàn tất và được nghiệm thu"
    // ngay sau khi vừa báo chưa xong, mà hoàn tất là trạng thái cuối nên phiếu
    // không mở lại được nữa.
    expect(ticketStatusFromTask('done', 100, 'REOPENED')).toBeNull();
  });

  it('làm lại thật (tiến độ tụt rồi lên) thì phiếu chạy tiếp bình thường', () => {
    expect(ticketStatusFromTask('in-progress', 40, 'REOPENED')).toBeNull();  // cùng hạng
    expect(ticketStatusFromTask('review', 100, 'IN_PROGRESS')).toBe('RESOLVED');
    expect(ticketStatusFromTask('done', 100, 'RESOLVED')).toBe('CLOSED');
  });

  it('⭐ phiếu bị từ chối không bị công việc kéo sống lại', () => {
    expect(ticketStatusFromTask('done', 100, 'REJECTED')).toBeNull();
    expect(ticketStatusFromTask('in-progress', 50, 'DUPLICATE')).toBeNull();
  });
});
