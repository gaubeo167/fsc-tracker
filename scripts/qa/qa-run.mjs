import {
  P, FS, D, OWNER, S, I, B, A, NUL, token, H, commit, upd, del, runQuery, getDoc,
  check, group, summary,
} from './qa-suite.mjs';

// Dọn trước mỗi lần chạy: QA phải cho cùng kết quả dù chạy lần đầu hay lần thứ mười.
const RAC = ['qa-t1', 'qa-t2', 'qa-t3'];
async function donRac() {
  for (const id of [...RAC, 'qa-gia']) {
    for (const c of ['support_tickets', 'support_ticket_index']) {
      await fetch(`${FS}/${c}/${id}`, { method: 'DELETE', headers: OWNER });
    }
  }
  const n = await (await fetch(`${FS}/notifications?pageSize=200`, { headers: OWNER })).json();
  for (const d of n.documents ?? []) {
    if ((d.fields?.ticketNo?.stringValue ?? '').startsWith('QA-')) {
      await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: 'DELETE', headers: OWNER });
    }
  }
  await fetch(`${FS}/projects/p-web-fsb/tasks/qa-task-1`, { method: 'DELETE', headers: OWNER });
  await fetch(`${FS}/support_modules/QA_TMP`, { method: 'DELETE', headers: OWNER });
  await fetch(`${FS}/support_campuses/QA01`, { method: 'DELETE', headers: OWNER });
}

const phieu = (over = {}) => ({
  ticketNo: S('QA-WEB_FSB-2608-0001'), type: S('BUG'), moduleId: S('WEB_FSB'),
  campusId: S('HN01'), reporterUserId: S('u-gv'), title: S('Khong dang nhap duoc he thong QA'),
  description: S('mo ta qa'), status: S('TRIAGE'), scope: S('CAMPUS_LOCAL'),
  affectedCampusIds: A(['HN01']), watcherUids: A(['u-gv']),
  normalizedTitle: S('khong dang nhap duoc he thong qa'),
  titleTokens: A(['khong', 'dang', 'nhap', 'duoc', 'he', 'thong', 'qa']),
  bodyTokens: A(['mo', 'ta', 'qa']),
  assigneeUserId: NUL, triagedBy: NUL, reopenCount: I(0), needsInfoRequest: S(''),
  rejectionReason: S(''), resolvedAt: NUL, closedAt: NUL, dueAt: NUL,
  linkedProjectId: NUL, linkedTaskId: NUL, attachments: { arrayValue: {} },
  contactName: S('QA'), contactEmail: S('giaovien.hn@fpt.edu.vn'),
  slaElapsedWorkingMs: I(0), createdAt: I(1), updatedAt: I(1), ...over,
});
const guong = (over = {}) => ({
  ticketNo: S('QA-WEB_FSB-2608-0001'), moduleId: S('WEB_FSB'), campusId: S('HN01'),
  status: S('TRIAGE'), title: S('Khong dang nhap duoc he thong QA'), type: S('BUG'),
  normalizedTitle: S('khong dang nhap duoc he thong qa'),
  titleTokens: A(['khong', 'dang', 'nhap', 'duoc', 'he', 'thong', 'qa']),
  bodyTokens: A(['mo', 'ta', 'qa']), createdAt: I(1), ...over,
});
async function datPhieu(id, status) {
  await fetch(`${FS}/${'support_tickets'}/${id}?${Object.keys(phieu()).map(k=>'updateMask.fieldPaths='+k).join('&')}`,
    { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: phieu({ status: S(status) }) }) });
  await fetch(`${FS}/support_ticket_index/${id}?${Object.keys(guong()).map(k=>'updateMask.fieldPaths='+k).join('&')}`,
    { method: 'PATCH', headers: OWNER, body: JSON.stringify({ fields: guong({ status: S(status) }) }) });
}

