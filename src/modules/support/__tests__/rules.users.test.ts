import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ===========================================================================
// Cổng duyệt tài khoản — test tầng firestore.rules, KHÔNG phải tầng UI.
//
// Vì sao test ở đây: ẩn nút trên giao diện không phải là bảo mật. Người dùng mở
// devtools gọi thẳng Firestore là bỏ qua toàn bộ React. Thứ duy nhất thật sự chặn
// được là firestore.rules, nên đây là chỗ duy nhất đáng viết test cho nó.
//
// Chạy: npx firebase emulators:exec --only firestore "npm test"
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-rules-test';
const ADMIN_UID = 'admin-uid';
const NEW_UID = 'nguoi-moi-uid';
const OTHER_UID = 'nguoi-khac-uid';

let testEnv: RulesTestEnvironment;

/** Hồ sơ hợp lệ tối thiểu, khớp UserProfile trong src/types.ts */
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
  // Seed sẵn: 1 admin và 1 tài khoản đã được duyệt, ghi bằng đường bỏ qua rules.
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN_UID), profile(ADMIN_UID, { role: 'admin', status: 'active' }));
    await setDoc(doc(db, 'users', OTHER_UID), profile(OTHER_UID, { status: 'active' }));
  });
});

describe('Cổng duyệt tài khoản', () => {
  it('người mới TẠO ĐƯỢC hồ sơ của chính mình ở trạng thái pending', async () => {
    const db = testEnv.authenticatedContext(NEW_UID).firestore();
    await assertSucceeds(setDoc(doc(db, 'users', NEW_UID), profile(NEW_UID)));
  });

  it('người mới KHÔNG tự tạo được hồ sơ ở trạng thái active', async () => {
    // Đây là cổng. Không có ràng buộc này thì tài khoản mới tự kích hoạt lúc đăng nhập.
    const db = testEnv.authenticatedContext(NEW_UID).firestore();
    await assertFails(setDoc(doc(db, 'users', NEW_UID), profile(NEW_UID, { status: 'active' })));
  });

  it('người mới KHÔNG tự tạo được hồ sơ với role admin', async () => {
    const db = testEnv.authenticatedContext(NEW_UID).firestore();
    await assertFails(setDoc(doc(db, 'users', NEW_UID), profile(NEW_UID, { role: 'admin' })));
  });

  it('tài khoản pending KHÔNG tự nâng mình lên active', async () => {
    // Lỗ hổng cũ: 'status' từng nằm trong danh sách field người dùng tự sửa được.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', NEW_UID), profile(NEW_UID));
    });
    const db = testEnv.authenticatedContext(NEW_UID).firestore();
    await assertFails(updateDoc(doc(db, 'users', NEW_UID), { status: 'active' }));
  });

  it('người dùng KHÔNG tự nâng role của mình', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();
    await assertFails(updateDoc(doc(db, 'users', OTHER_UID), { role: 'admin' }));
  });

  it('người dùng KHÔNG sửa được hồ sơ của người khác', async () => {
    const db = testEnv.authenticatedContext(NEW_UID).firestore();
    await assertFails(updateDoc(doc(db, 'users', OTHER_UID), { displayName: 'Bi doi ten' }));
  });

  it('người dùng SỬA ĐƯỢC tên hiển thị và ảnh của chính mình', async () => {
    const db = testEnv.authenticatedContext(OTHER_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(db, 'users', OTHER_UID), { displayName: 'Ten moi', photoURL: 'https://x/y.png' })
    );
  });

  it('admin DUYỆT ĐƯỢC tài khoản: đổi status sang active', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users', NEW_UID), profile(NEW_UID));
    });
    const db = testEnv.authenticatedContext(ADMIN_UID).firestore();
    await assertSucceeds(updateDoc(doc(db, 'users', NEW_UID), { status: 'active' }));

    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const snap = await getDoc(doc(ctx.firestore(), 'users', NEW_UID));
      expect(snap.data()?.status).toBe('active');
    });
  });

  it('người CHƯA đăng nhập không đọc được hồ sơ nào', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'users', OTHER_UID)));
  });
});
