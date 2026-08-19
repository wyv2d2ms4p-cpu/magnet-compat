/**
 * フェーズ1a: 移行元HTML → data/**.json
 *
 * 3つのHTMLは読み取るだけで変更しない。冪等（何度実行しても同じ出力）。
 *
 *   node tools/extract.mjs
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, readMagnet, readSensor, readFa } from './read-sources.mjs';
import {
  SPEC_MAP, THERMAL_RANGE, SPECIAL_LLK_METHOD, SPECIAL_DISTANCE_KEY,
  MODEL_STATUS, EXPECTED_COUNTS, generatedId,
  DISCONTINUED_SERIES, discontinuedSeriesIds,
} from './schema-map.mjs';

const DATA = join(REPO_ROOT, 'data');

/** 未定義・null を落として JSON を安定させる */
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    out[k] = v;
  }
  return out;
}

/** カテゴリ固有スペックを SPEC_MAP に従って組み立てる */
function buildSpecs(src, category) {
  const map = SPEC_MAP[category];
  if (!map) throw new Error(`SPEC_MAP に未定義のカテゴリ: ${category}`);
  const specs = {};

  for (const [from, to] of Object.entries(map)) {
    const v = src[from];
    if (v === undefined || v === null) continue;
    specs[to] = v;
  }

  // thermal: rangeMin/rangeMax → setRangeA:{min,max}
  if (category === 'thermal') {
    const [minKey, maxKey] = THERMAL_RANGE.from;
    if (src[minKey] != null && src[maxKey] != null) {
      specs[THERMAL_RANGE.to] = { min: src[minKey], max: src[maxKey] };
    }
  }

  // special: LLK(導光路)のみ長さを持つ。他は ratedA:0 = 該当なしなのでキーを作らない
  if (category === 'special') {
    if (src.detectMethod === SPECIAL_LLK_METHOD && src.ratedA > 0) {
      specs[SPECIAL_DISTANCE_KEY] = src.ratedA;
    }
  }

  // ratedA:0 はセンチネル（該当なし/不明）であって実値ではない。キーごと消す
  for (const key of ['sensingDistanceMM', SPECIAL_DISTANCE_KEY, 'ratedCurrentA', 'ratedPowerW']) {
    if (specs[key] === 0) delete specs[key];
  }

  return specs;
}

/** 共通トップレベル部分 */
function buildBase(src, { modelStatus, series = null }) {
  return compact({
    id: src.id,
    category: src.category,
    maker: src.maker,
    model: src.model,
    series: series ?? src.series ?? null,
    modelStatus,
    compatKey: src.capacityClass ?? null,
    dims: src.dims ?? null,
    holes: src.holes ?? null,
    mounting: src.mounting ?? null,
    discontinued: src.discontinued === true ? true : undefined,
    makerExited: src.makerExited === true ? true : undefined,
    successorId: src.successorId ?? null,
    note: src.note || undefined,
  });
}

function evidence(model, dims, specs) {
  return { model: { state: model }, dims: { state: dims }, specs: { state: specs } };
}

/** index.html の unverified / dimVerified / specVerified / rangeVerified を解決 */
function magnetEvidence(src) {
  let dims;
  if (src.dimVerified === true) dims = 'verified';
  else if (src.dimVerified === false) dims = 'estimated';
  else dims = 'unverified';

  let specs;
  if (src.rangeVerified === false) specs = 'estimated';
  else if (src.specVerified === true) specs = 'verified';
  else specs = 'unverified';

  // 型式そのものは人手でカタログから起こした実データ
  return evidence('verified', dims, specs);
}

/** index_3.html の verified（record全体の1フラグ）を3側面へ展開 */
function sensorEvidence(src) {
  // verified:false は「型式が未確認」ではなく「値が代表値・要データシート確認」の意味
  const state = src.verified === false ? 'estimated' : 'verified';
  return evidence(state, state, state);
}

function transformMagnet(src) {
  return {
    ...buildBase(src, { modelStatus: MODEL_STATUS.CONFIRMED }),
    specs: buildSpecs(src, src.category),
    evidence: magnetEvidence(src),
  };
}

function transformSensor(src) {
  return {
    ...buildBase(src, { modelStatus: MODEL_STATUS.CONFIRMED }),
    specs: buildSpecs(src, src.category),
    evidence: sensorEvidence(src),
  };
}

/** fa-compat.html の生成データ。実在未確認なので全件 provisional / 全側面 unverified */
function transformGenerated(src, category) {
  const withCategory = {
    ...src,
    category,
    // ID衝突を解消（schema-map.mjs の generatedId 参照）。model は変更しない
    id: generatedId(src.id, src.capacityClass),
    successorId: src.successorId ? generatedId(src.successorId, src.capacityClass) : null,
  };
  return {
    ...buildBase(withCategory, { modelStatus: MODEL_STATUS.PROVISIONAL, series: src.series ?? null }),
    specs: buildSpecs(withCategory, category),
    evidence: evidence('unverified', 'unverified', 'unverified'),
  };
}

/**
 * 安川電機の生産中止一覧（YASKAWA_DISC）→ サーボのレコード。
 *
 * 生成物ではなくメーカー公表の実データなので catalog-confirmed。ただし1行が
 * シリーズ単位のマスク（`SGDM / SGDH / SGDP`）なので modelScope で明示し、
 * 個別型式と同列に扱わせない。値が無いことを表す "-" / "なし" はキーごと落とす
 * （`ratedA:0` を番兵にしていた失敗と同じ轍を踏まないため）。
 */
