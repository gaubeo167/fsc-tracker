import { assertSafeToWrite, banner, getDb, parseArgs } from './_lib/admin';

// ===========================================================================
// Bổ sung `title` và `type` vào support_ticket_index cho những phiếu tạo TRƯỚC
// khi hai field này có mặt.
//
// Vì sao cần: cảnh báo trùng đọc dữ liệu từ bản gương. Phiếu cũ thiếu title thì
// cảnh báo rơi về hiện normalizedTitle — tiêu đề đã bỏ dấu, khó đọc, và người
// dùng không dựa vào đó để kết luận trùng được.
//
// CHỈ ĐỌC ĐỂ SO SÁNH rồi vá đúng những document còn thiếu. Không đụng document
// đã đủ field, không đụng bản gương không còn phiếu gốc (xoá nó là xoá mất dấu
// vết một mã phiếu đã cấp).
//
// Đi qua hàng rào chung ở _lib/admin.ts: mặc định DRY-RUN, ghi vào project thật
// phải gõ trọn --confirm=<projectId>, và tôn trọng --database.
//
// Chạy thử:  npx tsx scripts/backfill-index-title.ts --project=fsc-tracker-2128a
// Ghi thật:  npx tsx scripts/backfill-index-title.ts --project=fsc-tracker-2128a --apply --confirm=fsc-tracker-2128a
// ===========================================================================

const opts = parseArgs(process.argv.slice(2));

async function main() {
  banner('Bổ sung title/type cho bản gương phiếu cũ', opts);
  assertSafeToWrite(opts);
  const db = getDb(opts);

  const [tickets, index] = await Promise.all([
    db.collection('support_tickets').get(),
    db.collection('support_ticket_index').get(),
  ]);
  const byId = new Map(tickets.docs.map((d: any) => [d.id, d.data()]));

  let done = 0, skipped = 0, orphan = 0;
  for (const d of index.docs as any[]) {
    const cur = d.data();
    if (cur.title && cur.type) { skipped++; continue; }
    const t = byId.get(d.id) as any;
    if (!t) { orphan++; continue; }
    if (opts.apply) {
      await d.ref.update({ title: t.title ?? '', type: t.type ?? 'BUG' });
    }
    console.log(`  ~ ${String(cur.ticketNo ?? d.id).padEnd(34)} ${t.title ?? ''}`);
    done++;
  }

  console.log('─'.repeat(72));
  console.log(`  Bổ sung ${done} · Đã có sẵn ${skipped} · ${orphan} bản gương không còn phiếu gốc`);
  if (!opts.apply && done > 0) {
    console.log('  🔍 DRY-RUN — chưa ghi gì. Thêm --apply để ghi thật.');
  }
  console.log('─'.repeat(72));
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
