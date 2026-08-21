/**
 * フェーズ1a: 移行の非破壊性を検証する。
 *
 * 移行元HTMLから再抽出し、data/** と突合する。1項目でも落ちたら非ゼロ終了。
 * extract.mjs の変換コードは呼ばない（同じバグを共有しないため、schema-map.mjs の
 * 宣言だけを共有して突合ロジックは独立に実装している）。
 *
 *   node tools/verify-data.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, readMagnet, readSensor, readFa } from './read-sources.mjs';
import { normLoose } from '../src/core/util.mjs';
import { getCategory, distinguishingSpec } from '../src/core/registry.mjs';
import {
  TOP_LEVEL, SPEC_MAP, THERMAL_RANGE, SPECIAL_LLK_METHOD, SPECIAL_DISTANCE_KEY,
  EVIDENCE_SOURCE_KEYS, DROPPED, EVIDENCE_STATES, EVIDENCE_ASPECTS,
  MODEL_STATUS, EXPECTED_COUNTS, generatedId, ADDED_SPEC_KEYS,
  DISCONTINUED_SERIES, discontinuedSeriesIds, RECORD_KEYS, ADDED_RECORD_RULES,
  REPLACEMENT_NOTE_KEYS,
} from './schema-map.mjs';

const DATA = join(REPO_ROOT, 'data');
const failures = [];
let checkNo = 0;

function check(name, fn) {
  checkNo++;
  const errs = [];
  try {
    fn((msg) => errs.push(msg));
  } catch (e) {
    errs.push(`例外: ${e.message}`);
  }
  if (errs.length) {
    failures.push({ name, errs });
    console.log(`  ${String(checkNo).padStart(2)}. NG  ${name}`);
    for (const e of errs.slice(0, 8)) console.log(`        - ${e}`);
    if (errs.length > 8) console.log(`        - ... 他 ${errs.length - 8} 件`);
  } else {
    console.log(`  ${String(checkNo).padStart(2)}. OK  ${name}`);
  }
}

const load = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const setOf = (arr, f) => new Set(arr.map(f));

function diffSets(a, b) {
  const onlyA = [...a].filter((x) => !b.has(x));
  const onlyB = [...b].filter((x) => !a.has(x));
  return { onlyA, onlyB };
}

/**
 * カテゴリ定義を登録する。
 *
 * 検索の衝突検査は「UIが実際に何を見分ける材料として出せるか」を見るので、
 * 表示に使う specDefs の宣言そのものを参照する必要がある。build.mjs と同じく
 * src/categories/*.mjs を全部読む（カテゴリ追加時にここを直さなくて済む）。
 */
const CATEGORY_DIR = join(REPO_ROOT, 'src', 'categories');
for (const f of readdirSync(CATEGORY_DIR).filter((x) => x.endsWith('.mjs')).sort()) {
  await import(pathToFileURL(join(CATEGORY_DIR, f)).href);
}

// ---- 読み込み ------------------------------------------------------------

const magnet = readMagnet();
const sensor = readSensor();
const fa = readFa();

const REAL_CATEGORIES = ['contactor', 'starter', 'thermal', 'proximity', 'photo', 'ultrasonic', 'special'];
const DATA_CATEGORIES = [...REAL_CATEGORIES, 'inverter', 'servo'];
const migrated = {};
for (const c of DATA_CATEGORIES) migrated[c] = load(`${c}.json`);
const seedInv = load('_seed/inverter-generated.json');
const seedSv = load('_seed/servo-generated.json');
const refMakers = load('reference/makers.json');

/**
 * 移行元レコード。生成データにはカテゴリを補い、IDには schema-map.mjs が宣言する
 * 名前空間接頭辞を適用する（元アプリのID衝突40件の解消）。model は変更しない。
 */
const applyGeneratedId = (d, category) => ({
  ...d,
  category,
  id: generatedId(d.id, d.capacityClass),
  successorId: d.successorId ? generatedId(d.successorId, d.capacityClass) : undefined,
});
const sourceRecords = [
  ...magnet.devices,
  ...sensor.devices,
  ...fa.inverterGenerated.map((d) => applyGeneratedId(d, 'inverter')),
  ...fa.servoGenerated.map((d) => applyGeneratedId(d, 'servo')),
];

