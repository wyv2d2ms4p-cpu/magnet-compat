/**
 * カテゴリを1つ足したときに、ビルドからUIの互換判定までが動くことを自動で確かめる。
 *
 * 拡張しやすさは統合の目的そのものなので、口頭の約束ではなくテストとして固定する。
 * ダミーカテゴリ（`data/dummy.json` と `src/categories/dummy.mjs`）を置いてビルドし、
 * UIへ出て互換判定まで動くことを確認したうえで、必ず後始末する。
 *
 * **検査1が保証していないこと。**
 * 検査1「ビルドがコアと build.mjs を書き換えない」は、
 * *開発者がコアを編集していないこと* を見ていない。比較の before はこのテストが
 * 起動した時点のファイル内容で、比較相手は build.mjs を1回走らせた後の内容なので、
 * コアが編集された状態で起動すればその編集は before 側に入り、一致してしまう。
 * 確かめているのは「ビルドがコアを書き換えないこと」だけ。
 * （開発者の編集を見るなら比較の相手は origin であって before ではない。
 *   検査の向きが変わるので、ここでは名前を実態に合わせるにとどめる。）
 *
 * **このテストが通っても、カテゴリ追加に要るファイルが2つとは限らない。**
 * ここは verify-data を走らせないため、追加レコードの規約（検査12）を通っていない。
 * 新カテゴリの `specs` のキーは `tools/schema-map.mjs` の `ADDED_SPEC_KEYS` にも
 * 宣言が要る（未宣言だと検査12で落ちる。PR #27 の破壊テストで確認済み）。
 * 何が要るかは README「カテゴリを追加する」を唯一の記述とする。
 *
 *   node tools/test-extensibility.mjs
 */
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data', 'dummy.json');
const MOD_FILE = join(ROOT, 'src', 'categories', 'dummy.mjs');
const CORE_FILES = ['src/core/util.mjs', 'src/core/store.mjs', 'src/core/registry.mjs',
  'src/core/compat.mjs', 'src/core/evidence.mjs', 'src/core/ui.mjs', 'src/core/app.mjs',
  'src/index.html', 'build.mjs'];

const failures = [];
let n = 0;
function check(name, cond, detail) {
  n++;
  if (cond) console.log(`  ${n}. OK  ${name}`);
  else { failures.push(name); console.log(`  ${n}. NG  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const before = new Map(CORE_FILES.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

const DUMMY_DATA = [
  { id: 'DUMMY-1', category: 'dummy', maker: 'テスト', model: 'DMY-100', modelStatus: 'catalog-confirmed',
    compatKey: 'D-100', dims: { w: 10, h: 20, d: 30 }, mounting: 'DINレール',
    specs: { torqueNm: 100 },
    evidence: { model: { state: 'verified' }, dims: { state: 'verified' }, specs: { state: 'verified' } } },
  { id: 'DUMMY-2', category: 'dummy', maker: 'テスト', model: 'DMY-110', modelStatus: 'catalog-confirmed',
    compatKey: 'D-100', dims: { w: 10, h: 20, d: 30 }, mounting: 'DINレール',
    specs: { torqueNm: 110 },
    evidence: { model: { state: 'verified' }, dims: { state: 'verified' }, specs: { state: 'verified' } } },
];

const DUMMY_MODULE = `import { registerCategory } from '../core/registry.mjs';
import { withinWindow, preferTrue, ascending } from '../core/compat.mjs';
registerCategory({
  id: 'dummy', label: 'ダミー', group: 'test',
  specDefs: [{ key: 'torqueNm', label: '定格トルク', unit: 'N·m', primary: true, format: (v) => \`\${v}N·m\` }],
  gate: (a, m) => withinWindow(a.specs?.torqueNm, m.specs?.torqueNm, 0.3),
  rank: (a, b) => preferTrue(a.mountingMatch, b.mountingMatch) || ascending(a.diff, b.diff),
  summary: (d) => [{ label: '定格トルク', value: \`\${d.specs.torqueNm}N·m\` }],
});
`;

let browser;
try {
  writeFileSync(DATA_FILE, JSON.stringify(DUMMY_DATA, null, 2) + '\n');
  writeFileSync(MOD_FILE, DUMMY_MODULE);

  execFileSync('node', [join(ROOT, 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
  check('ビルドがコアと build.mjs を書き換えない',
    CORE_FILES.every((f) => readFileSync(join(ROOT, f), 'utf8') === before.get(f)));

  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  await page.goto(pathToFileURL(join(ROOT, 'dist', 'index.html')).href);
  await page.waitForSelector('.chiprow');

  check('新カテゴリのチップがUIに出る', (await page.$('[data-act="cat"][data-v="dummy"]')) !== null);

  await page.click('[data-act="cat"][data-v="dummy"]');
  await page.fill('#q', 'DMY-100');
  await page.click('[data-act="search"]');
  await page.waitForSelector('.model.big');
  check('宣言した単位(N·m)で表示される', (await page.textContent('#app')).includes('100N·m'));

  await page.click('[data-act="step"][data-v="3"]');
  await page.waitForTimeout(200);
  check('互換判定が動く', (await page.$$('.card')).length === 1);
  check('JSエラーが出ない', errs.length === 0, errs[0]);
} finally {
  if (browser) await browser.close();
  rmSync(DATA_FILE, { force: true });
  rmSync(MOD_FILE, { force: true });
  execFileSync('node', [join(ROOT, 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
}

check('後始末が済んでいる（ダミーが残っていない）',
  !existsSync(DATA_FILE) && !existsSync(MOD_FILE) && !readFileSync(join(ROOT, 'dist/index.html'), 'utf8').includes('DUMMY-1'));

console.log('');
if (failures.length) {
  console.error(`拡張性テスト失敗: ${failures.length} / ${n} 項目が NG`);
  process.exit(1);
}
console.log(`拡張性テスト成功: ${n} / ${n} 項目すべて PASS`
  + '（ビルドはコアを書き換えない。カテゴリ追加に要るものは README「カテゴリを追加する」）');