const T = {};
async function main() {
  await donRac();
  T.admin = await token('vietnb4@fpt.edu.vn');
  T.pm = await token('quanly.duan@fpt.edu.vn');
  T.nv = await token('nhanvien.duan@fpt.edu.vn');
  T.gv = await token('giaovien.hn@fpt.edu.vn');

  // =====================================================================
  group('1. Cách ly trường — nền tảng bảo mật của cả module');
  await datPhieu('qa-t1', 'TRIAGE');
  check('giáo viên HN01 đọc được phiếu trường mình', (await getDoc(T.gv, 'support_tickets/qa-t1')).status, 200);
  // Firestore từ chối cả truy vấn (403), không lọc bớt kết quả.
  check('giáo viên KHÔNG liệt kê được toàn bộ phiếu',
    (await runQuery(T.gv, { structuredQuery: { from: [{ collectionId: 'support_tickets' }] } })).status, 403);
  check('giáo viên liệt kê được phiếu có ràng buộc trường mình',
    (await runQuery(T.gv, { structuredQuery: { from: [{ collectionId: 'support_tickets' }],
      where: { fieldFilter: { field: { fieldPath: 'campusId' }, op: 'EQUAL', value: S('HN01') } } } })).status, 200);
  check('admin liệt kê được toàn bộ phiếu',
    (await runQuery(T.admin, { structuredQuery: { from: [{ collectionId: 'support_tickets' }] } })).status, 200);

  // =====================================================================
  group('2. Trường sửa / xoá phiếu — chỉ khi chưa tiếp nhận');
  const suaND = (tok) => commit(tok, [
    upd('support_tickets/qa-t1', { title: S('Khong dang nhap duoc he thong diem danh QA'),
      normalizedTitle: S('x'), titleTokens: A(['x']), bodyTokens: A(['x']), updatedAt: I(2) }),
    upd('support_ticket_index/qa-t1', { normalizedTitle: S('x'), titleTokens: A(['x']), bodyTokens: A(['x']),
      title: S('Khong dang nhap duoc he thong diem danh QA') }),
  ]);
  check('sửa nội dung khi CHỜ TIẾP NHẬN', await suaND(T.gv), 200);
  await datPhieu('qa-t1', 'ACCEPTED');
  check('sửa nội dung khi ĐÃ TIẾP NHẬN bị chặn', await suaND(T.gv), 403);

  const xoa = (tok) => commit(tok, [del('support_tickets/qa-t1'), del('support_ticket_index/qa-t1')]);
  check('xoá phiếu ĐÃ TIẾP NHẬN bị chặn', await xoa(T.gv), 403);
  await datPhieu('qa-t1', 'TRIAGE');
  check('cán bộ PTUD không xoá phiếu của trường', await xoa(T.pm), 403);
  check('admin cũng không xoá phiếu', await xoa(T.admin), 403);
  check('trường xoá được phiếu CHƯA tiếp nhận', await xoa(T.gv), 200);

  // =====================================================================
  group('3. Hỏi thêm thông tin → trường bổ sung → quay lại hàng đợi');
  await datPhieu('qa-t1', 'TRIAGE');
  check('đầu mối hỏi thêm + gửi thông báo', await commit(T.pm, [
    upd('support_tickets/qa-t1', { status: S('NEEDS_INFO'), needsInfoRequest: S('Gui anh chup man hinh'),
      needsInfoBy: S('u-pm'), slaLastResumedAt: NUL, updatedAt: I(3) }),
    upd('support_ticket_index/qa-t1', { status: S('NEEDS_INFO') }),
    upd('notifications/qa-n1', { targetUserId: S('u-gv'), ticketId: S('qa-t1'),
      ticketNo: S('QA-WEB_FSB-2608-0001'), message: S('can bo sung'), read: B(false),
      time: { timestampValue: new Date().toISOString() } }),
  ]), 200);
  // Hai vector giả mạo mà QA bắt được: trường ghi đè CÂU HỎI của đầu mối, và
  // trường tự bấm đồng hồ SLA trên phiếu của chính mình.
  check('⭐ trường KHÔNG ghi đè được câu hỏi của đầu mối', await commit(T.gv, [
    upd('support_tickets/qa-t1', { needsInfoRequest: S('tu bien lai cau hoi'), updatedAt: I(3) }),
  ]), 403);
  check('⭐ trường KHÔNG tự bấm đồng hồ SLA của mình', await commit(T.gv, [
    upd('support_tickets/qa-t1', { slaLastResumedAt: I(999), updatedAt: I(3) }),
  ]), 403);
  check('⭐ trường bổ sung xong, phiếu tự quay lại hàng đợi', await commit(T.gv, [
    upd('support_tickets/qa-t1', { title: S('Khong dang nhap duoc he thong diem danh QA'),
      description: S('day du hon'), normalizedTitle: S('y'), titleTokens: A(['y']), bodyTokens: A(['y']),
      status: S('TRIAGE'), slaLastResumedAt: I(4), needsInfoRequest: S(''), updatedAt: I(4) }),
    upd('support_ticket_index/qa-t1', { normalizedTitle: S('y'), titleTokens: A(['y']), bodyTokens: A(['y']),
      title: S('Khong dang nhap duoc he thong diem danh QA'), status: S('TRIAGE') }),
    upd('notifications/qa-n2', { targetUserId: S('u-pm'), ticketId: S('qa-t1'),
      ticketNo: S('QA-WEB_FSB-2608-0001'), message: S('da bo sung'), read: B(false),
      time: { timestampValue: new Date().toISOString() } }),
  ]), 200);

  // =====================================================================
  group('4. Tiếp nhận → sinh công việc → quyền gán');
  const task = (assignee, actor) => ({
    projectId: S('p-web-fsb'), title: S('[QA] Loi dang nhap'), description: S('x'),
    category: S('Sửa lỗi'), priority: S('medium'), status: S('todo'), progress: I(0),
    date: S('2026-09-01'), assignees: A([assignee]), reviewers: A([actor]), cc: { arrayValue: {} },
    tags: A(['ho-tro', 'WEB_FSB', 'HN01']), attachedImages: { arrayValue: {} },
    subtasks: { arrayValue: {} }, comments: { arrayValue: {} },
    supportTicketId: S('qa-t1'), supportTicketNo: S('QA-WEB_FSB-2608-0001'),
  });
  check('⭐ nhân viên KHÔNG gán việc cho người khác',
    await commit(T.nv, [upd('projects/p-web-fsb/tasks/qa-task-1', task('u-pm', 'u-dev'))]), 403);
  check('nhân viên tự nhận việc',
    await commit(T.nv, [upd('projects/p-web-fsb/tasks/qa-task-1', task('u-dev', 'u-dev'))]), 200);
  await fetch(`${FS}/projects/p-web-fsb/tasks/qa-task-1`, { method: 'DELETE', headers: OWNER });
  check('quản lý dự án gán được cho nhân viên',
    await commit(T.pm, [upd('projects/p-web-fsb/tasks/qa-task-1', task('u-dev', 'u-pm'))]), 200);
  check('giáo viên không tạo được công việc',
    await commit(T.gv, [upd('projects/p-web-fsb/tasks/qa-task-2', task('u-gv', 'u-gv'))]), 403);

  // =====================================================================
  group('5. Phiếu chạy theo công việc + thông báo mỗi bước');
  await datPhieu('qa-t1', 'ACCEPTED');
  const chuyen = (to, extra = {}) => commit(T.pm, [
    upd(`support_tickets/qa-t1`, { status: S(to), updatedAt: I(9), ...extra }),
    upd(`support_ticket_index/qa-t1`, { status: S(to) }),
    upd(`notifications/qa-n-${to}`, { targetUserId: S('u-gv'), ticketId: S('qa-t1'),
      ticketNo: S('QA-WEB_FSB-2608-0001'), message: S(to), read: B(false),
      time: { timestampValue: new Date().toISOString() } }),
  ]);
  check('tiến độ > 0 → Đang xử lý', await chuyen('IN_PROGRESS'), 200);
  check('tiến độ 100% → Đã khắc phục', await chuyen('RESOLVED', { resolvedAt: I(9), slaLastResumedAt: NUL }), 200);
  check('nghiệm thu → Hoàn tất', await chuyen('CLOSED', { closedAt: I(9) }), 200);
  const dem = await runQuery(T.gv, { structuredQuery: { from: [{ collectionId: 'notifications' }],
    where: { compositeFilter: { op: 'AND', filters: [
      { fieldFilter: { field: { fieldPath: 'targetUserId' }, op: 'EQUAL', value: S('u-gv') } },
      { fieldFilter: { field: { fieldPath: 'read' }, op: 'EQUAL', value: B(false) } }] } } } });
  check('giáo viên có thông báo chưa đọc trên chuông', dem.rows.length > 0, true);
  check('mỗi bước chuyển đều có thông báo',
    dem.rows.filter((d) => (d.document.fields.ticketNo?.stringValue ?? '').startsWith('QA-')).length >= 3, true);

  // =====================================================================
  group('6. Trường nghiệm thu — đóng hoặc mở lại');
  await datPhieu('qa-t1', 'RESOLVED');
  check('⭐ trường đóng được phiếu đã khắc phục', await commit(T.gv, [
    upd('support_tickets/qa-t1', { status: S('CLOSED'), closedAt: I(5), updatedAt: I(5) }),
    upd('support_ticket_index/qa-t1', { status: S('CLOSED') }),
  ]), 200);
  await datPhieu('qa-t1', 'RESOLVED');
  check('⭐ trường mở lại được khi vẫn còn lỗi', await commit(T.gv, [
    upd('support_tickets/qa-t1', { status: S('REOPENED'), reopenCount: I(1),
      needsInfoRequest: S('Van con loi o phong 201'), resolvedAt: NUL, slaLastResumedAt: I(5), updatedAt: I(5) }),
    upd('support_ticket_index/qa-t1', { status: S('REOPENED') }),
  ]), 200);
  await datPhieu('qa-t1', 'ACCEPTED');
  check('trường KHÔNG tự đặt phiếu sang đã khắc phục', await commit(T.gv, [
    upd('support_tickets/qa-t1', { status: S('RESOLVED'), resolvedAt: I(5), updatedAt: I(5) }),
  ]), 403);

  // =====================================================================
  group('7. Quản trị — trường, phân hệ, loại thành viên');
  const truong = { id: S('QA01'), code: S('QA01'), name: S('Truong QA'), region: S('Mien Bac'),
    address: S('So 1 Duong QA'), province: S('Ha Noi'), levels: S('THPT'), isActive: B(true) };
  check('admin thêm trường + địa chỉ', await commit(T.admin, [upd('support_campuses/QA01', truong)]), 200);
  check('người không phải admin không thêm trường',
    await commit(T.pm, [upd('support_campuses/QA02', truong)]), 403);
  check('admin tạo phân hệ mới', await commit(T.admin, [upd('support_modules/QA_TMP',
    { code: S('QA_TMP'), name: S('Phan he QA'), ownerUserId: NUL, backupOwnerUserId: NUL,
      projectId: NUL, isActive: B(true) })]), 200);
  check('admin đổi tên phân hệ',
    await commit(T.admin, [upd('support_modules/QA_TMP', { name: S('Phan he QA doi ten') })]), 200);
  check('cán bộ PTUD không tạo phân hệ', await commit(T.pm, [upd('support_modules/QA_HACK',
    { code: S('QA_HACK'), name: S('x'), isActive: B(true) })]), 403);
  check('admin gán loại thành viên + trường', await commit(T.admin, [upd('support_role_assignments/qa-probe',
    { uid: S('qa-probe'), campusId: S('HN01'), supportRole: S('CAMPUS_FOCAL'), assignedBy: S('u-admin'),
      assignedAt: { timestampValue: new Date().toISOString() } })]), 200);
  check('người khác không gán loại thành viên', await commit(T.pm, [upd('support_role_assignments/qa-probe2',
    { uid: S('qa-probe2'), campusId: NUL, supportRole: S('SYS_ADMIN'), assignedBy: S('u-pm'),
      assignedAt: { timestampValue: new Date().toISOString() } })]), 403);
  await fetch(`${FS}/support_role_assignments/qa-probe`, { method: 'DELETE', headers: OWNER });

  // =====================================================================
  group('8. Thông báo — đúng người, đánh dấu đọc được');
  check('người khác KHÔNG đọc được thông báo của giáo viên',
    (await getDoc(T.nv, 'notifications/qa-n1')).status, 403);
  check('giáo viên đọc được thông báo của mình', (await getDoc(T.gv, 'notifications/qa-n1')).status, 200);
  check('⭐ giáo viên đánh dấu đã đọc được (chấm đỏ tắt được)',
    await commit(T.gv, [upd('notifications/qa-n1', { read: B(true) })]), 200);
  check('giáo viên không sửa được nội dung thông báo',
    await commit(T.gv, [upd('notifications/qa-n1', { message: S('doi noi dung') })]), 403);

  // =====================================================================
  group('9. Những lỗ /review bắt được — chống tái phát');
  const phieuGia = { ...phieu(), priority: S('P1'), assigneeUserId: S('u-dev'),
    dueAt: I(0), triagedBy: S('u-pm'), triagedAt: I(1),
    affectedCampusIds: A(['HN01', 'HCM01']) };
  check('⭐ trường KHÔNG tạo phiếu đóng dấu sẵn P1 / người xử lý / hạn',
    await commit(T.gv, [upd('support_tickets/qa-t2', phieuGia)]), 403);
  check('⭐ trường KHÔNG cài sẵn trường khác vào danh sách ảnh hưởng',
    await commit(T.gv, [upd('support_tickets/qa-t3',
      { ...phieu(), affectedCampusIds: A(['HN01', 'HCM01']) })]), 403);
  check('trường vẫn tạo được phiếu bình thường',
    await commit(T.gv, [upd('support_tickets/qa-t2', phieu())]), 200);

  check('⭐ trường KHÔNG bịa được dòng gương hiện cho 18 trường',
    await commit(T.gv, [upd('support_ticket_index/qa-gia',
      { ...guong(), title: S('Tieu de bia dat'), status: S('ACCEPTED') })]), 403);

  await datPhieu('qa-t1', 'RESOLVED');
  check('⭐ phiếu đã khắc phục: trường không đổi được tiêu đề trên bản gương',
    await commit(T.gv, [upd('support_ticket_index/qa-t1',
      { title: S('Doi tieu de sau khi da xong') })]), 403);
  check('nhưng vẫn đổi được TRẠNG THÁI để nghiệm thu',
    await commit(T.gv, [upd('support_ticket_index/qa-t1', { status: S('CLOSED') })]), 200);

  check('⭐ không ai hạ được bộ đếm số phiếu',
    await commit(T.gv, [upd('support_counters/WEB_FSB_2608', { period: S('2608'), seq: I(1) })]), 403);

  // =====================================================================
  group('10. Mã phiếu không bao giờ cấp lại');
  await fetch(`${FS}/support_ticket_numbers/QA-WEB_FSB-2608-0001`, {
    method: 'PATCH', headers: OWNER,
    body: JSON.stringify({ fields: { ticketId: S('qa-t1'), createdAt: I(1) } }),
  });
  check('không ai xoá được bản khoá mã phiếu',
    await commit(T.gv, [del('support_ticket_numbers/QA-WEB_FSB-2608-0001')]), 403);

  await donRac();
  await fetch(`${FS}/support_ticket_numbers/QA-WEB_FSB-2608-0001`, { method: 'DELETE', headers: OWNER });
  for (const n of ['qa-n1','qa-n2','qa-n-IN_PROGRESS','qa-n-RESOLVED','qa-n-CLOSED'])
    await fetch(`${FS}/notifications/${n}`, { method: 'DELETE', headers: OWNER });
  process.exit(summary() ? 1 : 0);
}
main().catch((e) => { console.error('❌ QA hỏng:', e); process.exit(1); });