/**
 * 移行由来のレコードと、フェーズ2以降に追加されたレコードを切り分ける。
 *
 * この検証の目的は「移行が非破壊であること」なので、件数やID集合の突合は
 * 移行由来のぶんだけを対象にする。あとから出典付きで足されたレコードは
 * 移行元に対応が無くて当たり前なので、別の規約（下の「追加レコード」の検査）で見る。
 */
const discIds = new Set(discontinuedSeriesIds(fa.servoDiscontinued));
const sourceIds = new Set([...sourceRecords.map((d) => d.id), ...discIds]);
const isAdded = (r) => !sourceIds.has(r.id);

const dataRecords = DATA_CATEGORIES.flatMap((c) => migrated[c]);
const addedByCategory = Object.fromEntries(DATA_CATEGORIES.map((c) => [c, migrated[c].filter(isAdded)]));
const added = dataRecords.filter(isAdded);

/** data/ に入る全レコード（移行由来＋追加分）＋凍結中の _seed */
const allRecords = [...dataRecords, ...seedInv, ...seedSv];
const allMigrated = allRecords.filter((r) => !isAdded(r));
const byId = new Map(allRecords.map((r) => [r.id, r]));

console.log('検証中...\n');

// ---- 1. 件数一致 ---------------------------------------------------------

