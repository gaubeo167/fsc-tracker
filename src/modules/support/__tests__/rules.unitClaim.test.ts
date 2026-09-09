import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Bản khai đơn vị công tác — test tầng firestore.rules.
//
// Thứ phải chứng minh ở đây KHÔNG phải "người dùng khai được", mà là bản khai
// KHÔNG phải một đường vòng để tự cấp quyền. Ẩn nút trên giao diện không chặn
// được ai: người mở devtools ghi thẳng vào Firestore là bỏ qua toàn bộ React.
//
// Chạy: npx firebase emulators:exec --only firestore "npx vitest run"
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-unit-claim-test';
const ADMIN_UID = 'admin-uid';
const PENDING_UID = 'nguoi-moi-uid';
const ACTIVE_UID = 'nguoi-da-duyet-uid';
const REJECTED_UID = 'nguoi-bi-tu-choi-uid';
const CAMPUS_ID = 'DN01';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid,
    displayName: 'Nguyen Van A',
    email: `${uid}@fpt.edu.vn`,
    photoURL: '',
    role: 'user',
    status: 'pending',
    ...over,
  };
}

function claim(uid: string, over: Record<string, unknown> = {}) {
  return { uid, campusId: CAMPUS_ID, jobTitle: 'Giáo viên Toán', ...over };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN_UID), profile(ADMIN_UID, { role: 'admin', status: 'active' }));
    await setDoc(doc(db, 'users', PENDING_UID), profile(PENDING_UID));
    await setDoc(doc(db, 'users', ACTIVE_UID), profile(ACTIVE_UID, { status: 'active' }));
    await setDoc(doc(db, 'users', REJECTED_UID), profile(REJECTED_UID, { status: 'disabled' }));
    await setDoc(doc(db, 'support_campuses', CAMPUS_ID), {
      id: CAMPUS_ID,
      code: CAMPUS_ID,
      name: 'FPT Schools Đà Nẵng 1',
      region: 'Miền Trung',
      isActive: true,
    });
  });
});

describe('Danh sách trường cho người CHƯA được duyệt', () => {
  it('tài khoản chờ duyệt ĐỌC ĐƯỢC danh sách trường', async () => {
    // Không có quyền này thì màn tự khai đơn vị hiện ra một danh sách rỗng, và
    // người mới không có gì để chọn — vòng luẩn quẩn: phải được duyệt mới khai
    // được, mà admin thì chờ bản khai để biết duyệt vào đâu.
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertSucceeds(getDocs(collection(db, 'support_campuses')));
  });

  it('người CHƯA đăng nhập thì không đọc được', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDocs(collection(db, 'support_campuses')));
  });

  it('tài khoản chờ duyệt vẫn KHÔNG tạo được trường', async () => {
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertFails(
      setDoc(doc(db, 'support_campuses', 'GIA_MAO'), {
        id: 'GIA_MAO', code: 'GIA_MAO', name: 'Trường tự tạo', region: '', isActive: true,
      })
    );
  });
});

describe('Bản khai đơn vị công tác', () => {
  it('người chờ duyệt khai được cho CHÍNH MÌNH', async () => {
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'support_unit_claims', PENDING_UID), claim(PENDING_UID))
    );
  });

  it('khai "không thuộc trường nào" (campusId null) cũng được', async () => {
    // Cán bộ khối PTUD không thuộc cơ sở nào. Chặn nhánh này là ép họ khai bừa
    // một trường, và admin duyệt theo thông tin sai.
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'support_unit_claims', PENDING_UID), claim(PENDING_UID, { campusId: null }))
    );
  });

  it('sửa lại bản khai của chính mình được, khi còn chờ duyệt', async () => {
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'support_unit_claims', PENDING_UID), claim(PENDING_UID)));
    await assertSucceeds(
      updateDoc(doc(db, 'support_unit_claims', PENDING_UID), { jobTitle: 'Phòng CNTT' })
    );
  });

  it('KHÔNG khai hộ người khác được', async () => {
    // Khai hộ được nghĩa là gài cho một đồng nghiệp rơi vào trường khác.
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertFails(setDoc(doc(db, 'support_unit_claims', ACTIVE_UID), claim(ACTIVE_UID)));
  });

  it('KHÔNG khai được trường không có thật', async () => {
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertFails(
      setDoc(doc(db, 'support_unit_claims', PENDING_UID), claim(PENDING_UID, { campusId: 'BIA_RA' }))
    );
  });

  it('KHÔNG nhét thêm field lạ vào bản khai được', async () => {
    // Chốt chặn quan trọng nhất: bản khai không được phép mang theo bất cứ thứ
    // gì trông giống quyền. Thêm được field là mở đường cho một lần sửa rules
    // sau này vô tình đọc nó ra.
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertFails(
      setDoc(doc(db, 'support_unit_claims', PENDING_UID), claim(PENDING_UID, { supportRole: 'SYS_ADMIN' }))
    );
  });

  it('tài khoản ĐÃ BỊ TỪ CHỐI không khai được', async () => {
    // Từ chối là quyết định có chủ đích của admin. Khai lại một đơn vị khác
    // không được phép là đường lách để quay lại hàng đợi.
    const db = testEnv.authenticatedContext(REJECTED_UID).firestore();
    await assertFails(setDoc(doc(db, 'support_unit_claims', REJECTED_UID), claim(REJECTED_UID)));
  });

  it('tài khoản đã duyệt không sửa bản khai nữa', async () => {
    // Đã duyệt rồi thì support_role_assignments mới là sự thật. Cho sửa tiếp
    // chỉ tạo ra hai thông tin mâu thuẫn trên màn hình admin.
    const db = testEnv.authenticatedContext(ACTIVE_UID).firestore();
    await assertFails(setDoc(doc(db, 'support_unit_claims', ACTIVE_UID), claim(ACTIVE_UID)));
  });

  it('khai đơn vị KHÔNG kích hoạt được tài khoản', async () => {
    // Câu hỏi thật sự của tính năng này: tự khai có phải là đường tự duyệt không.
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'support_unit_claims', PENDING_UID), claim(PENDING_UID)));
    await assertFails(updateDoc(doc(db, 'users', PENDING_UID), { status: 'active' }));
    await assertFails(
      setDoc(doc(db, 'support_role_assignments', PENDING_UID), {
        uid: PENDING_UID,
        campusId: CAMPUS_ID,
        supportRole: 'CAMPUS_REPORTER',
        assignedBy: PENDING_UID,
      })
    );
  });
});

describe('Ai đọc được bản khai', () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'support_unit_claims', PENDING_UID), claim(PENDING_UID));
    });
  });

  it('chính chủ đọc được bản khai của mình', async () => {
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_unit_claims', PENDING_UID)));
  });

  it('admin liệt kê được cả collection để điền sẵn hàng đợi duyệt', async () => {
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(getDocs(collection(db, 'support_unit_claims')));
  });

  it('người khác KHÔNG đọc được bản khai của ai đó', async () => {
    const db = testEnv.authenticatedContext(ACTIVE_UID).firestore();
    await assertFails(getDoc(doc(db, 'support_unit_claims', PENDING_UID)));
  });

  it('người dùng thường KHÔNG liệt kê được cả collection', async () => {
    const db = testEnv.authenticatedContext(PENDING_UID).firestore();
    await assertFails(getDocs(collection(db, 'support_unit_claims')));
  });
});
