import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { deleteObject, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ===========================================================================
// storage.rules — ảnh đính kèm phiếu hỗ trợ.
//
// File này lấp một khoảng trống: storage.rules là nơi giữ dữ liệu NHẠY CẢM NHẤT
// của hệ thống (ảnh chụp màn hình có tên học sinh, §12 + Nghị định 13/2023)
// nhưng trước đó không có một dòng test nào, trong khi firestore.rules có tám
// file. Rules không được test là rules chỉ đúng vào ngày viết nó.
//
// Nửa dưới của file là regression test cho ISSUE-003: cán bộ trường đã được gán
// trường vẫn không tải được ảnh lên.
// ===========================================================================

/**
 * PHẢI trùng project mà emulator đang chạy, khác với mọi file test rules khác.
 *
 * Firestore emulator phục vụ project id nào client gửi lên, nên các file kia tự
 * đặt tên gì cũng chạy. Nhưng lượt firestore.get() bên trong STORAGE rules không
 * đi qua client: nó tra cứu trong project mà emulator được khởi động, tức
 * GCLOUD_PROJECT do `firebase emulators:exec` đặt. Đặt tên khác thì mọi lượt tra
 * cứu rơi vào một project rỗng, firestore.get trả null, và mọi test ở đây đỏ với
 * "Null value error" — trông y hệt rules viết sai.
 */
const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'fsc-tracker-storage-rules-test';
const ADMIN = 'admin-uid';
const ACTIVE = 'da-duyet-uid';
/** Hồ sơ KHÔNG có field status — tài khoản cũ, sinh trước khi có cổng duyệt. */
const THIEU_STATUS = 'thieu-status-uid';
/** Hồ sơ có status nhưng không phải 'active'/'pending'/'disabled'. */
const STATUS_LA = 'status-la-uid';
const PTUD = 'ptud-uid';
const CAMPUS = 'HN01';

let testEnv: RulesTestEnvironment;

/** Đủ để Storage nhận là ảnh; nội dung không quan trọng, rules chỉ đọc metadata. */
const ANH = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid,
    displayName: `User ${uid}`,
    email: `${uid}@fpt.edu.vn`,
    photoURL: '',
    role: 'user',
    ...over,
  };
}

/** Đúng đường dẫn attachmentUpload.ts dựng: support-tickets/{campus}/{draft}/{file}. */
function taiAnh(uid: string, campusId = CAMPUS) {
  const st = testEnv.authenticatedContext(uid).storage();
  return uploadBytes(
    ref(st, `support-tickets/${campusId}/${uid}-abc123/1757000000000_Untitled.png`),
    ANH,
    { contentType: 'image/jpeg' }
  );
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
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
  await testEnv.clearFirestore();
  await testEnv.clearStorage();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin', status: 'active' }));
    await setDoc(doc(db, 'users', ACTIVE), profile(ACTIVE, { status: 'active' }));
    await setDoc(doc(db, 'users', THIEU_STATUS), profile(THIEU_STATUS));
    await setDoc(doc(db, 'users', STATUS_LA), profile(STATUS_LA, { status: 'approved' }));
    await setDoc(doc(db, 'users', PTUD), profile(PTUD, { status: 'active' }));

    // Cả ba tài khoản trường đều được gán ĐÚNG trường. Khác nhau duy nhất ở status.
    for (const uid of [ACTIVE, THIEU_STATUS, STATUS_LA]) {
      await setDoc(doc(db, 'support_role_assignments', uid), {
        uid,
        campusId: CAMPUS,
        supportRole: 'CAMPUS_REPORTER',
        assignedBy: ADMIN,
      });
    }
    await setDoc(doc(db, 'support_role_assignments', PTUD), {
      uid: PTUD,
      campusId: null,
      supportRole: 'DEVELOPER',
      assignedBy: ADMIN,
    });
    await setDoc(doc(db, 'support_campuses', CAMPUS), {
      id: CAMPUS,
      code: CAMPUS,
      name: 'FPT Schools Ha Noi',
      region: 'Mien Bac',
      isActive: true,
    });
  });
});

