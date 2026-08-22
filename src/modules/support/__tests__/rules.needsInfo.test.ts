import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Vòng "hỏi thêm thông tin": đầu mối hỏi -> trường được BÁO -> trường bổ sung
// -> phiếu quay lại hàng đợi -> người hỏi được BÁO.
//
// Test này ra đời từ một lỗi thật: rules cho phép trường sửa NỘI DUNG phiếu và
// đổi status NEEDS_INFO -> TRIAGE trên document phiếu, nhưng BẢN GƯƠNG
// support_ticket_index lại không cho đổi 'status'. Hai lượt ghi nằm chung một
// batch, nên cả batch bị từ chối và trường KHÔNG BAO GIỜ gửi lại được phiếu.
// Trên giao diện chỉ hiện "permission-denied", không có gì chỉ ra rằng nguyên
// nhân nằm ở một collection khác.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-needsinfo-test';
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

beforeEach(async () => {
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

    await setDoc(doc(db, 'support_tickets', 't1'), {
      ticketNo: 'FSC-WEB_FSB-2608-0001', type: 'BUG', moduleId: 'WEB_FSB', campusId: 'HN01',
      reporterUserId: GV, title: 'Khong dang nhap duoc he thong', description: 'mo ta',
      status: 'TRIAGE', scope: 'CAMPUS_LOCAL', affectedCampusIds: ['HN01'], watcherUids: [GV],
      needsInfoRequest: '', normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'],
      slaElapsedWorkingMs: 0, createdAt: 1, updatedAt: 1,
    });
    await setDoc(doc(db, 'support_ticket_index', 't1'), {
      ticketNo: 'FSC-WEB_FSB-2608-0001', moduleId: 'WEB_FSB', campusId: 'HN01', status: 'TRIAGE',
      normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'], createdAt: 1,
    });
  });
});

/** Đúng batch mà requestMoreInfo() gửi đi. */
function batchHoiThem(db: any) {
  const b = writeBatch(db);
  b.update(doc(db, 'support_tickets', 't1'), {
    status: 'NEEDS_INFO', needsInfoRequest: 'Gui giup anh chup man hinh luc gap loi',
    needsInfoBy: DEV, slaLastResumedAt: null, slaElapsedWorkingMs: 0, updatedAt: 2,
  });
  b.update(doc(db, 'support_ticket_index', 't1'), { status: 'NEEDS_INFO' });
  b.set(doc(collection(db, 'notifications')), {
    targetUserId: GV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001', read: false,
    message: 'Yêu cầu FSC-WEB_FSB-2608-0001 cần bạn bổ sung thông tin: Gui giup anh chup man hinh',
    time: new Date(),
  });
  return b;
}

/** Đúng batch mà updateTicketContent() gửi đi khi phiếu đang NEEDS_INFO. */
function batchBoSung(db: any) {
  const b = writeBatch(db);
  b.update(doc(db, 'support_tickets', 't1'), {
    title: 'Khong dang nhap duoc he thong diem danh', description: 'mo ta day du hon',
    normalizedTitle: 'b', titleTokens: ['b'], bodyTokens: ['b'],
    status: 'TRIAGE', slaLastResumedAt: 3, needsInfoRequest: '', updatedAt: 3,
  });
  b.update(doc(db, 'support_ticket_index', 't1'), {
    normalizedTitle: 'b', titleTokens: ['b'], bodyTokens: ['b'], status: 'TRIAGE',
  });
  b.set(doc(collection(db, 'notifications')), {
    targetUserId: DEV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001', read: false,
    message: 'Trường đã bổ sung thông tin cho yêu cầu FSC-WEB_FSB-2608-0001.', time: new Date(),
  });
  return b;
}

async function datPhieuVeNeedsInfo() {
  await env.withSecurityRulesDisabled(async (c) => {
    const db = c.firestore();
    await setDoc(doc(db, 'support_tickets', 't1'),
      { status: 'NEEDS_INFO', needsInfoBy: DEV, needsInfoRequest: 'Gui anh chup man hinh' },
      { merge: true });
    await setDoc(doc(db, 'support_ticket_index', 't1'), { status: 'NEEDS_INFO' }, { merge: true });
  });
}

