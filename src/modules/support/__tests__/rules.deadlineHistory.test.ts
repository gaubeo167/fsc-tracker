import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { arrayUnion, doc, setDoc, updateDoc } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

// ===========================================================================
// Nhật ký đổi hạn phải là thứ KHÔNG sửa được.
//
// Giao diện bắt nhập lý do trước khi lưu hạn mới, nhưng giao diện chỉ là thiện
// chí: mở devtools ghi thẳng 'date' là hạn trượt thêm một tháng mà không để lại
// dấu vết nào, và bảng thống kê "việc bị kéo dài bao nhiêu lần" thành vô nghĩa.
// Hai điều dưới đây là hàng rào thật, và chúng đứng trên MỌI vai trò, kể cả
// admin: số mốc không bao giờ giảm, và đổi hạn thì phải kèm một mốc mới.
// ===========================================================================

const PROJECT_ID = 'fsc-tracker-deadline-history-test';
const ADMIN = 'admin-uid';
const PM = 'quan-ly-du-an';
const TIN = 'nguoi-thuc-hien';
const NT = 'nguoi-nghiem-thu';
const PROJ = 'p-fsp';
const TASK = 'task-1';

let testEnv: RulesTestEnvironment;

function profile(uid: string, over: Record<string, unknown> = {}) {
  return {
    uid, displayName: uid, email: `${uid}@fpt.edu.vn`,
    photoURL: '', role: 'user', status: 'active', ...over,
  };
}

function moc(over: Record<string, unknown> = {}) {
  return {
    id: 'm1', hanCu: '2026-09-05', hanMoi: '2026-09-20',
    lyDo: 'Chen việc gấp của trường', userId: PM, time: new Date(),
    ...over,
  };
}

function task(over: Record<string, unknown> = {}) {
  return {
    projectId: PROJ, title: 'Việc có hạn', description: '', category: '',
    priority: 'medium', status: 'in-progress', progress: 40, date: '2026-09-05',
    assignees: [TIN], reviewers: [NT], cc: [], tags: [],
    attachedImages: [], subtasks: [], comments: [],
    ...over,
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

async function taoTask(over: Record<string, unknown> = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `projects/${PROJ}/tasks`, TASK), task(over));
  });
}

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users', ADMIN), profile(ADMIN, { role: 'admin' }));
    await setDoc(doc(db, 'users', PM), profile(PM, { role: 'manager' }));
    await setDoc(doc(db, 'users', TIN), profile(TIN, { role: 'manager' }));
    await setDoc(doc(db, 'users', NT), profile(NT, { role: 'manager' }));
    await setDoc(doc(db, 'projects', PROJ), {
      id: PROJ, name: 'Hệ thống FSP', managers: [PM], members: [PM, TIN, NT],
    });
  });
  await taoTask();
});

