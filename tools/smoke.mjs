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

/**
 * ②確認画面の中身を、`.panel` をまたいで DOM の出現順のまま拾う。
 *
 * `confirmBoxOrder` が警告枠どうしの前後関係を見るのに対し、こちらは仕様欄・外形図・
 * 取付方式チップ・操作ボタン・出典行という、画面を上から下へ読むときの並びそのものを見る。
 * 「出典が画面にある」だけを見る検査だと、出典行をどこへ動かしても通ってしまうため、
 * `querySelectorAll`（＝文書順）で並びを取り、その添字を比較する。
 *
 * 種別は要素そのもの（クラス・`data-act`・タグ）で見分ける。文言で見分けると、
 * 出典の本文を持たないレコード（状態表示だけの18字）と持つレコード（813字）で
 * 拾い方が変わってしまう。ここで見たいのは本文の有無に依らない位置関係のほう。
 */
async function confirmFlow() {
  return page.$$eval('#app > .panel > *', (els) => els.map((e) => {
    if (e.classList.contains('evidence')) return '出典行';
    if (e.dataset?.act === 'step' && e.dataset.v === '3') return '互換品を表示ボタン';
    if (e.dataset?.act === 'step' && e.dataset.v === '1') return '型式を選び直すボタン';
    if (e.tagName.toLowerCase() === 'svg') return '外形図';
    if (e.classList.contains('dim-none')) return '外形図なしの断り';
    if (e.classList.contains('chiprow')) return '取付方式チップ';
    if (e.classList.contains('grid')) return '仕様欄';
    if (e.classList.contains('card-head')) return '型式ヘッダ';
    return `その他(${e.classList[0] || e.tagName.toLowerCase()})`;
  }));
}

/** ②の出典行が実際に出典の本文（srcNote / checkedAt / srcUrl）を持っているか */
async function confirmEvidenceBody() {
  return page.$eval('#app .evidence', (e) => ({
    notes: e.querySelectorAll('.ev-note').length,
    links: e.querySelectorAll('a').length,
    len: e.textContent.replace(/\s+/g, ' ').trim().length,
  }));
}

console.log(`file:// で起動: ${url}\n`);
await page.goto(url);
await page.waitForSelector('#app .chiprow');

check('JSエラーなしで起動する', consoleErrors.length === 0, consoleErrors[0]);
check('外部ネットワークアクセスが発生しない', external.length === 0, external[0]);

// カテゴリチップが10個出る
const chips = await page.$$eval('.chiprow [data-act="cat"]', (els) => els.map((e) => e.textContent.trim()));
check('カテゴリチップが10個並ぶ', chips.length === 10, `実際: ${chips.length} / ${chips.join(',')}`);
check('カテゴリチップに件数バッジが付く', (await page.$$('.chiprow.cats .cnt')).length === 10);

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
check('10カテゴリすべてが行内に収まる（画面外に隠れない）', hidden === 0, `はみ出し ${hidden}件`);

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

/* ---- 絶縁変換器: 信号種別で判定する（第2出力が違えば候補にしない） ---- */

/**
 * MS3749-A-O22 と MS3749-A-O25 は、入力信号・第1出力・外形寸法・電源が同一で、
 * 違うのは第2出力（オープンコレクタ / ラインドライバ・パルス）だけ。
 * `insulation` の gate が第2出力を見ていなければ、この2件は必ず互いの
 * 候補No.1になる。**両方向を見る**のは、片方向だけの検査では gate が
 * 非対称に壊れたときに素通りするため（`test-compat` の対称性検査と同じ考え方）。
 *
 * 現場写真の盤には両方が実在し、OUT2 を使っているかどうかは現場でしか
 * 分からない。だからアプリは「そのまま挿せる」候補だけを出す。
 */
check('絶縁変換器のカテゴリチップが出る',
  (await page.$('[data-act="cat"][data-v="insulation"]')) !== null, chips.join(','));

const isoCount = await page.$eval('[data-act="cat"][data-v="insulation"] .cnt', (e) => Number(e.textContent));
check('絶縁変換器が14件で表示される', isoCount === 14, `実際 ${isoCount}件`);

/**
 * ②の仕様欄を「ラベル → 値」の組で DOM 順のまま拾う。
 *
 * 欄の有無も値も、`#app` 全体の文字列検索では見ない。**同じ語が note や出典行に
 * 出ているだけで通ってしまう**ため。実際、オプションの `text` を落として `code`
 * だけにする壊し方をしたとき、`textContent('#app')` を見る書き方だと
 * 「センサ供給電源 12V DC（±10%）3線式」が `evidence.specs.srcNote`
 * （型式コードの読み下し）に出ているせいで検査が通ってしまった。
 * 見たいのは仕様欄がその値を出しているかなので、欄そのものから読む。
 */
async function confirmSpecRows() {
  return page.$$eval('#app .grid .spec', (els) => els.map((e) => [
    e.querySelector('.l').textContent.trim(), e.querySelector('.v').textContent.trim(),
  ]));
}

