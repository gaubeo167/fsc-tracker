import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// ===========================================================================
// Trao đổi trên phiếu: support_tickets/{id}/messages
//
// Hai thứ file này canh, và cả hai đều là chỗ dễ hỏng ngầm:
//
// 1. QUYỀN ĐỌC phải bám ĐÚNG quyền đọc phiếu cha. Nội dung trao đổi thường
//    nhạy cảm hơn cả phiếu — đây là chỗ người ta dán tên học sinh, mã lớp, số
//    điện thoại phụ huynh khi kỹ thuật viên hỏi "trường hợp cụ thể nào".
//    Nếu quyền hai chỗ lệch nhau thì phiếu vẫn khoá đúng trong khi cuộc trao
//    đổi rò ra rộng hơn, và không ai nhận ra vì màn phiếu trông vẫn bình thường.
//
// 2. LỊCH SỬ KHÔNG SỬA ĐƯỢC. Đây là hồ sơ xử lý sự cố. Sửa được lời mình đã nói
//    sau khi người khác đã hành động theo lời đó thì nó không còn chứng minh
//    được gì.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-messages-test';
const ADMIN = 'admin-uid';
/** Cán bộ trường HN01 — chủ phiếu. */
const GV = 'giao-vien-hn01';
/** Cán bộ trường HCM01 — không liên quan tới phiếu. */
const GV_KHAC = 'giao-vien-hcm01';
const DEV = 'can-bo-ptud';

let env: RulesTestEnvironment;

const profile = (uid: string, over = {}) => ({
  uid, displayName: uid, email: `${uid}@fpt.edu.vn`, photoURL: '',
  role: 'user', status: 'active', ...over,
});

const tinHopLe = (uid: string, over = {}) => ({
  authorUid: uid,
  authorName: 'Nguoi gui',
  authorSide: 'CAMPUS',
  body: 'Loi van con, em gui them anh chup man hinh',
  attachments: [],
  isSystem: false,
  createdAt: 1000,
  ...over,
});

function tin(ctx: ReturnType<RulesTestEnvironment['authenticatedContext']>, ticketId = 't1') {
  return collection(ctx.firestore(), 'support_tickets', ticketId, 'messages');
}

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
    for (const uid of [GV, GV_KHAC, DEV]) await setDoc(doc(db, 'users', uid), profile(uid));
    await setDoc(doc(db, 'support_role_assignments', GV),
      { uid: GV, campusId: 'HN01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', GV_KHAC),
      { uid: GV_KHAC, campusId: 'HCM01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN });
    await setDoc(doc(db, 'support_role_assignments', DEV),
      { uid: DEV, campusId: null, supportRole: 'DEVELOPER', assignedBy: ADMIN });

    const phieu = {
      ticketNo: 'FSC-WEB_FSB-2609-0001', type: 'BUG', moduleId: 'WEB_FSB', campusId: 'HN01',
      reporterUserId: GV, title: 'Khong diem danh duoc', description: 'mo ta',
      status: 'TRIAGE', scope: 'CAMPUS_LOCAL', affectedCampusIds: ['HN01'], watcherUids: [GV],
      needsInfoRequest: '', normalizedTitle: 'a', titleTokens: ['a'], bodyTokens: ['a'],
      slaElapsedWorkingMs: 0, createdAt: 1, updatedAt: 1,
    };
    await setDoc(doc(db, 'support_tickets', 't1'), phieu);
    // Phiếu toàn hệ thống, HCM01 nằm trong danh sách bị ảnh hưởng.
    await setDoc(doc(db, 'support_tickets', 't2'), {
      ...phieu, ticketNo: 'FSC-WEB_FSB-2609-0002', scope: 'SYSTEM_WIDE',
      affectedCampusIds: ['HN01', 'HCM01'],
    });
    // Một tin có sẵn, để thử đọc / sửa / xoá.
    await setDoc(doc(db, 'support_tickets', 't1', 'messages', 'm1'), tinHopLe(GV));
  });
});

describe('đọc trao đổi: bám đúng quyền đọc phiếu cha', () => {
  it('cán bộ trường sở hữu phiếu đọc được', async () => {
    await assertSucceeds(getDocs(tin(env.authenticatedContext(GV))));
  });

  it('nhân sự PTUD đọc được — họ là người xử lý', async () => {
    await assertSucceeds(getDocs(tin(env.authenticatedContext(DEV))));
  });

  it('admin đọc được', async () => {
    await assertSucceeds(getDocs(tin(env.authenticatedContext(ADMIN))));
  });

  it('trường KHÁC không đọc được trao đổi của phiếu trường này', async () => {
    // Đây là phép kiểm quan trọng nhất của file: cuộc trao đổi là nơi thông tin
    // cá nhân học sinh xuất hiện dày nhất.
    await assertFails(getDocs(tin(env.authenticatedContext(GV_KHAC))));
  });

  it('phiếu SYSTEM_WIDE: trường nằm trong danh sách bị ảnh hưởng thì đọc được', async () => {
    await assertSucceeds(getDocs(tin(env.authenticatedContext(GV_KHAC), 't2')));
  });

  it('người chưa đăng nhập không đọc được', async () => {
    await assertFails(getDocs(tin(env.unauthenticatedContext() as never)));
  });
});