describe('đầu mối hỏi thêm thông tin', () => {
  it('cán bộ PTUD gửi được cả cụm: đổi phiếu + bản gương + thông báo', async () => {
    await assertSucceeds(batchHoiThem(env.authenticatedContext(DEV).firestore()).commit());
  });

  it('giáo viên KHÔNG tự đẩy phiếu mình sang NEEDS_INFO', async () => {
    await assertFails(batchHoiThem(env.authenticatedContext(GV).firestore()).commit());
  });
});

describe('trường bổ sung xong và gửi lại', () => {
  beforeEach(datPhieuVeNeedsInfo);

  it('⭐ gửi lại được — cả phiếu, bản gương và thông báo trong một batch', async () => {
    // Đây là ca đã từng hỏng: bản gương không cho đổi 'status' nên cả batch bị
    // chặn, biến NEEDS_INFO thành ngõ cụt.
    await assertSucceeds(batchBoSung(env.authenticatedContext(GV).firestore()).commit());
  });

  it('giáo viên trường KHÁC không sửa được phiếu này', async () => {
    await assertFails(batchBoSung(env.authenticatedContext(GV_KHAC).firestore()).commit());
  });

  it('không tự nâng phiếu lên ACCEPTED qua bản gương', async () => {
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_ticket_index', 't1'), { status: 'ACCEPTED' }, { merge: true })
    );
  });

  it('không tự nâng phiếu lên ACCEPTED trên chính phiếu', async () => {
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'), { status: 'ACCEPTED', updatedAt: 4 }, { merge: true })
    );
  });

  it('⭐ trường KHÔNG ghi đè được câu hỏi của đầu mối', async () => {
    // needsInfoRequest là LỜI CỦA NGƯỜI KHÁC. Cho trường ghi đè nghĩa là màn
    // tiếp nhận hiện ra câu mà đầu mối chưa từng viết — và đầu mối không có
    // cách nào biết câu hỏi của mình đã bị thay.
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'),
        { needsInfoRequest: 'tu bien lai cau hoi', updatedAt: 4 }, { merge: true })
    );
  });

  it('⭐ trường KHÔNG tự bấm đồng hồ SLA của phiếu mình', async () => {
    // slaLastResumedAt quyết định phiếu có bị tính quá hạn hay không. Cho bên
    // GỬI yêu cầu ghi tự do nghĩa là cảnh báo quá hạn của đội kỹ thuật chạy
    // theo con số do chính người đi đòi đặt ra.
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'),
        { slaLastResumedAt: 999, updatedAt: 4 }, { merge: true })
    );
  });

  it('bổ sung xong phải XOÁ câu hỏi, không được giữ lại', async () => {
    // Giữ lại câu hỏi cũ thì phiếu quay về hàng đợi mà vẫn mang dòng "đang chờ
    // trường bổ sung", và đầu mối tưởng trường chưa trả lời.
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(
      setDoc(doc(db, 'support_tickets', 't1'),
        { status: 'TRIAGE', needsInfoRequest: 'van giu cau hoi cu',
          slaLastResumedAt: 5, updatedAt: 5 }, { merge: true })
    );
  });
});

describe('thông báo tới đúng người', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), 'notifications', 'n1'), {
        targetUserId: GV, ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001',
        message: 'Yêu cầu cần bạn bổ sung thông tin', read: false, time: new Date(),
      });
    });
  });

  it('người tạo yêu cầu đọc được thông báo của mình', async () => {
    await assertSucceeds(getDoc(doc(env.authenticatedContext(GV).firestore(), 'notifications', 'n1')));
  });

  it('⭐ người khác KHÔNG đọc được thông báo đó', async () => {
    // Nội dung thông báo mang nguyên văn câu hỏi của đầu mối, tức là một mẩu
    // nội dung phiếu. Để lọt sang tài khoản trường khác là thủng cách ly campus
    // qua một cửa sau.
    await assertFails(getDoc(doc(env.authenticatedContext(GV_KHAC).firestore(), 'notifications', 'n1')));
  });

  it('người tạo yêu cầu đánh dấu đã đọc được', async () => {
    const db = env.authenticatedContext(GV).firestore();
    await assertSucceeds(setDoc(doc(db, 'notifications', 'n1'), { read: true }, { merge: true }));
  });
});
