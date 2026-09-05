import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ===========================================================================
// storage.rules — ảnh đính kèm phiếu hỗ trợ.
//
// storage.rules giữ dữ liệu NHẠY CẢM NHẤT của hệ thống (ảnh chụp màn hình có
// tên học sinh, §12 + Nghị định 13/2023) nên nó phải có test, trong khi
// firestore.rules đã có tám file thì nó từng không có dòng nào.
//
// LỊCH SỬ, đừng xoá: bản trước của file rules khoá quyền bằng firestore.get()
// (cross-service rules) — đọc users.status và bản gán trường. Toàn bộ test ở
// emulator đều xanh, còn production thì TỪ CHỐI 100% lượt tải lên kể từ ngày mở
// tính năng: bucket không nhận được một file nào, 14 phiếu không phiếu nào có
// ảnh. Đo thẳng trên production ngày 05/09/2026 mới ra: bỏ hai lượt firestore.get
// là upload chạy ngay sau 15 giây. Cross-service rules không hoạt động ở project
// này, và emulator không tài nào tái hiện được.
//
// Vì vậy phép kiểm quan trọng nhất của file này KHÔNG phải là mấy test hành vi
// bên dưới, mà là test tĩnh cuối file: rules không được gọi firestore.
// ===========================================================================

/**
 * PHẢI trùng project mà emulator đang chạy (`firebase emulators:exec` đặt biến
 * GCLOUD_PROJECT). Storage emulator phân giải theo project của chính nó, đặt tên
 * khác thì mọi test ở đây đỏ theo kiểu rất khó đọc.
 */
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'fsc-tracker-storage-rules-test';
const CAMPUS = 'HN01';

let testEnv: RulesTestEnvironment;

/** Đủ để Storage nhận là ảnh; rules chỉ đọc metadata, không đọc nội dung. */
const ANH = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Token của một người đăng nhập bằng Google, đúng hình dạng Firebase Auth phát ra. */
function nguoi(uid: string, email: string, emailVerified = true) {
  return testEnv.authenticatedContext(uid, { email, email_verified: emailVerified });
}

/** Đúng đường dẫn attachmentUpload.ts dựng: support-tickets/{campus}/{draft}/{file}. */
function duongDan(uid: string, campusId = CAMPUS) {
  return `support-tickets/${campusId}/${uid}-abc123/1757000000000_Untitled.png`;
}

