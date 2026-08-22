import { describe, expect, it } from 'vitest';
import { isValidFptEmail } from '../components/forms/ContactFields';
import { validateFile } from '../services/attachmentUpload';
import { ATTACHMENT_LIMITS, DomainError } from '../types';

// ===========================================================================
// Đầu mối hỗ trợ và ảnh đính kèm — hai thứ mới của form báo lỗi.
// ===========================================================================

describe('email đầu mối', () => {
  it('nhận email FPT hợp lệ', () => {
    expect(isValidFptEmail('nguyenvana@fpt.edu.vn')).toBe(true);
    expect(isValidFptEmail('tranthib@fe.edu.vn')).toBe(true);
  });

  it('không phân biệt hoa thường và bỏ khoảng trắng thừa', () => {
    // Người dùng gõ trên điện thoại rất hay viết hoa chữ đầu hoặc dính dấu cách.
    expect(isValidFptEmail('  NguyenVanA@FPT.edu.vn  ')).toBe(true);
  });

  it('từ chối email ngoài hệ thống FPT', () => {
    expect(isValidFptEmail('ai@gmail.com')).toBe(false);
    expect(isValidFptEmail('ai@fpt.com.vn')).toBe(false);
    expect(isValidFptEmail('ai@fpt.edu.vn.evil.com')).toBe(false);
  });

  it('từ chối chuỗi chỉ có tên miền, không có tên người', () => {
    // '@fpt.edu.vn'.endsWith('@fpt.edu.vn') là true — không kiểm độ dài thì lọt.
    expect(isValidFptEmail('@fpt.edu.vn')).toBe(false);
    expect(isValidFptEmail('')).toBe(false);
  });
});

describe('kiểm tra file ảnh', () => {
  function fakeFile(name: string, size: number, type: string): File {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  }

  it('nhận ảnh trong giới hạn', () => {
    expect(() => validateFile(fakeFile('loi.png', 2 * 1024 * 1024, 'image/png'))).not.toThrow();
  });

  it('từ chối ảnh vượt 10MB kèm thông báo nêu rõ dung lượng thật', () => {
    // Báo "file quá lớn" chung chung thì người dùng không biết phải nén tới đâu.
    try {
      validateFile(fakeFile('to.jpg', 15 * 1024 * 1024, 'image/jpeg'));
      throw new Error('đáng lẽ phải ném lỗi');
    } catch (e) {
      expect(e).toBeInstanceOf(DomainError);
      expect((e as DomainError).code).toBe('ATTACHMENT_TOO_LARGE');
      expect((e as Error).message).toContain('15.0MB');
    }
  });

  it('từ chối file không phải ảnh', () => {
    // Chặn cả file thực thi lẫn PDF: rules Storage cũng chặn, nhưng báo ở client
    // thì người dùng biết ngay thay vì chờ tải xong mới nhận lỗi quyền.
    expect(() => validateFile(fakeFile('virus.exe', 1000, 'application/x-msdownload')))
      .toThrowError(/không phải ảnh/i);
    expect(() => validateFile(fakeFile('bao-cao.pdf', 1000, 'application/pdf')))
      .toThrowError(/không phải ảnh/i);
  });

  it('giới hạn khớp §10 spec: 10 file × 10MB', () => {
    expect(ATTACHMENT_LIMITS.maxFiles).toBe(10);
    expect(ATTACHMENT_LIMITS.maxBytes).toBe(10 * 1024 * 1024);
  });
});

describe('link đính kèm', () => {
  it('nhận link http và https', async () => {
    const { validateLink } = await import('../services/attachmentUpload');
    expect(validateLink('https://docs.google.com/document/d/abc')).toContain('docs.google.com');
    expect(validateLink('http://intranet.fpt.edu.vn/tai-lieu')).toContain('intranet');
  });

  it('CHẶN javascript: — đây là đường tấn công qua ô nhập link', async () => {
    // Link này được render thành thẻ <a> ở màn chi tiết cho người khác bấm.
    // Không chặn thì một người báo lỗi có thể chạy mã trên trình duyệt của
    // kỹ thuật viên đang xem phiếu.
    const { validateLink } = await import('../services/attachmentUpload');
    expect(() => validateLink('javascript:alert(document.cookie)')).toThrowError(/http/i);
    expect(() => validateLink('data:text/html,<script>x</script>')).toThrowError(/http/i);
    expect(() => validateLink('file:///etc/passwd')).toThrowError(/http/i);
  });

  it('từ chối chuỗi không phải URL', async () => {
    const { validateLink } = await import('../services/attachmentUpload');
    expect(() => validateLink('tài liệu của tôi')).toThrowError(/không hợp lệ/i);
    expect(() => validateLink('')).toThrowError(/chưa nhập/i);
  });

  it('không có nhãn thì lấy tên miền làm tên hiển thị', async () => {
    // URL Google Docs dài 80+ ký tự, hiện nguyên là không đọc được gì.
    const { makeLinkAttachment } = await import('../services/attachmentUpload');
    const a = makeLinkAttachment('https://docs.google.com/document/d/1a2b3c4d5e6f', '', 'u1');
    expect(a.name).toBe('docs.google.com');
    expect(a.kind).toBe('link');
    expect(a.path).toBe('');
  });
});

describe('loại file theo từng form', () => {
  function fakeFile(name: string, size: number, type: string): File {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  }

  it('form BÁO LỖI chỉ nhận ảnh, từ chối PDF', async () => {
    const { validateFile } = await import('../services/attachmentUpload');
    expect(() => validateFile(fakeFile('a.png', 1000, 'image/png'), 'image')).not.toThrow();
    expect(() => validateFile(fakeFile('a.pdf', 1000, 'application/pdf'), 'image'))
      .toThrowError(/không phải ảnh/i);
  });

  it('form ĐỀ XUẤT nhận cả ảnh lẫn tài liệu', async () => {
    const { validateFile } = await import('../services/attachmentUpload');
    for (const [n, t] of [
      ['a.png', 'image/png'],
      ['a.pdf', 'application/pdf'],
      ['a.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      ['a.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ]) {
      expect(() => validateFile(fakeFile(n, 1000, t), 'imageAndDocument')).not.toThrow();
    }
  });

  it('KHÔNG form nào nhận file thực thi hay kho nén', async () => {
    // Bucket này ai trong trường cũng ghi được — không được phép thành nơi
    // phát tán file thực thi. Rules Storage chặn lần hai ở phía máy chủ.
    const { validateFile } = await import('../services/attachmentUpload');
    for (const [n, t] of [
      ['x.exe', 'application/x-msdownload'],
      ['x.sh', 'application/x-sh'],
      ['x.zip', 'application/zip'],
    ]) {
      expect(() => validateFile(fakeFile(n, 1000, t), 'imageAndDocument')).toThrow();
    }
  });
});
