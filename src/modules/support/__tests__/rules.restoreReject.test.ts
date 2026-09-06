import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Tiếp nhận lại một phiếu đã bị TỪ CHỐI.
//
// Đây là đường sửa lỗi thao tác của phía PTUD: từ chối là nút một chạm nằm
// ngay trên hàng đợi, và bấm nhầm dòng là chuyện xảy ra thật.
//
// Vì sao phải có test rules riêng: nó mở một chiều mà §5 gọi là KHÔNG có —
// REJECTED là trạng thái kết thúc. Chiều đó chỉ được mở cho phía PTUD. Nếu một
// ngày ai đó nới isCampusContentEdit ra cho REJECTED (chẳng hạn để trường
// "gửi lại phiếu bị từ chối"), thì trường tự gỡ được quyết định từ chối của
// đội kỹ thuật và cả bước bắt buộc nhập lý do trở thành vô nghĩa. Test này
// đứng đó để chiều ấy không mở ra bằng một lượt sửa vô tình.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-restore-test';
const ADMIN = 'admin-uid';
const GV = 'giao-vien-hn01';
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

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    for (const u of [GV, DEV]) await setDoc(doc(db, 'users', u), profile(u));
    await setDoc(doc(db, 'support_role_assignments', GV),
      { uid: GV, campusId: 'HN01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', DEV),
      { uid: DEV, campusId: null, supportRole: 'MODULE_OWNER', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_tickets', 't1'), {
      ticketNo: 'FSC-WEB_FSB-2609-0001', type: 'BUG', moduleId: 'WEB_FSB', campusId: 'HN01',
      reporterUserId: GV, campusContactUserId: null,
      title: 'Khong dang nhap duoc', description: 'x',
      status: 'REJECTED', scope: 'CAMPUS_LOCAL', affectedCampusIds: ['HN01'], watcherUids: [GV],
      assigneeUserId: null, triagedBy: DEV, triagedAt: 2, reopenCount: 0,
      rejectionReason: 'Day la thao tac dung theo quy trinh, khong phai loi he thong.',
      needsInfoRequest: '',
      normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'],
      lastMessageAt: null, lastMessageBy: null, lastMessageSide: null,
      slaStartedAt: 1, slaElapsedWorkingMs: 0, slaLastResumedAt: 1,
      resolvedAt: null, closedAt: 2, createdAt: 1, updatedAt: 2,
    });
    await setDoc(doc(db, 'support_ticket_index', 't1'), {
      ticketNo: 'FSC-WEB_FSB-2609-0001', moduleId: 'WEB_FSB', campusId: 'HN01', status: 'REJECTED',
      title: 'Khong dang nhap duoc', type: 'BUG',
      normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'], createdAt: 1,
    });
  });
});

/**
 * Đúng những lượt ghi mà restoreRejectedTicket() gửi đi.
 *
 * Chép nguyên hình dạng thật chứ không rút gọn: test một lượt update trần sẽ
 * xanh trong khi lượt ghi thật vẫn hỏng, vì rules từ chối ở document khác —
 * đúng lớp lỗi đã xảy ra với bản gương support_ticket_index.
 */
function batchTiepNhanLai(db: any, actor: string) {
  const b = writeBatch(db);
  b.update(doc(db, 'support_tickets', 't1'), {
    status: 'TRIAGE', rejectionReason: '', closedAt: null,
    triagedBy: null, triagedAt: null, slaLastResumedAt: 1, updatedAt: 9,
  });
  b.update(doc(db, 'support_ticket_index', 't1'), { status: 'TRIAGE' });
  b.set(doc(collection(db, 'support_tickets', 't1', 'messages')), {
    authorUid: actor, authorName: actor, authorSide: 'PTUD',
    body: 'Đã tiếp nhận lại phiếu. Phiếu quay về hàng đợi chờ tiếp nhận.',
    attachments: [], isSystem: true, createdAt: 9,
  });
  b.set(doc(collection(db, 'notifications')), {
    targetUserId: GV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2609-0001',
    message: 'Yêu cầu đã được tiếp nhận lại', read: false, time: new Date(),
  });
  return b;
}

describe('tiếp nhận lại phiếu bị từ chối', () => {
  it('đầu mối phân hệ gỡ được lượt từ chối', async () => {
    const db = env.authenticatedContext(DEV, { email: `${DEV}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertSucceeds(batchTiepNhanLai(db, DEV).commit());
  });

  it('admin gỡ được lượt từ chối', async () => {
    const db = env.authenticatedContext(ADMIN, { email: `${ADMIN}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertSucceeds(batchTiepNhanLai(db, ADMIN).commit());
  });

  // Đây là vế quan trọng nhất của cả file. Trường tự gỡ được lượt từ chối
  // nghĩa là quyết định của đội kỹ thuật không có hiệu lực gì.
  it('cán bộ trường KHÔNG gỡ được, dù là phiếu của trường mình', async () => {
    const db = env.authenticatedContext(GV, { email: `${GV}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertFails(batchTiepNhanLai(db, GV).commit());
  });

  it('cán bộ trường KHÔNG tự đổi được trạng thái phiếu bị từ chối về hàng đợi', async () => {
    const db = env.authenticatedContext(GV, { email: `${GV}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't1'), { status: 'TRIAGE', updatedAt: 9 }));
  });

  // Cửa hậu tinh vi hơn: không đổi trạng thái, chỉ xoá lý do từ chối để phiếu
  // trông như chưa từng bị từ chối. Cùng nhóm field, cùng phải chặn.
  it('cán bộ trường KHÔNG xoá được lý do từ chối', async () => {
    const db = env.authenticatedContext(GV, { email: `${GV}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't1'), { rejectionReason: '', updatedAt: 9 }));
  });

  // Dòng ghi việc mang cờ isSystem. Trường đặt được cờ đó là giả giọng hệ thống
  // ngay trên hồ sơ xử lý sự cố — xem ghi chú ở nhánh create của messages.
  it('cán bộ trường KHÔNG ghi được dòng "hệ thống" vào luồng trao đổi', async () => {
    const db = env.authenticatedContext(GV, { email: `${GV}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertFails(setDoc(doc(collection(db, 'support_tickets', 't1', 'messages')), {
      authorUid: GV, authorName: GV, authorSide: 'CAMPUS',
      body: 'Đã tiếp nhận lại phiếu.', attachments: [], isSystem: true, createdAt: 9,
    }));
  });

  it('cán bộ trường KHÔNG sửa được bản gương của phiếu bị từ chối', async () => {
    const db = env.authenticatedContext(GV, { email: `${GV}@fpt.edu.vn`, email_verified: true }).firestore();
    await assertFails(updateDoc(doc(db, 'support_ticket_index', 't1'), { status: 'TRIAGE' }));
  });
});