async function insulationResult(model) {
  await gotoCategory('insulation');
  await search(model);
  await page.waitForSelector('.model.big');
  const reached = (await page.textContent('.model.big')).includes(model);
  const spec = (await page.textContent('#app')).replace(/\s+/g, ' ');
  const rows = await confirmSpecRows();
  const labels = rows.map(([l]) => l);
  const specOf = (label) => rows.find(([l]) => l === label)?.[1] ?? null;
  await page.click('[data-act="step"][data-v="3"]');
  await page.waitForTimeout(200);
  const cards = await page.$$eval('.card .model', (els) => els.map((e) => e.textContent.trim()));
  // 候補カードのカテゴリ固有パネル（detailPanels）。③でオプションが読めるかを見る
  const panels = await page.$$eval('.card .cmp', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  /*
   * パネルを**カードごとに**、見出し（`.cmp b`）と本文（`.cmp span`）に分けて拾う。
   *
   * `panels` のように全カード分を1本の配列にすると、「どのカードに出たか」を
   * 言えない。オプションのパネルは③の別のカードにも出るので、
   * 「MS3749-A-O25/H のカードに電源電圧のパネルが出ない」を平坦な配列で書くと、
   * 別のカードのパネルを拾って通ったり落ちたりする。
   * 枠の色（tone）はクラス名（`cmp-warn`）で読む。色コードそのものは
   * テーマ側にあり、検査に書くと二重管理になる（CLAUDE.md）。
   */
  const cardPanels = await page.$$eval('.card', (els) => els.map((card) => ({
    model: card.querySelector('.model').textContent.trim(),
    panels: [...card.querySelectorAll('.cmp')].map((p) => ({
      title: p.querySelector('b').textContent.trim(),
      body: p.querySelector('span').textContent.replace(/\s+/g, ' ').trim(),
      tone: [...p.classList].find((k) => k.startsWith('cmp-')) ?? '',
    })),
  })));
  /** 候補カード1枚のパネル見出しの一覧。そのカードが無ければ null（欄の不在と区別する） */
  const panelTitlesOf = (model) =>
    cardPanels.find((x) => x.model === model)?.panels.map((p) => p.title) ?? null;
  /** 候補カード1枚の、見出しで指したパネル1枚。カードごと無い場合も null */
  const panelOf = (model, title) =>
    cardPanels.find((x) => x.model === model)?.panels.find((p) => p.title === title) ?? null;
  const emptyEl = await page.$('.empty-note');
  const note = emptyEl ? (await emptyEl.textContent()).replace(/\s+/g, ' ').trim() : '';
  return { reached, spec, labels, specOf, cards, panels, panelTitlesOf, panelOf, note };
}

const isoO25 = await insulationResult('MS3749-A-O25');
check('MS3749-A-O25 を検索して②確認画面に到達する', isoO25.reached);

/**
 * ②の信号名は銘板の印字で出す（`insulation.mjs` の `formatSignal`）。
 *
 * もとは「②に第2出力（ラインドライバ・パルス）が出る」を `#app` 全体の文字列で
 * 見ていた。その書き方は表示を銘板表記に変えても落ちない——`note`（「第2出力が
 * ラインドライバ・パルスのため…」）と `evidence.specs.srcNote`（型式コードの
 * 読み下し）に同じ語があるので、仕様欄が何を出していようと通ってしまう。
 * オプションの `text` で同じ穴を踏んでいるので、ここも欄そのものから読む。
 *
 * 入力信号・第1出力も併せて見るのは、3つのうち1つだけ略記にすると
 * 同じ画面で表記が割れるため（`formatSignal` を specDefs と `summary` の
 * 両方に掛けているのはこのため。片方を外すとこの検査が落ちる）。
 */
check('MS3749-A-O25 の②で第2出力が Line Driver Pulse になる（銘板の印字）',
  isoO25.specOf('第2出力') === 'Line Driver Pulse',
  `第2出力欄: ${isoO25.specOf('第2出力') ?? '欄が無い'}`);
check('MS3749-A-O25 の②で入力信号・第1出力が OPN.C. になる（同じ画面で表記が割れない）',
  isoO25.specOf('入力信号') === 'OPN.C.' && isoO25.specOf('第1出力') === 'OPN.C.',
  `入力信号: ${isoO25.specOf('入力信号') ?? '欄が無い'}`
  + ` / 第1出力: ${isoO25.specOf('第1出力') ?? '欄が無い'}`);
check('MS3749-A-O25 の③に MS3749-A-O22 が候補として出ない（第2出力の種別が違う）',
  !isoO25.cards.includes('MS3749-A-O22'), isoO25.cards.join(' | ') || '候補0件');

const isoO22 = await insulationResult('MS3749-A-O22');
check('MS3749-A-O22 を検索して②確認画面に到達する', isoO22.reached);
check('MS3749-A-O22 の③に MS3749-A-O25 が候補として出ない（逆向きでも同じ）',
  !isoO22.cards.includes('MS3749-A-O25'), isoO22.cards.join(' | ') || '候補0件');

/**
 * 0件パネルの検査は MS3749-A-D44/H で見る。
 *
 * もとは MS3749-A-O22 で見ていたが、MS3749-A-O22/H を登録したことで
 * この型式は候補1件になり、0件パネルそのものが出なくなった（検査の前提が消えた）。
 * 落ちた検査を消さずに、**0件になる型式へ付け替える**。
 *
 * MS3749-A-D44/H を選んだのは、`MS3749-A-D4/H` と入力信号・第1出力が同一で
 * 違うのは第2出力の有無だけ——文面が名乗る「第2出力を一方だけが持つ組は
 * 候補にしません」がまさに効いて0件になる型式だから。
 * 候補が1件でも出れば0件パネルは出ないので、この検査は空振りしない。
 */
const isoD44 = await insulationResult('MS3749-A-D44/H');
check('MS3749-A-D44/H の③が0件になる（第2出力を一方だけが持つ組を候補にしない）',
  isoD44.cards.length === 0 && isoD44.note !== '', isoD44.cards.join(' | '));

/**
 * 「候補に出ない」は、カテゴリごと壊れて0件でも真になってしまう。
 * 0件パネルが insulation 自身の文面（必要条件を名乗る形）であることを併せて見て、
 * 判定まで到達したうえでの0件だと言えるようにする。
 * コアの既定文やセンサーの文面に差し替わる壊れ方は、ここで落ちる。
 */
const isoLeak = ['出力極性', '配線本数', '電源相数', '判定条件を満たす型式']
  .filter((p) => isoD44.note.includes(p));
check('絶縁変換器の0件パネルが必要条件（入力信号・第1出力・第2出力）を名乗る',
  isoD44.note.includes('入力信号と第1出力の種別が一致し')
  && isoD44.note.includes('第2出力を一方だけが持つ組は候補にしません')
  && isoD44.note.includes('どの条件で外れたかはこの画面では判別できません')
  && isoLeak.length === 0,
  isoLeak.length ? `他カテゴリの語が混ざった: ${isoLeak.join(' / ')}` : isoD44.note);

/* ---- 絶縁変換器: オプション（specs.option）の表示 ---- */

/**
 * `option` は `gate` に入れていないので、**判定では一切見えない**。
 * MS3749-A-O25 と MS3749-A-O25/H は仕様値が1つも違わず、差はオプションだけなので、
 * 画面に出していなければ③は同じ内容のカードが並ぶだけになる。
 * 「候補に出る」と「その差が読める」を別々に見る。
 *
 * カードの本文は `code` だけでなく `text`（仕様書 p.1 のオプション表の文言）まで
 * 見る。「H」とだけ出ても現場には伝わらないため、これは表示の要件そのもの。
 */
check('MS3749-A-O25 の③に MS3749-A-O25/H が候補として出る（差はオプションだけ）',
  isoO25.cards.includes('MS3749-A-O25/H'), isoO25.cards.join(' | ') || '候補0件');
check('MS3749-A-O25/H の候補カードに「ポリウレタン系コーティング」が出る（code だけでは伝わらない）',
  isoO25.panels.some((t) => t.includes('ポリウレタン系コーティング') && t.includes('/H')),
  isoO25.panels.join(' | ') || 'カテゴリ固有パネルが無い');

/**
 * オプションを持たない型式では、②に**オプションの欄そのものを出さない**。
 *
 * 「―」の欄を残すと、1出力型の「該当なし」とデータ未登録が同じ見た目になる
 * （`specs.option` を空配列で持たせないのと同じ理由）。
 * 欄が消えたのではなく出さないことを言えるように、**同じ画面が仕様欄を
 * 描いていること**（第1出力の欄がある）も併せて見る。
 */
check('MS3749-A-O25（option なし）の②にオプションの欄が出ない',
  !isoO25.labels.includes('オプション') && isoO25.labels.includes('第1出力'),
  isoO25.labels.join(' / '));

const isoD33 = await insulationResult('MS3749-A-D33/D');
check('MS3749-A-D33/D の②のオプション欄に「センサ供給電源 12V DC（±10%）3線式」が出る',
  isoD33.specOf('オプション')?.includes('センサ供給電源 12V DC（±10%）3線式') === true,
  `オプション欄: ${isoD33.specOf('オプション') ?? '欄が無い'}`);

/* ---- 絶縁変換器: 電源電圧（specs.powerSupply）の差を③に出す ---- */

/**
 * `powerSupply` も `gate` に入れていないので、**電源電圧が違っていても候補に並ぶ**。
 * MS3749-A-D45（AC100〜240V）と MS3749-D-D45（DC24V）は入力信号・第1出力・
 * 第2出力・外形寸法が同一で、どちらもオプションを持たない。違うのは電源電圧だけ
 * なので、パネルが無ければ③は差の読めない2枚のカードになる。
 *
 * **画面全体の文字列（`textContent('#app')`）で見ない。** このカテゴリは
 * `evidence.specs.srcNote` に型式コードの読み下しを書くので、
 * `DC24V` も `AC100〜240V` も出典行に現れる。パネルを消しても画面全体の検索では
 * 通ってしまう（オプションの `text`・第2出力の表記で2回踏んだ形。
 * `docs/design-insulation-converter.md` 6章）。だから**パネルの要素から**、
 * しかも**そのカードのパネル**から読む。
 *
 * 両方向を見るのは、基準機側の値だけ・候補側の値だけを出す実装でも
 * 片方向では通ってしまうため（`gate` の対称性検査と同じ考え方）。
 * 本文には基準機の値とこの候補の値の両方を要求する。
 */
const isoD45 = await insulationResult('MS3749-A-D45');
const psD45 = isoD45.panelOf('MS3749-D-D45', '電源電圧');
check('MS3749-A-D45 の③に電源電圧のパネルが出て、AC100〜240V と DC24V の両方が読める',
  psD45?.body.includes('AC100〜240V') === true
  && psD45.body.includes('DC24V')
  && psD45.body.includes('盤に来ている電源を確認')
  && psD45.tone === 'cmp-warn',
  psD45 ? `${psD45.tone} / ${psD45.body}` : `パネルが無い（${isoD45.panelTitlesOf('MS3749-D-D45')?.join(' / ') ?? 'カードが無い'}）`);

const isoDD45 = await insulationResult('MS3749-D-D45');
const psDD45 = isoDD45.panelOf('MS3749-A-D45', '電源電圧');
check('MS3749-D-D45 の③にも電源電圧のパネルが出る（逆向きでも基準機と候補の値がそろう）',
  psDD45?.body.includes('DC24V') === true
  && psDD45.body.includes('AC100〜240V')
  && psDD45.tone === 'cmp-warn',
  psDD45 ? `${psDD45.tone} / ${psDD45.body}` : `パネルが無い（${isoDD45.panelTitlesOf('MS3749-A-D45')?.join(' / ') ?? 'カードが無い'}）`);

/**
 * 電源電圧が同じ組では、パネルを出さない。
 *
 * MS3749-A-O25 と MS3749-A-O25/H はどちらも AC100〜240V。「電源電圧 同じ」の枠は
 * 情報を増やさず、本当に差がある枠と同じ場所を占める（オプションの
 * 「どちらも持たない組では出さない」と同じ扱い）。
 *
 * 空振り防止に、**同じカードにオプションのパネルが出ていること**を併せて見る。
 * これが無いと、`detailPanels` がパネルを1枚も返さない壊れ方や、
 * ③のカードごと描かれない壊れ方でも「電源電圧のパネルが無い」は真になる。
 */
const o25hTitles = isoO25.panelTitlesOf('MS3749-A-O25/H');
check('MS3749-A-O25 の③に電源電圧のパネルが出ない（候補と電源が同一・オプションのパネルは出る）',
  o25hTitles !== null
  && !o25hTitles.includes('電源電圧')
  && o25hTitles.includes('オプション'),
  `MS3749-A-O25/H のパネル: ${o25hTitles?.join(' / ') ?? 'カードが無い'}`);

/**
 * 1出力型（型式コードの第2出力が未記入）では、②に第2出力の欄を出さない。
 *
 * 前方一致で見るのは、「第2出力」と「第2出力 最大周波数」の2欄をまとめて
 * 落とすため。ここでも空振り防止に、第2出力を持つ MS3749-A-O25 では
 * 同じ欄が出ていることを併せて見る（欄の描画ごと壊れたら両方が落ちる）。
 */
const isoD4 = await insulationResult('MS3749-A-D4/H');
check('MS3749-A-D4/H の②に第2出力の欄が出ない（1出力型・MS3749-A-O25 では出る）',
  !isoD4.labels.some((l) => l.startsWith('第2出力'))
  && isoD4.labels.includes('第1出力')
  && isoO25.labels.includes('第2出力'),
  `A-D4/H: ${isoD4.labels.join(' / ')} ／ A-O25: ${isoO25.labels.join(' / ')}`);

/**
 * 銘板表記の変換表に無い値は、仕様書の表記のまま出す。
 *
 * 銘板の写真で読めたのは OPN.C. と Line Driver Pulse の2つだけで、
 * DC電圧パルス・電圧パルス10V・電圧パルス12V は未確認。**未知の値を握りつぶさない**
 * ことをここで固定する。`formatSignal` が表に無い値を空文字や「―」に倒す実装に
 * なると、登録済みの値が画面から消えるが、O25 側の検査だけでは落ちない。
 */
check('MS3749-A-D4/H の②で第1出力が「電圧パルス12V」のまま（変換表に無い値はそのまま出す）',
  isoD4.specOf('第1出力') === '電圧パルス12V' && isoD4.specOf('入力信号') === 'DC電圧パルス',
  `入力信号: ${isoD4.specOf('入力信号') ?? '欄が無い'}`
  + ` / 第1出力: ${isoD4.specOf('第1出力') ?? '欄が無い'}`);

/**
 * 略記であることを②で名乗る（`nameplateNote`）。
 *
 * 「OPN.C.」は仕様書のどこにも出てこない綴りなので、仕様書だけを持っている人は
 * これだけでは照合できない。②に対応表を1行出して結び付ける。値そのものを
 * 併記にしない理由は `insulation.mjs` の `nameplateNote` に書いた
 * （同じ `format` が③のカード右上にも掛かり、短くした意味が消えるため）。
 *
 * 変換が1つも起きていない型式（MS3749-A-D4/H）に**この行が出ないこと**も併せて見る。
 * 出てしまうと、仕様書の表記のまま出している値まで「銘板の印字」と名乗る。
 * 両側を見るので、行を常時出す実装でも常時出さない実装でも落ちる。
 */
const npRow = isoO25.specOf('信号名の表記');
check('②が銘板表記であることを名乗る（MS3749-A-O25 に対応表・MS3749-A-D4/H には出ない）',
  npRow?.includes('銘板') === true
  && npRow.includes('OPN.C.＝無電圧接点・オープンコレクタ')
  && npRow.includes('OPN.C.＝オープンコレクタ')
  && npRow.includes('Line Driver Pulse＝ラインドライバ・パルス')
  && !isoD4.labels.includes('信号名の表記'),
  `A-O25: ${npRow ?? '欄が無い'} ／ A-D4/H のラベル: ${isoD4.labels.join(' / ')}`);

/* ---- 出典バッジがページを横に伸ばさない（`.evidence .badge` の折り返し） ---- */

/**
 * 出典（`srcNote`）を出す evidence バッジは、長いものが1つで 3273px になる。
 * `.badge` の `white-space:nowrap` のままだと②のページ全体が横スクロールになり、
 * 390px 幅の実測で 530件中72件（srcNote を持つ追加レコード全件）がそうなっていた。
 * `src/index.html` の `.evidence .badge{white-space:normal}` がこれを折り返す。
 *
 * **測るのは 390px 幅**（iPhone 標準幅。このアプリの主対象）。既定の 1280px でも
 * 最大級の2件は超えるが、はみ出しは画面が狭いほど効くので、狭い側で固定する。
 * 対象の2件は実測ではみ出しが最大だったレコード
 * （絶縁 MS3749-A-O25 3298px / インバータ FR-E720-3.7K 2241px）。
 * ③も見るのは、候補カードが1件ごとに evidence 行を持つため。
 */
const baseViewport = page.viewportSize();
await page.setViewportSize({ width: 390, height: 844 });

async function pageWidth(cat, model, step3) {
  await gotoCategory(cat);
  await search(model);
  await page.waitForSelector('.model.big');
  if (step3) {
    await page.click('[data-act="step"][data-v="3"]');
    await page.waitForTimeout(200);
  }
  return page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    widest: (() => {
      const cw = document.documentElement.clientWidth;
      let w = null;
      for (const e of document.querySelectorAll('#app *')) {
        const r = e.getBoundingClientRect();
        if (r.right > cw + 1 && (!w || r.right > w.right)) {
          w = { right: Math.round(r.right), cls: e.className, text: (e.textContent || '').replace(/\s+/g, ' ').slice(0, 40) };
        }
      }
      return w;
    })(),
  }));
}

