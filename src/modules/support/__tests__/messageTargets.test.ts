import { describe, expect, it } from 'vitest';
import { nguoiCanBaoTin } from '../repository/messageRepository';
import type { Ticket } from '../types';

// ===========================================================================
// Ai được báo khi có tin nhắn mới.
//
// Lỗi thật, người dùng báo ngày 06/09/2026: "khi có trao đổi mới đang không có
// thông báo đến người dùng". Nguyên nhân: phiếu CHƯA ai tiếp nhận thì
// assigneeUserId, triagedBy và needsInfoBy đều rỗng, nên một câu hỏi từ phía
// trường không có một người nhận nào. Mà đó đúng là lúc trường hay hỏi nhất —
// vừa gửi phiếu xong và đang chờ.
//
// Hàm này trả về DANH SÁCH RỖNG trong đúng trường hợp đó, và nơi gọi phải rơi
// về đầu mối phân hệ. Test dưới đây khoá cả hai vế lại.
// ===========================================================================

const phieu = (over: Partial<Ticket> = {}) => ({
  id: 't1', ticketNo: 'FSC-X-1', moduleId: 'WEB_FSB', campusId: 'HN01',
  reporterUserId: 'gv', campusContactUserId: null,
  assigneeUserId: null, triagedBy: null, needsInfoBy: null,
  ...over,
} as unknown as Ticket);

describe('nguoiCanBaoTin', () => {
  it('phiếu CHƯA tiếp nhận: tin của trường không có người nhận trực tiếp', () => {
    // Chính là con bug. Rỗng ở đây BẮT BUỘC kéo theo nhánh rơi về đầu mối phân
    // hệ ở postTicketMessage — bỏ nhánh đó là tin nhắn lại rơi vào im lặng.
    expect(nguoiCanBaoTin(phieu(), 'gv', 'CAMPUS')).toEqual([]);
  });

  it('phiếu đã tiếp nhận: báo cho người xử lý và người đã tiếp nhận', () => {
    const t = phieu({ assigneeUserId: 'dev1', triagedBy: 'dev2' });
    expect(nguoiCanBaoTin(t, 'gv', 'CAMPUS').sort()).toEqual(['dev1', 'dev2']);
  });

  it('người vừa hỏi thêm thông tin cũng được báo khi trường trả lời', () => {
    const t = phieu({ needsInfoBy: 'dev3' });
    expect(nguoiCanBaoTin(t, 'gv', 'CAMPUS')).toEqual(['dev3']);
  });

  it('tin của kỹ thuật báo cho người gửi phiếu và đầu mối tại trường', () => {
    const t = phieu({ campusContactUserId: 'dauMoi' });
    expect(nguoiCanBaoTin(t, 'dev1', 'PTUD').sort()).toEqual(['dauMoi', 'gv']);
  });

  it('KHÔNG bao giờ tự báo cho chính người vừa gõ', () => {
    // Hệ thống tự bắn thông báo về cho người vừa bấm gửi là thứ khiến người ta
    // tắt chuông sau đúng hai ngày.
    const t = phieu({ assigneeUserId: 'dev1', triagedBy: 'dev1' });
    expect(nguoiCanBaoTin(t, 'dev1', 'CAMPUS')).toEqual([]);
  });

  it('trùng người thì chỉ báo một lần', () => {
    const t = phieu({ assigneeUserId: 'dev1', triagedBy: 'dev1', needsInfoBy: 'dev1' });
    expect(nguoiCanBaoTin(t, 'gv', 'CAMPUS')).toEqual(['dev1']);
  });

  it('người gửi phiếu cũng là đầu mối thì không nhân đôi thông báo', () => {
    const t = phieu({ campusContactUserId: 'gv' });
    expect(nguoiCanBaoTin(t, 'dev1', 'PTUD')).toEqual(['gv']);
  });
});
