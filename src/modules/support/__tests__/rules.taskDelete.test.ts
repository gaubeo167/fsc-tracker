import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Xoá một công việc — dành cho bản tạo trùng.
//
// firestore.rules đã cho phép từ trước; thiếu là thiếu cái nút trong giao diện,
// nên cách duy nhất để bỏ một task tạo nhầm là xoá cả dự án. Test này chốt lại
// đúng ranh giới mà cái nút mới phải bám theo: ai thấy nút, ai không.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-task-delete-test';
const ADMIN = 'admin-uid';
const PM = 'quan-ly-du-an';
const PM_KHAC = 'quan-ly-du-an-khac';
const TIN = 'nguoi-thuc-hien';
const NT = 'nguoi-nghiem-thu';
const PROJ = 'p-fsp';
const TASK = 'task-trung';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, displayName: uid, email: `${uid}@fpt.edu.vn`,
    photoURL: '', role: 'user', status: 'active', ...over,
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync(path.resolve(__dirname, '../../../../firestore.rules'), 'utf8'),
      host: '127.0.0.1', port: 8080,
    },
  });
});

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    await setDoc(doc(db, 'users', PM), profile(PM, { role: 'manager' }));
    // Vai trò 'manager' nhưng quản lý dự án KHÁC.
    await setDoc(doc(db, 'users', PM_KHAC), profile(PM_KHAC, { role: 'manager' }));
    await setDoc(doc(db, 'users', TIN), profile(TIN, { role: 'manager' }));
    await setDoc(doc(db, 'users', NT), profile(NT, { role: 'user' }));
    await setDoc(doc(db, 'projects', PROJ), {
      id: PROJ, name: 'Hệ thống FSP', managers: [PM], members: [PM, TIN, NT],
    });
    await setDoc(doc(db, `projects/${PROJ}/tasks`, TASK), {
      projectId: PROJ, title: 'Bản tạo trùng', description: '', category: '',
      priority: 'medium', status: 'in-progress', progress: 0, date: '2026-09-20',
      assignees: [TIN], reviewers: [NT], cc: [], tags: ['ho-tro'],
      attachedImages: [], subtasks: [], comments: [],
      supportTicketId: 't-1', supportTicketNo: 'FSC-WEB_FSB-2609-0001',
    });
  });
});

const task = (db: any) => doc(db, `projects/${PROJ}/tasks`, TASK);

describe('ai xoá được một công việc', () => {
  it('⭐ admin xoá được', async () => {
    await assertSucceeds(deleteDoc(task(testEnv.authenticatedContext(ADMIN).firestore())));
  });

  it('quản lý của CHÍNH dự án đó xoá được', async () => {
    await assertSucceeds(deleteDoc(task(testEnv.authenticatedContext(PM).firestore())));
  });

  it('⭐ vai trò manager nhưng không quản lý dự án này thì KHÔNG', async () => {
    // Cùng cái bẫy đã sửa cho nút Nghiệm thu: role 'manager' không phải là
    // quản lý của mọi dự án. Nút Xoá phải bám đúng ranh giới này.
    await assertFails(deleteDoc(task(testEnv.authenticatedContext(PM_KHAC).firestore())));
  });

  it('⭐ người thực hiện KHÔNG xoá được việc của chính mình', async () => {
    await assertFails(deleteDoc(task(testEnv.authenticatedContext(TIN).firestore())));
  });

  it('người nghiệm thu KHÔNG xoá được', async () => {
    await assertFails(deleteDoc(task(testEnv.authenticatedContext(NT).firestore())));
  });

  it('chưa đăng nhập thì không', async () => {
    await assertFails(deleteDoc(task(testEnv.unauthenticatedContext().firestore())));
  });
});