for (const [cat, model] of [['insulation', 'MS3749-A-O25'], ['inverter', 'FR-E720-3.7K']]) {
  const p2 = await pageWidth(cat, model, false);
  check(`${model} の②が横にはみ出さない（画面幅 390px）`,
    p2.scrollW <= p2.clientW + 1,
    `scrollWidth ${p2.scrollW} / clientWidth ${p2.clientW}${p2.widest ? ` ← ${p2.widest.cls} "${p2.widest.text}"` : ''}`);
}

const p3 = await pageWidth('inverter', 'FR-E720-3.7K', true);
check('FR-E720-3.7K の③（候補カードの出典行）も横にはみ出さない',
  p3.scrollW <= p3.clientW + 1,
  `scrollWidth ${p3.scrollW} / clientWidth ${p3.clientW}${p3.widest ? ` ← ${p3.widest.cls} "${p3.widest.text}"` : ''}`);

/* ---- ③の候補カード: 銘板表記にすると型式名が折り返さない ---- */

/**
 * カード右上（`.card-right`）は主スペックの幅で決まり、`flex-shrink:0` なので縮まない。
 * 左列（型式名）だけが削られるため、**右上が長いほど型式名が折り返す**。
 *
 * 390px 幅の実測で、主スペックが「無電圧接点・オープンコレクタ」（全角14字）の
 * ときは `.card-right` が 212.5px、`.model` が 117.5×51.2px（行高 25.6px）で
 * 2行に割れていた。銘板の印字「OPN.C.」にすると 54px / 137.7×25.6px の1行になる。
 * 折り返しの境目は全角13字と14字のあいだにあり、差は約2文字分しかない。
 * この検査が無いと、変換表から O25 の値を外しても全検査が通ってしまう。
 *
 * 行数は「一覧の行内バッジが1行のまま」と同じく、実高さ ÷ 行高で数える。
 * 行高が数値で取れないときは `lines` を null にして**落とす**。
 * 割り算できないことを「1行だった」に倒さない。
 *
 * 対象は MS3749-A-O25 の③に出る候補カード全件。名指しの MS3749-A-O25/H は
 * その中で型式名が最も長い（`/H` 付き）行で、実測で2行に割れていた当人。
 * 候補が0件になったら（判定が壊れたら）落ちるように、件数と名指しの1件も見る。
 */