describe('đổi hạn phải để lại dấu vết', () => {
  it('quản lý dự án đổi hạn kèm một mốc mới', async () => {
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-09-20', deadlineHistory: [moc()] })
    );
  });

  it('⭐ arrayUnion — đúng hình dạng lượt ghi của App.tsx — qua được rules', async () => {
    // App ghi bằng arrayUnion để hai người đổi hạn cùng lúc không nuốt mốc của
    // nhau. Nếu rules KHÔNG nhìn thấy kết quả sau phép nối thì lượt ghi thật sẽ
    // bị chặn, trong khi test ghi thẳng cả mảng vẫn xanh — hỏng đúng ở chỗ
    // không ai nhìn. Test này khoá cái giả định đó lại.
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-09-20', deadlineHistory: arrayUnion(moc()) })
    );
  });

  it('⭐ đổi hạn KHÔNG kèm mốc nào là chặn, kể cả quản lý dự án', async () => {
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { date: '2026-09-20' })
    );
  });

  it('⭐ admin cũng không đổi hạn lén được', async () => {
    // Hàng rào đứng TRÊN mọi nhánh quyền. Nhật ký mà admin sửa được thì ba
    // tháng sau không ai dám tin con số trong đó nữa.
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { date: '2026-12-31' })
    );
  });

  it('⭐ không xoá bớt mốc cũ được, kể cả admin', async () => {
    await taoTask({ date: '2026-09-20', deadlineHistory: [moc(), moc({ id: 'm2' })] });
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { deadlineHistory: [moc()] })
    );
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { deadlineHistory: [] })
    );
  });

  it('⭐ KHÔNG ghi đè được mốc cũ dù giữ nguyên số lượng', async () => {
    // Đếm số phần tử không phát hiện được việc này: hai mốc thay bằng hai mốc
    // khác thì size vẫn bằng nhau. Sửa được lý do của lần kéo dài ba tháng
    // trước thì nhật ký chỉ là trang trí.
    await taoTask({ date: '2026-09-20', deadlineHistory: [moc(), moc({ id: 'm2' })] });
    const db = testEnv.authenticatedContext(ADMIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), {
        deadlineHistory: [moc({ lyDo: 'Lý do bịa lại' }), moc({ id: 'm2' })],
      })
    );
  });

  it('⭐ mốc rỗng không phải là một lý do', async () => {
    // "Đổi hạn phải kèm một mốc" thoả mãn được bằng một object rỗng nếu chỉ
    // đếm: hạn vẫn trượt, nhật ký vẫn dài thêm, và dòng đó không nói gì cả.
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-09-20', deadlineHistory: arrayUnion({}) })
    );
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-09-20', deadlineHistory: arrayUnion(moc({ lyDo: '' })) })
    );
  });

  it('⭐ mốc phải nói đúng hạn cũ và hạn mới của chính lượt ghi này', async () => {
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-12-31', deadlineHistory: arrayUnion(moc()) })
    );
  });

  it('⭐ không ký tên người khác vào mốc của mình', async () => {
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-09-20', deadlineHistory: arrayUnion(moc({ userId: ADMIN })) })
    );
  });

  it('⭐ người thực hiện vẫn không tự dời hạn của mình, dù có ghi kèm mốc', async () => {
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { date: '2026-12-31', deadlineHistory: [moc({ userId: TIN })] })
    );
  });

  it('lượt ghi không đụng hạn thì không cần mốc mới', async () => {
    // Kéo tiến độ, tích checklist, bình luận: tuyệt đại đa số lượt ghi. Bắt
    // chúng mang theo một mốc là biến nhật ký thành rác trong một tuần.
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { progress: 80 })
    );
  });

  it('việc chưa có hạn, đặt hạn lần đầu cũng là một mốc', async () => {
    await taoTask({ date: '' });
    const db = testEnv.authenticatedContext(PM).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), {
        date: '2026-09-20',
        deadlineHistory: [moc({ hanCu: '', lyDo: 'Chốt hạn sau khi khảo sát' })],
      })
    );
  });
});

describe('quá hạn không khoá việc lại', () => {
  it('⭐ người thực hiện kéo tiến độ trên việc đã quá hạn', async () => {
    await taoTask({ date: '2020-01-01', status: 'in-progress', progress: 40 });
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), { progress: 70, status: 'in-progress' })
    );
  });

  it('⭐ người nghiệm thu đóng được việc đã quá hạn, kèm dấu trễ hạn', async () => {
    // Đúng hình dạng lượt ghi của updateTaskStatus khi bấm Nghiệm thu.
    await taoTask({ date: '2020-01-01', status: 'review', progress: 100 });
    const db = testEnv.authenticatedContext(NT).firestore();
    await assertSucceeds(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK), {
        status: 'done', progress: 100, doneAt: '2026-09-11', doneLate: true,
        comments: [{ id: 'c1', userId: NT, text: '[ĐÃ NGHIỆM THU] ok', time: new Date() }],
      })
    );
  });

  it('⭐ người nghiệm thu không tự khai "không muộn" cho việc đóng sau hạn', async () => {
    await taoTask({ date: '2020-01-01', status: 'review', progress: 100 });
    const db = testEnv.authenticatedContext(NT).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { status: 'done', progress: 100, doneAt: '2026-09-11', doneLate: false })
    );
  });

  it('người thực hiện không tự đóng dấu hoàn thành cho mình', async () => {
    await taoTask({ date: '2020-01-01', status: 'review', progress: 100 });
    const db = testEnv.authenticatedContext(TIN).firestore();
    await assertFails(
      updateDoc(doc(db, `projects/${PROJ}/tasks`, TASK),
        { status: 'done', doneAt: '2026-09-11', doneLate: true })
    );
  });
});
