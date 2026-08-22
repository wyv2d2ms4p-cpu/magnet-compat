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

/**
 * ②確認画面の枠を DOM の出現順のまま拾う。
 *
 * 並び順は app.mjs の記述順にしか存在せず、入れ替えても「文言が画面のどこかにある」
 * 検査は全部通ってしまう。ここで見るのは文字列の有無ではなく枠どうしの前後関係なので、
 * `querySelectorAll`（＝文書順）で並びを取り、その添字を比較する。
 *
 * scopeNote / discontinuedNote / warningBox はどれも同じ `.warn` で描かれるため、
 * 枠の種別は中の文言で見分ける（警告の本文そのものではなく、どの枠かを言い当てるための
 * 目印として使う。`.warn` に種別クラスを足す実装になっても、この見分けは変わらない）。
 */
async function confirmBoxOrder() {
  return page.$$eval('.warn, .cmp-info', (els) => els.map((e) => {
    const t = e.textContent.replace(/\s+/g, ' ').trim();
    if (e.classList.contains('cmp-info')) return '後継品枠';
    if (t.includes('シリーズ単位の記載')) return 'scopeNote';
    if (t.includes('生産終了')) return 'discontinuedNote';
    return 'その他の警告';
  }));
}

console.log(`file:// で起動: ${url}\n`);
await page.goto(url);
await page.waitForSelector('#app .chiprow');

check('JSエラーなしで起動する', consoleErrors.length === 0, consoleErrors[0]);
check('外部ネットワークアクセスが発生しない', external.length === 0, external[0]);

// カテゴリチップが9つ出る
const chips = await page.$$eval('.chiprow [data-act="cat"]', (els) => els.map((e) => e.textContent.trim()));
check('カテゴリチップが9つ並ぶ', chips.length === 9, `実際: ${chips.length} / ${chips.join(',')}`);
check('カテゴリチップに件数バッジが付く', (await page.$$('.chiprow.cats .cnt')).length === 9);

// 折り返して全件が見えること（横スクロールだと画面外のカテゴリに気づけない）
const chipRow = await page.$eval('.chiprow.cats', (e) => ({
  scrollW: e.scrollWidth, clientW: e.clientWidth,
  overflowX: getComputedStyle(e).overflowX,
}));
check('カテゴリ行が横スクロールしない', chipRow.scrollW <= chipRow.clientW + 1 && chipRow.overflowX !== 'auto' && chipRow.overflowX !== 'scroll',
  `scrollWidth ${chipRow.scrollW} / clientWidth ${chipRow.clientW} / overflow-x ${chipRow.overflowX}`);

const hidden = await page.$$eval('.chiprow.cats .chip', (els) => {
  const row = els[0].parentElement.getBoundingClientRect();
  return els.filter((e) => {
    const r = e.getBoundingClientRect();
    return r.right > row.right + 1 || r.left < row.left - 1;
  }).length;
});
check('9カテゴリすべてが行内に収まる（画面外に隠れない）', hidden === 0, `はみ出し ${hidden}件`);

// ステータスバーとの重なり対策（black-translucent + viewport-fit=cover）
const safeTop = await page.evaluate(() => {
  const styles = [...document.styleSheets[0].cssRules].map((r) => r.cssText).join('\n');
  return {
    declared: /#app\s*\{[^}]*padding:\s*env\(safe-area-inset-top\)/.test(styles),
    computed: getComputedStyle(document.getElementById('app')).paddingTop,
  };
});
check('上端に safe-area の余白を取る（iOSのステータスバーとタイトルの重なり）',
  safeTop.declared && safeTop.computed === '0px', `宣言=${safeTop.declared} ブラウザでの実値=${safeTop.computed}`);

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

/* ---- サーボ: 安川の生産中止シリーズ27件 ---- */
await gotoCategory('servo');
const servoCount = await page.$eval('[data-act="cat"][data-v="servo"] .cnt', (e) => Number(e.textContent));
check('サーボが27件で表示される', servoCount === 27, `実際 ${servoCount}件`);
check('サーボで「データが未登録」と出ない', !(await page.textContent('#app')).includes('実在確認済みのデータが未登録'));

await search('SGDM');
await page.waitForSelector('.model.big');
const servoText = await page.textContent('#app');
check('SGDM から生産中止シリーズに到達できる', (await page.textContent('.model.big')).includes('SGDM'));
check('シリーズ単位であることを明示する', servoText.includes('シリーズ単位'));
check('生産中止日と修理対応期限が出る', servoText.includes('2015.3.20') && servoText.includes('2025.3.20'), servoText.includes('2025.3.20') ? '' : '修理期限が無い');

