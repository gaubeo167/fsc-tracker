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
// Rules cho support_campuses và support_role_assignments.
//
// Quy tắc cứng §3: người dùng KHÔNG BAO GIỜ tự gán mình vào trường. Nếu họ ghi
// được support_role_assignments của chính mình thì họ tự chuyển sang trường
// khác và đọc dữ liệu trường đó — cách ly campus sụp đổ hoàn toàn.
// Test này tồn tại để chặn đúng điều đó.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-support-rules-test';
const ADMIN = 'admin-uid';
const APPROVED = 'da-duyet-uid';
const PENDING = 'cho-duyet-uid';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid,
    displayName: `User ${uid}`,
    email: `${uid}@fpt.edu.vn`,
    photoURL: '',
    role: 'user',
    status: 'pending',
    ...over,
  };
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
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin', status: 'active' }));
    await setDoc(doc(db, 'users', APPROVED), profile(APPROVED, { status: 'active' }));
    await setDoc(doc(db, 'users', PENDING), profile(PENDING));
    await setDoc(doc(db, 'support_campuses', 'HN01'), {
      id: 'HN01',
      code: 'HN01',
      name: 'FPT Schools Ha Noi',
      region: 'Mien Bac',
      isActive: true,
    });
    await setDoc(doc(db, 'support_role_assignments', APPROVED), {
      uid: APPROVED,
      campusId: 'HN01',
      supportRole: 'CAMPUS_REPORTER',
      assignedBy: ADMIN,
    });
  });
});

describe('support_campuses', () => {
  it('tài khoản ĐÃ DUYỆT đọc được danh sách trường', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_campuses', 'HN01')));
  });

  it('tài khoản CHỜ DUYỆT KHÔNG đọc được trường nào', async () => {
    // Đây là điểm khác biệt so với collection `users` cũ (ai đăng nhập cũng đọc được).
    const db = testEnv.authenticatedContext(PENDING).firestore();
    await assertFails(getDoc(doc(db, 'support_campuses', 'HN01')));
  });

  it('người dùng thường KHÔNG tạo được trường', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertFails(
      setDoc(doc(db, 'support_campuses', 'HCM01'), {
        id: 'HCM01',
        code: 'HCM01',
        name: 'Tu tao',
        region: '',
        isActive: true,
      })
    );
  });

  it('admin tạo và sửa được trường', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'support_campuses', 'HCM01'), {
        id: 'HCM01',
        code: 'HCM01',
        name: 'FPT Schools HCM',
        region: 'Mien Nam',
        isActive: true,
      })
    );
    await assertSucceeds(updateDoc(doc(db, 'support_campuses', 'HN01'), { isActive: false }));
  });

  it('KHÔNG ai xoá được trường, kể cả admin', async () => {
    // Cố ý: ticket lịch sử trỏ về campus. Tắt bằng isActive, không xoá.
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    const { deleteDoc } = await import('firebase/firestore');
    await assertFails(deleteDoc(doc(db, 'support_campuses', 'HN01')));
  });
});

describe('support_role_assignments — cách ly campus', () => {
  it('người dùng đọc được bản ghi gán quyền của CHÍNH MÌNH', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertSucceeds(getDoc(doc(db, 'support_role_assignments', APPROVED)));
  });

  it('người dùng KHÔNG đọc được bản ghi gán quyền của người khác', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertFails(getDoc(doc(db, 'support_role_assignments', ADMIN)));
  });

  it('người dùng KHÔNG tự gán mình vào trường', async () => {
    // Nếu test này fail thì toàn bộ mô hình phân quyền theo trường vô nghĩa.
    const db = testEnv.authenticatedContext(PENDING).firestore();
    await assertFails(
      setDoc(doc(db, 'support_role_assignments', PENDING), {
        uid: PENDING,
        campusId: 'HN01',
        supportRole: 'CAMPUS_REPORTER',
        assignedBy: PENDING,
      })
    );
  });

  it('người dùng KHÔNG tự đổi sang trường khác', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_role_assignments', APPROVED), { campusId: 'HCM01' })
    );
  });

  it('người dùng KHÔNG tự nâng mình lên SYS_ADMIN', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertFails(
      updateDoc(doc(db, 'support_role_assignments', APPROVED), { supportRole: 'SYS_ADMIN' })
    );
  });

  it('người dùng thường KHÔNG liệt kê được cả collection', async () => {
    const db = testEnv.authenticatedContext(APPROVED).firestore();
    await assertFails(getDocs(collection(db, 'support_role_assignments')));
  });

  it('admin liệt kê được cả collection để dựng hàng đợi duyệt', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(getDocs(collection(db, 'support_role_assignments')));
  });

  it('admin gán được trường cho tài khoản chờ duyệt', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'support_role_assignments', PENDING), {
        uid: PENDING,
        campusId: 'HN01',
        supportRole: 'CAMPUS_FOCAL',
        assignedBy: ADMIN,
      })
    );
  });
});
