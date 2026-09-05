import { banner, getDb, parseArgs } from './_lib/admin';

// ===========================================================================
// Soi trạng thái tài khoản — tìm những người "vào được form nhưng tải ảnh lên
// bị chặn" (ISSUE-003).
//
// Vì sao cần một script riêng thay vì mở giao diện ra xem: nhóm tài khoản gây
// ra lỗi này KHÔNG hiện ở đâu trong giao diện. Hàng đợi "Duyệt tài khoản" truy
// vấn status == 'pending', nên hồ sơ THIẾU field status hoặc mang một giá trị
// lạ không nằm trong kết quả — mà đúng nhóm đó mới là nhóm hỏng.
//
// Cơ chế hỏng, đọc từ dưới lên:
//   storage.rules  → isApprovedUser() đòi users/{uid}.status == 'active'
//   firestore.rules→ isApproved() cũng đòi đúng 'active'
//   App.tsx        → cổng chặn toàn app chỉ chặn 'pending' và 'disabled'
// Tài khoản rơi vào kẽ giữa hai định nghĩa đó dựng được form báo lỗi (đọc bản
// gán trường CỦA CHÍNH MÌNH không cần isApproved) rồi hỏng ở đúng lượt ghi ảnh.
//
// Script này CHỈ ĐỌC. Không có nhánh ghi nào, kể cả với --apply.
//
// Chạy:  npx tsx scripts/audit-user-status.ts --project=fsc-tracker-2128a
//        npx tsx scripts/audit-user-status.ts --project=fsc-tracker-2128a --database=fsc-asia
// ===========================================================================

const opts = parseArgs(process.argv.slice(2));

/** Bốn giá trị hợp lệ. Mọi thứ khác là hồ sơ hỏng, kể cả field không tồn tại. */
const HOP_LE = ['active', 'pending', 'disabled'];

function nhomTrangThai(status: unknown): string {
  if (status === undefined || status === null || status === '') return 'THIẾU status';
  if (typeof status !== 'string') return `KIỂU LẠ (${typeof status})`;
  if (!HOP_LE.includes(status)) return `status lạ: "${status}"`;
  return status;
}

async function main() {
  banner('Soi trạng thái tài khoản (CHỈ ĐỌC)', opts);

  const db = getDb(opts);
  const [userSnap, assignSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('support_role_assignments').get(),
  ]);

  const banGan = new Map<string, any>(
    assignSnap.docs.map((d: any) => [d.id, d.data()])
  );

  const dem: Record<string, number> = {};
  /** Đã được gán trường nhưng chưa 'active' — đây chính là người báo lỗi tải ảnh. */
  const hongThatSu: string[] = [];
  /** Không hiện ở hàng đợi duyệt vì hàng đợi chỉ tìm status == 'pending'. */
  const voHinh: string[] = [];

  for (const d of userSnap.docs as any[]) {
    const u = d.data();
    const nhom = nhomTrangThai(u.status);
    dem[nhom] = (dem[nhom] ?? 0) + 1;

    const laActive = u.status === 'active';
    const laDisabled = u.status === 'disabled';
    const gan = banGan.get(d.id);
    const nhan = `${String(u.email ?? d.id).padEnd(34)} ${String(u.displayName ?? '').slice(0, 22).padEnd(24)} ${nhom}`;

    if (gan && !laActive) {
      hongThatSu.push(
        `${nhan}  ← đã gán ${gan.supportRole}${gan.campusId ? ` @ ${gan.campusId}` : ''}`
      );
    }
    if (!laActive && !laDisabled && u.status !== 'pending') {
      voHinh.push(nhan);
    }
  }

  console.log(`\n  ${userSnap.docs.length} tài khoản:`);
  for (const [k, v] of Object.entries(dem).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }

  console.log(`\n  ── Đã được gán trường/vai trò nhưng status ≠ 'active' (${hongThatSu.length}) ──`);
  console.log('     Nhóm này vào được form gửi phiếu, và tải ảnh lên sẽ báo "không có quyền".');
  hongThatSu.forEach((r) => console.log(`     ${r}`));
  if (!hongThatSu.length) console.log('     (không có)');

  console.log(`\n  ── Không hiện ở hàng đợi "Duyệt tài khoản" (${voHinh.length}) ──`);
  console.log("     Hàng đợi truy vấn status == 'pending' nên bỏ sót đúng những dòng này.");
  voHinh.forEach((r) => console.log(`     ${r}`));
  if (!voHinh.length) console.log('     (không có)');

  console.log('\n' + '─'.repeat(72));
  console.log('  Cách sửa: Hỗ trợ → Duyệt tài khoản (sau khi triển khai bản vá hàng đợi),');
  console.log('  hoặc Nhân sự → đặt lại "Loại thành viên" cho từng người.');
  console.log('─'.repeat(72));
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