/**
 * ②の枠の並び順（scopeNote が discontinuedNote より先）を DOM順で固定する。
 *
 * SGDM は `modelScope:"series"` と `discontinued` の両方が立つレコードで、
 * 2つの全幅警告が同じ画面に並ぶ数少ない例。順序が入れ替わると、読み手は先に
 * 「この型式は生産終了です。新規発注はできません」を読む。しかしこの行はそもそも
 * 個別の発注可能型式ではない（`SGDM / SGDH / SGDP …` というシリーズ単位のマスク）ので、
 * 発注番号として実在する型式が終息した、と読み替えられてしまう。
 * 「これは型式ではない」を先に言い切る scopeNote が先。
 */
const servoBoxes = await confirmBoxOrder();
const scopeAt = servoBoxes.indexOf('scopeNote');
const servoDiscAt = servoBoxes.indexOf('discontinuedNote');
check('②でシリーズ単位の注意が生産終了の警告より先に出る（DOM順）',
  scopeAt >= 0 && servoDiscAt >= 0 && scopeAt < servoDiscAt,
  `枠の並び: ${servoBoxes.join(' → ')}`);

await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(150);
const servoResult = await page.textContent('#app');
check('シリーズ単位の行では互換判定をせず理由を説明する',
  (await page.$$('.card')).length === 0 && servoResult.includes('型式ごとの互換判定は行いません'));
check('代替シリーズをメーカー案内として出す', servoResult.includes('Σ-Xシリーズ'));

/* ---- インバータ: 出典付きで昇格した実データだけを出す ---- */
await gotoCategory('inverter');
const invCount = await page.$eval('[data-act="cat"][data-v="inverter"] .cnt', (e) => Number(e.textContent));
// 現行品 FR-E800 が40件、生産終了の旧機種 FR-E700 が30件
check('インバータが実在確認済み70件で表示される', invCount === 70, `実際 ${invCount}件`);
check('インバータで「データが未登録」と出ない', !(await page.textContent('#app')).includes('実在確認済みのデータが未登録'));

await page.click('[data-act="browse"]');
await page.waitForSelector('.rows .row');
const invModels = await page.$$eval('.rows .row .mono', (els) => els.map((e) => e.textContent.trim()));
/**
 * 形名の綴りは世代で違う。FR-E800 は末尾の `-1`（インバータ本体の仕様コード）まで
 * 含めるのが公式形名で、FR-E700 にはそれが無い（`FR-E720-3.7K` で1つの公式形名）。
 * どちらも「その世代の公式形名どおり」であることを、世代ごとの綴りで見る。
 */
const e800Models = invModels.filter((m) => /^FR-E8/.test(m));
const e700Models = invModels.filter((m) => /^FR-E7/.test(m));
check('公式形名で登録されている（FR-E800 は末尾 -1 まで／FR-E700 は容量記号まで）',
  invModels.length === 70
  && e800Models.length === 40 && e800Models.every((m) => /^FR-E8(20|40|60|20S|10W)-[\d.]+K-1$/.test(m))
  && e700Models.length === 30 && e700Models.every((m) => /^FR-E7(20|40|20S|10W)-[\d.]+K$/.test(m)),
  invModels.join(' '));
// 5つの電圧クラスが揃っている（3相200/400/575V・単相200/100V）。
// 旧機種は575V機が無く4クラス（置換え資料 BCN-C21002-214C の対応表どおり）
const invByClass = (re) => invModels.filter((m) => re.test(m)).length;
check('電圧クラス別の機種数が容量表と一致する',
  invByClass(/^FR-E820-/) === 13 && invByClass(/^FR-E840-/) === 11 && invByClass(/^FR-E860-/) === 6
  && invByClass(/^FR-E820S-/) === 6 && invByClass(/^FR-E810W-/) === 4,
  `E820 ${invByClass(/^FR-E820-/)} / E840 ${invByClass(/^FR-E840-/)} / E860 ${invByClass(/^FR-E860-/)} / E820S ${invByClass(/^FR-E820S-/)} / E810W ${invByClass(/^FR-E810W-/)}`);
check('旧機種も電圧クラス別の機種数が置換え資料と一致する',
  invByClass(/^FR-E720-/) === 11 && invByClass(/^FR-E740-/) === 9
  && invByClass(/^FR-E720S-/) === 6 && invByClass(/^FR-E710W-/) === 4,
  `E720 ${invByClass(/^FR-E720-/)} / E740 ${invByClass(/^FR-E740-/)} / E720S ${invByClass(/^FR-E720S-/)} / E710W ${invByClass(/^FR-E710W-/)}`);
