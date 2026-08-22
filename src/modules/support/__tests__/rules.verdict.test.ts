import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Vòng nghiệm thu: đội xử lý báo XONG -> trường xác nhận ĐÓNG, hoặc MỞ LẠI.
//
// Vì sao phải mở quyền cho phía trường: người sửa lỗi KHÔNG phải người biết lỗi
// đã hết hay chưa. Nếu chỉ phía PTUD đóng được thì "đã xong" là lời tự khai của
// chính người làm, và trường không có đường nào nói ngược lại.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-verdict-test';
const ADMIN = 'admin-uid';
const GV = 'giao-vien-hn01';
const GV_KHAC = 'giao-vien-hcm01';
const DEV = 'can-bo-ptud';

let env: RulesTestEnvironment;

const profile = (uid: string, over = {}) => ({
  uid, displayName: uid, email: `${uid}@fpt.edu.vn`, photoURL: '',
  role: 'user', status: 'active', ...over,
});

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

async function seed(status: string) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    for (const u of [GV, GV_KHAC, DEV]) await setDoc(doc(db, 'users', u), profile(u));
    await setDoc(doc(db, 'support_role_assignments', GV),
      { uid: GV, campusId: 'HN01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', GV_KHAC),
      { uid: GV_KHAC, campusId: 'HCM01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', DEV),
      { uid: DEV, campusId: null, supportRole: 'DEVELOPER', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_tickets', 't1'), {
      ticketNo: 'FSC-WEB_FSB-2608-0001', type: 'BUG', moduleId: 'WEB_FSB', campusId: 'HN01',
      reporterUserId: GV, title: 'Khong dang nhap duoc', description: 'x',
      status, scope: 'CAMPUS_LOCAL', affectedCampusIds: ['HN01'], watcherUids: [GV],
      assigneeUserId: DEV, triagedBy: DEV, reopenCount: 0, needsInfoRequest: '',
      normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'],
      resolvedAt: status === 'RESOLVED' ? 2 : null, closedAt: null,
      createdAt: 1, updatedAt: 1,
    });
    await setDoc(doc(db, 'support_ticket_index', 't1'), {
      ticketNo: 'FSC-WEB_FSB-2608-0001', moduleId: 'WEB_FSB', campusId: 'HN01', status,
      title: 'Khong dang nhap duoc', type: 'BUG',
      normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'], createdAt: 1,
    });
  });
}

/** Đúng batch mà confirmTicketClosed() gửi đi. */
function batchDong(db: any) {
  const b = writeBatch(db);
  b.update(doc(db, 'support_tickets', 't1'), { status: 'CLOSED', closedAt: 3, updatedAt: 3 });
  b.update(doc(db, 'support_ticket_index', 't1'), { status: 'CLOSED' });
  b.set(doc(collection(db, 'notifications')), {
    targetUserId: DEV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001',
    message: 'Trường đã xác nhận hết lỗi', read: false, time: new Date(),
  });
  return b;
}

/** Đúng batch mà reopenTicket() gửi đi. */
function batchMoLai(db: any) {
  const b = writeBatch(db);
  b.update(doc(db, 'support_tickets', 't1'), {
    status: 'REOPENED', reopenCount: 1, needsInfoRequest: 'Van con loi o phong 201',
    resolvedAt: null, slaLastResumedAt: 3, updatedAt: 3,
  });
  b.update(doc(db, 'support_ticket_index', 't1'), { status: 'REOPENED' });
  b.set(doc(collection(db, 'notifications')), {
    targetUserId: DEV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001',
    message: 'Van con loi', read: false, time: new Date(),
  });
  return b;
}

describe('trường nghiệm thu phiếu đã báo xử lý xong', () => {
  it('⭐ trường ĐÓNG được phiếu đang ở trạng thái đã khắc phục', async () => {
    await seed('RESOLVED');
    await assertSucceeds(batchDong(env.authenticatedContext(GV).firestore()).commit());
  });

  it('⭐ trường MỞ LẠI được phiếu khi vẫn còn lỗi', async () => {
    await seed('RESOLVED');
    await assertSucceeds(batchMoLai(env.authenticatedContext(GV).firestore()).commit());
  });

  it('trường KHÁC không nghiệm thu hộ phiếu của HN01', async () => {
    await seed('RESOLVED');
    await assertFails(batchDong(env.authenticatedContext(GV_KHAC).firestore()).commit());
  });
});

describe('cửa nghiệm thu chỉ mở đúng lúc', () => {
  for (const status of ['TRIAGE', 'ACCEPTED', 'IN_PROGRESS', 'CLOSED', 'REJECTED']) {
    it(`⭐ trường KHÔNG tự đóng phiếu đang ${status}`, async () => {
      await seed(status);
      await assertFails(batchDong(env.authenticatedContext(GV).firestore()).commit());
    });
  }

  it('⭐ trường không nhảy thẳng từ đã khắc phục sang đã tiếp nhận', async () => {
    // Chỉ hai đích được phép: CLOSED và REOPENED. Mọi chiều khác là tự thay đổi
    // tiến trình xử lý phiếu của mình.
    await seed('RESOLVED');
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'), { status: 'ACCEPTED', updatedAt: 3 }, { merge: true })
    );
  });

  it('trường không sửa lén nội dung khi đang nghiệm thu', async () => {
    await seed('RESOLVED');
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'),
        { status: 'CLOSED', closedAt: 3, title: 'Doi tieu de len', updatedAt: 3 }, { merge: true })
    );
  });
});

describe('phía kỹ thuật báo xử lý xong', () => {
  it('cán bộ PTUD đặt được phiếu sang đã khắc phục', async () => {
    await seed('ACCEPTED');
    const db = env.authenticatedContext(DEV).firestore();
    const b = writeBatch(db);
    b.update(doc(db, 'support_tickets', 't1'),
      { status: 'RESOLVED', resolvedAt: 3, slaLastResumedAt: null, updatedAt: 3 });
    b.update(doc(db, 'support_ticket_index', 't1'), { status: 'RESOLVED' });
    b.set(doc(collection(db, 'notifications')), {
      targetUserId: GV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001',
      message: 'Da xu ly xong', read: false, time: new Date(),
    });
    await assertSucceeds(b.commit());
  });

  it('⭐ trường KHÔNG tự đặt phiếu của mình sang đã khắc phục', async () => {
    await seed('ACCEPTED');
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'),
        { status: 'RESOLVED', resolvedAt: 3, updatedAt: 3 }, { merge: true })
    );
  });
});
