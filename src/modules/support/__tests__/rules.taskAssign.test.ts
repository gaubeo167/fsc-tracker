import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, writeBatch } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// "Quản lý dự án thì mới được gán công việc cho người khác trong dự án còn
//  nhân viên bên trong thì chỉ tiếp nhận công việc của mình."
//
// Đây là quyền, không phải gợi ý giao diện. TriageQueue có khoá ô chọn người
// xử lý, nhưng khoá đó nằm trong trình duyệt và mở được bằng devtools — chỉ
// rules mới là hàng rào thật. Test này kiểm đúng hàng rào đó.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-task-assign-test';
const ADMIN = 'admin-uid';
const PM = 'quan-ly-du-an';
const DEV = 'nhan-vien-trong-du-an';
const OTHER = 'nguoi-khac';
const PROJ = 'p-web-fsb';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, displayName: uid, email: `${uid}@fpt.edu.vn`,
    photoURL: '', role: 'user', status: 'active', ...over,
  };
}

/** Đúng hình dạng task mà acceptTicket() sinh ra. */
function supportTask(assignee: string, actor: string, over: Record<string, unknown> = {}) {
  return {
    projectId: PROJ,
    title: '[FSC-WEB_FSB-2608-0001] Khong dang nhap duoc',
    description: 'Phieu ho tro',
    category: 'Sửa lỗi',
    priority: 'medium',
    status: 'todo',
    progress: 0,
    date: '2026-09-01',
    assignees: [assignee],
    reviewers: [actor],
    cc: [],
    tags: ['ho-tro', 'WEB_FSB', 'HN01'],
    attachedImages: [],
    subtasks: [],
    comments: [],
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

afterAll(async () => { await testEnv?.cleanup(); });

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    await setDoc(doc(db, 'users', PM), profile(PM));
    await setDoc(doc(db, 'users', DEV), profile(DEV));
    await setDoc(doc(db, 'users', OTHER), profile(OTHER));

    // Cả hai đều là cán bộ PTUD — khác nhau CHỈ ở chỗ đứng trong dự án.
    for (const uid of [PM, DEV, OTHER]) {
      await setDoc(doc(db, 'support_role_assignments', uid),
        { uid, campusId: null, supportRole: 'DEVELOPER', assignedBy: ADMIN });
    }

    // PM nằm trong managers, DEV chỉ là members. Cố ý để user.role của PM vẫn
    // là 'user': isManager() sẵn có đòi role == 'manager', nếu luồng hỗ trợ dựa
    // vào hàm đó thì quản lý dự án hỗ trợ sẽ trượt oan.
    await setDoc(doc(db, 'projects', PROJ), {
      id: PROJ, name: 'Web FSB', managers: [PM], members: [DEV],
      supportModules: ['WEB_FSB'],
    });
  });
});

describe('quyền gán việc khi tiếp nhận phiếu', () => {
  it('quản lý dự án GÁN ĐƯỢC việc cho người khác trong dự án', async () => {
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertSucceeds(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)), supportTask(DEV, PM))
    );
  });

  it('⭐ nhân viên trong dự án KHÔNG gán được việc cho người khác', async () => {
    const db = testEnv.authenticatedContext(DEV).firestore();
    await assertFails(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)), supportTask(OTHER, DEV))
    );
  });

  it('nhân viên trong dự án TỰ NHẬN ĐƯỢC việc về mình', async () => {
    const db = testEnv.authenticatedContext(DEV).firestore();
    await assertSucceeds(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)), supportTask(DEV, DEV))
    );
  });

  it('nhân viên không gán được cho cả mình VÀ người khác cùng lúc', async () => {
    // assignees == [uid] là ràng buộc chính xác một phần tử, không phải "có
    // chứa uid" — nếu không sẽ lách được bằng cách nhét thêm tên vào mảng.
    const db = testEnv.authenticatedContext(DEV).firestore();
    await assertFails(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)),
        supportTask(DEV, DEV, { assignees: [DEV, OTHER] }))
    );
  });

  it('cán bộ PTUD ngoài dự án không tự nhét việc cho người khác', async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)), supportTask(DEV, OTHER))
    );
  });

  it('admin gán được cho bất kỳ ai', async () => {
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertSucceeds(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)), supportTask(OTHER, ADMIN))
    );
  });

  it('CC không mở thêm quyền: nhân viên tự nhận việc vẫn CC được người khác', async () => {
    const db = testEnv.authenticatedContext(DEV).firestore();
    await assertSucceeds(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)),
        supportTask(DEV, DEV, { cc: [PM, OTHER] }))
    );
  });

  it('nhánh này không thành đường tạo task tuỳ ý: thiếu thẻ ho-tro là chặn', async () => {
    const db = testEnv.authenticatedContext(DEV).firestore();
    await assertFails(
      setDoc(doc(collection(db, `projects/${PROJ}/tasks`)),
        supportTask(DEV, DEV, { tags: ['WEB_FSB'], status: 'todo' }))
    );
  });

  it('⭐ batch thật của acceptTicket bị chặn nguyên khối khi nhân viên gán cho người khác', async () => {
    // writeBatch là all-or-nothing: nếu một write trong batch bị rules từ chối
    // thì phiếu cũng KHÔNG bị chuyển sang ACCEPTED. Kiểm điều đó ở đây để chắc
    // chắn không có trạng thái nửa vời "phiếu đã nhận nhưng không có task".
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const d = ctx.firestore();
      await setDoc(doc(d, 'support_tickets', 't1'), {
        ticketNo: 'FSC-WEB_FSB-2608-0001', type: 'BUG', moduleId: 'WEB_FSB',
        campusId: 'HN01', reporterUserId: 'nguoi-truong', title: 'Loi',
        status: 'TRIAGE', scope: 'CAMPUS_LOCAL', affectedCampusIds: ['HN01'],
        watcherUids: [], createdAt: 1_700_000_000_000,
      });
      await setDoc(doc(d, 'support_ticket_index', 't1'),
        { ticketId: 't1', ticketNo: 'FSC-WEB_FSB-2608-0001', status: 'TRIAGE' });
    });

    const db = testEnv.authenticatedContext(DEV).firestore();
    const taskRef = doc(collection(db, `projects/${PROJ}/tasks`));
    const batch = writeBatch(db);
    batch.set(taskRef, supportTask(OTHER, DEV));
    batch.update(doc(db, 'support_tickets', 't1'), {
      status: 'ACCEPTED', priority: 'P3', assigneeUserId: OTHER,
      dueAt: 1_800_000_000_000, triagedBy: DEV, triagedAt: 1_700_000_000_000,
      linkedProjectId: PROJ, linkedTaskId: taskRef.id, updatedAt: 1_700_000_000_000,
    });
    batch.update(doc(db, 'support_ticket_index', 't1'), { status: 'ACCEPTED' });
    await assertFails(batch.commit());
  });
});