// FR-E846 は SCE 仕様のみで末尾 -1 の標準仕様品が無い
check('ラインアップに無い FR-E846 を出さない', !invModels.some((m) => /^FR-E846-/.test(m)));
// _seed の生成データは末尾 -1 が欠けている。昇格時にそれをコピーしていないことを見る。
// 旧機種は末尾がKで終わるのが公式形名なので、この検査は FR-E800 側にだけ課す
const e800Dropped = e800Models.filter((m) => /K$/.test(m));
check('生成データ由来の末尾欠け形名（FR-E820-0.4K）が出ない',
  e800Dropped.length === 0, e800Dropped.join(' '));

await search('FR-E820-3.7K-1');
await page.waitForSelector('.model.big');
const invText = await page.textContent('#app');
check('FR-E820-3.7K-1 で確認画面に進む', (await page.textContent('.model.big')) === 'FR-E820-3.7K-1');
check('ND定格の定格出力電流が出る (17.5A)', invText.includes('17.5A'), (invText.match(/[\d.]+A/) || [])[0]);
check('ND定格の定格容量が出る (7kVA)', invText.includes('7kVA'), (invText.match(/[\d.]+kVA/) || [])[0]);
check('公式確認済みの適用モータ容量は出る', invText.includes('3.7kW'));
// カタログの括弧付き(16.5A)は周囲温度40℃超・PWM2kHz以上の低減値、19.6A は LD定格
check('括弧付きの低減値(16.5A)を通常定格として出さない', !invText.includes('16.5A'));
check('LD定格(19.6A)を出さない', !invText.includes('19.6A'));
check('寸法未取得なので外形図を描かない', (await page.$('#app svg')) === null);

