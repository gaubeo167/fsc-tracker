import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// "Yêu cầu chưa duyệt cho phép sửa hoặc xoá."
//
// Cửa sổ xoá đúng bằng cửa sổ sửa: TRIAGE và NEEDS_INFO. Từ ACCEPTED trở đi đã
// có người nhận việc và có task chạy trong module Công việc — xoá lúc đó để lại
// một task trỏ về phiếu không còn tồn tại.
//
// Phiếu và bản gương phải chết CÙNG NHAU. Bản gương sống sót nghĩa là phiếu đã
// xoá vẫn hiện ra trong cảnh báo trùng, và người dùng đi tìm một mã không có.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-delete-test';
const ADMIN = 'admin-uid';
const GV = 'giao-vien-hn01';
const GV_KHAC = 'giao-vien-hcm01';
const DEV = 'can-bo-ptud';

let env: RulesTestEnvironment;

const profile = (uid: string, over = {}) => ({
  uid, displayName: uid, email: `${uid}@fpt.edu.vn`, photoURL: '',
  role: 'user', status: 'active', ...over,
});

const ticket = (over = {}) => ({
  ticketNo: 'FSC-WEB_FSB-2608-0001', type: 'BUG', moduleId: 'WEB_FSB', campusId: 'HN01',
  reporterUserId: GV, title: 'Khong dang nhap duoc he thong', description: 'mo ta',
  status: 'TRIAGE', scope: 'CAMPUS_LOCAL', affectedCampusIds: ['HN01'], watcherUids: [GV],
  normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'], createdAt: 1, updatedAt: 1,
  ...over,
});

const indexDoc = (over = {}) => ({
  ticketNo: 'FSC-WEB_FSB-2608-0001', moduleId: 'WEB_FSB', campusId: 'HN01', status: 'TRIAGE',
  title: 'Khong dang nhap duoc he thong', type: 'BUG',
  normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'], createdAt: 1, ...over,
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
    await setDoc(doc(db, 'users', GV), profile(GV));
    await setDoc(doc(db, 'users', GV_KHAC), profile(GV_KHAC));
    await setDoc(doc(db, 'users', DEV), profile(DEV));
    await setDoc(doc(db, 'support_role_assignments', GV),
      { uid: GV, campusId: 'HN01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', GV_KHAC),
      { uid: GV_KHAC, campusId: 'HCM01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', DEV),
      { uid: DEV, campusId: null, supportRole: 'DEVELOPER', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_tickets', 't1'), ticket({ status }));
    await setDoc(doc(db, 'support_ticket_index', 't1'), indexDoc({ status }));
    await setDoc(doc(db, 'support_ticket_numbers', 'FSC-WEB_FSB-2608-0001'),
      { ticketId: 't1', createdAt: 1 });
  });
}

/** Đúng batch mà deleteTicket() gửi đi. */
function batchXoa(db: any) {
  const b = writeBatch(db);
  b.delete(doc(db, 'support_tickets', 't1'));
  b.delete(doc(db, 'support_ticket_index', 't1'));
  return b;
}

describe('xoá yêu cầu chưa được tiếp nhận', () => {
  it('trường xoá được phiếu của mình khi đang CHỜ TIẾP NHẬN', async () => {
    await seed('TRIAGE');
    await assertSucceeds(batchXoa(env.authenticatedContext(GV).firestore()).commit());
  });

  it('trường xoá được phiếu của mình khi đang CẦN BỔ SUNG', async () => {
    await seed('NEEDS_INFO');
    await assertSucceeds(batchXoa(env.authenticatedContext(GV).firestore()).commit());
  });
});

describe('cửa sổ xoá đóng lại sau khi tiếp nhận', () => {
  for (const status of ['ACCEPTED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REJECTED']) {
    it(`⭐ KHÔNG xoá được phiếu đang ${status}`, async () => {
      await seed(status);
      await assertFails(batchXoa(env.authenticatedContext(GV).firestore()).commit());
    });
  }
});

describe('không ai xoá hộ ai', () => {
  it('⭐ giáo viên trường KHÁC không xoá được phiếu của HN01', async () => {
    await seed('TRIAGE');
    await assertFails(batchXoa(env.authenticatedContext(GV_KHAC).firestore()).commit());
  });

  it('cán bộ PTUD không xoá phiếu của trường', async () => {
    // Đầu mối muốn dừng một phiếu thì TỪ CHỐI kèm lý do, để trường biết vì sao.
    // Xoá lặng lẽ là phiếu biến mất và không ai giải thích được chuyện gì xảy ra.
    await seed('TRIAGE');
    await assertFails(batchXoa(env.authenticatedContext(DEV).firestore()).commit());
  });

  it('admin cũng không xoá được', async () => {
    await seed('TRIAGE');
    await assertFails(batchXoa(env.authenticatedContext(ADMIN).firestore()).commit());
  });
});

describe('mã phiếu đã cấp thì không cấp lại', () => {
  it('⭐ xoá phiếu KHÔNG xoá được bản khoá mã', async () => {
    // Trường có thể đã nhắn mã đó cho ai đó qua Zalo. Cấp lại cho phiếu khác là
    // hai yêu cầu khác nhau cùng một mã.
    await seed('TRIAGE');
    const db = env.authenticatedContext(GV).firestore();
    const b = writeBatch(db);
    b.delete(doc(db, 'support_ticket_numbers', 'FSC-WEB_FSB-2608-0001'));
    await assertFails(b.commit());
  });
});