describe('cách ly ảnh theo trường', () => {
  it('cán bộ trường đã duyệt tải được ảnh vào thư mục TRƯỜNG MÌNH', async () => {
    await assertSucceeds(taiAnh(ACTIVE));
  });

  it('cán bộ trường KHÔNG tải được ảnh vào thư mục trường khác', async () => {
    // Không có phép kiểm này thì bất kỳ ai cũng nhét ảnh vào thư mục trường khác.
    await assertFails(taiAnh(ACTIVE, 'HCM01'));
  });

  it('người chưa đăng nhập không tải được gì', async () => {
    const st = testEnv.unauthenticatedContext().storage();
    await assertFails(
      uploadBytes(ref(st, `support-tickets/${CAMPUS}/khach/1_Untitled.png`), ANH, {
        contentType: 'image/jpeg',
      })
    );
  });

  it('file thực thi bị chặn dù đúng trường', async () => {
    // Bucket này ai trong trường cũng ghi được, nên nó không được phép trở thành
    // nơi phát tán file thực thi.
    const st = testEnv.authenticatedContext(ACTIVE).storage();
    await assertFails(
      uploadBytes(ref(st, `support-tickets/${CAMPUS}/${ACTIVE}-abc/setup.exe`), ANH, {
        contentType: 'application/x-msdownload',
      })
    );
  });

  it('ảnh là bằng chứng của phiếu — không ai xoá được, kể cả người tải lên', async () => {
    // Trước đây lượt xoá bị chặn bằng tai nạn chứ không phải bằng luật: nhánh
    // ghi khai `allow write` (gộp cả delete) làm `allow delete: if false` thành
    // vô nghĩa, và thứ duy nhất chặn được là request.resource null khi xoá làm
    // hỏng phép kiểm dung lượng. Nhánh ghi giờ khai `create, update`.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await uploadBytes(
        ref(ctx.storage(), `support-tickets/${CAMPUS}/${ACTIVE}-abc/bang-chung.png`),
        ANH,
        { contentType: 'image/jpeg' }
      );
    });
    const st = testEnv.authenticatedContext(ACTIVE).storage();
    await assertFails(deleteObject(ref(st, `support-tickets/${CAMPUS}/${ACTIVE}-abc/bang-chung.png`)));
  });
});