// 主スペックが揃ったので、インバータで初めて候補算出まで到達する
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const invCards = await page.$$eval('.card', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
check('インバータで互換候補が表示される', invCards.length > 0, `${invCards.length}件`);
check('候補は同じ電圧クラス(3相200V)の型式だけ',
  invCards.every((t) => /FR-E820-/.test(t) && !/FR-E8(40|60|20S|10W)-/.test(t)), invCards.join(' | '));
check('寸法未確認の候補には「寸法未確認」と出る', invCards.every((t) => t.includes('寸法未確認')));

// 単相入力機は電源相数が違う。出力が3相200Vであることを注記から読めること
await gotoCategory('inverter');
await search('FR-E820S-1.5K-1');
await page.waitForSelector('.model.big');
const singleText = await page.textContent('#app');
check('単相200V入力機の電源電圧が「単相200V」と出る', singleText.includes('単相200V'));
check('単相入力機はモータ出力が3相200Vであることを注記する', singleText.includes('出力は3相200V'));

/**
 * 電源相数の一致条件（PR #6）が画面上でも効いていること。
 *
 * FR-E820S-1.5K-1（単相200V入力）と FR-E820-1.5K-1（3相200V入力）は
 * voltClass=200・定格出力電流=8.0A で完全に同値なので、相数を見なければ
 * 候補の先頭に並ぶ。ここは定格が入って初めて実際に検証できるようになった。
 */
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const singleCards = await page.$$eval('.card', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ')));
check('単相200V入力機でも候補が出る', singleCards.length > 0, `${singleCards.length}件`);
check('単相入力機の候補に3相入力の FR-E820 が混ざらない（電源相数の一致条件）',
  singleCards.every((t) => !/FR-E820-\d/.test(t)), singleCards.join(' | '));
check('単相入力機の候補は単相入力機だけ',
  singleCards.every((t) => /FR-E820S-/.test(t)), singleCards.join(' | '));

/* ---- 生産終了品の表示（発注してはいけない型式を目立たせる） ---- */

/**
 * FR-E720-3.7K は生産終了品で、置換えには FR-E8AT03（取付互換アタッチメント）が要る。
 *
 * ②では後継型式が警告に出ること、③では型式が最大文字で出る結果ヘッダに
 * 「生産終了」バッジが付くこと。③のバッジが無いと、画面で一番目立つのが
 * 「発注してはいけない型式」になる。
 */
await gotoCategory('inverter');
await search('FR-E720-3.7K');
await page.waitForSelector('.model.big');
check('FR-E720-3.7K で確認画面に進む', (await page.textContent('.model.big')) === 'FR-E720-3.7K');
const discWarns = await page.$$eval('.warn', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
check('②画面の警告に「生産終了」と後継型式が出る',
  discWarns.some((t) => t.includes('生産終了') && t.includes('FR-E820-3.7K-1')),
  discWarns.join(' | '));

/**
 * ②の枠の並び順（discontinuedNote が後継品枠より先）を DOM順で固定する。
 *
 * 後継品枠（`.cmp-info`）は「FR-E720-3.7K → FR-E820-3.7K-1」と置換え先を示す枠で、
 * 生産終了の警告より先に出ると、既設品がまだ発注できるうえでの参考情報として読める。
 * 「新規発注はできない」が先にあって初めて、後継品枠が代替の提示になる。
 */
const invBoxes = await confirmBoxOrder();
const invDiscAt = invBoxes.indexOf('discontinuedNote');
const succAt = invBoxes.indexOf('後継品枠');
check('②で生産終了の警告が後継品枠より先に出る（DOM順）',
  invDiscAt >= 0 && succAt >= 0 && invDiscAt < succAt,
  `枠の並び: ${invBoxes.join(' → ')}`);

/**
 * 置換えの条件（FR-E8AT03 が要ること）が現場に届いていること。
 *
 * これは警告枠に限定せず②画面全体で見る。生産終了品の note 25件のうち置換えの条件は
 * 5件だけで、残る20件は仕様説明や来歴なので、note をまとめて ⚠ にはできない。
 * どの枠で出すかは今後も変わりうるが、枠が変わっても情報そのものが画面から
 * 消えてはいけない。守りたいのは見た目ではなく、後継の型式だけを見て発注すると
 * アタッチメントが無く取り付けられない、という事実が読めることのほう。
 */
check('②画面のどこかに置換えの条件（FR-E8AT03）が出ている',
  (await page.textContent('#app')).includes('FR-E8AT03'));

/**
 * 置換えの条件は後継品枠の中、後継型式の直下に出す。
 *
 * 「FR-E820-3.7K-1 に置換えられる」と「そのために FR-E8AT03 が要る」はひとつづきの
 * 手順なので、別枠に離すと後継型式だけを読んで発注される。品名（取付互換
 * アタッチメント）まで出すのは、型式だけでは何を買えばよいのか電話で伝えられないため。
 */
const succBox = (await page.textContent('.cmp-info')).replace(/\s+/g, ' ').trim();
check('後継品枠の中に品名と型式（取付互換アタッチメント / FR-E8AT03）が出る',
  succBox.includes('取付互換アタッチメント') && succBox.includes('FR-E8AT03'), succBox);

/**
 * 品名と型式が実際に橙で描画されること。クラス名ではなく描画された色を見る。
 *
 * `.cmp b{color:var(--sub)}` は `.amber` より詳細度が高いので、後継品枠の中で
 * <b class="amber"> と書くと class は付いているのに灰色で描かれる。クラスの有無だけを
 * 見る検査だと、その書き換えを通してしまい画面だけ色が落ちる。
 * 期待値は --amber をその場で解決して作る（色コードを検査に直書きすると、
 * テーマの色を変えたときに二重管理になる）。
 */
const amberPaint = await page.evaluate((labels) => {
  const box = document.querySelector('.cmp-info');
  // --amber をブラウザに解決させて期待色を作る。probe は枠の中に置き、同じ継承下で測る
  const probe = document.createElement('span');
  probe.style.color = 'var(--amber)';
  box.appendChild(probe);
  const want = getComputedStyle(probe).color;
  probe.remove();
  // 語を包む要素が span でも b でも拾えるよう、葉の要素をテキストで引く
  const leaves = [...box.querySelectorAll('*')].filter((e) => e.children.length === 0);
  return {
    want,
    got: labels.map((text) => {
      const el = leaves.find((e) => e.textContent.trim() === text);
      return { text, tag: el?.tagName.toLowerCase() ?? null, color: el ? getComputedStyle(el).color : null };
    }),
  };
}, ['取付互換アタッチメント', 'FR-E8AT03']);
check('置換えに必要な品名と型式が橙で描画される（--amber の実測色と一致）',
  amberPaint.got.length === 2 && amberPaint.got.every((g) => g.color === amberPaint.want),
  `期待 ${amberPaint.want} / 実際 ${amberPaint.got.map((g) => `${g.text}=<${g.tag}>${g.color}`).join(' , ')}`);

await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const resultHeadBadges = await page.$$eval('.result-head .badge', (els) => els.map((e) => e.textContent.trim()));
check('③画面の結果ヘッダに「生産終了」バッジが出る',
  resultHeadBadges.some((t) => t.includes('生産終了')), `バッジ: ${resultHeadBadges.join(' / ') || 'なし'}`);

/**
 * replacementNote を持たない生産終了品では、この行を出さない。
 *
 * S-N18（生産終了・後継 S-T20）は置換えに別部品が要らないので、後継品枠は
 * 後継型式だけになる。出しっぱなしにすると「何か買い足すのだろう」と読まれる。
 */
await gotoCategory('contactor');
await search('S-N18');
await page.waitForSelector('.model.big');
const plainSuccBox = (await page.textContent('.cmp-info')).replace(/\s+/g, ' ').trim();
check('置換えの条件を持たない生産終了品の後継品枠には、その行が出ない',
  plainSuccBox.includes('S-T20') && !plainSuccBox.includes('別途必要')
  && (await page.$$('.cmp-info .amber')).length === 0, plainSuccBox);

/* ---- ③の候補リストを根拠で2つに分ける ---- */

/**
 * ③の候補を、ゾーン見出しと DOM順の所属で拾う。
 *
 * 「見出しの文字列が画面のどこかにある」だけでは、見出しと候補の対応が入れ替わっても
 * 通ってしまう。守りたいのは「メーカーが後継として指定した型式が、後継品側の見出しの
 * 下にある」ことなので、`#app` の子要素を文書順に走査して所属を決める。
 */
async function resultZones() {
  return page.evaluate(() => {
    const zones = [];
    for (const el of document.getElementById('app').children) {
      if (el.classList.contains('zone-head')) {
        zones.push({
          title: el.querySelector('.t').textContent.trim(),
          note: el.querySelector('.n')?.textContent.replace(/\s+/g, ' ').trim() || '',
          models: [],
        });
      } else if (el.classList.contains('card')) {
        // 見出しの無い（分割していない）画面のために、暗黙のゾーンを1つ作る
        if (!zones.length) zones.push({ title: '', note: '', models: [] });
        zones[zones.length - 1].models.push(el.querySelector('.model').textContent.trim());
      }
    }
    return zones;
  });
}

/** ③の候補カードを「型式・主スペック・大小表示」に落として拾う */
async function resultCards() {
  return page.$$eval('.card', (els) => els.map((e) => ({
    model: e.querySelector('.model').textContent.trim(),
    spec: e.querySelector('.primary-spec').textContent.trim(),
    standing: e.querySelector('.standing')?.textContent.replace(/\s+/g, ' ').trim() || '',
  })));
}

/** 結果ヘッダの件数行（`.result-head` の中の `.sub` ではなく、パネル直下の1行） */
async function countLine() {
  return page.$eval('.panel > .sub', (e) => e.textContent.replace(/\s+/g, ' ').trim());
}

/**
 * S-N18 は生産終了・後継 S-T20 を持ちつつ、電流窓の近傍とも当たる接触器。
 * メーカーが指定した1件と、アプリが窓で拾った候補が同じ列に並んでいた代表例。
 */
await gotoCategory('contactor');
await search('S-N18');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const sn18Zones = await resultZones();
check('S-N18 の③が「メーカー指定の後継品」と「当アプリの判定による候補」の2つに分かれる',
  sn18Zones.length === 2
  && sn18Zones[0].title === 'メーカー指定の後継品'
  && sn18Zones[1].title === '当アプリの判定による候補',
  sn18Zones.map((z) => `${z.title || '(見出し無し)'}:${z.models.length}件`).join(' → '));
check('S-N18 の後継品側の見出しの下には、登録された後継 S-T20 だけが入る',
  sn18Zones[0]?.models.join(' ') === 'S-T20', sn18Zones[0]?.models.join(' '));
check('判定側の見出しに、メーカー指定ではない旨を添える',
  sn18Zones[1]?.note === 'メーカーが後継として指定した型式ではありません。', sn18Zones[1]?.note);

/**
 * 件数は根拠ごとの内訳で出す。合算した「N件」だけだと、メーカーが保証した1件と
 * アプリが拾った候補が同じ数字に溶ける。期待値は実際のゾーンの件数から組み立てる
 * （画面の数字を検査に直書きすると、データが増えたときに二重管理になる）。
 */
const sn18Counts = sn18Zones.map((z) => z.models.length);
check('件数表示が根拠ごとの内訳になる',
  (await countLine()) === `互換品候補 ${sn18Counts[0] + sn18Counts[1]}件`
    + `（メーカー指定の後継品 ${sn18Counts[0]}件 / 当アプリの判定による候補 ${sn18Counts[1]}件）`,
  await countLine());

/**
 * 片方しか無いときは見出しを出さない。
 *
 * 旧機種インバータ30件は候補が後継品ちょうど1件（`test-compat` 検査14）なので、
 * 判定側は必ず空になる。中身の無い見出しと対で並べても対比する相手がいないため、
 * ③の見た目は従来のまま（見出し無しで候補が並ぶ）であることを固定する。
 */
await gotoCategory('inverter');
await search('FR-E720-3.7K');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const invZones = await resultZones();
check('FR-E720-3.7K の③には見出しが出ない（候補が後継品1件だけで、分ける相手がいない）',
  (await page.$$('.zone-head')).length === 0
  && invZones.length === 1 && invZones[0].title === ''
  && invZones[0].models.join(' ') === 'FR-E820-3.7K-1',
  invZones.map((z) => `${z.title || '(見出し無し)'}:${z.models.join(',')}`).join(' → '));
check('分けていない画面の件数表示は従来どおり内訳を付けない',
  (await countLine()) === '互換品候補 1件', await countLine());

/* ---- 主スペックが基準より小さい候補を明示する ---- */

/**
 * S-N35（34A）は、基準より小さい候補が最も多く混ざる組。
 *
 * 候補16件のうち 26A が9件・32A が2件で、後継の S-T35 は 35A。
 * 「26A に表示が出る」だけだと 34A 以上にも出る実装で通ってしまうので、
 * 34A 未満と 34A 以上の全件を突き合わせて、境界の両側を1回で見る。
 */
await gotoCategory('contactor');
await search('S-N35');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const sn35Cards = await resultCards();
const sn35Small = sn35Cards.filter((c) => c.spec === '26A');
check('S-N35（34A）の③で、26A の候補に「基準より小さい」が出る',
  sn35Small.length > 0 && sn35Small.every((c) => c.standing.includes('基準 34A より小さい')),
  `26A の候補 ${sn35Small.length}件 / 表示あり ${sn35Small.filter((c) => c.standing).length}件`);

const st35Card = sn35Cards.find((c) => c.model === 'S-T35');
check('S-N35 の③で、S-T35（35A ＝ 基準34A以上）には「基準より小さい」が出ない',
  !!st35Card && st35Card.spec === '35A' && st35Card.standing === '',
  `${st35Card?.spec} / 表示「${st35Card?.standing}」`);

const boundary = sn35Cards.filter((c) =>
  (Number(c.spec.replace('A', '')) < 34) !== c.standing.includes('より小さい'));
check('S-N35 の③で、34A 未満の候補にだけ表示が付く（境界の両側を全件で見る）',
  sn35Cards.length > 0 && boundary.length === 0,
  boundary.map((c) => `${c.model} ${c.spec} 表示「${c.standing}」`).join(' / '));

/**
 * 適合の可否は断定しない。
 *
 * アプリが知っているのは交換前の機器の**定格**であって、実際の負荷電流ではない。
 * 34A の機器が付いていても実負荷が 20A なら 26A 品で足りるので、「容量不足」と
 * 書くと成立する置換えを現場が捨てる。書いてよいのは大小の事実と、実負荷を
 * 確認する必要があるという注意まで。
 */
const sn35Text = (await page.textContent('#app')).replace(/\s+/g, ' ');
check('③に「容量不足」「使用不可」など適合の可否を断定する文言を出さない',
  !/容量不足|容量が足りな|使用不可/.test(sn35Text),
  (sn35Text.match(/容量不足|容量が足りな|使用不可/) || [])[0]);
check('「基準より小さい」を出す画面には、実負荷を現場で確認する注意を添える',
  sn35Text.includes('実際の負荷電流は定格とはかぎらない'),
  (await page.$$('.load-note')).length ? '注意はあるが文面が違う' : '注意が無い');

/**
 * 大小に意味の無いカテゴリでは何も出さない。
 *
 * サーマルリレーの主スペック `setRangeA` は `{min, max}` の区間で、区間どうしに
 * 大小は無い（TH-N18 の 1〜18A に対し TH-T18 は 0.12〜15A で、下限は下がり上限も下がる）。
 * 判定できないものを黙って「基準以上」に倒さず、表示そのものを出さない。
 */
await gotoCategory('thermal');
await search('TH-N18');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const thCards = await resultCards();
check('サーマルリレーの生産終了品では、大小の表示が1件も出ない（整定範囲は区間で比較できない）',
  thCards.length > 0 && thCards.every((c) => c.standing === '')
  && (await page.$$('.standing')).length === 0,
  `候補 ${thCards.length}件中 ${thCards.filter((c) => c.standing).length}件に表示`);
check('大小の表示が無い画面には、実負荷の注意書きも出さない',
  (await page.$$('.load-note')).length === 0);

/* ---- 大小の判定を宣言した残りのカテゴリでも 'below' の経路を通す ---- */

/**
 * `primaryStanding` を宣言しているのは6カテゴリだが、上の S-N35 が通しているのは
 * 電磁接触器の1カテゴリだけだった。残りも「基準より小さい候補が実際に並ぶ型式」を
 * data から選んで1件ずつ通す。型式は候補を実測して選んである（後述の基準値の
 * 突き合わせが、データが変わったときにこの前提ごと落とす）。
 */

/**
 * 主スペックの表示値を数値に戻す。`26A` は 26、`500mm` は 500、`1.3m` は 1300。
 *
 * 書式はカテゴリの specDef の `format` が決めるので、ここで解くのは実際に出る
 * 3書式だけ。**解けない書式は NaN にして、呼び出し側が必ず落とす。**
 * 「解析できないから一致とみなす」経路を作ると、書式が変わった瞬間に
 * 全候補が「基準以上」に倒れて、この検査が黙って空振りする。
 */
function specNumber(text) {
  const m = /^([\d.]+)(mm|m|A)$/.exec(text);
  if (!m) return NaN;
  return m[2] === 'm' ? Number(m[1]) * 1000 : Number(m[1]);
}

/** 基準の主スペック（結果ヘッダの「メーカー ・ 値」の値側） */
async function baseSpec() {
  return page.$eval('.result-head .sub', (e) => e.textContent.trim().split('・').pop().trim());
}

/** カテゴリを開いて型式を検索し、③まで進んで候補カードを拾う */
async function standingCards(catId, model) {
  await gotoCategory(catId);
  await search(model);
  await page.waitForSelector('.model.big');
  await page.click('[data-act="step"][data-v="3"]');
  await page.waitForTimeout(200);
  return resultCards();
}

/**
 * 候補を基準との大小で3つに分ける。
 * `unparsable` が1件でもあれば、大小の集合そのものが信用できない。
 */
function byStanding(cards, base) {
  return {
    unparsable: cards.filter((c) => Number.isNaN(specNumber(c.spec))),
    smaller: cards.filter((c) => specNumber(c.spec) < base),
    notSmaller: cards.filter((c) => specNumber(c.spec) >= base),
  };
}

/**
 * インバータ（定格出力電流）。
 *
 * FR-E820-5.5K-1（24A）の候補は ±30%窓の両側に1件ずつで、
 * 3.7K-1（17.5A）が基準より小さく、7.5K-1（33A）が基準より大きい。
 * 旧機種と違って現行品どうしなので、値が揃っていて 'unknown' にならない。
 */
const invStanding = await standingCards('inverter', 'FR-E820-5.5K-1');
const invBase = await baseSpec();
const inv = byStanding(invStanding, 24);
check('FR-E820-5.5K-1（24A）の③で、17.5A の候補に「基準より小さい」が出る',
  invBase === '24A' && inv.unparsable.length === 0
  && inv.smaller.length > 0 && inv.smaller.every((c) => c.standing.includes('基準 24A より小さい')),
  `基準 ${invBase} / 小さい候補 ${inv.smaller.map((c) => `${c.model}(${c.spec})`).join(' ') || 'なし'}`);
check('FR-E820-5.5K-1 の③で、33A の候補には「基準より小さい」が出ない',
  inv.notSmaller.length > 0 && inv.notSmaller.every((c) => c.standing === ''),
  inv.notSmaller.map((c) => `${c.model}(${c.spec}) 表示「${c.standing}」`).join(' / ') || '基準以上の候補が無い');

/**
 * フォトスイッチ（検出距離）。
 *
 * E3Z-D61（100mm）を選んだのは、候補に **100mm ちょうど**の HP7-D11 が居るため。
 * 大小を `<` ではなく `<=` で書いた実装だと、同値のこの1件に表示が出て落ちる。
 * 候補は 50mm〜1.5m と mm / m 両方の書式にまたがるので、単位の読み替えも通る。
 */
const photoStanding = await standingCards('photo', 'E3Z-D61');
const photoBase = await baseSpec();
const photo = byStanding(photoStanding, 100);
check('E3Z-D61（100mm）の③で、検出距離が基準より短い候補に「基準より小さい」が出る',
  photoBase === '100mm' && photo.unparsable.length === 0
  && photo.smaller.length > 0 && photo.smaller.every((c) => c.standing.includes('基準 100mm より小さい')),
  `基準 ${photoBase} / 短い候補 ${photo.smaller.map((c) => `${c.model}(${c.spec})`).join(' ') || 'なし'}`
  + ` / 読めない書式 ${photo.unparsable.map((c) => c.spec).join(' ')}`);
const equalCard = photoStanding.find((c) => c.model === 'HP7-D11');
check('E3Z-D61 の③で、基準と同値（100mm）の HP7-D11 には表示が出ない',
  !!equalCard && equalCard.spec === '100mm' && equalCard.standing === ''
  && photo.notSmaller.every((c) => c.standing === ''),
  `HP7-D11 ${equalCard?.spec} 表示「${equalCard?.standing}」`);

/**
 * 電磁開閉器（定格使用電流）。
 *
 * MSO-N20（18A・生産終了）の候補は 13A が2件、18A が3件、22A が1件。
 * 同値（18A）の3件に出ないことも、この1画面で一緒に見る。
 */
const msoStanding = await standingCards('starter', 'MSO-N20');
const msoBase = await baseSpec();
const mso = byStanding(msoStanding, 18);
check('MSO-N20（18A）の③で、13A の候補に「基準より小さい」が出る',
  msoBase === '18A' && mso.unparsable.length === 0
  && mso.smaller.length > 0 && mso.smaller.every((c) => c.standing.includes('基準 18A より小さい')),
  `基準 ${msoBase} / 小さい候補 ${mso.smaller.map((c) => `${c.model}(${c.spec})`).join(' ') || 'なし'}`);
check('MSO-N20 の③で、18A・22A の候補には「基準より小さい」が出ない',
  mso.notSmaller.length > 0 && mso.notSmaller.every((c) => c.standing === ''),
  mso.notSmaller.map((c) => `${c.model}(${c.spec}) 表示「${c.standing}」`).join(' / ') || '基準以上の候補が無い');

/**
 * 超音波センサ（検出距離）。
 *
 * 「基準より小さい候補が並ぶ画面」は US-T50 / US-T50PN の2型式だけで、どちらも
 * 候補は US-T04AN（400mm）の1件。この画面には基準以上の候補が居ないので、
 * ここで見るのは小さい側だけ（出ない側は上の3カテゴリが見ている）。
 */
const usStanding = await standingCards('ultrasonic', 'US-T50');
const usBase = await baseSpec();
const us = byStanding(usStanding, 500);
check('US-T50（500mm）の③で、400mm の候補に「基準より小さい」が出る',
  usBase === '500mm' && us.unparsable.length === 0
  && us.smaller.length > 0 && us.smaller.every((c) => c.standing.includes('基準 500mm より小さい')),
  `基準 ${usBase} / 候補 ${usStanding.map((c) => `${c.model}(${c.spec}) 表示「${c.standing}」`).join(' ')}`);

/* ---- 容量の取り違え防止（normLoose で同じ綴りになる型式） ---- */

/**
 * normLoose はハイフンと小数点を落とすため 1.5K-1 と 15K-1 が同じ綴りになる。
 * 確定させずに選ばせるだけでなく、選ぶための材料（容量）が実際に出ていること。
 * 識別材料は specDefs の宣言順で最初に値が割れたスペックなので、判定に使う
 * 定格出力電流ではなく適用モータ容量が出る。現場の保全員は銘板やモータ側から
 * 型式に入るため、8A / 60A より 1.5kW / 15kW のほうが即断できる。
 */
async function ambiguousRows() {
  await page.waitForSelector('.rows [data-act="pick"]');
  return page.$$eval('.rows [data-act="pick"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
}

for (const q of ['FR-E820-15K-1', 'FR-E820-1.5K-1']) {
  await gotoCategory('inverter');
  await search(q);
  const rows = await ambiguousRows();
  const text = (await page.textContent('#app')).replace(/\s+/g, ' ');
  check(`「${q}」で確定させず選ばせる`, text.includes('取り違え') && rows.length >= 2, `候補 ${rows.length}件`);
  check(`「${q}」の候補に 1.5kW と 15kW が併記される`,
    rows.some((t) => t.includes('1.5kW')) && rows.some((t) => t.includes('15kW')), rows.join(' | '));
  check(`「${q}」で何倍違うのかを警告に書く`, text.includes('10倍違います'), text.slice(0, 200));
  // 判定に使う主スペックは定格出力電流のまま。識別材料だけを容量にしている
  check(`「${q}」の識別材料が電流ではなく容量で出る`,
    rows.every((t) => t.includes('適用モータ容量')) && !rows.some((t) => /\d+A\b/.test(t)), rows.join(' | '));
  check(`「${q}」に完全一致する候補へバッジが付く`,
    rows[0].includes('入力と完全一致') && rows[0].includes(q), rows[0]);
}

// 小数点を省いた入力は 15K と完全一致するが、それを根拠に確定させてはいけない
await gotoCategory('inverter');
await search('FRE82015K1');
const dotless = await ambiguousRows();
check('小数点を省いた入力でも確定させず両方を見せる',
  dotless.length >= 2 && dotless.some((t) => t.includes('1.5kW')) && dotless.some((t) => t.includes('15kW')),
  dotless.join(' | '));

// 曖昧一致（うろ覚え入力）は維持されていること。ドットを省いても引ける
await gotoCategory('proximity');
await search('I21031');
await page.waitForSelector('.model.big');
check('ドットを省いた入力で I-210.31 に到達できる（曖昧一致の維持）',
  (await page.textContent('.model.big')).includes('I-210.31'));

// サジェストと Enter の母集団が一致していること（メーカー絞り込みに引きずられない）
await gotoCategory('contactor');
await page.click('[data-act="browse"]');
await page.click('[data-act="maker"][data-v="パナソニック"]');
await page.fill('#q', 'S-N10');
await page.dispatchEvent('#q', 'input');
await page.waitForTimeout(60);
const sugModels = await page.$$eval('#sug [data-act="pick"]', (els) => els.map((e) => e.textContent));
check('メーカー絞り込み中でもサジェストがカテゴリ全体を見る',
  sugModels.some((t) => t.includes('S-N10')) && sugModels.some((t) => t.includes('SN10')),
  sugModels.join(' | '));

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
