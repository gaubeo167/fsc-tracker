import { FSCHOOLS_CAMPUSES } from './data/fschools-campuses';
import { assertSafeToWrite, banner, getDb, parseArgs } from './_lib/admin';

// ===========================================================================
// Nhập 18 điểm trường FSchools vào collection support_campuses.
//
// UPSERT chứ không ghi đè trắng: chạy lại nhiều lần vẫn ra đúng một kết quả, và
// KHÔNG đụng tới cờ isActive. Trường nào admin đã tắt bằng tay thì vẫn tắt sau
// khi chạy lại — nếu không, mỗi lần chạy lại là bật lại hết những trường vừa
// tắt và không ai hiểu vì sao.
//
// Cũng KHÔNG xoá trường nào đang có: phiếu lịch sử trỏ về campusId, xoá là để
// lại tham chiếu mồ côi.
//
// ĐI QUA hàng rào chung ở _lib/admin.ts, không tự dựng cơ chế riêng:
//   - mặc định DRY-RUN, không ghi một byte nào nếu thiếu --apply
//   - ghi vào project thật phải gõ trọn --confirm=<projectId>
//   - TÔN TRỌNG --database / FIRESTORE_DATABASE_ID
//
// Điểm cuối quan trọng nhất: hệ thống có HAI database ((default) và fsc-asia).
// getFirestore() không tham số luôn trỏ vào (default). Chạy sau đợt chuyển vùng
// sang asia-southeast1 mà không chọn database thì 18 trường rơi vào database đã
// bỏ, script vẫn in "thành công", còn ứng dụng hiện danh sách trường trống.
//
// Chạy thử:  npx tsx scripts/import-campuses.ts --emulator
// Ghi thật:  npx tsx scripts/import-campuses.ts --apply --confirm=fsc-tracker-2128a --database=fsc-asia
// ===========================================================================

const opts = parseArgs(process.argv.slice(2));

async function main() {
  banner(`Nhập ${FSCHOOLS_CAMPUSES.length} điểm trường FSchools`, opts);
  assertSafeToWrite(opts);
  const db = getDb(opts);

  const snap = await db.collection('support_campuses').get();
  const dangCo = new Map(snap.docs.map((d) => [d.id, d.data()]));

  let them = 0, capNhat = 0, khongDoi = 0;
  for (const c of FSCHOOLS_CAMPUSES) {
    const cu = dangCo.get(c.code);
    const payload: Record<string, unknown> = {
      id: c.code,
      code: c.code,
      name: c.name,
      region: c.region,
      address: c.address,
      province: c.province,
      levels: c.levels,
      officialCode: c.officialCode,
      note: c.note,
    };
    if (!cu) {
      // Chỉ đặt isActive lúc TẠO MỚI. Xem ghi chú đầu file.
      if (opts.apply) {
        await db.collection('support_campuses').doc(c.code).set({
          ...payload, isActive: true, createdAt: new Date(), createdBy: 'import-script',
        });
      }
      console.log(`  + ${c.code.padEnd(6)} ${c.name}`);
      them++;
      continue;
    }
    const doiGi = Object.keys(payload).filter((k) => cu[k] !== payload[k]);
    if (doiGi.length === 0) { khongDoi++; continue; }
    if (opts.apply) {
      await db.collection('support_campuses').doc(c.code).set(payload, { merge: true });
    }
    console.log(`  ~ ${c.code.padEnd(6)} ${c.name}  (đổi: ${doiGi.join(', ')})`);
    capNhat++;
  }

  const laLuot = [...dangCo.keys()].filter((id) => !FSCHOOLS_CAMPUSES.some((c) => c.code === id));

  console.log('─'.repeat(72));
  console.log(`  Thêm mới ${them} · Cập nhật ${capNhat} · Không đổi ${khongDoi}`);
  if (!opts.apply) console.log('  🔍 DRY-RUN — chưa ghi gì. Thêm --apply để ghi thật.');
  if (laLuot.length > 0) {
    console.log(`  Giữ nguyên ${laLuot.length} trường không có trong file: ${laLuot.join(', ')}`);
    console.log('  (Không xoá: phiếu lịch sử trỏ về mã trường. Muốn ẩn thì tắt trong Hỗ trợ > Trường học.)');
  }
  console.log('─'.repeat(72));
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