check('件数一致（移行由来のぶん。追加レコードは別勘定）', (fail) => {
  const migratedOnly = (c) => migrated[c].filter((r) => !isAdded(r)).length;
  const actual = {
    ...Object.fromEntries(DATA_CATEGORIES.map((c) => [c, migratedOnly(c)])),
    _seed_inverter: seedInv.length,
    _seed_servo: seedSv.length,
    reference_makers: refMakers.length,
  };
  for (const [k, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (actual[k] !== expected) fail(`${k}: 期待 ${expected} / 実際 ${actual[k]}`);
  }
  // 移行元の総数と移行先の総数が一致すること（27件の生産中止シリーズは 11 で見る）
  const migratedInData = allMigrated.filter((r) => !discIds.has(r.id)).length;
  if (sourceRecords.length !== migratedInData) {
    fail(`総件数: 移行元 ${sourceRecords.length} / 移行先 ${migratedInData}`);
  }
});

// ---- 2. ID集合一致 -------------------------------------------------------

check('ID集合一致・重複なし・衝突なし', (fail) => {
  const srcIds = setOf(sourceRecords, (d) => d.id);
  // 生産中止シリーズ27件は 11 で個別に突合するのでここでは対象外
  const dstIds = setOf(allMigrated.filter((r) => !discIds.has(r.id)), (d) => d.id);
  const { onlyA, onlyB } = diffSets(srcIds, dstIds);
  for (const id of onlyA.slice(0, 5)) fail(`移行先に無いID: ${id}`);
  for (const id of onlyB.slice(0, 5)) fail(`移行元に無いID: ${id}`);

  if (srcIds.size !== sourceRecords.length) fail(`移行元にID重複あり (${sourceRecords.length - srcIds.size} 件)`);
  const allIds = setOf(allRecords, (d) => d.id);
  if (allIds.size !== allRecords.length) fail(`移行先にID重複あり (${allRecords.length - allIds.size} 件)`);

  // 3データセット間のID衝突
  const mag = setOf(magnet.devices, (d) => d.id);
  const sen = setOf(sensor.devices, (d) => d.id);
  const gen = setOf([...fa.inverterGenerated, ...fa.servoGenerated], (d) => d.id);
  for (const [a, b, label] of [[mag, sen, 'magnet↔sensor'], [mag, gen, 'magnet↔generated'], [sen, gen, 'sensor↔generated']]) {
    const hit = [...a].filter((x) => b.has(x));
    if (hit.length) fail(`ID衝突 ${label}: ${hit.slice(0, 3).join(', ')}`);
  }
});

// ---- 3. model 文字列集合一致 ---------------------------------------------

check('model 文字列が1文字も変わっていない', (fail) => {
  for (const src of sourceRecords) {
    const dst = byId.get(src.id);
    if (!dst) continue; // 2 で報告済み
    if (dst.model !== src.model) fail(`${src.id}: "${src.model}" → "${dst.model}"`);
  }
});

// ---- 4. 値の往復一致 -----------------------------------------------------

check('全レコード×全キーの値が一致（ratedA → specs.* を含む）', (fail) => {
  for (const src of sourceRecords) {
    const dst = byId.get(src.id);
    if (!dst) continue;
    const cat = src.category;
    const specMap = SPEC_MAP[cat];

    for (const [key, value] of Object.entries(src)) {
      if (value === undefined || value === null) continue;
      if (value === '') continue; // 空文字は情報を持たないため移行先では省略される
      if (EVIDENCE_SOURCE_KEYS.includes(key)) continue; // 9 で検証
      if (key in DROPPED) continue;

      // トップレベル
      if (key in TOP_LEVEL) {
        const target = TOP_LEVEL[key];
        if (!eq(dst[target], value)) fail(`${src.id}.${key}: ${JSON.stringify(value)} ≠ ${JSON.stringify(dst[target])}`);
        continue;
      }

      // thermal の rangeMin/rangeMax
      if (cat === 'thermal' && THERMAL_RANGE.from.includes(key)) {
        const range = dst.specs?.[THERMAL_RANGE.to];
        const side = key === 'rangeMin' ? 'min' : 'max';
        if (!range || range[side] !== value) fail(`${src.id}.${key}: ${value} ≠ ${JSON.stringify(range)}`);
        continue;
      }

      // special の ratedA は detectMethod で意味が変わる
      if (cat === 'special' && key === 'ratedA') {
        if (src.detectMethod === SPECIAL_LLK_METHOD && value > 0) {
          if (dst.specs?.[SPECIAL_DISTANCE_KEY] !== value) {
            fail(`${src.id}.ratedA(導光路長): ${value} ≠ ${dst.specs?.[SPECIAL_DISTANCE_KEY]}`);
          }
        } else if (SPECIAL_DISTANCE_KEY in (dst.specs ?? {})) {
          fail(`${src.id}: ratedA=${value} は該当なしのはずが ${SPECIAL_DISTANCE_KEY} を持っている`);
        }
        continue;
      }

      // カテゴリ固有スペック
      if (specMap && key in specMap) {
        const target = specMap[key];
        // 0 はセンチネルなのでキーごと消えているのが正
        if (value === 0 && ['sensingDistanceMM', 'ratedCurrentA', 'ratedPowerW'].includes(target)) {
          if (target in (dst.specs ?? {})) fail(`${src.id}.${key}=0 のセンチネルが残っている`);
          continue;
        }
        if (!eq(dst.specs?.[target], value)) {
          fail(`${src.id}.${key} → specs.${target}: ${JSON.stringify(value)} ≠ ${JSON.stringify(dst.specs?.[target])}`);
        }
        continue;
      }

      fail(`${src.id}: キー "${key}" (${cat}) の移行先が仕様に無い`);
    }
  }
});

// ---- 5. キーの取りこぼしゼロ ---------------------------------------------

check('移行元の全キーが仕様のいずれかに属する（未知キーの検出）', (fail) => {
  const seen = new Map(); // category → Set(key)
  for (const src of sourceRecords) {
    if (!seen.has(src.category)) seen.set(src.category, new Set());
    for (const k of Object.keys(src)) seen.get(src.category).add(k);
  }
  for (const [cat, keys] of seen) {
    for (const k of keys) {
      const known =
        k in TOP_LEVEL ||
        k in DROPPED ||
        EVIDENCE_SOURCE_KEYS.includes(k) ||
        (SPEC_MAP[cat] && k in SPEC_MAP[cat]) ||
        (cat === 'thermal' && THERMAL_RANGE.from.includes(k)) ||
        (cat === 'special' && k === 'ratedA');
      if (!known) fail(`未知のキー: ${cat}.${k} — schema-map.mjs に追加してください`);
    }
  }
});

// ---- 6. ratedA 全廃 ------------------------------------------------------

check('data/** のどこにも ratedA が存在しない', (fail) => {
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === 'ratedA') fail(`${path}.${k} が残っている`);
        walk(v, `${path}.${k}`);
      }
    }
  };
  walk(allRecords, 'data');
  walk(refMakers, 'reference/makers');
});

