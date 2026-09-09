import { describe, expect, it } from 'vitest';
import {
  base64Url,
  diaChiHeader,
  dichLoiGmail,
  maHoaHeader,
  taoThuMIME,
} from '../services/gmailSend';

/** Giải mã thân thư base64 trong MIME để kiểm nội dung thật sự gửi đi. */
function thanThu(mime: string): string {
  const body = mime.split('\r\n\r\n')[1];
  return new TextDecoder().decode(Uint8Array.from(atob(body), (c) => c.charCodeAt(0)));
}

function headerCua(mime: string, ten: string): string {
  const dong = mime.split('\r\n\r\n')[0].split('\r\n');
  const i = dong.findIndex((d) => d.startsWith(`${ten}: `));
  if (i < 0) return '';
  // Header gấp dòng: dòng tiếp theo bắt đầu bằng khoảng trắng là phần nối tiếp.
  let v = dong[i].slice(ten.length + 2);
  for (let j = i + 1; j < dong.length && /^\s/.test(dong[j]); j++) v += `\r\n${dong[j]}`;
  return v;
}

/** Header lạ tự sinh ra ngoài sáu header hợp lệ — dấu hiệu bị tiêm. */
function dongHeaderMoi(mime: string): string[] {
  const CHO_PHEP = ['From', 'To', 'Subject', 'MIME-Version', 'Content-Type', 'Content-Transfer-Encoding'];
  return mime
    .split('\r\n\r\n')[0]
    .split('\r\n')
    .filter((d) => /^[A-Za-z-]+:/.test(d) && !CHO_PHEP.some((h) => d.startsWith(`${h}: `)));
}

const THU = {
  from: { email: 'vietnb4@fpt.edu.vn', name: 'Nguyễn Bá Việt' },
  to: { email: 'a@fpt.edu.vn', name: 'Nguyễn Văn A' },
  subject: 'Thông báo tính năng mới',
  body: 'Kính gửi thầy cô,\nHệ thống vừa có tính năng mới.',
};

describe('taoThuMIME', () => {
  it('giữ nguyên tiếng Việt có dấu trong thân thư', () => {
    expect(thanThu(taoThuMIME(THU))).toBe('Kính gửi thầy cô,\r\nHệ thống vừa có tính năng mới.');
  });

  it('mã hoá tiêu đề có dấu theo RFC 2047', () => {
    const s = headerCua(taoThuMIME(THU), 'Subject');
    expect(s).toMatch(/^=\?UTF-8\?B\?/);
    expect(s).not.toContain('Thông báo');
  });

  it('khai báo charset UTF-8 và base64', () => {
    const mime = taoThuMIME(THU);
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Content-Transfer-Encoding: base64');
  });

  it('CHẶN tiêm header qua tên người nhận', () => {
    // Một cái tên chứa xuống dòng + "Bcc:" mà lọt vào header nghĩa là người dán
    // danh sách vừa âm thầm thêm người nhận vào mọi thư gửi đi.
    //
    // Điều phải đúng KHÔNG phải là "chuỗi Bcc: biến mất" — nó vẫn được phép nằm
    // lại như chữ thường trong tên. Điều phải đúng là không có DÒNG HEADER nào
    // sinh thêm: xuống dòng bị vô hiệu thì "Bcc:" chỉ còn là mấy ký tự vô hại.
    const mime = taoThuMIME({
      ...THU,
      to: { email: 'a@fpt.edu.vn', name: 'A\r\nBcc: keluu@ngoai.com' },
    });
    expect(dongHeaderMoi(mime)).toEqual([]);
    expect(headerCua(mime, 'To').split('\r\n')).toHaveLength(1);
  });

  it('CHẶN tiêm header qua tiêu đề', () => {
    const mime = taoThuMIME({ ...THU, subject: 'Xin chao\r\nBcc: keluu@ngoai.com' });
    expect(dongHeaderMoi(mime)).toEqual([]);
    expect(headerCua(mime, 'Subject').split('\r\n')).toHaveLength(1);
  });
});

describe('maHoaHeader', () => {
  it('ASCII thuần thì để nguyên, dễ đọc khi soi thư gốc', () => {
    expect(maHoaHeader('Thong bao tinh nang moi')).toBe('Thong bao tinh nang moi');
  });

  it('tiêu đề dài có dấu được cắt thành nhiều mẩu có thụt đầu dòng', () => {
    const daMa = maHoaHeader('Thông báo về việc triển khai tính năng quản lý nhóm nhận thông báo mới');
    expect(daMa).toContain('\r\n ');
    for (const dong of daMa.split('\r\n')) expect(dong.length).toBeLessThanOrEqual(78);
  });

  it('mọi mẩu đều giải mã lại được thành đúng chuỗi gốc', () => {
    // Cắt giữa một ký tự UTF-8 nhiều byte là hỏng chữ đó — đây là phép kiểm.
    const goc = 'Thông báo tính năng mới cho các trường đã đăng ký hệ thống hỗ trợ';
    const ghep = maHoaHeader(goc)
      .split('\r\n ')
      .map((m) => new TextDecoder().decode(
        Uint8Array.from(atob(m.replace(/^=\?UTF-8\?B\?/, '').replace(/\?=$/, '')), (c) => c.charCodeAt(0))
      ))
      .join('');
    expect(ghep).toBe(goc);
  });
});

describe('diaChiHeader', () => {
  it('không có tên thì chỉ còn địa chỉ', () => {
    expect(diaChiHeader('a@fpt.edu.vn', '')).toBe('a@fpt.edu.vn');
  });

  it('tên ASCII có dấu phẩy thì bọc trong nháy kép', () => {
    expect(diaChiHeader('a@fpt.edu.vn', 'Nguyen Van A, Hieu truong'))
      .toBe('"Nguyen Van A, Hieu truong" <a@fpt.edu.vn>');
  });

  it('tên có dấu thì mã hoá, KHÔNG bọc nháy quanh chuỗi đã mã hoá', () => {
    // Bọc nháy quanh encoded-word là sai chuẩn: ứng dụng thư hiện nguyên chuỗi
    // =?UTF-8?B?... ra màn hình thay vì tên người.
    const h = diaChiHeader('a@fpt.edu.vn', 'Nguyễn Văn A');
    expect(h).toMatch(/^=\?UTF-8\?B\?.+\?= <a@fpt\.edu\.vn>$/);
  });
});

describe('base64Url', () => {
  it('không còn ký tự + / = vốn làm hỏng trường raw của Gmail', () => {
    const s = base64Url('Kính gửi thầy cô ??>>~~');
    expect(s).not.toMatch(/[+/=]/);
  });
});

describe('dichLoiGmail', () => {
  it('401 nói cho người dùng biết phải kết nối lại, và KHÔNG tự thử lại', () => {
    const e = dichLoiGmail(401, 'invalid credentials');
    expect(e.code).toBe('GMAIL_TOKEN');
    expect(e.thuLaiDuoc).toBe(false);
  });

  it('403 vì chưa bật API được tách khỏi 403 vì hết hạn mức', () => {
    expect(dichLoiGmail(403, 'Gmail API has not been used in project 123').code).toBe('GMAIL_API_TAT');
    expect(dichLoiGmail(403, 'Daily sending quota exceeded').code).toBe('GMAIL_TU_CHOI');
  });

  it('429 là lỗi tạm, được phép thử lại', () => {
    expect(dichLoiGmail(429, 'rate limit').thuLaiDuoc).toBe(true);
  });
});
