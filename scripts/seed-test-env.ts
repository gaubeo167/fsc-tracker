import { getAuth } from 'firebase-admin/auth';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildDedupFields } from '../src/modules/support/services/duplicateScorer';

// ===========================================================================
// Dựng môi trường test đầy đủ trên EMULATOR.
//
// Tạo tài khoản ảo, trường ảo, phiếu ảo để thử toàn bộ luồng mà không đụng một
// byte nào của dữ liệu thật.
//
// Chạy:
//   npm run test:env          (tự bật emulator, seed, rồi mở app)
// Hoặc thủ công:
//   npm run emulators         (cửa sổ 1)
//   npx tsx scripts/seed-test-env.ts   (cửa sổ 2)
//   npm run dev:emulator      (cửa sổ 3) -> http://localhost:3100
// ===========================================================================

const EMU_FIRESTORE = '127.0.0.1:8080';
const EMU_AUTH = '127.0.0.1:9099';
const PROJECT_ID = 'fsc-tracker-2128a';

// Chốt chặn cứng. Script này tạo tài khoản và phiếu rác; chạy nhầm vào
// production là làm bẩn dữ liệu thật mà phiếu thì KHÔNG XOÁ ĐƯỢC (rules cấm).
// Không có cờ --apply hay --confirm nào mở được đường tới production ở đây.
if (process.env.FIRESTORE_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST !== EMU_FIRESTORE) {
  console.error(`❌ FIRESTORE_EMULATOR_HOST đang trỏ tới ${process.env.FIRESTORE_EMULATOR_HOST}, không phải emulator local.`);
  process.exit(1);
}
process.env.FIRESTORE_EMULATOR_HOST = EMU_FIRESTORE;
process.env.FIREBASE_AUTH_EMULATOR_HOST = EMU_AUTH;

if (!getApps().length) initializeApp({ projectId: PROJECT_ID });
const db = getFirestore();
const auth = getAuth();

/** Tài khoản ảo. Đăng nhập qua nút Google của emulator, không cần mật khẩu. */
// ĐÚNG BỐN loại, không thêm vai nào khác. Mỗi tài khoản đại diện một quyền
// khác hẳn nhau, để nhìn phát là biết mỗi loại thấy gì và làm được gì:
//
//   1 admin tổng      -> thấy toàn bộ, quản trị trường/dự án/phân hệ/duyệt tài khoản
//   2 quản lý dự án   -> tiếp nhận phiếu của dự án mình, GÁN việc cho người khác
//   3 nhân viên dự án -> tiếp nhận phiếu của dự án mình, CHỈ tự nhận việc
//   4 giáo viên đầu mối campus -> chỉ gửi và theo dõi yêu cầu của trường mình
const USERS = [
  { uid: 'u-admin', email: 'vietnb4@fpt.edu.vn',      name: 'Nguyen Van Admin (Admin tong)',   role: 'admin',   status: 'active', supportRole: 'SYS_ADMIN',       campusId: null },
  { uid: 'u-pm',    email: 'quanly.duan@fpt.edu.vn',  name: 'Tran Quan Ly (QL du an)',         role: 'manager', status: 'active', supportRole: 'PTUD_MANAGER',    campusId: null },
  { uid: 'u-dev',   email: 'nhanvien.duan@fpt.edu.vn',name: 'Le Nhan Vien (NV du an)',         role: 'user',    status: 'active', supportRole: 'DEVELOPER',       campusId: null },
  { uid: 'u-gv',    email: 'giaovien.hn@fpt.edu.vn',  name: 'Pham Thi Giao Vien (HN01)',       role: 'user',    status: 'active', supportRole: 'CAMPUS_FOCAL',    campusId: 'HN01' },
];

const CAMPUSES = [
  { code: 'HN01', name: 'FPT Schools Ha Noi', region: 'Mien Bac' },
  { code: 'HCM01', name: 'FPT Schools Ho Chi Minh', region: 'Mien Nam' },
  { code: 'DN01', name: 'FPT Schools Da Nang', region: 'Mien Trung' },
];