// ---- 7. センチネル消滅 ---------------------------------------------------

check('ratedA:0 由来のレコードが距離系キーを持たない', (fail) => {
  const zeros = sourceRecords.filter((d) => d.ratedA === 0);
  if (zeros.length !== 11) fail(`ratedA:0 の移行元が 11 件のはずが ${zeros.length} 件`);
  for (const src of zeros) {
    const specs = byId.get(src.id)?.specs ?? {};
    for (const k of ['sensingDistanceMM', SPECIAL_DISTANCE_KEY]) {
      if (k in specs) fail(`${src.id}: センチネル由来なのに specs.${k}=${specs[k]}`);
    }
  }
  // 量的スペックに 0 が残っていないこと
  const quantitative = ['sensingDistanceMM', SPECIAL_DISTANCE_KEY, 'ratedCurrentA', 'ratedCapacityKVA', 'ratedPowerKW', 'ratedPowerW'];
  for (const r of allRecords) {
    for (const k of quantitative) {
      if (r.specs?.[k] === 0) fail(`${r.id}.specs.${k} が 0`);
    }
  }
});

// ---- 8. 参照整合性 -------------------------------------------------------

check('successorId と mountsOn が解決する', (fail) => {
  for (const r of allRecords) {
    if (r.successorId && !byId.has(r.successorId)) fail(`${r.id}.successorId → ${r.successorId} が存在しない`);
  }
  const modelsByCategory = new Set(migrated.contactor.concat(migrated.starter).map((d) => d.model));
  for (const t of migrated.thermal) {
    for (const m of t.specs?.mountsOn ?? []) {
      if (!modelsByCategory.has(m)) fail(`${t.id}.mountsOn → "${m}" に該当する接触器/開閉器が無い`);
    }
  }
});

// ---- 9. evidence 網羅 ----------------------------------------------------

check('evidence が3側面そろい、状態が3値のいずれか', (fail) => {
  for (const r of allRecords) {
    for (const aspect of EVIDENCE_ASPECTS) {
      const state = r.evidence?.[aspect]?.state;
      if (!state) { fail(`${r.id}: evidence.${aspect} が無い`); continue; }
      if (!EVIDENCE_STATES.includes(state)) fail(`${r.id}: evidence.${aspect}.state="${state}" は不正`);
    }
  }
  // 移行元フラグとの対応（抜き取りではなく全件）
  for (const src of magnet.devices) {
    const ev = byId.get(src.id)?.evidence;
    const expectDims = src.dimVerified === true ? 'verified' : src.dimVerified === false ? 'estimated' : 'unverified';
    const expectSpecs = src.rangeVerified === false ? 'estimated' : src.specVerified === true ? 'verified' : 'unverified';
    if (ev?.dims.state !== expectDims) fail(`${src.id}: evidence.dims 期待 ${expectDims} / 実際 ${ev?.dims.state}`);
    if (ev?.specs.state !== expectSpecs) fail(`${src.id}: evidence.specs 期待 ${expectSpecs} / 実際 ${ev?.specs.state}`);
  }
  for (const src of sensor.devices) {
    const expected = src.verified === false ? 'estimated' : 'verified';
    const ev = byId.get(src.id)?.evidence;
    for (const aspect of EVIDENCE_ASPECTS) {
      if (ev?.[aspect].state !== expected) fail(`${src.id}: evidence.${aspect} 期待 ${expected} / 実際 ${ev?.[aspect].state}`);
    }
  }
  for (const src of [...fa.inverterGenerated, ...fa.servoGenerated]) {
    const ev = byId.get(generatedId(src.id, src.capacityClass))?.evidence;
    for (const aspect of EVIDENCE_ASPECTS) {
      if (ev?.[aspect].state !== 'unverified') fail(`${src.id}: 生成データの evidence.${aspect} が unverified でない`);
    }
  }
});

