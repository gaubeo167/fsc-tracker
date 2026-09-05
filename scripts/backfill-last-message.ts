import { assertSafeToWrite, banner, getDb, parseArgs } from './_lib/admin';

// ===========================================================================
// Chép dấu vết lượt trao đổi gần nhất lên những phiếu ĐÃ CÓ tin nhắn từ trước.
//
// Vì sao cần: ba field lastMessageAt/By/Side chỉ được ghi từ lúc tính năng
// "dấu hiệu có trao đổi" lên production. Mọi cuộc trao đổi diễn ra TRƯỚC đó
// không có dấu vết, nên chip "Trường vừa nhắn" và note trên phiếu không hiện —
// đúng những cuộc trao đổi đầu tiên, tức là những cuộc người ta đang chờ trả
// lời nhất.
//
// Không có script này thì cách duy nhất để một phiếu cũ hiện dấu hiệu là có
// người nhắn thêm một câu nữa, mà chính việc không thấy dấu hiệu là lý do không
// ai vào nhắn.
//
// Chỉ ghi 3 field, chỉ với phiếu thực sự có tin nhắn, và chỉ khi phiếu chưa có
// dấu vết. Không đụng trạng thái, không đụng updatedAt.
//
// Chạy thử:  npx tsx scripts/backfill-last-message.ts --project=fsc-tracker-2128a
// Ghi thật:  npx tsx scripts/backfill-last-message.ts --project=fsc-tracker-2128a --apply --confirm=fsc-tracker-2128a
// ===========================================================================

const opts = parseArgs(process.argv.slice(2));

async function main() {
  banner('Vá dấu vết trao đổi cho phiếu cũ', opts);
  assertSafeToWrite(opts);
  const db = getDb(opts);

  const tickets = await db.collection('support_tickets').get();
  let va = 0, boQua = 0, khongCoTin = 0;

  for (const d of tickets.docs as any[]) {
    const t = d.data();
    if (t.lastMessageAt) { boQua++; continue; }

    // Đường dẫn dạng chuỗi ba đoạn: chạy được với cả Admin SDK lẫn lớp REST
    // tối giản ở _lib/rest.ts, vốn không có .doc().collection().
    const tin = await db.collection(`support_tickets/${d.id}/messages`).get();
    if (!tin.docs.length) { khongCoTin++; continue; }

    const moiNhat = (tin.docs as any[])
      .map((m) => m.data())
      .sort((a, b) => Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0))[0];

    console.log(
      `  ~ ${String(t.ticketNo ?? d.id).padEnd(32)} ${tin.docs.length} tin, ` +
      `gần nhất ${new Date(Number(moiNhat.createdAt)).toISOString().slice(0, 16)} ` +
      `(${moiNhat.authorSide})`
    );
    if (opts.apply) {
      await db.collection('support_tickets').doc(d.id).update({
        lastMessageAt: Number(moiNhat.createdAt ?? 0),
        lastMessageBy: String(moiNhat.authorUid ?? ''),
        lastMessageSide: moiNhat.authorSide === 'PTUD' ? 'PTUD' : 'CAMPUS',
      });
    }
    va++;
  }

  console.log('─'.repeat(72));
  console.log(`  Vá ${va} · Đã có dấu vết ${boQua} · Không có tin nhắn ${khongCoTin}`);
  if (!opts.apply && va > 0) console.log('  🔍 DRY-RUN — chưa ghi gì. Thêm --apply để ghi thật.');
  console.log('─'.repeat(72));
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