/** Phiếu mẫu. Hai phiếu đầu cố tình GIỐNG NHAU để thử quét trùng. */
const TICKETS = [
  { no: 'FSC-WEB_FSB-2608-0001', module: 'WEB_FSB', campus: 'HN01', reporter: 'u-gv',
    title: 'Không đăng nhập được vào hệ thống điểm danh',
    desc: 'Nhập đúng tài khoản mật khẩu nhưng bấm đăng nhập thì quay vòng mãi không vào được.',
    status: 'TRIAGE', scope: 'CAMPUS_LOCAL', priority: null },
  { no: 'FSC-WEB_FSB-2608-0002', module: 'WEB_FSB', campus: 'HN01', reporter: 'u-gv',
    title: 'Khong dang nhap duoc he thong diem danh',
    desc: 'Giao vien bao khong vao duoc trang diem danh tu sang nay.',
    status: 'TRIAGE', scope: 'CAMPUS_LOCAL', priority: null },
  { no: 'FSC-FINANCE-2608-0001', module: 'FINANCE', campus: 'HN01', reporter: 'u-gv',
    title: 'Xuất báo cáo học phí ra Excel bị sai định dạng ngày',
    desc: 'Cột ngày đóng học phí hiện thành số thay vì ngày tháng.',
    status: 'ACCEPTED', scope: 'CAMPUS_LOCAL', priority: 'P3',
    task: { projectId: 'p-web-fsb', assignee: 'u-dev', progress: 0, status: 'todo' } },
  { no: 'FSC-APP_MY_FPT_SCHOOL-2608-0001', module: 'APP_MY_FPT_SCHOOL', campus: 'HN01', reporter: 'u-gv',
    title: 'App phụ huynh không nhận được thông báo điểm',
    desc: 'Phu huynh phan anh khong nhan duoc thong bao khi giao vien nhap diem.',
    status: 'IN_PROGRESS', scope: 'SYSTEM_WIDE', priority: 'P2', affected: ['HN01', 'HCM01', 'DN01'],
    task: { projectId: 'p-app', assignee: 'u-pm', progress: 40, status: 'in-progress' } },
  { no: 'FSC-HEALTH_SYSTEM-2608-0001', module: 'HEALTH_SYSTEM', campus: 'HN01', reporter: 'u-gv',
    title: 'Không in được sổ theo dõi sức khỏe học sinh',
    desc: 'Bam in thi trang trang.', status: 'RESOLVED', scope: 'CAMPUS_LOCAL', priority: 'P4' },
];

const now = Date.now();
const DAY = 86_400_000;

