/**
 * フェーズ1a: 移行の非破壊性を検証する。
 *
 * 移行元HTMLから再抽出し、data/** と突合する。1項目でも落ちたら非ゼロ終了。
 * extract.mjs の変換コードは呼ばない（同じバグを共有しないため、schema-map.mjs の
 * 宣言だけを共有して突合ロジックは独立に実装している）。
 *
 *   node tools/verify-data.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, readMagnet, readSensor, readFa } from './read-sources.mjs';
import {
  TOP_LEVEL, SPEC_MAP, THERMAL_RANGE, SPECIAL_LLK_METHOD, SPECIAL_DISTANCE_KEY,
  EVIDENCE_SOURCE_KEYS, DROPPED, EVIDENCE_STATES, EVIDENCE_ASPECTS,
  MODEL_STATUS, EXPECTED_COUNTS, generatedId,
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

// ---- 読み込み ------------------------------------------------------------

const magnet = readMagnet();
const sensor = readSensor();
const fa = readFa();

const REAL_CATEGORIES = ['contactor', 'starter', 'thermal', 'proximity', 'photo', 'ultrasonic', 'special'];
const migrated = {};
for (const c of [...REAL_CATEGORIES, 'inverter', 'servo']) migrated[c] = load(`${c}.json`);
const seedInv = load('_seed/inverter-generated.json');
const seedSv = load('_seed/servo-generated.json');
const refMakers = load('reference/makers.json');
const refDisc = load('reference/servo-discontinued.json');

const allMigrated = [...REAL_CATEGORIES.flatMap((c) => migrated[c]), ...seedInv, ...seedSv];
const byId = new Map(allMigrated.map((r) => [r.id, r]));

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

console.log('検証中...\n');

// ---- 1. 件数一致 ---------------------------------------------------------

check('件数一致', (fail) => {
  const actual = {
    ...Object.fromEntries(REAL_CATEGORIES.map((c) => [c, migrated[c].length])),
    inverter: migrated.inverter.length,
    servo: migrated.servo.length,
    _seed_inverter: seedInv.length,
    _seed_servo: seedSv.length,
    reference_makers: refMakers.length,
    reference_servoDiscontinued: refDisc.length,
  };
  for (const [k, expected] of Object.entries(EXPECTED_COUNTS)) {
    if (actual[k] !== expected) fail(`${k}: 期待 ${expected} / 実際 ${actual[k]}`);
  }
  // 移行元の総数と移行先の総数が一致すること
  if (sourceRecords.length !== allMigrated.length) {
    fail(`総件数: 移行元 ${sourceRecords.length} / 移行先 ${allMigrated.length}`);
  }
});

// ---- 2. ID集合一致 -------------------------------------------------------

check('ID集合一致・重複なし・衝突なし', (fail) => {
  const srcIds = setOf(sourceRecords, (d) => d.id);
  const dstIds = setOf(allMigrated, (d) => d.id);
  const { onlyA, onlyB } = diffSets(srcIds, dstIds);
  for (const id of onlyA.slice(0, 5)) fail(`移行先に無いID: ${id}`);
  for (const id of onlyB.slice(0, 5)) fail(`移行元に無いID: ${id}`);

  if (srcIds.size !== sourceRecords.length) fail(`移行元にID重複あり (${sourceRecords.length - srcIds.size} 件)`);
  if (dstIds.size !== allMigrated.length) fail(`移行先にID重複あり (${allMigrated.length - dstIds.size} 件)`);

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
  walk(allMigrated, 'data');
  walk(refMakers, 'reference/makers');
  walk(refDisc, 'reference/servo-discontinued');
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
  const quantitative = ['sensingDistanceMM', SPECIAL_DISTANCE_KEY, 'ratedCurrentA', 'ratedPowerKW', 'ratedPowerW'];
  for (const r of allMigrated) {
    for (const k of quantitative) {
      if (r.specs?.[k] === 0) fail(`${r.id}.specs.${k} が 0`);
    }
  }
});

// ---- 8. 参照整合性 -------------------------------------------------------

check('successorId と mountsOn が解決する', (fail) => {
  for (const r of allMigrated) {
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
  for (const r of allMigrated) {
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
  for (const c of REAL_CATEGORIES) {
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
console.log(`  実データ ${REAL_CATEGORIES.reduce((n, c) => n + migrated[c].length, 0)} 件 (catalog-confirmed)`);
console.log(`  凍結データ ${seedInv.length + seedSv.length} 件 (provisional・既定非表示)`);
console.log(`  参照データ ${refMakers.length + refDisc.length} 件`);
