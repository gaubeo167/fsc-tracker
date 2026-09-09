import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COL, NOTIFY_COL, TICKET_COL } from '../types';

// Regression: ISSUE-001 — seed lại vẫn để sót nhóm và mẫu email của lần trước
// Found by /qa on 2026-09-09
// Report: .gstack/qa-reports/qa-report-localhost-3100-2026-09-09.md
//
// scripts/seed-test-env.ts xoá dữ liệu theo một danh sách collection GHI TAY.
// Mỗi lần thêm một collection mới mà quên cập nhật danh sách đó, môi trường thử
// lại mang theo dữ liệu của lần trước — lần này là hai nhóm trùng tên.
//
// Test này chốt đúng chỗ dễ quên: mọi collection cấp cao nhất khai trong types.ts
// đều phải có tên trong danh sách xoá. Nó đọc script như VĂN BẢN chứ không chạy,
// nên không cần emulator và chạy trong vài mili giây.

/**
 * Subcollection thì KHÔNG nằm trong danh sách xoá: chúng được xoá theo document
 * cha (xem nhánh riêng cho projects/tasks và support_announcements/deliveries).
 */
const LA_SUBCOLLECTION = new Set<string>([TICKET_COL.messages, NOTIFY_COL.deliveries]);

const nguonSeed = readFileSync(
  path.resolve(__dirname, '../../../../scripts/seed-test-env.ts'),
  'utf8'
);

const capCaoNhat = [...new Set([
  ...Object.values(COL),
  ...Object.values(NOTIFY_COL),
  ...Object.values(TICKET_COL),
])].filter((c) => !LA_SUBCOLLECTION.has(c));

describe('scripts/seed-test-env.ts xoá đủ mọi collection', () => {
  it.each(capCaoNhat)('có xoá %s', (ten) => {
    expect(nguonSeed).toContain(`'${ten}'`);
  });

  it('xoá subcollection deliveries trước khi xoá thông báo cha', () => {
    // Xoá document cha KHÔNG xoá con trong Firestore. Bỏ bước này thì bản ghi
    // từng lượt gửi thành mồ côi và vẫn đọc ra được ở lần seed sau.
    expect(nguonSeed).toContain(`collection('${NOTIFY_COL.deliveries}')`);
  });
});
