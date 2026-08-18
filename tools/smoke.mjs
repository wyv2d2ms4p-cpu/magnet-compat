/**
 * dist/index.html を file:// で実際に開いて動作を確認する。
 *
 * オフライン利用が前提のアプリなので、HTTPサーバ経由ではなく file:// で開く。
 * ネットワークアクセスが1件でも発生したら失敗させる（外部依存の混入検出）。
 *
 *   node tools/smoke.mjs
 */
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = pathToFileURL(join(ROOT, 'dist', 'index.html')).href;

const failures = [];
let n = 0;
function check(name, cond, detail) {
  n++;
  if (cond) console.log(`  ${String(n).padStart(2)}. OK  ${name}`);
  else { failures.push(name); console.log(`  ${String(n).padStart(2)}. NG  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();

const consoleErrors = [];
const external = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('request', (r) => { if (!r.url().startsWith('file://') && !r.url().startsWith('data:')) external.push(r.url()); });

/** カテゴリチップは検索画面（step1）にのみ出るので、必要なら戻ってから切り替える */
async function gotoCategory(id) {
  if (!(await page.$(`[data-act="cat"][data-v="${id}"]`))) {
    // 確認画面には「型式を選び直す」、結果画面には「最初からやり直す」がある
    const back = (await page.$('[data-act="step"][data-v="1"]')) || (await page.$('[data-act="reset"]'));
    if (!back) throw new Error('検索画面へ戻る導線が見つかりません');
    await back.click();
    await page.waitForSelector('[data-act="cat"]');
  }
  await page.click(`[data-act="cat"][data-v="${id}"]`);
  await page.waitForSelector('#q');
}

/** 型式を検索して確認画面まで進む */
async function search(model) {
  await page.fill('#q', model);
  await page.click('[data-act="search"]');
}

console.log(`file:// で起動: ${url}\n`);
await page.goto(url);
await page.waitForSelector('#app .chiprow');

check('JSエラーなしで起動する', consoleErrors.length === 0, consoleErrors[0]);
check('外部ネットワークアクセスが発生しない', external.length === 0, external[0]);

// カテゴリチップが9つ、横一列で出る
const chips = await page.$$eval('.chiprow [data-act="cat"]', (els) => els.map((e) => e.textContent.trim()));
check('カテゴリチップが9つ並ぶ', chips.length === 9, `実際: ${chips.length} / ${chips.join(',')}`);

// チップ行が縦に折り返していないこと（横スクロールで収める設計）
const rowHeight = await page.$eval('.chiprow', (e) => e.getBoundingClientRect().height);
check('チップ行が1行に収まる（縦に伸びない）', rowHeight < 80, `高さ ${rowHeight}px`);

/* ---- 接触器: 検索 → 確認 → 結果 ---- */
await page.fill('#q', 'S-T10');
await page.click('[data-act="search"]');
await page.waitForSelector('.model.big');
check('S-T10 で確認画面に進む', (await page.textContent('.model.big')).includes('S-T10'));
check('定格使用電流がAで表示される', (await page.textContent('#app')).includes('11A'));

await page.click('[data-act="step"][data-v="3"]');
await page.waitForSelector('.card');
const cards = await page.$$('.card');
check('互換候補が表示される', cards.length > 0, `${cards.length}件`);

/* ---- 近接: 同じ画面で mm 表示になる ---- */
await gotoCategory('proximity');
await search('E2E-X4D1');
await page.waitForSelector('.model.big');
const proxText = await page.textContent('#app');
check('近接センサで検出距離が mm 表示になる', proxText.includes('4mm'), '同じ specDefs 機構で単位が切り替わる');
check('近接センサで A 表記が出ない', !/\b4A\b/.test(proxText));

/* ---- 特殊: 導光路長と「該当なし」の出し分け ---- */
await gotoCategory('special');
await page.click('[data-act="browse"]');
await page.waitForSelector('.rows .row');
const specialRows = await page.$$eval('.rows .row', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
const llk = specialRows.find((t) => t.includes('PR-LLK 2m'));
const osa = specialRows.find((t) => t.includes('OSA 674'));
check('導光路品は長さが出る (PR-LLK 2m → 2m)', !!llk && llk.includes('2m'), llk);
check('熱間金属検出は「―」になる (0mm と表示しない)', !!osa && osa.includes('―') && !osa.includes('0mm'), osa);

/* ---- 既知の不具合5件の修正確認 ---- */

// (a) 接触器直付 — サーマルの取付方式が選択肢に出る
await gotoCategory('thermal');
await search('TH-T18');
await page.waitForSelector('.model.big');
const mountChips = await page.$$eval('[data-act="mount"]', (els) => els.map((e) => e.textContent.trim()));
check('サーマルの取付方式「接触器直付」が選択肢にある', mountChips.includes('接触器直付'), mountChips.join(','));
const selected = await page.$$eval('[data-act="mount"].on', (els) => els.length);
check('取付方式がいずれか選択状態になっている', selected === 1, `選択数 ${selected}`);

// (b) note の描画（移行元では一度も描画されていなかった）
await gotoCategory('contactor');
await search('HC35');
await page.waitForSelector('.model.big');
const noteEl = await page.$('.note');
const noteText = noteEl ? (await noteEl.textContent()).trim() : '';
check('デバイスの note が実際に描画される',
  noteText.includes('電気的耐久性100万回'), `取得: "${noteText}"`);

// (c) S-N10 / SN10 の取り違え防止
await gotoCategory('contactor');
await search('SN10');
await page.waitForTimeout(120);
const ambiguous = await page.$$('[data-act="pick"]');
const warnText = (await page.textContent('#app')) || '';
check('SN10 が曖昧なとき確定せず選ばせる', warnText.includes('取り違え') && ambiguous.length >= 2, `候補 ${ambiguous.length}件`);

// (d) NPN/PNP のハードフィルタ
await gotoCategory('proximity');
await search('E2E-X4D1');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(150);
const npnResult = await page.$$eval('.card', (els) => els.map((e) => e.textContent));
const pnpLeak = npnResult.filter((t) => /PNP/.test(t) && !/NPN/.test(t));
check('NPN機の候補にPNP専用機が出ない', pnpLeak.length === 0, `${pnpLeak.length}件混入`);

// (e) 寸法が確認済みなら外形図を描き、未確認なら描かない
await gotoCategory('contactor');
await search('S-T10');            // evidence.dims = verified
await page.waitForSelector('.model.big');
check('寸法確認済みなら外形図(SVG)を描く', (await page.$('#app svg')) !== null);

await gotoCategory('contactor');
await search('S-T35');            // evidence.dims = verified 以外
await page.waitForSelector('.model.big');
const noSvg = (await page.$('#app svg')) === null;
const noticed = (await page.textContent('#app')).includes('外形寸法は未確認');
check('寸法未確認なら外形図を描かず理由を明示する', noSvg && noticed, `svg無=${noSvg} 文言=${noticed}`);

await browser.close();

console.log('');
if (failures.length) {
  console.error(`スモークテスト失敗: ${failures.length} / ${n} 項目が NG`);
  process.exit(1);
}
console.log(`スモークテスト成功: ${n} / ${n} 項目すべて PASS`);
