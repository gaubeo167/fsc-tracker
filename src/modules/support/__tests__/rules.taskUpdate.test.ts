import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Ghi lên một công việc: ai được ghi gì, ở trạng thái nào.
//
// Dựng lại đúng tình huống đã gặp trên production: một người vai trò 'manager'
// được giao việc trong dự án mà họ KHÔNG quản lý. Trước bản sửa này, hai thứ
// hỏng cùng lúc trên đúng một cái task:
//
//   1. Giao diện coi mọi role 'manager' là quản lý của mọi dự án, nên bày ra
//      nút "Nghiệm thu" cho chính người thực hiện. Rules từ chối — đúng, nhưng
//      người dùng chỉ thấy "Bạn không có quyền thực hiện thao tác này".
//      (Phần giao diện có test riêng ở services/__tests__/taskPermissions.test.ts)
//   2. Task nghiệm thu xong ('done') thì KHÔNG AI ngoài admin/quản lý ghi thêm
//      được gì lên nó — kể cả một dòng bình luận — vì điều kiện trạng thái bị
//      áp cho cả những lượt ghi không đụng tới trạng thái.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-task-update-test';
const ADMIN = 'admin-uid';
const PM = 'quan-ly-du-an';
const TIN = 'nguoi-thuc-hien';   // role 'manager', KHÔNG quản lý dự án này
const NT = 'nguoi-nghiem-thu';   // trong reviewers, cũng KHÔNG quản lý dự án
const NGOAI = 'nguoi-ngoai';
const PROJ = 'p-fsp';
const TASK = 'task-1';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, displayName: uid, email: `${uid}@fpt.edu.vn`,
    photoURL: '', role: 'user', status: 'active', ...over,
  };
}

function task(over: Record<string, unknown> = {}) {
  return {
    projectId: PROJ,
    title: 'Thêm button đồng bộ email HS mới sang Edunext',
    description: '',
    category: '',
    priority: 'medium',
    status: 'in-progress',
    progress: 40,
    date: '2026-09-10',
    assignees: [TIN],
    reviewers: [NT],
    cc: [],
    tags: [],
    attachedImages: [],
    subtasks: [],
    comments: [],
    ...over,
  };
}

/** Đúng hình dạng lượt ghi của addMainComment(): chỉ mảng comments. */
function themBinhLuan(uid: string) {
  return { comments: [{ id: 'c1', userId: uid, text: 'Đã xong phần này', time: new Date() }] };
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
    await setDoc(doc(db, 'users', PM), profile(PM, { role: 'manager' }));
    // Vai trò 'manager' nhưng KHÔNG có tên trong managers của dự án này — đây
    // chính là tài khoản đã gặp lỗi thật.
    await setDoc(doc(db, 'users', TIN), profile(TIN, { role: 'manager' }));
    await setDoc(doc(db, 'users', NT), profile(NT, { role: 'manager' }));
    await setDoc(doc(db, 'users', NGOAI), profile(NGOAI, { role: 'manager' }));
    await setDoc(doc(db, 'projects', PROJ), {
      id: PROJ, name: 'Hệ thống FSP', managers: [PM], members: [PM, TIN, NT],
    });
  });
});

describe('người thực hiện ghi lên việc của mình', () => {
  async function taoTask(over: Record<string, unknown> = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `projects/${PROJ}/tasks`, TASK), task(over));
    });
  }

  it('⭐ bình luận được lên task ĐÃ NGHIỆM THU', async () => {
    // Lỗi thật: nghiệm thu xong là việc đóng băng với chính người làm ra nó.
    // Bình luận không đổi trạng thái, nên không có lý do gì để chặn.
    await taoTask({ status: 'done', progress: 100 });
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), themBinhLuan(TIN))
    );
  });

  it('⭐ tích được checklist trên task BỊ TỪ CHỐI', async () => {
    await taoTask({
      status: 'rejected', progress: 90,
      subtasks: [{ id: 's1', text: 'Sửa lại', deadline: '2026-09-10', completed: false, comments: [] }],
    });
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), {
        subtasks: [{ id: 's1', text: 'Sửa lại', deadline: '2026-09-10', completed: true, comments: [] }],
      })
    );
  });

  it('bình luận được lên task CHỜ DUYỆT', async () => {
    await taoTask({ status: 'pending', progress: 0 });
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), themBinhLuan(TIN))
    );
  });

  it('kéo tiến độ lên 100% để chờ nghiệm thu', async () => {
    await taoTask();
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { progress: 100, status: 'review' })
    );
  });

  it('⭐ KHÔNG tự nghiệm thu cho mình được', async () => {
    // Nới điều kiện trạng thái không được nới luôn cái này.
    await taoTask({ status: 'review', progress: 100 });
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { status: 'done', progress: 100 })
    );
  });

  it('KHÔNG tự từ chối việc của mình được', async () => {
    await taoTask();
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { status: 'rejected' })
    );
  });

  it('KHÔNG sửa được tên việc, hạn, hay người thực hiện', async () => {
    await taoTask();
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertFails(updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { title: 'Việc khác' }));
    await assertFails(updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { date: '2026-12-31' }));
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { assignees: [TIN, NGOAI] })
    );
  });
});

describe('người nghiệm thu ghi lên việc mình duyệt', () => {
  // NT cố ý KHÔNG nằm trong managers của dự án: nếu không, nhánh
  // isManager(projectId) nuốt mất nhánh reviewer và test không kiểm gì cả.
  async function taoTaskChoNghiemThu() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `projects/${PROJ}/tasks`, TASK),
        task({ status: 'review', progress: 100 }));
    });
  }

  it('⭐ bình luận được lên task ĐANG CHỜ CHÍNH MÌNH nghiệm thu', async () => {
    // 'review' không nằm trong danh sách trạng thái của nhánh reviewer, nên
    // trước bản sửa này người nghiệm thu không hỏi lại được một câu nào trên
    // đúng việc đang chờ mình — trong khi vẫn bấm được nút Nghiệm thu.
    await taoTaskChoNghiemThu();
    const db = testEnv.authenticatedContext(NT).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), themBinhLuan(NT))
    );
  });

  it('nghiệm thu được', async () => {
    await taoTaskChoNghiemThu();
    const db = testEnv.authenticatedContext(NT).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { status: 'done', progress: 100 })
    );
  });

  it('KHÔNG sửa được tên việc — nghiệm thu không phải quyền sửa nội dung', async () => {
    await taoTaskChoNghiemThu();
    const db = testEnv.authenticatedContext(NT).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { title: 'Việc khác' })
    );
  });

  it('người ngoài không ghi được gì, kể cả bình luận', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), `projects/${PROJ}/tasks`, TASK), task());
    });
    const db = testEnv.authenticatedContext(NGOAI).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), themBinhLuan(NGOAI))
    );
  });
});
