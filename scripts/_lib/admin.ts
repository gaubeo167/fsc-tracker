import { cert, getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { restDb } from './rest';

// ===========================================================================
// Khởi tạo Admin SDK + hàng rào an toàn cho mọi script.
//
// Admin SDK BỎ QUA HOÀN TOÀN firestore.rules. Nghĩa là mọi thứ ở đây có quyền
// đọc/ghi/xoá toàn bộ database, kể cả support_audit_log vốn được rules bảo vệ
// là append-only. Không có mạng lưới an toàn nào ngoài chính file này.
//
// Vì vậy mặc định là DRY-RUN: không truyền --apply thì không ghi một byte nào.
// ===========================================================================

export const PROD_PROJECT_ID = 'fsc-tracker-2128a';

export interface ScriptOptions {
  projectId: string;
  databaseId: string;
  apply: boolean;
  confirmed: string | null;
  useEmulator: boolean;
}

export function parseArgs(argv: string[]): ScriptOptions {
  const get = (name: string): string | null => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : null;
  };
  const has = (name: string) => argv.includes(`--${name}`);

  const useEmulator = has('emulator') || !!process.env.FIRESTORE_EMULATOR_HOST;
  return {
    projectId: get('project') ?? (useEmulator ? 'demo-fsc-tracker' : PROD_PROJECT_ID),
    // Chỉ có (default) và fsc-asia. Sai database id thì script ghi đúng dữ liệu
    // vào một database không ai đọc, và triệu chứng là giao diện trống trơn —
    // trùng với bốn nguyên nhân khác. Vì vậy luôn IN RA ở dòng đầu.
    databaseId: get('database') ?? process.env.FIRESTORE_DATABASE_ID ?? '(default)',
    apply: has('apply'),
    confirmed: get('confirm'),
    useEmulator,
  };
}

export function banner(scriptName: string, opts: ScriptOptions) {
  console.log('─'.repeat(64));
  console.log(`  ${scriptName}`);
  console.log(`  Project   : ${opts.projectId}${opts.useEmulator ? '  (EMULATOR)' : ''}`);
  console.log(`  Database  : ${opts.databaseId}`);
  console.log(`  Chế độ    : ${opts.apply ? '⚠️  GHI THẬT (--apply)' : '🔍 THỬ (dry-run, không ghi gì)'}`);
  console.log('─'.repeat(64));
}

/**
 * Chặn mọi thao tác ghi vào production nếu chưa gõ đủ tên project.
 * `--confirm=fsc-tracker-2128a` phải gõ TRỌN VẸN — cố ý bắt gõ tay để không ai
 * mũi tên-lên-enter lại lệnh cũ trong nhầm tab terminal.
 */
export function assertSafeToWrite(opts: ScriptOptions, destructive = false) {
  if (!opts.apply) return;

  // Đòi xác nhận với MỌI project thật, không riêng project production đã biết
  // tên. `--project=<một-project-thật-khác> --apply` trước đây đi thẳng qua đây
  // mà không cần --confirm: ai có credential chạm tới project nào thì ghi được
  // vào project đó, kể cả thao tác xoá.
  if (opts.useEmulator) return;

  if (opts.confirmed !== opts.projectId) {
    console.error(
      `\n❌ Đây là project PRODUCTION (${opts.projectId}).\n` +
        `   Muốn ghi thật, gõ đầy đủ:\n\n` +
        `      --apply --confirm=${opts.projectId}\n`
    );
    process.exit(1);
  }
  if (destructive && process.env.ALLOW_PROD_WRITE !== '1') {
    console.error(
      `\n❌ Đây là thao tác XOÁ DỮ LIỆU trên production.\n` +
        `   Firestore không có undo. Kiểm tra PITR đã bật chưa rồi chạy lại với:\n\n` +
        `      ALLOW_PROD_WRITE=1 npm run <script> -- --apply --confirm=${opts.projectId}\n`
    );
    process.exit(1);
  }
}

/**
 * Có file Application Default Credentials trên máy không.
 *
 * `gcloud auth login` (đăng nhập để dùng CLI) và `gcloud auth application-default
 * login` (cấp credential cho thư viện) là HAI thứ khác nhau, và người ta hay chỉ
 * làm cái đầu. Khi đó applicationDefault() ném lỗi "Could not load the default
 * credentials" ở đúng lúc script sắp ghi — sau khi đã in banner và làm người
 * chạy tưởng mọi thứ ổn.
 */
function coADC(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  return existsSync(join(homedir(), '.config/gcloud/application_default_credentials.json'));
}

export function getDb(opts: ScriptOptions) {
  if (!opts.useEmulator && !process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 && !coADC()) {
    console.log('  (dùng phiên gcloud đang đăng nhập — chưa có ADC trên máy này)');
    return restDb(opts.projectId, opts.databaseId) as any;
  }
  if (!getApps().length) {
    if (opts.useEmulator) {
      process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
      initializeApp({ projectId: opts.projectId });
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
      const json = JSON.parse(
        Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
      );
      initializeApp({ credential: cert(json), projectId: opts.projectId });
    } else if (coADC()) {
      // Không có service account thì dùng Application Default Credentials.
      // Ưu tiên cách này: không có file credential nào nằm trên đĩa để lỡ tay
      // commit. Chạy một lần: gcloud auth application-default login
      initializeApp({ credential: applicationDefault(), projectId: opts.projectId });
    } else {
      initializeApp({ credential: applicationDefault(), projectId: opts.projectId });
    }
  }
  return opts.databaseId === '(default)'
    ? getFirestore()
    : getFirestore(opts.databaseId);
}

/** Ghi có tôn trọng dry-run. Trả về số document đã (hoặc sẽ) ghi. */
export async function writeDocs(
  db: FirebaseFirestore.Firestore,
  collection: string,
  docs: Array<{ id: string; data: Record<string, unknown> }>,
  opts: ScriptOptions
): Promise<number> {
  for (const d of docs) {
    if (opts.apply) {
      await db.collection(collection).doc(d.id).set(d.data, { merge: true });
      console.log(`  ✓ ${collection}/${d.id}`);
    } else {
      console.log(`  · ${collection}/${d.id}  (sẽ ghi)`);
    }
  }
  return docs.length;
}