function transformDiscontinuedSeries(src, id) {
  const D = DISCONTINUED_SERIES;
  const present = (v) => v !== undefined && v !== null && !D.ABSENT.includes(String(v).trim());

  const top = {};
  for (const [from, to] of Object.entries(D.TOP_LEVEL)) {
    if (present(src[from])) top[to] = src[from];
  }
  const specs = {};
  for (const [from, to] of Object.entries(D.SPEC_MAP)) {
    if (present(src[from])) specs[to] = src[from];
  }

  const aspect = (name) => {
    const state = D.EVIDENCE[name];
    return state === 'verified' ? { state, srcNote: D.SRC_NOTE } : { state };
  };

  return compact({
    id,
    category: D.category,
    maker: D.maker,
    ...top,
    modelStatus: MODEL_STATUS.CONFIRMED,
    modelScope: D.modelScope,
    discontinued: true,
    specs,
    evidence: { model: aspect('model'), dims: aspect('dims'), specs: aspect('specs') },
  });
}

const FORCE = process.argv.includes('--force');

/**
 * 追加レコードの上書き防止。
 *
 * このスクリプトは移行元HTMLから data/** を作り直す（冪等）。フェーズ2以降に
 * 出典付きで追加されたレコードは移行元に存在しないので、そのまま走らせると
 * **調査して足したぶんが黙って消える**。既存ファイルにしか無いIDを見つけたら止める。
 * 移行のやり直しなど、消してよいと分かっている場合だけ --force を付ける。
 */
function assertNoAdditionsLost(abs, relPath, next) {
  if (FORCE || !existsSync(abs)) return;
  const prev = JSON.parse(readFileSync(abs, 'utf8'));
  if (!Array.isArray(prev) || !Array.isArray(next)) return;
  const nextIds = new Set(next.map((r) => r?.id).filter(Boolean));
  const lost = prev.filter((r) => r?.id && !nextIds.has(r.id)).map((r) => r.id);
  if (!lost.length) return;
  throw new Error(
    `data/${relPath} には移行元に無いレコードが ${lost.length} 件あります（${lost.slice(0, 5).join(', ')}）。\n` +
    'このまま書き出すと消えます。フェーズ2以降に追加したレコードのはずなので、\n' +
    '本当に作り直す場合だけ `node tools/extract.mjs --force` を使ってください。',
  );
}

function writeJson(relPath, value) {
  const abs = join(DATA, relPath);
  assertNoAdditionsLost(abs, relPath, value);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, JSON.stringify(value, null, 2) + '\n', 'utf8');
  const n = Array.isArray(value) ? value.length : 1;
  console.log(`  data/${relPath.padEnd(38)} ${String(n).padStart(4)} 件`);
}

function groupByCategory(records) {
  const out = new Map();
  for (const r of records) {
    if (!out.has(r.category)) out.set(r.category, []);
    out.get(r.category).push(r);
  }
  return out;
}

// ---- 実行 ----------------------------------------------------------------

console.log('移行元を読み込み中...');
const magnet = readMagnet();
const sensor = readSensor();
const fa = readFa();
console.log(`  index.html      ${magnet.devices.length} 件 (+ メーカー参照 ${magnet.makerReference.length} 件)`);
console.log(`  index_3.html    ${sensor.devices.length} 件`);
console.log(`  fa-compat.html  生成 ${fa.inverterGenerated.length + fa.servoGenerated.length} 件 (+ 安川生産中止 ${fa.servoDiscontinued.length} 件)`);

console.log('\ndata/ を書き出し中...');

const byCategory = groupByCategory([
  ...magnet.devices.map(transformMagnet),
  ...sensor.devices.map(transformSensor),
]);

// 実データのカテゴリ。inverter は実在確認済みが0件なので空配列で場所だけ作る
for (const category of ['contactor', 'starter', 'thermal', 'proximity', 'photo', 'ultrasonic', 'special']) {
  writeJson(`${category}.json`, byCategory.get(category) ?? []);
}
writeJson('inverter.json', []);

// 安川の生産中止シリーズ27件はメーカー公表の実データ。サーボのレコードとして書き出す
const discIds = discontinuedSeriesIds(fa.servoDiscontinued);
writeJson('servo.json', fa.servoDiscontinued.map((row, i) => transformDiscontinuedSeries(row, discIds[i])));

// 参照データ（デバイスではないので native な形のまま保持）
writeJson('reference/makers.json', magnet.makerReference);

// 生成データの凍結。出典URLが付いたものだけが今後 data/ へ昇格する
writeJson('_seed/inverter-generated.json', fa.inverterGenerated.map((d) => transformGenerated(d, 'inverter')));
writeJson('_seed/servo-generated.json', fa.servoGenerated.map((d) => transformGenerated(d, 'servo')));

// 件数の自己チェック（詳細な検証は tools/verify-data.mjs）
const actual = {
  ...Object.fromEntries([...byCategory].map(([k, v]) => [k, v.length])),
  inverter: 0, servo: fa.servoDiscontinued.length,
  _seed_inverter: fa.inverterGenerated.length,
  _seed_servo: fa.servoGenerated.length,
  reference_makers: magnet.makerReference.length,
};
const mismatched = Object.entries(EXPECTED_COUNTS).filter(([k, v]) => actual[k] !== v);
if (mismatched.length) {
  console.error('\n件数が期待値と一致しません:');
  for (const [k, v] of mismatched) console.error(`  ${k}: 期待 ${v} / 実際 ${actual[k]}`);
  process.exit(1);
}

console.log('\n完了。次に `node tools/verify-data.mjs` で検証してください。');