// ===========================================================================
// Trần 2 document của cross-service rules.
//
// Test TĨNH, cố ý không chạy qua emulator: EMULATOR KHÔNG ÁP TRẦN NÀY. Mọi test
// hành vi ở trên vẫn xanh khi rules vượt trần, còn production thì từ chối 100%
// lượt tải lên. Đó đúng là cách bản trước lọt ra thật: bucket không nhận được
// một file nào, 14 phiếu không phiếu nào có ảnh, mà không một test nào đỏ.
//
// Đây là lý do phép đếm phải nằm ở tầng văn bản của file rules.
// ===========================================================================
describe('cross-service rules: trần 2 document', () => {
  const nguonGoc = readFileSync(path.resolve(__dirname, '../../../../storage.rules'), 'utf8');
  // Bỏ chú thích trước khi đếm. File này giải thích chính cái bẫy nó đang tránh,
  // nên câu chữ trong chú thích có cả `allow write` lẫn `exists()` — đếm cả
  // chú thích là tự bắt nhầm chính mình.
  const nguon = nguonGoc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  /** Số lượt đọc Firestore trong thân một hàm, tính cả hàm nó gọi lồng vào. */
  function demLuotDoc(than: string, thanHam: Map<string, string>, daQua = new Set<string>()): number {
    let n = (than.match(/firestore\.(get|exists)\s*\(/g) ?? []).length;
    for (const [ten, body] of thanHam) {
      if (daQua.has(ten)) continue;
      if (!new RegExp(`\\b${ten}\\s*\\(`).test(than)) continue;
      n += demLuotDoc(body, thanHam, new Set([...daQua, ten]));
    }
    return n;
  }

  /** Thân từng hàm khai trong file. Cắt bằng cách đếm ngoặc nhọn cho khớp. */
  const thanHam = new Map<string, string>();
  for (const m of nguon.matchAll(/function\s+(\w+)\s*\([^)]*\)\s*\{/g)) {
    let sau = 1;
    let i = (m.index ?? 0) + m[0].length;
    const batDau = i;
    while (i < nguon.length && sau > 0) {
      if (nguon[i] === '{') sau++;
      else if (nguon[i] === '}') sau--;
      i++;
    }
    thanHam.set(m[1], nguon.slice(batDau, i - 1));
  }

  it('mỗi câu allow đọc tối đa 2 document Firestore', () => {
    // Đây là phép kiểm mà emulator KHÔNG làm được. Bản cũ tiêu 3 lượt cho một
    // lượt ghi và 5 lượt cho một lượt đọc, vẫn xanh hết ở local.
    const cauAllow = [...nguon.matchAll(/allow\s+[^;]*?:\s*if\s+([^;]*);/g)];
    expect(cauAllow.length).toBeGreaterThan(0);
    for (const c of cauAllow) {
      const soLuot = demLuotDoc(c[1], thanHam);
      expect(
        soLuot,
        `câu allow "${c[0].replace(/\s+/g, ' ').slice(0, 60)}…" đọc ${soLuot} document`
      ).toBeLessThanOrEqual(2);
    }
  });

  it('không exists() rồi get() lại cùng một document', () => {
    // Hai lượt đọc lên cùng một document vẫn tính là hai suất trong trần.
    // Bản cũ tiêu suất thứ ba đúng theo kiểu này.
    expect(nguon).not.toMatch(/firestore\.exists\s*\(/);
  });

  it('nhánh ghi khai create/update chứ không phải write', () => {
    // `allow write` gộp cả delete nên nó vô hiệu hoá `allow delete: if false`.
    // Chốt chặn mặc định `allow read, write: if false` thì không sao.
    expect(nguon).not.toMatch(/allow[^:\n]*\bwrite\b[^:\n]*:\s*if\s+(?!false\s*;)/);
  });
});

// ===========================================================================
// ISSUE-003 — "gửi báo lỗi không tải được ảnh".
//
// Cán bộ trường đã được gán ĐÚNG trường, vào được form báo lỗi, nhưng mọi lượt
// tải ảnh lên đều trả storage/unauthorized.
//
// HAI nguyên nhân độc lập cùng ra một câu báo lỗi. Cái production thật sự vấp
// phải là TRẦN 2 DOCUMENT của cross-service rules (xem describe cuối file):
// nó chặn MỌI người, kể cả tài khoản hoàn hảo — soi production ngày 05/09/2026
// thì cả 18 tài khoản đều status 'active' và 15 bản gán trường đều hợp lệ.
//
// Phần dưới đây khoá nguyên nhân còn lại: hồ sơ không ở đúng status 'active'.
// Nó có thật và vẫn phải chặn, chỉ là không phải thứ đang làm hỏng production.
//
// Cổng duyệt toàn ứng
// dụng (App.tsx) chỉ chặn 'pending' và 'disabled', trong khi isApproved() của
// firestore.rules và isApprovedUser() của storage.rules đòi đúng 'active'. Tài
// khoản rơi vào kẽ hở giữa hai định nghĩa đó vẫn dựng được form — vì đọc bản
// gán trường CỦA CHÍNH MÌNH không cần isApproved() — rồi hỏng ở đúng lượt ghi.
//
// Ba test dưới đây khoá lại cả chuỗi đó, không chỉ mỗi lượt ghi cuối: nếu chỉ
// test lượt ghi thì lần sau ai đó nới rules đọc và kẽ hở mở lại mà không ai biết.
// ===========================================================================
describe('ISSUE-003: hồ sơ không phải status=active', () => {
  for (const [ten, uid] of [
    ['thiếu field status', THIEU_STATUS],
    ['status lạ (không phải active/pending/disabled)', STATUS_LA],
  ] as const) {
    describe(ten, () => {
      it('VẪN đọc được bản gán trường của mình — đây là lý do form báo lỗi dựng ra được', async () => {
        const db = testEnv.authenticatedContext(uid).firestore();
        await assertSucceeds(getDoc(doc(db, 'support_role_assignments', uid)));
      });

      it('nhưng KHÔNG đọc được danh sách trường — dashboard rỗng mà không báo lỗi', async () => {
        const db = testEnv.authenticatedContext(uid).firestore();
        await assertFails(getDoc(doc(db, 'support_campuses', CAMPUS)));
      });

      it('và tải ảnh lên BỊ CHẶN dù đã được gán đúng trường', async () => {
        await assertFails(taiAnh(uid));
      });
    });
  }
});
