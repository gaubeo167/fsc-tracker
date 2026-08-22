// ===========================================================================
// QA đầu-cuối trên EMULATOR, bằng token Auth THẬT của bốn loại tài khoản.
//
// Đi qua ĐÚNG những lượt ghi mà ứng dụng gửi đi, không phải qua hàm TypeScript:
// như vậy nó kiểm cả firestore.rules chứ không chỉ kiểm logic client. Rules mới
// là thứ chặn thật; test đi vòng qua rules chỉ chứng minh code chạy trên máy
// người viết nó.
//
// Chạy:  node scripts/qa/qa-suite.mjs
// ===========================================================================

const P = 'fsc-tracker-2128a';
const AUTH = 'http://127.0.0.1:9099';
const FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const D = `projects/${P}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });
const B = (v) => ({ booleanValue: v });
const A = (v) => ({ arrayValue: { values: v.map(S) } });
const NUL = { nullValue: null };

async function token(email) {
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub: email, email, email_verified: true }))}&providerId=google.com`,
      requestUri: 'http://localhost', returnSecureToken: true,
    }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`đăng nhập hỏng ${email}: ${JSON.stringify(j)}`);
  return j.idToken;
}
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

async function commit(tok, writes) {
  const r = await fetch(`${FS}:commit`, { method: 'POST', headers: H(tok), body: JSON.stringify({ writes }) });
  return r.status;
}
const upd = (path, fields) => ({
  update: { name: `${D}/${path}`, fields },
  updateMask: { fieldPaths: Object.keys(fields) },
});
const del = (path) => ({ delete: `${D}/${path}` });

async function runQuery(tok, body) {
  const r = await fetch(`${FS}:runQuery`, { method: 'POST', headers: H(tok), body: JSON.stringify(body) });
  if (r.status !== 200) return { status: r.status, rows: [] };
  const j = await r.json();
  return { status: 200, rows: (Array.isArray(j) ? j : []).filter((x) => x.document) };
}
async function getDoc(tok, path) {
  const r = await fetch(`${FS}/${path}`, { headers: H(tok) });
  return { status: r.status, doc: r.status === 200 ? await r.json() : null };
}

// ---------------------------------------------------------------------------
let pass = 0, fail = 0;
const fails = [];
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : (fail++, fails.push(`${name}: nhận ${JSON.stringify(got)}, mong đợi ${JSON.stringify(want)}`));
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${ok ? '' : `   → nhận ${JSON.stringify(got)}, mong đợi ${JSON.stringify(want)}`}`);
}
function group(t) { console.log(`\n\x1b[1m${t}\x1b[0m`); }

export { P, FS, D, OWNER, S, I, B, A, NUL, token, H, commit, upd, del, runQuery, getDoc, check, group };
export function summary() {
  console.log('\n' + '═'.repeat(72));
  console.log(`  ${pass} ĐẠT · ${fail} HỎNG`);
  if (fail) { console.log('─'.repeat(72)); fails.forEach((f) => console.log('  ✗ ' + f)); }
  console.log('═'.repeat(72));
  return fail;
}