describe('gửi tin', () => {
  it('cán bộ trường sở hữu phiếu gửi được', async () => {
    await assertSucceeds(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(GV)));
  });

  it('nhân sự PTUD gửi được', async () => {
    await assertSucceeds(
      addDoc(tin(env.authenticatedContext(DEV)), tinHopLe(DEV, { authorSide: 'PTUD' }))
    );
  });

  it('KHÔNG mạo danh được người khác', async () => {
    // authorUid là thứ duy nhất dùng để phán "ai đã nói câu này". Không ghim nó
    // thì bất kỳ ai gửi được tin cũng viết được lời vào miệng người khác trên
    // chính hồ sơ xử lý sự cố.
    await assertFails(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(DEV)));
  });

  it('trường KHÁC không gửi được vào phiếu không phải của mình', async () => {
    await assertFails(addDoc(tin(env.authenticatedContext(GV_KHAC)), tinHopLe(GV_KHAC)));
  });

  it('tin rỗng, không kèm gì, bị chặn', async () => {
    await assertFails(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(GV, { body: '' })));
  });

  it('tin rỗng NHƯNG có đính kèm thì được — gửi ảnh không kèm lời là bình thường', async () => {
    await assertSucceeds(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(GV, {
      body: '',
      attachments: [{ kind: 'file', path: 'support-tickets/HN01/d/a.jpg', url: '', name: 'a.jpg',
        sizeBytes: 100, contentType: 'image/jpeg', uploadedBy: GV, uploadedAt: 1 }],
    })));
  });

  it('tin vượt 2000 ký tự bị chặn', async () => {
    await assertFails(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(GV, { body: 'x'.repeat(2001) })));
  });

  it('quá 10 đính kèm trong một tin bị chặn', async () => {
    const mot = { kind: 'file', path: 'p', url: '', name: 'a', sizeBytes: 1,
      contentType: 'image/jpeg', uploadedBy: GV, uploadedAt: 1 };
    await assertFails(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(GV, {
      attachments: Array.from({ length: 11 }, () => mot),
    })));
  });
});

describe('cờ tin hệ thống', () => {
  it('cán bộ trường KHÔNG tự đặt cờ hệ thống được', async () => {
    // Cờ này đổi cách hiển thị thành dòng ghi việc. Ai đặt được nó thì giả được
    // giọng của hệ thống ngay trong hồ sơ xử lý sự cố.
    await assertFails(addDoc(tin(env.authenticatedContext(GV)), tinHopLe(GV, { isSystem: true })));
  });

  it('nhân sự PTUD đặt được — họ là người bấm những nút sinh ra loại tin đó', async () => {
    await assertSucceeds(
      addDoc(tin(env.authenticatedContext(DEV)), tinHopLe(DEV, { authorSide: 'PTUD', isSystem: true }))
    );
  });
});

describe('lịch sử là bằng chứng', () => {
  it('người viết KHÔNG sửa được tin của chính mình', async () => {
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't1', 'messages', 'm1'), { body: 'sua lai' }));
  });

  it('người viết KHÔNG xoá được tin của chính mình', async () => {
    const db = env.authenticatedContext(GV).firestore();
    await assertFails(deleteDoc(doc(db, 'support_tickets', 't1', 'messages', 'm1')));
  });

  it('admin cũng KHÔNG sửa, KHÔNG xoá được', async () => {
    const db = env.authenticatedContext(ADMIN).firestore();
    await assertFails(updateDoc(doc(db, 'support_tickets', 't1', 'messages', 'm1'), { body: 'x' }));
    await assertFails(deleteDoc(doc(db, 'support_tickets', 't1', 'messages', 'm1')));
  });
});

describe('quyền đọc trao đổi không được lệch khỏi quyền đọc phiếu', () => {
  const nguon = readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8');

  it('rules của messages suy ra quyền TỪ document phiếu cha', () => {
    // Chốt bằng văn bản vì test hành vi không bắt được kiểu hỏng này: ai đó nới
    // quyền đọc phiếu mà quên chỗ này thì mọi test trên vẫn xanh, còn quyền hai
    // chỗ thì đã lệch nhau.
    const khoiMessages = nguon.slice(nguon.indexOf('match /messages/{messageId}'));
    expect(khoiMessages).toContain('get(/databases/$(database)/documents/support_tickets/$(ticketId))');
    expect(khoiMessages).toContain('isPtudStaff()');
    expect(khoiMessages).toContain('myCampusId()');
    expect(khoiMessages).toContain('SYSTEM_WIDE');
  });
});
