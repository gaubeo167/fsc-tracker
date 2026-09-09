import { describe, expect, it, vi } from 'vitest';
import { guiHangLoat, trangThaiSauKhiGui } from '../services/announcementSender';
import { GmailError } from '../services/gmailSend';
import type { NotifyRecipient } from '../types';

function nguoiNhan(n: number): NotifyRecipient[] {
  return Array.from({ length: n }, (_, i) => ({ email: `u${i}@fpt.edu.vn`, name: `Nguoi ${i}` }));
}

/** Không chờ thật, nếu không mỗi test mất vài giây cho đúng phần nhịp gửi. */
const nghiNgay = async () => {};

describe('guiHangLoat', () => {
  it('gửi hết và ghi trạng thái SENT cho từng người', async () => {
    const daGhi: string[] = [];
    const ket = await guiHangLoat({
      recipients: nguoiNhan(3),
      gui: async () => {},
      ghi: async (lo) => { lo.forEach((k) => daGhi.push(`${k.email}:${k.status}`)); },
      nghi: nghiNgay,
    });
    expect(ket).toMatchObject({ sent: 3, failed: 0, dungGiuaChung: false });
    expect(daGhi).toEqual([
      'u0@fpt.edu.vn:SENT', 'u1@fpt.edu.vn:SENT', 'u2@fpt.edu.vn:SENT',
    ]);
  });

  it('một địa chỉ hỏng KHÔNG làm hỏng cả lượt', async () => {
    const gui = vi.fn(async (r: NotifyRecipient) => {
      if (r.email === 'u1@fpt.edu.vn') throw new GmailError('GMAIL_LOI', 'Địa chỉ không tồn tại', false);
    });
    const ket = await guiHangLoat({ recipients: nguoiNhan(3), gui, ghi: async () => {}, nghi: nghiNgay });
    expect(ket).toMatchObject({ sent: 2, failed: 1, dungGiuaChung: false });
    expect(gui).toHaveBeenCalledTimes(3);
  });

  it('lỗi tạm thì THỬ LẠI chính người đó rồi đi tiếp', async () => {
    let lan = 0;
    const gui = vi.fn(async () => {
      lan++;
      if (lan === 1) throw new GmailError('GMAIL_CHAM_LAI', 'quá nhanh', true);
    });
    const ket = await guiHangLoat({ recipients: nguoiNhan(2), gui, ghi: async () => {}, nghi: nghiNgay });
    expect(gui).toHaveBeenCalledTimes(3); // 1 hỏng + 1 thử lại + 1 người sau
    expect(ket).toMatchObject({ sent: 2, failed: 0 });
  });

  it('thử lại có giới hạn, hết lượt thì tính là hỏng', async () => {
    const gui = vi.fn(async () => { throw new GmailError('GMAIL_CHAM_LAI', 'quá nhanh', true); });
    const ket = await guiHangLoat({
      recipients: nguoiNhan(1), gui, ghi: async () => {}, nghi: nghiNgay, soLanThuLai: 2,
    });
    expect(gui).toHaveBeenCalledTimes(3);
    expect(ket).toMatchObject({ sent: 0, failed: 1 });
  });

  it('hết phiên Gmail thì DỪNG HẲN, không đánh dấu hỏng cho người chưa gửi', async () => {
    // Đây là nhánh dễ làm sai nhất: đi tiếp khi phiên đã hết hạn thì 300 người
    // còn lại đều thành FAILED trong ba giây và trông như 300 địa chỉ sai.
    const daGhi: Array<{ email: string; status: string }> = [];
    const gui = vi.fn(async (r: NotifyRecipient) => {
      if (r.email === 'u1@fpt.edu.vn') throw new GmailError('GMAIL_TOKEN', 'Phiên gửi thư đã hết hạn.', false);
    });
    const ket = await guiHangLoat({
      recipients: nguoiNhan(10), gui, ghi: async (lo) => { daGhi.push(...lo); }, nghi: nghiNgay,
    });
    expect(gui).toHaveBeenCalledTimes(2);
    expect(ket.dungGiuaChung).toBe(true);
    expect(ket.lyDoDung).toContain('hết hạn');
    expect(ket).toMatchObject({ sent: 1, failed: 0 });
    // Người thứ hai KHÔNG bị ghi FAILED, để lượt "gửi tiếp" nhặt lại đúng họ.
    expect(daGhi.map((k) => k.email)).toEqual(['u0@fpt.edu.vn']);
  });

  it('người dùng bấm dừng thì ngừng ngay, giữ nguyên phần còn lại', async () => {
    let dung = false;
    const gui = vi.fn(async () => { dung = true; });
    const ket = await guiHangLoat({
      recipients: nguoiNhan(5), gui, ghi: async () => {}, nghi: nghiNgay, nenDung: () => dung,
    });
    expect(gui).toHaveBeenCalledTimes(1);
    expect(ket).toMatchObject({ sent: 1, dungGiuaChung: true });
  });

  it('gom trạng thái theo lô thay vì ghi từng thư một', async () => {
    const soLanGhi = vi.fn(async () => {});
    await guiHangLoat({
      recipients: nguoiNhan(25), gui: async () => {}, ghi: soLanGhi, nghi: nghiNgay, loGhi: 10,
    });
    // 25 thư, lô 10 -> 2 lô đầy + 1 lô lẻ lúc kết thúc.
    expect(soLanGhi).toHaveBeenCalledTimes(3);
  });

  it('không ghi gì khi danh sách rỗng', async () => {
    const ghi = vi.fn(async () => {});
    const ket = await guiHangLoat({ recipients: [], gui: async () => {}, ghi, nghi: nghiNgay });
    expect(ghi).not.toHaveBeenCalled();
    expect(ket).toMatchObject({ sent: 0, failed: 0 });
  });
});

describe('trangThaiSauKhiGui', () => {
  it('xong sạch là SENT', () => {
    expect(trangThaiSauKhiGui({ total: 5, sent: 5, failed: 0, dungGiuaChung: false })).toBe('SENT');
  });

  it('có người hỏng là PARTIAL, không phải SENT cũng không phải FAILED', () => {
    // Gộp vào SENT thì người gửi tưởng xong; gộp vào FAILED thì họ gửi lại cả
    // nhóm và người đã nhận bị nhận hai lần.
    expect(trangThaiSauKhiGui({ total: 5, sent: 4, failed: 1, dungGiuaChung: false })).toBe('PARTIAL');
  });

  it('hỏng sạch là FAILED', () => {
    expect(trangThaiSauKhiGui({ total: 5, sent: 0, failed: 5, dungGiuaChung: false })).toBe('FAILED');
  });

  it('dừng giữa chừng còn người chưa gửi thì vẫn là SENDING', () => {
    expect(trangThaiSauKhiGui({ total: 5, sent: 2, failed: 0, dungGiuaChung: true })).toBe('SENDING');
  });

  it('dừng đúng lúc người cuối vừa xong thì vẫn chốt SENT', () => {
    expect(trangThaiSauKhiGui({ total: 5, sent: 5, failed: 0, dungGiuaChung: true })).toBe('SENT');
  });
});