await gotoCategory('insulation');
await search('MS3749-A-O25');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForSelector('.card .model');
const isoCards = await page.$$eval('.card', (els) => els.map((e) => {
  const m = e.querySelector('.model');
  const lh = parseFloat(getComputedStyle(m).lineHeight);
  const r = m.getBoundingClientRect();
  return {
    model: m.textContent.trim(),
    primary: e.querySelector('.card-right .primary-spec').textContent.trim(),
    rightW: Math.round(e.querySelector('.card-right').getBoundingClientRect().width * 10) / 10,
    modelW: Math.round(r.width * 10) / 10,
    modelH: Math.round(r.height * 10) / 10,
    lh: lh > 0 ? lh : null,
    lines: lh > 0 ? Math.max(1, Math.round(r.height / lh)) : null,
  };
}));
const ISO_ANCHOR = 'MS3749-A-O25/H';
const isoAnchor = isoCards.find((c) => c.model === ISO_ANCHOR);
const isoCardDetail = isoCards
  .map((c) => `${c.model}: 右上 "${c.primary}" ${c.rightW}px / .model ${c.modelW}×${c.modelH}px 行高${c.lh ?? '不明'} ${c.lines ?? '?'}行`)
  .join(' ／ ') || '候補0件';

check(`MS3749-A-O25 の③のカード右上が OPN.C. になる（${ISO_ANCHOR} を含む）`,
  isoCards.length > 0 && !!isoAnchor && isoCards.every((c) => c.primary === 'OPN.C.'),
  isoCardDetail);
check(`MS3749-A-O25 の③で型式名が1行に収まる（画面幅 390px・${ISO_ANCHOR} を含む）`,
  isoCards.length > 0 && !!isoAnchor && isoCards.every((c) => c.lines === 1),
  isoCardDetail);

/**
 * 一覧の行内バッジは1行のまま。
 *
 * 折り返しを `.badge` 全体へ広げると、一覧の行（`.row-main`）はフレックスではなく
 * インラインの文字列なので、バッジが行末にかかると**枠線ごと2行に割れる**。
 * 390px 幅の実測で、サーボの一覧27行のうち11行がそうなった。
 * この検査が無いと、その変更を入れても全検査が通ってしまう。
 *
 * 名指しの `SGDM / SGDH / SGDP / SGDJ / SGDD`（`data/servo.json` の SVD_SGDM_2015）は、
 * その11行のうちの1つ——「シリーズ単位」バッジが 321x34px の2行に割れた行——を
 * 実測から選んだもの。行が消えたら検査は落ちる（対象0件で PASS しないため）。
 */
