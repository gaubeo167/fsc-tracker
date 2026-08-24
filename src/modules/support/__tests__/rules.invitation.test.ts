import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Duyệt trước: admin ghi sẵn quyền cho một email, người đó đăng nhập là nhận.
//
// Đây là đường DUY NHẤT trong hệ thống cho phép một tài khoản tự nâng quyền của
// chính mình. Nên nó phải hẹp đến mức không còn chỗ nào để lách:
//   - chỉ admin ghi được thư mời
//   - doc id LÀ email, nên không trỏ sang thư mời của người khác được
//   - giá trị nhận phải khớp CHÍNH XÁC thứ admin đã ghi
//   - thư mời hết hạn thì vô hiệu
//   - dùng rồi thì không dùng lại được
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-invite-test';
const ADMIN = 'admin-uid';
const MOI = 'nguoi-duoc-moi';
const KHAC = 'nguoi-khac';
const EMAIL_MOI = 'nguoimoi@fpt.edu.vn';
const EMAIL_KHAC = 'nguoikhac@fpt.edu.vn';

let env: RulesTestEnvironment;
const SAU = Date.now() + 30 * 24 * 3600_000;
const TRUOC = Date.now() - 1000;

const ctx = (uid: string, email: string) =>
  env.authenticatedContext(uid, { email, email_verified: true }).firestore();

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
  });
});
afterAll(async () => { await env?.cleanup(); });

async function seed(over: Record<string, unknown> = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', ADMIN), {
      uid: ADMIN, displayName: 'A', email: 'admin@fpt.edu.vn', photoURL: '',
      role: 'admin', status: 'active',
    });
    await setDoc(doc(db, 'invitations', EMAIL_MOI), {
      email: EMAIL_MOI, role: 'manager', supportRole: 'CAMPUS_FOCAL', campusId: 'HN01',
      status: 'pending', invitedBy: ADMIN, invitedAt: 1, expiresAt: SAU, ...over,
    });
  });
}

const hoSo = (uid: string, email: string, over: Record<string, unknown> = {}) => ({
  uid, displayName: 'X', email, photoURL: '', role: 'manager', status: 'active', ...over,
});

describe('nhận quyền đã được cấp trước', () => {
  it('⭐ đăng nhập lần đầu là có ngay quyền đã ghi sẵn', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertSucceeds(setDoc(doc(db, 'users', MOI), hoSo(MOI, EMAIL_MOI)));
  });

  it('⭐ nhận luôn được bản gán trường kèm theo', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertSucceeds(setDoc(doc(db, 'support_role_assignments', MOI), {
      uid: MOI, campusId: 'HN01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN, assignedAt: new Date(),
    }));
  });

  it('đóng được thư mời của chính mình sau khi nhận', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertSucceeds(setDoc(doc(db, 'invitations', EMAIL_MOI),
      { status: 'accepted', acceptedUid: MOI, acceptedAt: 2 }, { merge: true }));
  });

  it('người được mời đọc được thư của mình', async () => {
    await seed();
    await assertSucceeds(getDoc(doc(ctx(MOI, EMAIL_MOI), 'invitations', EMAIL_MOI)));
  });
});

describe('không có đường nào lách', () => {
  it('⭐ KHÔNG tự nâng quyền cao hơn thứ admin đã ghi', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertFails(setDoc(doc(db, 'users', MOI), hoSo(MOI, EMAIL_MOI, { role: 'admin' })));
  });

  it('⭐ KHÔNG dùng thư mời của người khác', async () => {
    await seed();
    // Đăng nhập bằng email khác, cố nhận thư mời của nguoimoi@
    const db = ctx(KHAC, EMAIL_KHAC);
    await assertFails(setDoc(doc(db, 'users', KHAC), hoSo(KHAC, EMAIL_KHAC)));
  });

  it('⭐ KHÔNG đọc trộm thư mời của người khác', async () => {
    await seed();
    await assertFails(getDoc(doc(ctx(KHAC, EMAIL_KHAC), 'invitations', EMAIL_MOI)));
  });

  it('⭐ thư mời HẾT HẠN thì vô hiệu', async () => {
    await seed({ expiresAt: TRUOC });
    const db = ctx(MOI, EMAIL_MOI);
    await assertFails(setDoc(doc(db, 'users', MOI), hoSo(MOI, EMAIL_MOI)));
  });

  it('⭐ thư mời ĐÃ DÙNG thì không dùng lại', async () => {
    await seed({ status: 'accepted' });
    const db = ctx(MOI, EMAIL_MOI);
    await assertFails(setDoc(doc(db, 'users', MOI), hoSo(MOI, EMAIL_MOI)));
  });

  it('⭐ KHÔNG nhận trường khác với trường admin đã ghi', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertFails(setDoc(doc(db, 'support_role_assignments', MOI), {
      uid: MOI, campusId: 'HCM01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN, assignedAt: new Date(),
    }));
  });

  it('⭐ KHÔNG nhận loại thành viên khác thứ đã ghi', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertFails(setDoc(doc(db, 'support_role_assignments', MOI), {
      uid: MOI, campusId: 'HN01', supportRole: 'SYS_ADMIN', assignedBy: ADMIN, assignedAt: new Date(),
    }));
  });

  it('người được mời KHÔNG tự sửa quyền trong thư mời của mình', async () => {
    await seed();
    const db = ctx(MOI, EMAIL_MOI);
    await assertFails(setDoc(doc(db, 'invitations', EMAIL_MOI), { role: 'admin' }, { merge: true }));
  });

  it('không phải admin thì không cấp quyền trước cho ai', async () => {
    await seed();
    const db = ctx(KHAC, EMAIL_KHAC);
    await assertFails(setDoc(doc(db, 'invitations', 'aikhac@fpt.edu.vn'), {
      email: 'aikhac@fpt.edu.vn', role: 'admin', supportRole: '', campusId: null,
      status: 'pending', invitedBy: KHAC, invitedAt: 1, expiresAt: SAU,
    }));
  });

  it('không có thư mời thì vẫn phải chờ duyệt như cũ', async () => {
    await seed();
    const db = ctx(KHAC, EMAIL_KHAC);
    await assertSucceeds(setDoc(doc(db, 'users', KHAC),
      hoSo(KHAC, EMAIL_KHAC, { role: 'user', status: 'pending' })));
  });
});
