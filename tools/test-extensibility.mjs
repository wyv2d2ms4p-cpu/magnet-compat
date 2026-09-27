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
 * **候補の段の口（`src/core/tiers.mjs`）もここで見る。** 口（`alternates`・`checkDefs`・
 * `fieldQuestions`）を宣言するカテゴリは、このダミーのほかに無い（設計
 * `docs/design-common-alternates.md` 8-3 の順2。絶縁変換器が使い始めるのは順4）。
 * 利用者0の間に「対象0件で PASS」にしないため、ダミーに口を宣言させ、4つの段と
 * 4つの状態が実際に出ることを件数つきで見る（設計 8-1）。反対側として、口を宣言しない
 * 実在の全カテゴリ・全基準機で、段に分けても候補が1本も増減せず並びも変わらないことを見る。
 *
 *   node tools/test-extensibility.mjs
 */
import { writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_FILE = join(ROOT, 'data', 'dummy.json');
const MOD_FILE = join(ROOT, 'src', 'categories', 'dummy.mjs');
const CORE_FILES = ['src/core/util.mjs', 'src/core/store.mjs', 'src/core/registry.mjs',
  'src/core/compat.mjs', 'src/core/tiers.mjs', 'src/core/evidence.mjs', 'src/core/ui.mjs', 'src/core/app.mjs',
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

/**
 * 段の検査用のレコード。トルクを互いの窓（±30%）の外に離し、基準機どうしが候補に混ざらないようにする
 * （DMY-100 の「互換判定が動く」＝候補1件も、この離し方で保っている）。
 *
 *   DUMMY-10 … 4段がそろう基準機。後継 DUMMY-11、窓で DUMMY-12、口で DUMMY-13（分類）・DUMMY-14（2台）
 *   DUMMY-30 … 判定条件がすべて一致が0件で、下の段だけがある基準機（D8 の1行）
 *   DUMMY-40 … 判定一致と下の段の両方がある基準機（「候補No.1」が判定一致の先頭にだけ付く）
 *   DUMMY-20 … 口が登録に無い id を返す基準機（例外で止まる）。画面では開かない
 *   DUMMY-S  … シリーズ単位。口が返しても下の段に入らない
 *
 * 確認項目の値は、4状態がそろうように置く：電源電圧（equal）・出力（set）・絶縁耐圧（equal、候補側に無い）。
 */
const EV = { model: { state: 'verified' }, dims: { state: 'verified' }, specs: { state: 'verified' } };
const tierDevice = (id, model, maker, specs, extra = {}) => ({
  id, category: 'dummy', maker, model, modelStatus: 'catalog-confirmed',
  dims: { w: 10, h: 20, d: 30 }, mounting: 'DINレール', specs, evidence: EV, ...extra });
DUMMY_DATA.push(
  tierDevice('DUMMY-10', 'DMY-1000', 'テスト', { torqueNm: 1000, supplyV: 24, outputs: ['A'], insulationKV: 2 },
    { successorId: 'DUMMY-11' }),
  tierDevice('DUMMY-11', 'DMY-1000N', 'テスト', { torqueNm: 1000, supplyV: 24, outputs: ['A'], insulationKV: 2 }),
  tierDevice('DUMMY-12', 'DMY-1050', 'テスト', { torqueNm: 1050, supplyV: 24, outputs: ['A'], insulationKV: 2 }),
  tierDevice('DUMMY-13', 'OTH-3000', '別テスト', { torqueNm: 3000, supplyV: 24, outputs: ['A', 'B'] }),
  tierDevice('DUMMY-14', 'OTH-5000', '別テスト', { torqueNm: 5000, supplyV: 100, outputs: ['A'], insulationKV: 2 }),
  tierDevice('DUMMY-20', 'DMY-20000', 'テスト', { torqueNm: 20000 }),
  tierDevice('DUMMY-30', 'DMY-70000', 'テスト', { torqueNm: 70000, supplyV: 24, outputs: ['A'], insulationKV: 2 }),
  tierDevice('DUMMY-40', 'DMY-200000', 'テスト', { torqueNm: 200000, supplyV: 24, outputs: ['A'], insulationKV: 2 }),
  tierDevice('DUMMY-41', 'DMY-205000', 'テスト', { torqueNm: 205000, supplyV: 24, outputs: ['A'], insulationKV: 2 }),
  tierDevice('DUMMY-S', 'DMY-□□', 'テスト', { torqueNm: 900000 }, { modelScope: 'series' }),
);

const DUMMY_MODULE = `import { registerCategory } from '../core/registry.mjs';
import { withinWindow, preferTrue, ascending } from '../core/compat.mjs';
registerCategory({
  id: 'dummy', label: 'ダミー', group: 'test',
  specDefs: [{ key: 'torqueNm', label: '定格トルク', unit: 'N·m', primary: true, format: (v) => \`\${v}N·m\` }],
  gate: (a, m) => withinWindow(a.specs?.torqueNm, m.specs?.torqueNm, 0.3),
  rank: (a, b) => preferTrue(a.mountingMatch, b.mountingMatch) || ascending(a.diff, b.diff),
  summary: (d) => [{ label: '定格トルク', value: \`\${d.specs.torqueNm}N·m\` }],
  alternates: (m, ctx) => DUMMY_ALT[ctx.probe || m.id] || [],
  checkDefs: [
    { key: 'supplyV', label: '電源電圧', read: (d) => d.specs?.supplyV, compare: 'equal', format: (v) => \`\${v}V\`,
      whenDiffers: '盤に来ている電源を確認してください。' },
    { key: 'outputs', label: '出力', read: (d) => d.specs?.outputs, compare: 'set',
      whenField: '今使っている出力を確認してください。' },
    { key: 'insulationKV', label: '絶縁耐圧', read: (d) => d.specs?.insulationKV, compare: 'equal' },
  ],
  fieldQuestions: (m) => (m.id === 'DUMMY-10' ? ['第2出力の配線を使っているか'] : []),
});
const dummyClassMatch = (id) => ({ tier: 'classMatch', parts: [{ id, qty: 1 }] });
const DUMMY_ALT = {
  // 下の2件だけが下の段に残る。残りの5件は基準機自身・シリーズ単位・上の段の型式・重複で、コアが落とす
  'DUMMY-10': [dummyClassMatch('DUMMY-13'), { tier: 'rework', parts: [{ id: 'DUMMY-14', qty: 2 }], rule: 'テスト用の2台' },
    { tier: 'rework', parts: [{ id: 'DUMMY-13', qty: 2 }], rule: 'テスト用の2台' },
    dummyClassMatch('DUMMY-10'), dummyClassMatch('DUMMY-S'), dummyClassMatch('DUMMY-11'), dummyClassMatch('DUMMY-12')],
  'DUMMY-20': [dummyClassMatch('DUMMY-NOT-REGISTERED')],
  'DUMMY-30': [dummyClassMatch('DUMMY-13')],
  'DUMMY-40': [dummyClassMatch('DUMMY-13')],
  modelKey: [{ tier: 'classMatch', parts: [{ id: 'DUMMY-13', qty: 1, model: 'OTH-3000X' }] }],
  upperTier: [{ tier: 'exact', parts: [{ id: 'DUMMY-13', qty: 1 }] }],
};
`;

/* ---------- 候補の段（node） ---------- */

/** 実在の全カテゴリとダミーを読み込む。loadDevices は保管庫を丸ごと置き換えるので1回で読む */
async function loadAll() {
  const url = (p) => pathToFileURL(join(ROOT, p)).href;
  const mods = {
    store: await import(url('src/core/store.mjs')),
    registry: await import(url('src/core/registry.mjs')),
    compat: await import(url('src/core/compat.mjs')),
    tiers: await import(url('src/core/tiers.mjs')),
  };
  for (const f of readdirSync(join(ROOT, 'src', 'categories')).sort()) {
    if (f.endsWith('.mjs')) await import(url(`src/categories/${f}`));
  }
  mods.store.loadDevices(readdirSync(join(ROOT, 'data')).filter((f) => f.endsWith('.json')).sort()
    .flatMap((f) => JSON.parse(readFileSync(join(ROOT, 'data', f), 'utf8'))));
  return mods;
}

/** 例外で止まるか。止まったときの文言も返す（「別の理由で落ちた」を通さないため） */
function thrown(fn) {
  try { fn(); return ''; } catch (e) { return String(e.message || e); }
}

async function tierUnitChecks() {
  const { store, registry, compat, tiers: T } = await loadAll();
  const dummy = registry.getCategory('dummy');
  const byId = (id) => store.store.byId.get(id);
  const ids = (cs) => cs.map((c) => c.id).join(',');

  /**
   * 口を宣言しないカテゴリは画面が変わらない（設計 8-1）。
   * 並び・中身まで見るのは、振り分けで順番が崩れると「候補No.1」の付く候補が変わるため。
   * 基準機の数を名前に入れて、対象0件で通る形にしない。
   */
  const real = registry.allCategories().filter((c) => c.id !== 'dummy');
  const declared = real.filter((c) => c.alternates || c.checkDefs || c.fieldQuestions);
  let bases = 0;
  const bad = [];
  for (const cat of real) {
    for (const m of store.devicesOf(cat.id)) {
      bases++;
      const list = compat.computeCompatibles(m, cat, {});
      const t = T.computeTiers(m, cat, {});
      // 2つの段で list を割り切るので、各段が list の振り分けと中身・並びまで同じなら増減も無い
      const same = JSON.stringify(t.successor) === JSON.stringify(list.filter((c) => c.isSuccessor))
        && JSON.stringify(t.exact) === JSON.stringify(list.filter((c) => !c.isSuccessor));
      if (!same || t.classMatch.length || t.rework.length) bad.push(m.model);
    }
  }
  check(`口を宣言しない全${real.length}カテゴリ・全基準機（${bases}台）で、computeTiers の後継＋判定一致が`
    + ' computeCompatibles と中身も並びも同じで、下の段が空',
  bases > 0 && declared.length === 0 && bad.length === 0,
  declared.length ? `口を宣言したカテゴリ: ${declared.map((c) => c.id).join(' ')}` : bad.slice(0, 5).join(' '));

  /** 4段がそれぞれ1件以上。基準機自身・シリーズ単位・上の段の型式・重複は下の段に入らない */
  const t10 = T.computeTiers(byId('DUMMY-10'), dummy, {});
  const counts = T.TIERS.map((t) => t10[t.id].length);
  check(`ダミーの口で4段がそれぞれ1件以上出る（後継 ${counts[0]}・判定一致 ${counts[1]}・分類 ${counts[2]}・配線/台数 ${counts[3]}）`,
    counts.every((k) => k >= 1), counts.join('/'));
  check('口が返した7件のうち、基準機自身・シリーズ単位・後継・判定一致の型式と重複は下の段に入らない（上の段が勝つ）',
    ids(t10.successor) === 'DUMMY-11' && ids(t10.exact) === 'DUMMY-12'
    && ids(t10.classMatch) === 'DUMMY-13' && ids(t10.rework) === 'DUMMY-14' && t10.rework[0].qty === 2,
    `分類 ${ids(t10.classMatch)} / 配線・台数 ${ids(t10.rework)}`);

  /** 4状態がそれぞれ1行以上。状態は下の段のカードにだけ付く */
  const rows = [...t10.classMatch, ...t10.rework].flatMap((c) => c.checks);
  const stateCounts = T.CHECK_STATES.map((s) => rows.filter((r) => r.state === s.id).length);
  check(`確認項目の4状態がそれぞれ1行以上出る（${T.CHECK_STATES.map((s, i) => `${s.label} ${stateCounts[i]}`).join('・')}）`,
    stateCounts.every((k) => k >= 1), stateCounts.join('/'));

  /** 共通の比べ方は、片方でも値が無ければ unknown（match に倒さない。設計 6章） */
  const samples = { equal: 'x', set: ['x'], range: { min: 1, max: 2 }, window: 10, atMost: 10 };
  const names = Object.keys(T.COMPARES);
  // 例外も「unknown を返さなかった」に数える（欠けを書式違いとして止めるのは、未登録を隠すのと同じ結果になる）
  const verdictOf = (name, b, c) => { try { return T.compareValues(name, b, c, { ratio: 0.3 }).verdict; } catch { return 'throw'; } };
  const notUnknown = names.filter((name) => [[undefined, samples[name]], [samples[name], undefined],
    [null, samples[name]], [samples[name], '']].some(([b, c]) => verdictOf(name, b, c) !== 'unknown'));
  check(`共通の比べ方 ${names.length} 種（${names.join('・')}）は、片方でも値が無ければ unknown を返す`,
    names.length === Object.keys(samples).length && notUnknown.length === 0, notUnknown.join(' '));

  /** 口は登録済みの id しか指せず、型式の文字列を作れない（設計 1-2 の3） */
  const unregistered = thrown(() => T.computeTiers(byId('DUMMY-20'), dummy, {}));
  check('口が登録に無い id を返したら例外で止まる', unregistered.includes('登録に無い id'), unregistered || '例外が出ない');
  const modelKey = thrown(() => T.computeTiers(byId('DUMMY-10'), dummy, { probe: 'modelKey' }));
  check('口が部品に型式の文字列（model）を付けたら例外で止まる', modelKey.includes('知らないキー model'), modelKey || '例外が出ない');
  const upper = thrown(() => T.computeTiers(byId('DUMMY-10'), dummy, { probe: 'upperTier' }));
  check('口は上の2段（後継・判定一致）に候補を足せない', upper.includes('口から足せません'), upper || '例外が出ない');
}

/* ---------- 候補の段（画面） ---------- */

/** ③の候補を、ゾーン見出しと DOM順の所属で拾う（smoke の resultZones と同じ読み方） */
async function zonesOf(page) {
  return page.evaluate(() => {
    const zones = [];
    for (const el of document.getElementById('app').children) {
      if (el.classList.contains('zone-head')) zones.push({ title: el.querySelector('.t').textContent.trim(), cards: [] });
      else if (el.classList.contains('card')) {
        if (!zones.length) zones.push({ title: '', cards: [] });
        zones[zones.length - 1].cards.push({
          model: el.querySelector('.model').textContent.trim(),
          badges: [...el.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
          checks: !!el.querySelector('.checks'),
          qty: el.querySelector('.qty')?.textContent.trim() || '',
        });
      }
    }
    return zones;
  });
}

async function openResult(page, model) {
  const back = (await page.$('[data-act="reset"]')) || (await page.$('[data-act="step"][data-v="1"]'));
  if (back) await back.click();
  await page.fill('#q', model);
  await page.click('[data-act="search"]');
  await page.waitForSelector('.model.big');
  await page.click('[data-act="step"][data-v="3"]');
  await page.waitForTimeout(200);
}

/**
 * 断定語（設計 8-1）。smoke の `③に「容量不足」「使用不可」など…` と同じ形で、新しい段を持つ画面を見る。
 * 下の段は判定条件を満たしていない候補なので、使える・使えないを画面が言うと、そのまま嘘になる。
 */
const ASSERTIVE = /交換可|互換品です|使用可|使用できません/;

async function tierScreenChecks(page) {
  const LOWER = ['分類が一致・違いあり', '配線変更または台数増が必要'];
  const texts = [];

  await openResult(page, 'DMY-1000');
  const z10 = await zonesOf(page);
  texts.push(await page.textContent('#app'));
  check(`4段がそろう画面に、中身のある段の見出しが段の順に出る（${z10.length}段）`,
    z10.map((z) => z.title).join('|') === 'メーカー指定の後継品|判定条件がすべて一致|' + LOWER.join('|')
    && z10.every((z) => z.cards.length >= 1),
    z10.map((z) => `${z.title || '(見出し無し)'}:${z.cards.length}件`).join(' → '));
  const count10 = await page.$eval('.panel > .sub', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  check('段を持つ画面の件数は段ごとで、合計を「互換品候補」と呼ばない',
    count10 === z10.map((z) => `${z.title} ${z.cards.length}件`).join(' / ') && !count10.includes('互換品候補'), count10);
  const lowerCards = z10.filter((z) => LOWER.includes(z.title)).flatMap((z) => z.cards);
  const upperCards = z10.filter((z) => !LOWER.includes(z.title)).flatMap((z) => z.cards);
  check(`下の段のカード（${lowerCards.length}枚）は「別メーカー」を名乗り、「他社互換」を名乗らない`,
    lowerCards.length > 0 && lowerCards.every((c) => c.badges.includes('別メーカー') && !c.badges.includes('他社互換')),
    lowerCards.map((c) => `${c.model}:${c.badges.join(',')}`).join(' '));
  check('確認項目の表は下の段のカードにだけ出る',
    lowerCards.every((c) => c.checks) && upperCards.every((c) => !c.checks));
  const marks = await page.$$eval('.ck-row', (els) => els.map((e) => [e.className, e.querySelector('.ck-mark').textContent.trim()]));
  const want = [['ck-differs', '△ 違う'], ['ck-missing', '？ 未登録・現物で確認'], ['ck-field', '◇ 現場で確認'], ['ck-same', '✓ 同じ']];
  check(`4状態がそれぞれ1行以上、コアの印と文言で出る（${want.map(([k]) => `${k.slice(3)} ${marks.filter(([c]) => c.includes(k)).length}`).join('・')}）`,
    want.every(([k, t]) => marks.some(([c, m]) => c.includes(k) && m === t)), JSON.stringify(marks));
  const rework = z10.find((z) => z.title === LOWER[1])?.cards[0];
  check('2台の候補は型式の横に「× 2台」が出て、型式は登録された綴りのまま',
    rework?.model === 'OTH-5000' && rework?.qty === '× 2台', JSON.stringify(rework));
  const fq = await page.evaluate(() => {
    const kids = [...document.getElementById('app').children];
    const i = kids.findIndex((e) => e.classList.contains('field-q'));
    const first = kids.findIndex((e) => e.classList.contains('zone-head') || e.classList.contains('card'));
    return { n: document.querySelectorAll('.field-q').length, before: i >= 0 && i < first,
      title: document.querySelector('.field-q b')?.textContent.trim() };
  });
  check('「交換前に現場で確かめること」が候補より前に1回だけ出る',
    fq.n === 1 && fq.before && fq.title === '交換前に現場で確かめること', JSON.stringify(fq));

  /** 判定一致が0件で下の段だけ：D8 の1行、0件パネルを出さない、先頭の候補でも「候補No.1」を付けない */
  await openResult(page, 'DMY-70000');
  const z30 = await zonesOf(page);
  texts.push(await page.textContent('#app'));
  const d8 = await page.evaluate(() => {
    const kids = [...document.getElementById('app').children];
    const i = kids.findIndex((e) => e.classList.contains('tier-none'));
    const head = kids.findIndex((e) => e.classList.contains('zone-head'));
    return { text: kids[i]?.textContent.trim(), before: i >= 0 && i < head, empty: !!document.querySelector('.empty-note') };
  });
  check('判定条件がすべて一致が0件で下の段だけあるとき、見出しと「判定条件がすべて一致する候補はありません。」を下の段の前に出す',
    z30.length === 1 && z30[0].title === LOWER[0] && d8.text === '判定条件がすべて一致する候補はありません。'
    && d8.before && !d8.empty, JSON.stringify({ z30, d8 }));
  const numbered30 = z30.flatMap((z) => z.cards).filter((c) => c.badges.includes('候補No.1'));
  check('下の段の候補が画面の先頭でも「候補No.1」は付かない',
    z30[0]?.cards.length > 0 && numbered30.length === 0, numbered30.map((c) => c.model).join(' '));

  /** 判定一致と下の段の両方：「候補No.1」は判定一致の先頭の1枚にだけ付く（付く側が消えても通る検査にしない） */
  await openResult(page, 'DMY-200000');
  const z40 = await zonesOf(page);
  texts.push(await page.textContent('#app'));
  const numbered40 = z40.flatMap((z) => z.cards.filter((c) => c.badges.includes('候補No.1')).map((c) => `${z.title}:${c.model}`));
  check('「候補No.1」は判定条件がすべて一致の先頭にだけ付き、下の段には付かない',
    numbered40.join(' ') === '判定条件がすべて一致:DMY-205000', numbered40.join(' ') || '(なし)');

  const hit = texts.map((t) => (t.match(ASSERTIVE) || [])[0]).filter(Boolean);
  check(`新しい段を持つ画面（${texts.length}画面）に断定語（交換可・互換品です・使用可・使用できません）が出ない`,
    texts.length === 3 && hit.length === 0, hit.join(' '));
}

let browser;
try {
  writeFileSync(DATA_FILE, JSON.stringify(DUMMY_DATA, null, 2) + '\n');
  writeFileSync(MOD_FILE, DUMMY_MODULE);

  execFileSync('node', [join(ROOT, 'build.mjs')], { cwd: ROOT, stdio: 'pipe' });
  check('ビルドがコアと build.mjs を書き換えない',
    CORE_FILES.every((f) => readFileSync(join(ROOT, f), 'utf8') === before.get(f)));

  await tierUnitChecks();

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

  await tierScreenChecks(page);
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