function taiAnh(ctx: ReturnType<typeof nguoi>, uid: string, campusId = CAMPUS) {
  return uploadBytes(ref(ctx.storage(), duongDan(uid, campusId)), ANH, {
    contentType: 'image/jpeg',
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync(path.resolve(__dirname, '../../../../storage.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 9199,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearStorage();
});

describe('ai tải được ảnh lên', () => {
  it('cán bộ trường dùng mail @fpt.edu.vn tải được', async () => {
    await assertSucceeds(taiAnh(nguoi('u1', 'canbo@fpt.edu.vn'), 'u1'));
  });

  it('mail @fe.edu.vn cũng tải được', async () => {
    await assertSucceeds(taiAnh(nguoi('u2', 'nhansu@fe.edu.vn'), 'u2'));
  });

  it('người chưa đăng nhập không tải được gì', async () => {
    const st = testEnv.unauthenticatedContext().storage();
    await assertFails(
      uploadBytes(ref(st, duongDan('khach')), ANH, { contentType: 'image/jpeg' })
    );
  });

  it('tài khoản Google ngoài tổ chức KHÔNG tải được', async () => {
    // Project bật đăng nhập Google nên bất kỳ tài khoản Google nào cũng lấy được
    // token. App.tsx chặn tên miền ở phía trình duyệt, ai gọi thẳng API thì
    // không đi qua đó — nên rules phải tự chặn.
    await assertFails(taiAnh(nguoi('u3', 'nguoila@gmail.com'), 'u3'));
  });

  it('mail nội bộ nhưng CHƯA xác thực thì không tải được', async () => {
    await assertFails(taiAnh(nguoi('u4', 'canbo@fpt.edu.vn', false), 'u4'));
  });

  it('mail giả dạng tên miền nội bộ không lọt', async () => {
    // matches() trong rules là khớp TOÀN CHUỖI, nên đuôi giả kiểu
    // "@fpt.edu.vn.kelua.com" phải rớt. Test này khoá điều đó lại.
    await assertFails(taiAnh(nguoi('u5', 'gia@fpt.edu.vn.kelua.com'), 'u5'));
  });
});

describe('cái gì được phép nằm trong bucket', () => {
  it('file thực thi bị chặn dù người tải là người nội bộ', async () => {
    // Bucket này ai trong tổ chức cũng ghi được, nên nó không được phép trở
    // thành nơi phát tán file thực thi.
    const st = nguoi('u1', 'canbo@fpt.edu.vn').storage();
    await assertFails(
      uploadBytes(ref(st, `support-tickets/${CAMPUS}/u1-abc/setup.exe`), ANH, {
        contentType: 'application/x-msdownload',
      })
    );
  });

  it('tài liệu trong danh sách cho phép thì qua', async () => {
    const st = nguoi('u1', 'canbo@fpt.edu.vn').storage();
    await assertSucceeds(
      uploadBytes(ref(st, `support-tickets/${CAMPUS}/u1-abc/mo-ta.pdf`), ANH, {
        contentType: 'application/pdf',
      })
    );
  });

  it('ảnh là bằng chứng của phiếu — không ai xoá được, kể cả người tải lên', async () => {
    // Nhánh ghi khai `create, update` chứ không khai `write`; `write` gộp cả
    // delete nên nó sẽ vô hiệu hoá `allow delete: if false`.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), duongDan('u1')), ANH, { contentType: 'image/jpeg' });
    });
    await assertFails(deleteObject(ref(nguoi('u1', 'canbo@fpt.edu.vn').storage(), duongDan('u1'))));
  });
});

describe('ai xem được ảnh', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(ref(ctx.storage(), duongDan('u1')), ANH, { contentType: 'image/jpeg' });
    });
  });

  it('người nội bộ xem được — kể cả admin và nhân sự PTUD không thuộc trường nào', async () => {
    // Đây chính là chỗ hỏng người dùng gặp: admin mở phiếu ra thấy "Không xem
    // được ảnh này", vì rule cũ đòi người xem phải có bản gán trường mà admin
    // thì không có.
    await assertSucceeds(getBytes(ref(nguoi('admin', 'admin@fpt.edu.vn').storage(), duongDan('u1'))));
  });

  it('người ngoài tổ chức KHÔNG xem được', async () => {
    await assertFails(getBytes(ref(nguoi('x', 'nguoila@gmail.com').storage(), duongDan('u1'))));
  });

  it('người chưa đăng nhập KHÔNG xem được', async () => {
    await assertFails(getBytes(ref(testEnv.unauthenticatedContext().storage(), duongDan('u1'))));
  });
});

// ===========================================================================
// Phép kiểm quan trọng nhất của file này.
//
// Test hành vi ở trên chạy trên emulator, mà emulator CHO firestore.get chạy
// ngon lành trong khi production thì không. Nghĩa là nếu ai đó thêm lại một
// lượt firestore.get vào rules, mọi test trên vẫn xanh và tính năng vẫn chết
// trên production — đúng kịch bản đã xảy ra một lần.
//
// Nên phép kiểm phải nằm ở tầng văn bản của file rules.
// ===========================================================================
describe('rules không được chạm vào Firestore', () => {
  const nguonGoc = readFileSync(path.resolve(__dirname, '../../../../storage.rules'), 'utf8');
  // Bỏ chú thích trước khi soi: file rules kể lại chính cái bẫy nó đang tránh
  // nên trong chú thích có đầy chữ firestore.get.
  const nguon = nguonGoc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('không có lời gọi firestore.get / firestore.exists nào', () => {
    const luotDoc = nguon.match(/firestore\.(get|exists)\s*\(/g) ?? [];
    expect(
      luotDoc.length,
      'cross-service rules KHÔNG chạy trên project này — xem ghi chú đầu storage.rules'
    ).toBe(0);
  });

  it('nhánh ghi khai create/update chứ không phải write', () => {
    // `allow write` gộp cả delete nên nó vô hiệu hoá `allow delete: if false`.
    // Chốt chặn mặc định `allow read, write: if false` thì không sao.
    expect(nguon).not.toMatch(/allow[^:\n]*\bwrite\b[^:\n]*:\s*if\s+(?!false\s*;)/);
  });
});
