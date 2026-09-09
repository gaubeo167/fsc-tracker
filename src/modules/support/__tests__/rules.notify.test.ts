import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Nhóm nhận tin, mẫu email, lịch sử gửi — test tầng firestore.rules.
//
// Vì sao đáng test kỹ: thư đi từ trình duyệt bằng hộp thư của người bấm nút,
// KHÔNG qua máy chủ nào cả. Nghĩa là rules ở đây là hàng rào duy nhất. Ai ghi
// được vào ba collection này là gửi được thư hàng loạt danh nghĩa nhà trường,
// tới danh sách địa chỉ của hiệu trưởng 18 cơ sở.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-notify-test';
const ADMIN = 'admin-uid';
const CAMPUS_USER = 'giao-vien-uid';
const PTUD_USER = 'nhan-vien-ptud-uid';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, displayName: 'Nguyen Van A', email: `${uid}@fpt.edu.vn`,
    photoURL: '', role: 'user', status: 'active', ...over,
  };
}

const NHOM = {
  name: 'Hiệu trưởng các trường',
  description: '',
  recipients: [{ email: 'a@fpt.edu.vn', name: 'A' }],
  isActive: true,
};

const MAU = { name: 'Thông báo tính năng', subject: 'Chào', body: 'Nội dung', isActive: true };

const LAN_GUI = {
  subject: 'Chào', body: 'Nội dung', templateId: null, templateName: '',
  groupIds: ['g1'], groupNames: ['Hiệu trưởng'], total: 1,
  sentCount: 0, failedCount: 0, status: 'SENDING',
  senderEmail: 'vietnb4@fpt.edu.vn', createdBy: ADMIN, createdByName: 'Admin',
};

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

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    await setDoc(doc(db, 'users', CAMPUS_USER), profile(CAMPUS_USER));
    await setDoc(doc(db, 'users', PTUD_USER), profile(PTUD_USER));
    await setDoc(doc(db, 'support_role_assignments', CAMPUS_USER), {
      uid: CAMPUS_USER, campusId: 'HN01', supportRole: 'CAMPUS_FOCAL', assignedBy: ADMIN,
    });
    await setDoc(doc(db, 'support_role_assignments', PTUD_USER), {
      uid: PTUD_USER, campusId: null, supportRole: 'PTUD_MANAGER', assignedBy: ADMIN,
    });
    await setDoc(doc(db, 'support_notify_groups', 'g1'), NHOM);
    await setDoc(doc(db, 'support_email_templates', 't1'), MAU);
    await setDoc(doc(db, 'support_announcements', 'a1'), LAN_GUI);
  });
});

describe('Nhóm nhận tin', () => {
  it('admin đọc và tạo được nhóm', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(getDocs(collection(db, 'support_notify_groups')));
    await assertSucceeds(addDoc(collection(db, 'support_notify_groups'), NHOM));
  });

  it('cán bộ trường KHÔNG đọc được danh sách địa chỉ', async () => {
    // Đây là dữ liệu cá nhân của hiệu trưởng 18 cơ sở, không phải danh bạ công khai.
    const db = testEnv.authenticatedContext(CAMPUS_USER).firestore();
    await assertFails(getDoc(doc(db, 'support_notify_groups', 'g1')));
    await assertFails(getDocs(collection(db, 'support_notify_groups')));
  });

  it('quản lý PTUD cũng KHÔNG ghi được — chỉ admin', async () => {
    // Ghi được vào đây là gửi được thư hàng loạt danh nghĩa nhà trường.
    const db = testEnv.authenticatedContext(PTUD_USER).firestore();
    await assertFails(addDoc(collection(db, 'support_notify_groups'), NHOM));
  });

  it('CHẶN nhóm vượt 1000 người nhận', async () => {
    // Chốt chặn để một lần dán nhầm cả file Excel không lặng lẽ thành một nhóm
    // khổng lồ rồi bắn đi.
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    const qua = Array.from({ length: 1001 }, (_, i) => ({ email: `u${i}@fpt.edu.vn`, name: '' }));
    await assertFails(addDoc(collection(db, 'support_notify_groups'), { ...NHOM, recipients: qua }));
  });

  it('đúng 1000 người nhận thì vẫn lưu được', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    const vua = Array.from({ length: 1000 }, (_, i) => ({ email: `u${i}@fpt.edu.vn`, name: '' }));
    await assertSucceeds(addDoc(collection(db, 'support_notify_groups'), { ...NHOM, recipients: vua }));
  });
});

describe('Mẫu email', () => {
  it('admin sửa được mẫu', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(setDoc(doc(db, 'support_email_templates', 't1'), MAU));
  });

  it('người dùng thường không đọc, không sửa được mẫu', async () => {
    const db = testEnv.authenticatedContext(CAMPUS_USER).firestore();
    await assertFails(getDoc(doc(db, 'support_email_templates', 't1')));
    await assertFails(setDoc(doc(db, 'support_email_templates', 't1'), MAU));
  });
});

describe('Lịch sử gửi', () => {
  it('admin tạo và cập nhật được lần gửi', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(addDoc(collection(db, 'support_announcements'), LAN_GUI));
    await assertSucceeds(setDoc(doc(db, 'support_announcements', 'a1'), { ...LAN_GUI, sentCount: 1 }));
  });

  it('KHÔNG ai xoá được lịch sử, kể cả admin', async () => {
    // Đây là sổ ghi "đã gửi gì, cho ai, ngày nào". Xoá được thì nó không còn là
    // bằng chứng của bất cứ điều gì.
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(deleteDoc(doc(db, 'support_announcements', 'a1')));
  });

  it('admin ghi được trạng thái từng lượt gửi', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(
      setDoc(doc(db, 'support_announcements', 'a1', 'deliveries', 'a@fpt.edu.vn'), {
        email: 'a@fpt.edu.vn', name: 'A', status: 'SENT',
      })
    );
  });

  it('người ngoài không đọc được ai đã nhận thư nào', async () => {
    const db = testEnv.authenticatedContext(CAMPUS_USER).firestore();
    await assertFails(getDoc(doc(db, 'support_announcements', 'a1')));
    await assertFails(getDocs(collection(db, 'support_announcements', 'a1', 'deliveries')));
  });
});