// ---- 10. modelStatus 規則 ------------------------------------------------

check('modelStatus の付与規則', (fail) => {
  for (const c of DATA_CATEGORIES) {
    for (const r of migrated[c]) {
      if (r.modelStatus !== MODEL_STATUS.CONFIRMED) fail(`data/${c}.json ${r.id}: ${r.modelStatus}`);
    }
  }
  for (const r of [...seedInv, ...seedSv]) {
    if (r.modelStatus !== MODEL_STATUS.PROVISIONAL) fail(`_seed ${r.id}: ${r.modelStatus}`);
  }
  // anchor（シリーズ単位の継承バッジ）が残っていないこと
  const anchored = [...seedInv, ...seedSv].filter((r) => 'anchor' in r || 'anchor' in (r.specs ?? {}));
  if (anchored.length) fail(`anchor が ${anchored.length} 件残っている`);
});

// ---- 11. 安川の生産中止シリーズ27件 --------------------------------------

/**
 * 1a で data/reference/servo-discontinued.json に置いたまま、どこからも描画されて
 * いなかった27件。サーボのレコードとして data/servo.json に入っていることを、
 * extract.mjs の変換コードを使わずに移行元と突合する。
 */
check('安川の生産中止シリーズ27件がサーボのレコードになっている', (fail) => {
  const D = DISCONTINUED_SERIES;
  const rows = fa.servoDiscontinued;
  const ids = discontinuedSeriesIds(rows);
  const dst = migrated.servo;

  if (new Set(ids).size !== ids.length) fail('導出したIDに重複がある');
  if (dst.length !== rows.length) {
    fail(`件数: 移行元 ${rows.length} / data/servo.json ${dst.length}`);
    return;
  }

  const absent = (v) => v === undefined || v === null || D.ABSENT.includes(String(v).trim());

  rows.forEach((src, i) => {
    const r = dst.find((x) => x.id === ids[i]);
    if (!r) { fail(`${ids[i]} が data/servo.json に無い`); return; }

    if (r.category !== D.category) fail(`${r.id}.category=${r.category}`);
    if (r.maker !== D.maker) fail(`${r.id}.maker=${r.maker}`);
    if (r.modelScope !== D.modelScope) fail(`${r.id}.modelScope=${r.modelScope}`);
    if (r.discontinued !== true) fail(`${r.id}.discontinued が true でない`);
    if (r.dims || r.holes) fail(`${r.id}: 移行元に無い寸法を持っている`);

    // 移行元の全キーが宣言のいずれかに属し、値が1文字も変わっていないこと
    for (const [key, value] of Object.entries(src)) {
      if (key in D.DROPPED) continue;
      const top = D.TOP_LEVEL[key];
      const spec = D.SPEC_MAP[key];
      if (!top && !spec) { fail(`未知のキー: YASKAWA_DISC.${key}`); continue; }
      if (absent(value)) {
        // "-" / "なし" は番兵。キーごと落ちているのが正
        if (top ? top in r : spec in (r.specs ?? {})) fail(`${r.id}: 番兵 "${value}" が ${top || spec} に残っている`);
        continue;
      }
      const actual = top ? r[top] : r.specs?.[spec];
      if (actual !== value) fail(`${r.id}.${key}: "${value}" ≠ "${actual}"`);
    }

    // 移行先に移行元由来でないスペックが増えていないこと
    for (const k of Object.keys(r.specs ?? {})) {
      if (!Object.values(D.SPEC_MAP).includes(k)) fail(`${r.id}.specs.${k} は移行元に対応が無い`);
    }

    for (const aspect of EVIDENCE_ASPECTS) {
      if (r.evidence?.[aspect]?.state !== D.EVIDENCE[aspect]) {
        fail(`${r.id}: evidence.${aspect} 期待 ${D.EVIDENCE[aspect]} / 実際 ${r.evidence?.[aspect]?.state}`);
      }
    }
  });
});

// ---- 12. 追加レコードの規約 ----------------------------------------------

