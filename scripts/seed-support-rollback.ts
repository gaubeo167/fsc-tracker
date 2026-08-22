import { assertSafeToWrite, banner, getDb, parseArgs } from './_lib/admin';

// ===========================================================================
// Gỡ dữ liệu module hỗ trợ.
//
// ⚠️ ĐỌC TRƯỚC KHI CHẠY
//
// Script này chạy bằng Admin SDK, tức là BỎ QUA firestore.rules hoàn toàn.
// Nó xoá được cả support_audit_log — cuốn sổ mà rules bảo vệ là append-only.
// Firestore KHÔNG có transaction log, KHÔNG có undo. Phục hồi chỉ có PITR,
// và PITR phải bật TRƯỚC khi mất dữ liệu chứ không phải sau.
//
// Vì vậy có ba lớp chặn, cố ý làm phiền:
//   1. Mặc định dry-run, phải --apply
//   2. Trên production phải --confirm=<đủ tên project>
//   3. Trên production còn phải ALLOW_PROD_WRITE=1
//
// Mặc định chỉ xoá dữ liệu THAM CHIẾU (phân hệ, SLA, cấu hình). Muốn xoá cả
// trường và bản ghi phân quyền phải thêm --include-campuses, vì đó là dữ liệu
// do người dùng nhập tay, không tái tạo được bằng seed.
//
// Chạy thử:
//   npx tsx scripts/seed-support-rollback.ts --emulator
// ===========================================================================

const REFERENCE_COLLECTIONS = ['support_modules', 'support_sla_policies', 'support_config'];
const USER_DATA_COLLECTIONS = ['support_campuses', 'support_role_assignments'];

const opts = parseArgs(process.argv.slice(2));
const includeCampuses = process.argv.includes('--include-campuses');

banner('seed-support-rollback — GỠ dữ liệu module hỗ trợ', opts);
assertSafeToWrite(opts, /* destructive */ true);

const db = getDb(opts);
const targets = includeCampuses
  ? [...REFERENCE_COLLECTIONS, ...USER_DATA_COLLECTIONS]
  : REFERENCE_COLLECTIONS;

async function main() {
  console.log(`\nCollection sẽ xử lý: ${targets.join(', ')}`);
  if (!includeCampuses) {
    console.log('(Giữ nguyên support_campuses và support_role_assignments — thêm --include-campuses để xoá luôn)');
  }

  let grandTotal = 0;
  for (const name of targets) {
    const snap = await db.collection(name).get();
    console.log(`\n${name}: ${snap.size} document`);
    grandTotal += snap.size;

    if (!opts.apply) {
      snap.docs.slice(0, 5).forEach((d) => console.log(`  · ${name}/${d.id}  (sẽ xoá)`));
      if (snap.size > 5) console.log(`  · … và ${snap.size - 5} document nữa`);
      continue;
    }

    // Xoá theo lô 500 — trần một batch của Firestore.
    let batch = db.batch();
    let inBatch = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      if (++inBatch === 500) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();
    console.log(`  ✓ đã xoá ${snap.size} document`);
  }

  console.log(
    `\n${opts.apply ? '✅ Đã xoá' : '🔍 Sẽ xoá'} tổng ${grandTotal} document.` +
      (opts.apply ? '' : '\n   Thêm --apply để xoá thật.')
  );
}

main().catch((err) => {
  console.error('\n❌ Rollback thất bại:', err?.message ?? err);
  process.exit(1);
});