await gotoCategory('servo');
await page.click('[data-act="browse"]');
await page.waitForSelector('.rows [data-act="pick"]');
const servoRows = await page.$$eval('.rows [data-act="pick"]', (els) => els.map((e) => ({
  model: e.querySelector('.mono').textContent.trim(),
  badges: [...e.querySelectorAll('.badge')].map((b) => {
    const cs = getComputedStyle(b);
    const lh = parseFloat(cs.lineHeight) || 12;
    const r = b.getBoundingClientRect();
    const inner = r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
      - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    return { text: b.textContent.trim(), w: Math.round(r.width), lines: Math.max(1, Math.round(inner / lh)) };
  }),
})));
const ANCHOR = 'SGDM / SGDH / SGDP / SGDJ / SGDD';
const anchorRow = servoRows.find((r) => r.model === ANCHOR);
check(`一覧の行内バッジが1行のまま（案Aで割れた ${ANCHOR} を含む）`,
  !!anchorRow && anchorRow.badges.length > 0
  && servoRows.every((r) => r.badges.every((b) => b.lines === 1)),
  !anchorRow
    ? `基準にした行 "${ANCHOR}" が一覧に無い（data/servo.json を確認）`
    : servoRows.flatMap((r) => r.badges.filter((b) => b.lines > 1)
        .map((b) => `${r.model}: [${b.text}] ${b.w}px ${b.lines}行`)).join(' / '));

await page.setViewportSize(baseViewport);

/* ---- ②の出典行は操作ボタンより後ろに置く ---- */

/**
 * 出典行（`.evidence`）が「この仕様で互換品を表示」「型式を選び直す」の両方より
 * 後ろにあることを DOM 出現順で固定する。
 *
 * 出典は表示された仕様を疑ったときに読むもので、交換作業中の動線には要らない。
 * 仕様欄と外形図の間にあったときは、`srcNote` を持つレコードでこの1行が画面1枚分を
 * 占め、操作ボタンへ到達するまでにその本文をスクロールで越える必要があった。
 *
 * 対象は2件で、本文の有無で位置が変わらないことを見る。
 *   MS3749-A-O25（絶縁変換器）… `evidence` の3側面すべてに `srcNote` と `checkedAt` が
 *     あり、出典行は813字。うち状態表示は18字。この画面が今回の動機そのもの。
 *   S-T10（電磁接触器）… `data/contactor.json` の MIT-ST10 は `evidence` が
 *     3側面とも `state` だけで、`srcNote` も `srcUrl` も `checkedAt` も持たない。
 *     出典行は状態表示の18字だけになる。
 *
 * 本文の有無そのものも下で検査する。データが変わって両方とも本文ありに（あるいは
 * 両方とも本文なしに）なると、この2件は「本文の有無に依らない」ことを示さなくなるが、
 * 位置だけを見る検査はその状態でも黙って通ってしまうため。落ちたときは条件を緩めず、
 * `data/**` を読んで該当する側のレコードを選び直す。
 */
const CONFIRM_FLOW_TARGETS = [
  ['insulation', 'MS3749-A-O25', '出典の本文あり'],
  ['contactor', 'S-T10', '出典の本文なし'],
];
const confirmFlows = [];
for (const [cat, model, why] of CONFIRM_FLOW_TARGETS) {
  await gotoCategory(cat);
  await search(model);
  await page.waitForSelector('.model.big');
  const flow = await confirmFlow();
  confirmFlows.push({ model, why, flow, body: await confirmEvidenceBody() });
  const evAt = flow.indexOf('出典行');
  const goAt = flow.indexOf('互換品を表示ボタン');
  const backAt = flow.indexOf('型式を選び直すボタン');
  check(`②で出典行が操作ボタンより後ろに出る（DOM順・${model}／${why}）`,
    evAt >= 0 && goAt >= 0 && backAt >= 0 && evAt > goAt && evAt > backAt,
    `並び: ${flow.join(' → ')}`);
}

const withBody = confirmFlows.find((x) => x.model === 'MS3749-A-O25');
const withoutBody = confirmFlows.find((x) => x.model === 'S-T10');
check('②の出典行の検査が、本文を持つレコードと持たないレコードの両方を通っている',
  withBody?.body.notes > 0 && withBody?.body.links > 0 && withBody?.body.len > 100
  && withoutBody?.body.notes === 0 && withoutBody?.body.links === 0,
  `${withBody?.model}: 本文${withBody?.body.notes}件・リンク${withBody?.body.links}件・${withBody?.body.len}字`
  + ` / ${withoutBody?.model}: 本文${withoutBody?.body.notes}件・リンク${withoutBody?.body.links}件・${withoutBody?.body.len}字`);

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

/* ---- 候補カードの添字は分割前の通し番号のまま ---- */