/**
 * フェーズ2以降に追加されたレコード（移行元に対応が無いもの）の受け入れ検査。
 *
 * このリポジトリの一番の約束は「実在確認が取れた型式だけを候補に出す」こと。
 * 出典の無いレコードは人手のレビューを待たずにここで落とす。
 * 追加が0件でも検査は走る（規約が生きていることを示すため）。
 */
check(`追加レコードの規約（現在 ${added.length} 件）`, (fail) => {
  const R = ADDED_RECORD_RULES;

  for (const c of DATA_CATEGORIES) {
    const specKeys = new Set([
      ...Object.values(SPEC_MAP[c] ?? {}),
      ...(ADDED_SPEC_KEYS[c] ?? []),
      ...(c === 'thermal' ? [THERMAL_RANGE.to] : []),
      ...(c === 'special' ? [SPECIAL_DISTANCE_KEY] : []),
      // サーボは生産中止シリーズと同じ枠（生産中止日・修理期限など）も持てる
      ...(c === 'servo' ? Object.values(DISCONTINUED_SERIES.SPEC_MAP) : []),
    ]);

    for (const r of addedByCategory[c]) {
      const at = `data/${c}.json ${r.id ?? '(id無し)'}`;
      if (!r.id) fail(`${at}: id が無い`);
      if (r.category !== c) fail(`${at}: category="${r.category}" がファイルと一致しない`);
      if (!r.maker || !r.model) fail(`${at}: maker / model は必須`);
      if (r.modelStatus !== R.modelStatus) fail(`${at}: modelStatus="${r.modelStatus}" は不可（${R.modelStatus} のみ）`);

      for (const k of Object.keys(r)) {
        if (!RECORD_KEYS.includes(k)) fail(`${at}: 未知のトップレベルキー "${k}"`);
      }
      for (const k of Object.keys(r.specs ?? {})) {
        if (!specKeys.has(k)) fail(`${at}: specs.${k} は ${c} の宣言に無い（schema-map.mjs を確認）`);
      }

      // 出典。実在確認の根拠が無いレコードは入れない
      const model = r.evidence?.model;
      if (model?.state !== R.modelEvidenceState) {
        fail(`${at}: evidence.model.state="${model?.state}"（追加レコードは ${R.modelEvidenceState} であること）`);
      }
      if (!R.sourceKeys.some((k) => String(model?.[k] ?? '').trim())) {
        fail(`${at}: 出典が無い（evidence.model に ${R.sourceKeys.join(' か ')} が必要）`);
      }
      if (model?.srcUrl && !/^https?:\/\//.test(model.srcUrl)) {
        fail(`${at}: evidence.model.srcUrl="${model.srcUrl}" がURLでない`);
      }
    }
  }
});

// ---- 13. 検索の正規化衝突 ------------------------------------------------

/**
 * norm の緩いほう（normLoose）で同じ綴りになる型式の組を洗い出す。
 *
 * 検索は normLoose で候補を集めるので、同一カテゴリ内で衝突する組は
 * 必ず曖昧一致リストに並ぶ。並んだときに見分けられなければ意味がないので、
 * 「識別スペックが取れる」か「メーカーが違う」かのどちらかを満たすことを要求する。
 * 個別の型式を名指しで潰しても、データが増えれば再発するのでここで機械的に止める。
 */
function collisionGroups(records) {
  const g = new Map();
  for (const r of records) {
    const k = `${r.category}|${normLoose(r.model)}`;
    if (!g.has(k)) g.set(k, []);
    g.get(k).push(r);
  }
  return [...g].filter(([, v]) => v.length > 1);
}

const publishable = dataRecords.filter((r) => r.modelStatus === MODEL_STATUS.CONFIRMED);
const publishedCollisions = collisionGroups(publishable);

check(`検索で同じ綴りになる型式に見分ける材料がある（衝突 ${publishedCollisions.length} 組）`, (fail) => {
  for (const [key, group] of publishedCollisions) {
    const cat = getCategory(group[0].category);
    if (!cat) { fail(`${key}: カテゴリ定義 ${group[0].category} が見つからない`); continue; }
    const sd = distinguishingSpec(cat, group);
    const makers = new Set(group.map((r) => r.maker));
    if (sd || makers.size > 1) continue;
    fail(`${key}: ${group.map((r) => r.model).join(' / ')}`
      + ' … 割れているスペックもメーカー差も無く、曖昧一致リストで見分けられない');
  }
});

