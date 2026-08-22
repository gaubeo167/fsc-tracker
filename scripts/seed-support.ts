import { DEFAULT_SLA_POLICIES } from '../src/modules/support/services/slaCalculator';
import { SUPPORT_MODULES } from '../src/modules/support/types';
import { assertSafeToWrite, banner, getDb, parseArgs, writeDocs } from './_lib/admin';

// ===========================================================================
// Seed dữ liệu THAM CHIẾU của module hỗ trợ.
//
// Chỉ seed những thứ §2 và §7 spec quy định là CỐ ĐỊNH:
//   - 5 phân hệ
//   - ma trận SLA
//   - lịch làm việc + ngày lễ
//
// KHÔNG seed 18 campus. Campus là dữ liệu do quản trị viên tự tạo trong sản
// phẩm (màn Quản lý trường), vì danh sách và mã trường là thứ chỉ phía nghiệp
// vụ chốt được, và nó sẽ thay đổi — seed cứng nghĩa là mỗi lần đổi phải sửa
// code rồi deploy lại.
//
// Chạy thử (mặc định, không ghi gì):
//   npx tsx scripts/seed-support.ts --emulator
// Ghi vào emulator:
//   npx tsx scripts/seed-support.ts --emulator --apply
// Ghi vào production:
//   npx tsx scripts/seed-support.ts --apply --confirm=fsc-tracker-2128a --database=fsc-asia
// ===========================================================================

const opts = parseArgs(process.argv.slice(2));
banner('seed-support — dữ liệu tham chiếu module hỗ trợ', opts);
assertSafeToWrite(opts);

const db = getDb(opts);

async function main() {
  let total = 0;

  console.log('\n[1/3] Phân hệ hỗ trợ (5 nhóm cố định)');
  total += await writeDocs(
    db,
    'support_modules',
    SUPPORT_MODULES.map((m) => ({
      id: m.code,
      data: {
        code: m.code,
        name: m.name,
        // Đầu mối để trống: gán qua giao diện sau khi có người dùng thật.
        // Seed sẵn uid giả sẽ tạo ra đầu mối không tồn tại, và thông báo sẽ
        // gửi vào hư không mà không ai biết.
        ownerUserId: null,
        backupOwnerUserId: null,
        isActive: true,
      },
    })),
    opts
  );

  console.log('\n[2/3] Ma trận SLA (§7)');
  total += await writeDocs(
    db,
    'support_sla_policies',
    DEFAULT_SLA_POLICIES.map((p) => ({
      id: p.id,
      data: {
        type: p.type,
        priority: p.priority,
        firstResponseMinutes: p.firstResponseMinutes,
        resolutionMinutes: p.resolutionMinutes,
        isActive: true,
      },
    })),
    opts
  );

  console.log('\n[3/3] Lịch làm việc + ngày lễ');
  total += await writeDocs(
    db,
    'support_config',
    [
      {
        id: 'working_calendar',
        data: {
          // T2-T6, 08:00-17:00 giờ Việt Nam. Phút tính từ 00:00.
          windows: [1, 2, 3, 4, 5].map((weekday) => ({
            weekday,
            startMinute: 8 * 60,
            endMinute: 17 * 60,
          })),
          timezone: 'Asia/Ho_Chi_Minh',
          utcOffsetMinutes: 420,
        },
      },
      {
        id: 'holidays',
        data: {
          // Để trống có chủ đích. Ngày lễ Việt Nam đổi theo năm (Tết âm lịch,
          // ngày nghỉ bù do Chính phủ công bố) nên seed cứng là chắc chắn sai
          // sau 12 tháng. Nhập qua giao diện quản trị.
          dates: [] as string[],
          // Thứ Bảy làm bù dịp Tết/30-4. Mô hình chỉ T2-T6 không diễn đạt được,
          // nên phải có ghi đè theo từng ngày.
          overrides: {} as Record<string, { isWorking: boolean }>,
        },
      },
    ],
    opts
  );

  console.log(
    `\n${opts.apply ? '✅ Đã ghi' : '🔍 Sẽ ghi'} ${total} document.` +
      (opts.apply ? '' : '\n   Thêm --apply để ghi thật.')
  );
  console.log('\nBước tiếp theo: vào màn Hỗ trợ → Quản lý trường để tạo danh sách trường.');
}

main().catch((err) => {
  console.error('\n❌ Seed thất bại:', err?.message ?? err);
  process.exit(1);
});