async function main() {
  console.log('─'.repeat(60));
  console.log('  Dựng môi trường test trên EMULATOR');
  console.log(`  Firestore : ${EMU_FIRESTORE}`);
  console.log(`  Auth      : ${EMU_AUTH}`);
  console.log('─'.repeat(60));

  // Xoá sạch trước, để chạy lại nhiều lần vẫn ra đúng trạng thái mong muốn.
  // 'notifications' PHẢI có trong danh sách. Thông báo mang ticketId 't-1'…
  // 't-5'; lần chạy sau tạo lại đúng những id đó với nội dung khác, nên thông
  // báo cũ lặng lẽ bám sang phiếu mới và chỉ sang sai phiếu.
  for (const c of ['users', 'support_campuses', 'support_role_assignments', 'support_tickets',
                   'support_ticket_index', 'support_counters', 'support_ticket_numbers',
                   'support_modules', 'support_sla_policies', 'support_config', 'projects',
                   'notifications']) {
    const snap = await db.collection(c).get();
    if (c === 'projects') {
      for (const d of snap.docs) {
        const tasks = await d.ref.collection('tasks').get();
        await Promise.all(tasks.docs.map((t) => t.ref.delete()));
      }
    }
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }

  // Xoá sạch tài khoản bằng endpoint của emulator thay vì deleteUser từng người.
  // Vòng lặp deleteUser + importUsers làm hỏng chỉ mục nội bộ của Auth emulator
  // và lần chạy sau ném "Internal state invariant broken: no user with ID".
  await fetch(`http://${EMU_AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  }).catch(() => {});

  console.log('\n[1/5] Tài khoản');
  for (const u of USERS) {
    // importUsers + providerUserInfo chứ KHÔNG phải createUser.
    //
    // App đăng nhập bằng signInWithPopup(googleProvider). Tài khoản tạo bằng
    // createUser chỉ có phương thức mật khẩu, nên bảng chọn tài khoản của
    // emulator sẽ không liệt kê chúng — bấm đăng nhập sẽ sinh ra một uid MỚI
    // không khớp dữ liệu đã seed, và người thử rơi vào màn chờ duyệt với
    // database trống trơn.
    //
    // Gắn sẵn liên kết google.com với đúng uid thì emulator hiện tài khoản
    // trong bảng chọn và đăng nhập ra đúng uid đã seed.
    await auth.importUsers([{
      uid: u.uid,
      email: u.email,
      emailVerified: true,
      displayName: u.name,
      providerData: [{ uid: u.email, email: u.email, displayName: u.name, providerId: 'google.com' }],
    }]);
    await db.collection('users').doc(u.uid).set({
      uid: u.uid, displayName: u.name, email: u.email, photoURL: '', role: u.role, status: u.status,
    });
    console.log(`  ✓ ${u.email.padEnd(28)} ${u.supportRole ?? 'CHỜ DUYỆT'}${u.campusId ? ` @ ${u.campusId}` : ''}`);
    if (u.supportRole) {
      await db.collection('support_role_assignments').doc(u.uid).set({
        uid: u.uid, campusId: u.campusId, supportRole: u.supportRole, assignedBy: 'u-admin', assignedAt: new Date(),
      });
    }
  }

  console.log('\n[2/4] Trường');
  for (const c of CAMPUSES) {
    await db.collection('support_campuses').doc(c.code).set({
      id: c.code, code: c.code, name: c.name, region: c.region, isActive: true,
      createdAt: new Date(), createdBy: 'u-admin',
    });
    console.log(`  ✓ ${c.code} — ${c.name}`);
  }

  // Project trong module Công việc. Phiếu được tiếp nhận sẽ sinh task ở đây.
  // Đặt tên khớp production để thử sát thực tế.
  console.log('\n[3/5] Dự án (module Công việc)');
  //
  // managers KHÁC members — đây là thứ làm nên khác biệt giữa tài khoản số 2 và
  // số 3. Nếu để hai danh sách bằng nhau thì ai cũng là quản lý và không nhìn ra
  // được sự khác nhau.
  //
  // u-dev cố ý CHỈ ở p-web-fsb: đăng nhập bằng nhân viên sẽ không thấy hàng đợi
  // của App MyFPTSchools hay Y tế, còn quản lý thì thấy cả ba.
  const PROJECTS = [
    { id: 'p-web-fsb', name: 'Hệ thống FSP',     modules: ['WEB_FSB', 'FINANCE'],           managers: ['u-pm'], members: ['u-pm', 'u-dev'] },
    { id: 'p-app',     name: 'App MyFPTSchools', modules: ['APP_MY_FPT_SCHOOL', 'FEEN'],    managers: ['u-pm'], members: ['u-pm'] },
    { id: 'p-health',  name: 'Hệ thống Y tế',    modules: ['HEALTH_SYSTEM'],                managers: ['u-pm'], members: ['u-pm'] },
  ];
  const moduleToProject: Record<string, string> = {};
  for (const pr of PROJECTS) {
    await db.collection('projects').doc(pr.id).set({
      id: pr.id, name: pr.name, description: `Dự án ${pr.name}`,
      managers: pr.managers, members: pr.members,
      // Dự án khai nó nhận phân hệ nào. Lưu hai chiều: support_modules.projectId
      // là chiều tra ngược, dùng lúc tiếp nhận phiếu để biết đặt task vào đâu.
      supportModules: pr.modules,
      status: 'active', createdAt: new Date(),
    });
    pr.modules.forEach((m) => (moduleToProject[m] = pr.id));
    console.log(`  ✓ ${pr.name} <- ${pr.modules.join(', ')}`);
  }

  console.log('\n[4/5] Dữ liệu tham chiếu (5 phân hệ, SLA, lịch làm việc)');
  const { SUPPORT_MODULES } = await import('../src/modules/support/types');
  const { DEFAULT_SLA_POLICIES } = await import('../src/modules/support/services/slaCalculator');
  for (const m of SUPPORT_MODULES) {
    await db.collection('support_modules').doc(m.code).set({
      code: m.code, name: m.name,
      ownerUserId: 'u-pm', backupOwnerUserId: null,
      // Chưa gán projectId thì KHÔNG tiếp nhận phiếu được — task không có chỗ chui vào.
      projectId: moduleToProject[m.code] ?? null,
      isActive: true,
    });
  }
  for (const p of DEFAULT_SLA_POLICIES) {
    await db.collection('support_sla_policies').doc(p.id).set({ ...p, isActive: true });
  }
  await db.collection('support_config').doc('working_calendar').set({
    windows: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 480, endMinute: 1020 })),
    timezone: 'Asia/Ho_Chi_Minh', utcOffsetMinutes: 420,
  });
  await db.collection('support_config').doc('holidays').set({ dates: [], overrides: {} });
  console.log(`  ✓ ${SUPPORT_MODULES.length} phân hệ, ${DEFAULT_SLA_POLICIES.length} chính sách SLA, lịch làm việc`);

  console.log('\n[5/5] Phiếu mẫu');
  for (let i = 0; i < TICKETS.length; i++) {
    const t = TICKETS[i];
    const id = `t-${i + 1}`;
    const created = now - (TICKETS.length - i) * DAY;
    const dedup = buildDedupFields(t.title, t.desc);
    const affected = (t as any).affected ?? [t.campus];
    await db.collection('support_tickets').doc(id).set({
      id, ticketNo: t.no, type: 'BUG', moduleId: t.module, subFeature: '',
      campusId: t.campus, reporterUserId: t.reporter, campusContactUserId: null,
      title: t.title, description: t.desc, stepsToReproduce: '', expectedResult: '', actualResult: '',
      occurredAt: created, hasWorkaround: false, impactScale: 'FROM_10_TO_100',
      affectedUserRef: '', affectedUserRole: '', deviceOs: 'Android', deviceBrowser: 'Chrome',
      appVersion: '', networkNote: '', errorCode: '', logExcerpt: '',
      status: t.status, scope: t.scope, priority: t.priority,
      assigneeUserId: (t as any).task?.assignee ?? null,
      triagedBy: t.priority ? 'u-pm' : null, triagedAt: t.priority ? created : null,
      // Phiếu thứ 3 cố tình để hạn QUÁ KHỨ, để thấy ngay ô "Quá hạn" tô đỏ.
      dueAt: t.priority ? (i === 2 ? now - 2 * DAY : now + 2 * DAY) : null,
      slaPolicyId: null, firstResponseAt: null,
      resolvedAt: t.status === 'RESOLVED' ? now - DAY : null, closedAt: null,
      duplicateOfTicketId: null, reopenCount: 0,
      linkedProjectId: (t as any).task?.projectId ?? null,
      linkedTaskId: (t as any).task ? `task-${id}` : null,
      // Đầu mối để kỹ thuật viên liên hệ. Ảnh để trống vì seed không tải file
      // thật lên Storage — anh tự thử bằng cách gửi phiếu mới có ảnh.
      contactName: 'Pham Thi Giao Vien',
      contactEmail: 'giaovien.hn@fpt.edu.vn',
      attachments: [],
      affectedCampusIds: affected, watcherUids: [t.reporter],
      ...dedup,
      slaStartedAt: created, slaElapsedWorkingMs: 0, slaLastResumedAt: created, slaBreachNotifiedAt: null,
      createdAt: created, updatedAt: created,
    });
    await db.collection('support_ticket_index').doc(id).set({
      ticketNo: t.no, moduleId: t.module, campusId: t.campus, status: t.status,
      title: t.title, type: 'BUG',
      ...dedup, createdAt: created,
    });
    await db.collection('support_ticket_numbers').doc(t.no).set({ ticketId: id, createdAt: created });

    const tk = (t as any).task;
    if (tk) {
      // Đúng hình dạng mà acceptTicket() sinh ra, kể cả thẻ 'ho-tro' và ô CC.
      await db.collection('projects').doc(tk.projectId).collection('tasks').doc(`task-${id}`).set({
        id: `task-${id}`, projectId: tk.projectId,
        title: `[${t.no}] ${t.title}`,
        description: `Phiếu hỗ trợ ${t.no} — ${t.campus}\n\n${t.desc}`,
        category: 'Sửa lỗi',
        priority: t.priority === 'P1' ? 'critical' : t.priority === 'P2' ? 'high' : t.priority === 'P3' ? 'medium' : 'low',
        status: tk.status, progress: tk.progress,
        date: new Date(now + 2 * DAY).toISOString().slice(0, 10),
        assignees: [tk.assignee],
        reviewers: ['u-pm'],
        cc: tk.assignee === 'u-dev' ? ['u-pm'] : [],
        tags: ['ho-tro', t.module, t.campus],
        attachedImages: [], subtasks: [], comments: [],
        createdAt: new Date(created),
      });
    }
    console.log(`  ✓ ${t.no.padEnd(34)} ${t.status}${tk ? `  -> công việc của ${tk.assignee}` : ''}`);
  }

  // Counter phải khớp số phiếu đã seed, nếu không phiếu tạo tay sẽ trùng mã.
  await db.collection('support_counters').doc('WEB_FSB_2608').set({ period: '2608', seq: 2 });
  await db.collection('support_counters').doc('FINANCE_2608').set({ period: '2608', seq: 1 });
  await db.collection('support_counters').doc('APP_MY_FPT_SCHOOL_2608').set({ period: '2608', seq: 1 });
  await db.collection('support_counters').doc('HEALTH_SYSTEM_2608').set({ period: '2608', seq: 1 });

  const G = (t: string) => `\x1b[1m${t}\x1b[0m`;
  console.log('\n' + '═'.repeat(74));
  console.log(G('  ✅ XONG — BỐN LOẠI TÀI KHOẢN'));
  console.log('═'.repeat(74));
  console.log(`  App: http://localhost:3100      Emulator: http://127.0.0.1:4000`);
  console.log(`  Đăng nhập bằng nút Google, chọn tài khoản trong bảng của emulator.\n`);

  const DEMO = [
    { n: '1', who: 'ADMIN TỔNG', email: 'vietnb4@fpt.edu.vn',
      sees: 'Toàn bộ phiếu của mọi trường + mọi công việc của mọi dự án',
      can: 'Quản trị trường, dự án, phân hệ, duyệt tài khoản. Gán việc cho bất kỳ ai' },
    { n: '2', who: 'QUẢN LÝ DỰ ÁN', email: 'quanly.duan@fpt.edu.vn',
      sees: 'Hàng đợi của cả 3 dự án (FSP, App, Y tế) + công việc của mình',
      can: 'Tiếp nhận / từ chối / hỏi thêm. GÁN việc cho người khác trong dự án' },
    { n: '3', who: 'NHÂN VIÊN DỰ ÁN', email: 'nhanvien.duan@fpt.edu.vn',
      sees: 'CHỈ hàng đợi của Hệ thống FSP — không thấy App, không thấy Y tế',
      can: 'Tiếp nhận phiếu nhưng CHỈ tự nhận việc về mình, không gán cho ai' },
    { n: '4', who: 'GIÁO VIÊN ĐẦU MỐI HN01', email: 'giaovien.hn@fpt.edu.vn',
      sees: 'Chỉ yêu cầu của trường HN01 mình gửi. KHÔNG có mục Công việc',
      can: 'Gửi yêu cầu mới, sửa khi chưa ai nhận, theo dõi tiến độ xử lý' },
  ];
  for (const d of DEMO) {
    console.log(`  ${G(d.n + '. ' + d.who)}`);
    console.log(`     Đăng nhập : ${d.email}`);
    console.log(`     Nhìn thấy : ${d.sees}`);
    console.log(`     Làm được  : ${d.can}\n`);
  }

  console.log('  ' + '─'.repeat(70));
  console.log(G('  Cách thấy rõ khác biệt giữa số 2 và số 3 trong 30 giây:'));
  console.log('  ' + '─'.repeat(70));
  console.log('   a. Vào bằng nhân viên  -> Hỗ trợ > Tiếp nhận > mở phiếu FSC-WEB_FSB-2608-0001');
  console.log('      Ô "Người xử lý" BỊ KHOÁ, ghi sẵn tên mình kèm dòng giải thích.');
  console.log('   b. Vào bằng quản lý dự án -> cùng phiếu đó');
  console.log('      Ô "Người xử lý" là danh sách chọn được, có cả nhân viên. Kèm ô CC.\n');
  console.log('   Phiếu FSC-FINANCE-2608-0001 đã tiếp nhận và có công việc thật giao cho');
  console.log('   nhân viên — vào bằng giáo viên sẽ thấy tiến độ chạy ngược về phiếu.\n');
  console.log('  ⚠️  Cổng 3100, KHÔNG phải 3000 (3000 đang là hệ thống khảo thí).\n');
}

main().catch((err) => {
  console.error('\n❌ Seed thất bại:', err?.message ?? err);
  process.exit(1);
});