/**
 * _seed は配布物に入らないので検査は落とさないが、昇格した瞬間に衝突するものは
 * 昇格前に見えていないと困る（1.5K/15K 系は全メーカーの型式表に潜んでいる）。
 */
const seedCollisions = collisionGroups([...publishable, ...seedInv, ...seedSv])
  .filter(([, v]) => v.some((r) => r.modelStatus !== MODEL_STATUS.CONFIRMED));

// ---- 追加: replacementNote の規約 ----------------------------------------

/**
 * replacementNote（後継品への置換えに別途必要な部品）の規約。
 *
 * note と分けた意味は「置換えの条件だけを後継型式の隣に出せること」なので、
 * 同じ情報が note にも残っていると片方だけ更新される。二重管理を機械的に止める。
 */
const withReplacement = dataRecords.filter((r) => r.replacementNote !== undefined);

check(`replacementNote を持つのは生産終了品だけ（現在 ${withReplacement.length} 件）`, (fail) => {
  for (const r of withReplacement) {
    if (r.discontinued !== true) {
      fail(`${r.id} (${r.model}): discontinued=${JSON.stringify(r.discontinued)}`
        + ' … 現行品に置換えの条件は付かない');
    }
  }
});

check('replacementNote の partType / partModel が両方とも非空文字列', (fail) => {
  for (const r of withReplacement) {
    const rn = r.replacementNote;
    if (typeof rn !== 'object' || rn === null || Array.isArray(rn)) {
      fail(`${r.id} (${r.model}): replacementNote がオブジェクトでない`);
      continue;
    }
    for (const k of REPLACEMENT_NOTE_KEYS) {
      const v = rn[k];
      if (typeof v !== 'string' || v.trim() === '') {
        fail(`${r.id} (${r.model}): replacementNote.${k}=${JSON.stringify(v)} が非空文字列でない`);
      }
    }
    for (const k of Object.keys(rn)) {
      if (!REPLACEMENT_NOTE_KEYS.includes(k)) {
        fail(`${r.id} (${r.model}): replacementNote.${k} は宣言に無いキー`);
      }
    }
  }
});

check('replacementNote を持つレコードは note を持たない（二重管理の禁止）', (fail) => {
  for (const r of withReplacement) {
    if ('note' in r) {
      fail(`${r.id} (${r.model}): note=${JSON.stringify(r.note)} が残っている`
        + ' … 置換えの条件は replacementNote だけに置く');
    }
  }
});

// ---- 追加: アプリ本体が無変更であること ----------------------------------

check('移行元HTMLが3つとも存在し読み取れる（1a では変更しない）', (fail) => {
  for (const f of ['index.html', 'index_3.html', 'fa-compat.html']) {
    if (!existsSync(join(REPO_ROOT, f))) fail(`${f} が見つからない`);
  }
});

// ---- 結果 ----------------------------------------------------------------

console.log('');
if (failures.length) {
  console.error(`検証失敗: ${failures.length} / ${checkNo} 項目が NG`);
  process.exit(1);
}
console.log(`検証成功: ${checkNo} / ${checkNo} 項目すべて PASS`);
console.log(`  実データ ${dataRecords.length} 件 (catalog-confirmed) … 移行由来 ${dataRecords.length - added.length} 件 + 追加 ${added.length} 件`);
console.log(`  凍結データ ${seedInv.length + seedSv.length} 件 (provisional・既定非表示)`);
if (seedCollisions.length) {
  console.log(`  ⚠ _seed に検索衝突 ${seedCollisions.length} 組 … 昇格時に曖昧一致リストへ並ぶ`);
  for (const [key, group] of seedCollisions.slice(0, 5)) {
    console.log(`      ${key}: ${group.map((r) => r.model).join(' / ')}`);
  }
  if (seedCollisions.length > 5) console.log(`      ... 他 ${seedCollisions.length - 5} 組`);
}
console.log(`  参照データ ${refMakers.length} 件`);