/** ③の候補カードを、そのカードに付いているバッジの文言つきで文書順に拾う */
async function cardBadges() {
  return page.$$eval('.card', (els) => els.map((e) => ({
    model: e.querySelector('.model').textContent.trim(),
    badges: [...e.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
  })));
}

/**
 * 分けた③に「候補No.1」バッジを出さない。
 *
 * `candidateCard` はこのバッジを添字0にだけ付ける。`viewResult` がゾーンごとに
 * 添字を数え直すと、公式後継の隣で判定側の先頭が「候補No.1」を名乗り、
 * 「No.1がだめならNo.2で代用」という読みが戻る。根拠で分けた意味が見た目で消える。
 *
 * 2ゾーンに分かれていること自体も同じ検査で見る。分割が壊れて1列に戻ると先頭は
 * 後継品（＝「メーカー後継品」バッジ）になるので「候補No.1」はやはり出ず、
 * 出ないことだけを見る検査はその状態でも黙って通ってしまう。
 */
await gotoCategory('contactor');
await search('S-N18');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const sn18Split = await resultZones();
const sn18Numbered = (await cardBadges()).filter((c) => c.badges.includes('候補No.1'));
check('2ゾーンに分けた③には「候補No.1」バッジが1つも出ない（添字をゾーンごとに数え直さない）',
  sn18Split.length === 2 && sn18Split.every((z) => z.models.length > 0)
  && sn18Numbered.length === 0,
  sn18Numbered.length
    ? `バッジの付いた候補: ${sn18Numbered.map((c) => c.model).join(' ')}`
    : `ゾーン: ${sn18Split.map((z) => `${z.title || '(見出し無し)'}:${z.models.length}件`).join(' → ')}`);

/**
 * 反対側。後継品を持たない型式は分割しないので、先頭が「候補No.1」を名乗る。
 *
 * 上の検査は「出ない」ことしか見ていないため、バッジを描く実装ごと消しても通る。
 * 今もバッジが出る画面を1つ押さえて、上の検査が空振りしていないことを示す。
 * S-T10 は `successorId` を持たない現行品なので、③は見出し無しの1列になる。
 *
 * 対象が「1列のまま」であることがこの検査の前提で、これはデータ側の都合で崩れる。
 * `data/contactor.json` の S-T10 に `successorId` が付くと③は2ゾーンに分かれ、
 * 先頭は後継品（＝「メーカー後継品」バッジ）になるので「候補No.1」は出なくなり、
 * この検査は落ちる。画面が実際に変わっているので、落ちること自体は正しい。
 *
 * そのときは検査を消したり「バッジが0個でもよい」と条件を緩めたりしない。
 * それをすると上の検査を支える足場が無くなり、バッジを描く実装ごと消えても
 * 両方黙って通る状態に戻る。直し方は対象の差し替えで、`successorId` を持たない
 * 別の現行品を選ぶ。型式は記憶で決めず、`data/contactor.json` にそのレコードが
 * あり `successorId` を持たないことを読んで確かめてから使う。
 */
await gotoCategory('contactor');
await search('S-T10');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const st10Cards = await cardBadges();
const st10Numbered = st10Cards.filter((c) => c.badges.includes('候補No.1'));
check('後継品を持たない型式の③では、先頭の候補に「候補No.1」バッジが出る',
  (await page.$$('.zone-head')).length === 0
  && st10Cards.length > 0 && st10Numbered.length === 1
  && st10Numbered[0].model === st10Cards[0].model,
  `候補 ${st10Cards.length}件 / 先頭 ${st10Cards[0]?.model}`
  + ` / バッジの付いた候補 ${st10Numbered.map((c) => c.model).join(' ') || 'なし'}`);

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

/* ---- 注意書きの文面を主スペックに合わせる ---- */

/** ③の注意書き（`.load-note`）の全文。出ていなければ空文字 */
async function loadNote() {
  const el = await page.$('.load-note');
  return el ? (await el.textContent()).replace(/\s+/g, ' ').trim() : '';
}

/**
 * 注意書きを出す6カテゴリを、1画面ずつ実際に開いて文面を拾う。
 *
 * 文面はコアが持つ枠と、カテゴリが持つ真ん中の1文でできている。枠だけを見ると
 * 「文面がある」ことしか分からないので、カテゴリ側の1文が主スペックの量に
 * 合っているかまで見る。検出距離の画面に「実際の負荷電流は…」が出ていたのは、
 * 文面がまるごとコアに直書きされていたため。
 *
 * 表はここに置くしかない（配布物は1つのIIFEに畳まれていて、ブラウザ側から
 * レジストリを読めない）。カテゴリを足したときにこの表へ足し忘れても、
 * 既定の文面は量に依らない中立文なので、掛からない量の話が出ることはない。
 */
const NOTE_SCREENS = [
  { cat: 'contactor', model: 'S-N35', family: '電流系' },
  { cat: 'starter', model: 'MSO-N20', family: '電流系' },
  { cat: 'inverter', model: 'FR-E820-5.5K-1', family: '電流系' },
  { cat: 'proximity', model: 'E2E-X12C318', family: '距離系' },
  { cat: 'photo', model: 'E3Z-D61', family: '距離系' },
  { cat: 'ultrasonic', model: 'US-T50', family: '距離系' },
];
const CURRENT_PHRASE = '実際の負荷電流は定格とはかぎらない';
const DISTANCE_PHRASE = '実際に必要な検出距離は設置条件で決まる';

const notes = [];
for (const s of NOTE_SCREENS) {
  await standingCards(s.cat, s.model);
  notes.push({ ...s, text: await loadNote() });
}
const noteOf = (model) => notes.find((x) => x.model === model)?.text ?? '';
const distanceNotes = notes.filter((x) => x.family === '距離系');
const currentNotes = notes.filter((x) => x.family === '電流系');

check('注意書きを出す6カテゴリすべてで、文面が空でない',
  notes.length === 6 && notes.every((x) => x.text.length > 0),
  notes.filter((x) => !x.text).map((x) => `${x.cat}/${x.model}`).join(' ') || `${notes.length}カテゴリ`);

check('E3Z-D61（フォトスイッチ）の注意書きに「負荷電流」が出ない',
  !!noteOf('E3Z-D61') && !noteOf('E3Z-D61').includes('負荷電流')
  && noteOf('E3Z-D61').includes(DISTANCE_PHRASE),
  noteOf('E3Z-D61'));

check('S-N35（電磁接触器）の注意書きには従来どおり負荷電流の記述がある',
  noteOf('S-N35').includes(CURRENT_PHRASE), noteOf('S-N35'));

check('距離系3カテゴリの注意書きが、検出距離の話になっている（電流の話が混ざらない）',
  distanceNotes.length === 3
  && distanceNotes.every((x) => x.text.includes(DISTANCE_PHRASE) && !x.text.includes('負荷電流')),
  distanceNotes.map((x) => `${x.cat}: ${x.text}`).join(' | '));

check('電流系3カテゴリの注意書きが、定格と実負荷の話になっている',
  currentNotes.length === 3 && currentNotes.every((x) => x.text.includes(CURRENT_PHRASE)),
  currentNotes.map((x) => `${x.cat}: ${x.text}`).join(' | '));

/**
 * 量に依らない2文（何と比べたのか／表示が無い候補は何なのか）は、どのカテゴリでも出る。
 * カテゴリ側の1文だけを差し替える設計なので、枠が欠けたらここで落ちる。
 */
check('どのカテゴリの注意書きにも、比較の対象と「表示が無い候補」の意味を書く',
  notes.every((x) => x.text.includes('交換前の機器の登録値との比較')
    && x.text.includes('基準以上か、比較できる値が登録されていない')),
  notes.filter((x) => !x.text.includes('交換前の機器の登録値との比較')
    || !x.text.includes('基準以上か、比較できる値が登録されていない')).map((x) => `${x.cat}: ${x.text}`).join(' | '));

/* ---- 比較できる値が無い組（'unknown'）では、大小の表示も注意書きも出さない ---- */

/**
 * 旧機種インバータ30件は定格出力電流をキーごと持たないので、これを基準にした組は
 * 全件 `primaryStanding` が 'unknown' になる（`numericStanding` は値の不在を
 * 'atOrAbove' に倒さない）。'unknown' は「基準以上」ではないので大小の表示は出さず、
 * 'below' が0件なので注意書きも出ない。
 *
 * 基準の主スペックが「―」（＝キーごと持たない）であることを先に確かめてから見る。
 * 候補が0件になったり、旧機種に定格が登録されたりして 'unknown' の経路を通らなく
 * なったとき、「表示が無い」ことだけを見る検査は黙って通ってしまう。
 * サーマルリレーの検査（判定しないカテゴリ＝null）とは別の経路で、こちらは
 * 判定を宣言したカテゴリの中で値が無い組が通る。
 */
const legacyCards = await standingCards('inverter', 'FR-E720-3.7K');
const legacyBase = await baseSpec();
check('FR-E720-3.7K（定格出力電流を持たない）の③では、大小の表示が1件も出ない',
  legacyBase === '―' && legacyCards.length > 0
  && legacyCards.every((c) => c.standing === '') && (await page.$$('.standing')).length === 0,
  `基準 ${legacyBase} / 候補 ${legacyCards.map((c) => `${c.model}(${c.spec}) 表示「${c.standing}」`).join(' ') || 'なし'}`);
check('FR-E720-3.7K の③には実負荷の注意書きも出さない（比較できない組を「基準より小さい」に数えない）',
  (await page.$$('.load-note')).length === 0, await loadNote());

/* ---- ③の0件パネルは、そのカテゴリの gate が実際に使っている理由だけを言う ---- */

/**
 * ③の0件パネル（`.empty-note`）の全文。パネルが無ければ空文字。
 *
 * 以下の検査はどれも「この語が出ない」を含むので、**パネルが出ていること自体を
 * 毎回いっしょに要求する**。0件の画面に到達できなくなったとき（候補が付いた・
 * 型式が消えた・検索が曖昧一致に落ちた）、出ないことだけを見る検査は
 * 対象0件のまま黙って全部PASSになる。
 */
async function emptyNoteText() {
  const el = await page.$('.empty-note');
  return el ? (await el.textContent()).replace(/\s+/g, ' ').trim() : '';
}

/**
 * インバータの0件画面（FR-E820-0.1K-1 ＝ 3相200V・0.8A）。
 *
 * この画面が0件なのは、登録が無いからでも電気的に成立しないからでもない。
 * 同じ電圧クラス・同じ電源相数の型式は12件登録済みで、定格出力電流が gate の窓に
 * 入らないだけ（隣の FR-E820-0.2K-1 は 1.5A）。コアの既定文は `sensorGate` にしか
 * 無い2条件（出力極性・配線本数）を9カテゴリ共通で名乗っていたため、
 * インバータの0件20件はここで「実際には使っていない除外理由」を読まされていた。
 */
const invZeroCards = await standingCards('inverter', 'FR-E820-0.1K-1');
const invZeroNote = await emptyNoteText();
const invZeroScreen = (await page.textContent('#app')).replace(/\s+/g, ' ');
check('FR-E820-0.1K-1 の③が候補0件で、0件パネルが出る（以下4件の足場）',
  invZeroCards.length === 0 && invZeroNote.length > 0,
  `候補 ${invZeroCards.length}件 / パネル「${invZeroNote || 'なし'}」`);

check('インバータの0件パネルに、gate が見ていない除外理由（出力極性・配線本数）を書かない',
  invZeroNote.length > 0 && !invZeroNote.includes('出力極性') && !invZeroNote.includes('配線本数'),
  invZeroNote);

// 0件は登録の有無とは限らない。同クラス・同相の型式が登録済みで窓を外れているだけの
// ことがあるので、③の画面のどこにもこの断定を出さない（見出しに限らず画面全体で見る）
check('インバータの0件画面に「登録されていません」と断定しない',
  invZeroNote.length > 0 && !invZeroScreen.includes('登録されていません'),
  invZeroScreen.slice(0, 200));

/**
 * インバータ向けの文面が出ていること。何を見るかは要素で決める。
 *
 * 見るのは「gate が実際に使っている3条件の名前」と「範囲外は使えないことを意味しない」
 * の両方。前者だけ（たとえば「電源相数」の1語）を見る検査にすると、後半を落としても
 * 通ってしまう。後半はこの段の目的そのもの——アプリが知っているのは登録された定格だけで
 * 現場の実負荷は知らない、という段4と同じ原則——なので、条件の名前と同じ強さで固定する。
 * ±30% の窓幅は文面に出していないので、ここでも数値は見ない
 * （`withinWindow` は大きい方を基準に取るため、基準値から見た幅は上下で非対称になる）。
 */
const INV_EMPTY_PARTS = ['電圧クラス', '電源相数', '定格出力電流',
  '使えないことを意味しません', '現場の負荷', 'メーカーの選定資料'];
const invMissing = INV_EMPTY_PARTS.filter((p) => !invZeroNote.includes(p));
check('インバータの0件パネルが、判定に使う3条件と「範囲外＝使えないではない」を書く',
  invZeroNote.length > 0 && invMissing.length === 0,
  `欠けている要素: ${invMissing.join(' / ') || 'なし'} / パネル「${invZeroNote}」`);

// 0件パネルにも③の他の文言と同じ制約が掛かる（`smoke` の S-N35 の検査と同じ原則）。
// 「該当なし」を「使えない」と書き換えた瞬間に、成立する置換えを現場が捨てる
check('インバータの0件パネルで適合の可否を断定しない（「使用不可」「代替なし」など）',
  invZeroNote.length > 0 && !/使用不可|代替なし|容量不足|容量が足りな/.test(invZeroNote),
  (invZeroNote.match(/使用不可|代替なし|容量不足|容量が足りな/) || [])[0]);

/**
 * センサー側の0件パネル。文面は同じでも、0件になった理由は画面ごとに違う。
 *
 * 移設直後の文面は「（出力極性・配線本数の相違）は候補から除外しています」と、
 * その画面で起きたことを語る形だった。`emptyNote(m)` は基準機しか受け取らないので
 * アプリはそれを知らず、実測（`docs/sensor-empty-note-audit.md`）では候補0件16件のうち
 * 1件で偽・5件で何も説明しない文になっていた。文面を必要条件の言い方に変えたので、
 * **理由の違う3画面で同じ文面が出ること**を検査でも固定する。3件は実測の分類から取った。
 *
 *   IM5132（A・極性が実効）… 同じ `compatGroup`「PX角型」・同じ `threadSize`「角型」の
 *     GX-F8B / GX-F12B が居るが、どちらも NPN なので `polarityOK` が落とす。
 *     この画面だけを見て検査を書くと、移設直後の文面でも通ってしまう。
 *   9800-0159（B・系列が単独）… `compatKey`「PX-SEJリング」を持つのは自身だけで、
 *     `compatGroup` も持たない。極性・配線で落ちた候補は0件なので、
 *     移設直後の文面はこの画面で何も説明していなかった。
 *   GX-4M（C・ねじ径で落ちた）… `compatGroup`「PX円柱」を共有する19件は全部ねじ径違い。
 *     極性・配線を外しても1件も候補にならないので、移設直後の文面はここで偽だった。
 *
 * 見るのは3画面で同じ文面が出ることと、その文面が必要条件の言い方になっていること。
 * 「どの条件で外れたか」を画面ごとに言い分ける実装に戻したら、ここで落ちる。
 */
const SENSOR_EMPTY_PARTS = ['メーカー指定の後継品', '互換系列', '出力極性', '配線本数',
  'ものだけです', 'どの条件で外れたかはこの画面では判別できません'];
const sensorZeroScreens = [];
for (const [model, why] of [['IM5132', 'A:極性が実効'], ['9800-0159', 'B:系列が単独'], ['GX-4M', 'C:ねじ径で落ちた']]) {
  const cards = await standingCards('proximity', model);
  sensorZeroScreens.push({
    model, why, cards: cards.length, note: await emptyNoteText(),
    screen: (await page.textContent('#app')).replace(/\s+/g, ' '),
  });
}
for (const s of sensorZeroScreens) {
  const missing = SENSOR_EMPTY_PARTS.filter((p) => !s.note.includes(p));
  check(`近接スイッチの0件型式 ${s.model}（${s.why}）の③に、候補の必要条件を語る文面が出る`,
    s.cards === 0 && s.note.length > 0 && missing.length === 0,
    `候補 ${s.cards}件 / 欠けている要素: ${missing.join(' / ') || 'なし'} / パネル「${s.note || 'なし'}」`);
}

// 理由の違う3画面で文面が割れていないこと。1件ずつ見る検査では、
// 画面ごとに理由を言い分ける実装（アプリが知らないことを語る形）に戻っても気づけない
const noteSet = new Set(sensorZeroScreens.map((s) => s.note));
check('理由の違う3画面（A/B/C）で0件パネルの文面が同一（画面ごとに理由を言い分けない）',
  noteSet.size === 1 && sensorZeroScreens.every((s) => s.note.length > 0),
  [...noteSet].map((t) => `「${t}」`).join(' ≠ '));

/**
 * 「登録されていません」は0件画面のどこにも出さない。
 *
 * 実測では候補0件16件のうち11件で、互換系列を共有する型式が登録済みだった。
 * 判定で外れただけなのに「登録されていません」と書くと、データの欠落と読める。
 * この語は検索画面が「実在確認済みのデータが未登録です」の意味で使っている
 * （`src/core/app.mjs`）ので、意味が衝突する。
 *
 * 見出しだけでなく③の画面全体で見る。インバータの0件画面には同じ制約の検査が
 * すぐ上にあるので、ここではセンサー側の3画面を見る（同じ defect で2件落とさない）。
 */
const declaresUnregistered = sensorZeroScreens.filter((s) => s.screen.includes('登録されていません'));
check('センサーの0件画面（A/B/C の3件）のどこにも「登録されていません」と断定しない',
  sensorZeroScreens.length === 3 && sensorZeroScreens.every((s) => s.screen.length > 0)
  && declaresUnregistered.length === 0,
  declaresUnregistered.map((s) => s.model).join(' / '));

/**
 * サーボの0件画面は今回の対象外。文面が変わっていないことを見る。
 *
 * 全文一致にしないのは、代替シリーズ名が `data/servo.json` 由来（`Σ-Xシリーズ`）で、
 * データが増えたときに文面の検査がデータの検査に化けるため。代わりに、サーボ固有の
 * 3要素が残っていることと、**他カテゴリの文面が混ざっていないこと**を見る。
 * コアの既定文やセンサーの文面に差し替わる壊れ方は、この後半で落ちる。
 */
await gotoCategory('servo');
await search('SGDM');
await page.waitForSelector('.model.big');
await page.click('[data-act="step"][data-v="3"]');
await page.waitForTimeout(200);
const servoZeroNote = await emptyNoteText();
const servoLeak = ['出力極性', '配線本数', '電源相数', '判定条件を満たす型式']
  .filter((p) => servoZeroNote.includes(p));
check('サーボの0件パネルが従来どおり（シリーズ単位の説明のままで、他カテゴリの文面が混ざらない）',
  (await page.$$('.card')).length === 0
  && servoZeroNote.includes('シリーズ単位のため、型式ごとの互換判定は行いません')
  && servoZeroNote.includes('メーカーが案内する代替は')
  && servoZeroNote.includes('個別型式を確定させたうえでメーカー選定資料で確認してください')
  && servoLeak.length === 0,
  servoLeak.length ? `他カテゴリの語が混ざった: ${servoLeak.join(' / ')}` : servoZeroNote);

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

/* ---- O（英字）と 0（数字）の読み違い（normLoose だけで同一視する） ---- */

/**
 * 銘板の O をゼロで打っても引けること。
 *
 * MS3749-A-O25 は3セグメント目の1桁目が英字 O で、現場がゼロで打つと以前は
 * 完全一致・部分一致とも0件（＝「見つかりませんでした」）になっていた。
 * 同一視は候補を「集める」normLoose にだけ入れてあるので、期待するのは
 * 曖昧一致リストではなく②への直行。曖昧一致リストに落ちるようなら、
 * 同一視で新しい衝突が生まれている（その場合 verify-data の検査13 も落ちる）。
 */
async function jumpsToConfirm() {
  // 引けなくなる壊れ方（0件で①に留まる）は待っても②が来ないので、待ち切りを
  // 短くして NG として報告する。既定の30秒待ちに任せると例外で落ち、
  // どの検査が何を見て落ちたのかが出力に残らない
  const reached = await page.waitForSelector('.model.big', { timeout: 3000 }).then(() => true, () => false);
  return {
    model: reached ? (await page.textContent('.model.big')).replace(/\s+/g, ' ').trim() : '（②へ進んでいない）',
    ambiguous: (await page.$$('.rows [data-act="pick"]')).length,
  };
}

for (const q of ['MS3749-A-025', 'MS3749-A-O25']) {
  await gotoCategory('insulation');
  await search(q);
  const r = await jumpsToConfirm();
  check(`絶縁変換器で「${q}」が MS3749-A-O25 の②に直行する`,
    r.model.includes('MS3749-A-O25') && r.ambiguous === 0,
    `型式=${r.model} / 曖昧一致 ${r.ambiguous}件`);
}

// 特定カテゴリの細工ではなく正規化そのものの変更であること（他カテゴリでも効く）
await gotoCategory('photo');
await search('06H200');
const ifm = await jumpsToConfirm();
check('フォトスイッチで「06H200」が O6H200 の②に直行する（他カテゴリでも効く）',
  ifm.model.includes('O6H200') && ifm.ambiguous === 0,
  `型式=${ifm.model} / 曖昧一致 ${ifm.ambiguous}件`);

// 打ち切りの途中でサジェストが消えないこと（0件だと候補ごと見えなくなる）
await gotoCategory('insulation');
await page.fill('#q', 'MS3749-A-0');
await page.dispatchEvent('#q', 'input');
await page.waitForTimeout(60);
const zeroSug = await page.$$eval('#sug [data-act="pick"]', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
check('入力途中の「MS3749-A-0」でサジェストが0件にならない',
  zeroSug.length > 0 && zeroSug.some((t) => t.includes('MS3749-A-O25')),
  `サジェスト ${zeroSug.length}件: ${zeroSug.join(' | ')}`);

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
