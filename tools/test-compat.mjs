/**
 * インバータの互換判定のユニットテスト。
 *
 * インバータは主スペック（定格出力電流）が全件未登録だったため、候補算出まで
 * 一度も到達していなかった。ND定格を入れて初めて gate が実際に走るようになるので、
 * 「動いた」だけでなく **どこで落ちるべきものが落ちているか** を固定する。
 *
 * とくに電源相数の一致条件（PR #6）は、FR-E820S(単相200V入力) と
 * FR-E820(3相200V入力) が voltClass も定格出力電流も同値になる組があるため、
 * 条件が消えても voltClass 比較と電流窓だけは素通りしてしまう。相数条件を外すと
 * 実際に通ってしまうことまで確かめて、テストが空振りしないようにする。
 *
 * 定格値そのものは、形名の4桁電流コード（カタログの別の列）と突き合わせる。
 * 転記した表を同じ表で検算しても意味がないので、L(名)06130-J が
 * 「電流コード ＝ ND定格出力電流 × 10」で全電圧クラス一貫していることを使う。
 * LD定格を誤って入れると、この検算が合わなくなる。
 *
 * 生産終了の旧機種（FR-E700）は、置換え資料 BCN-C21002-214C にしか載っておらず
 * 定格出力電流・定格容量を持たない。件数と定格の検査は現行品（FR-E800）と分けて
 * 数えるが、**現行品に対する要求は緩めない**。旧機種が gate を通れるのは
 * 後継品バイパス（`a.id === m.successorId`）だけなので、候補が後継1件に閉じることと、
 * 現行品を基準にしたときに旧機種が混ざらないことを両方向から固定する。
 *
 *   node tools/test-compat.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDevices, devicesOf } from '../src/core/store.mjs';
import { getCategory, primarySpec, distinguishingSpec } from '../src/core/registry.mjs';
import { computeCompatibles, withinWindow } from '../src/core/compat.mjs';
import '../src/categories/drive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
let n = 0;
function check(name, cond, detail) {
  n++;
  if (cond) console.log(`  ${String(n).padStart(2)}. OK  ${name}`);
  else { failures.push(name); console.log(`  ${String(n).padStart(2)}. NG  ${name}${detail ? ` — ${detail}` : ''}`); }
}

const inverters = JSON.parse(readFileSync(join(ROOT, 'data', 'inverter.json'), 'utf8'));
loadDevices(inverters);

const cat = getCategory('inverter');
const all = devicesOf('inverter');
const byModel = new Map(all.map((d) => [d.model, d]));
const get = (model) => {
  const d = byModel.get(model);
  if (!d) throw new Error(`${model} が data/inverter.json に無い`);
  return d;
};
/** m の候補の形名一覧 */
const candidates = (model) => computeCompatibles(get(model), cat).map((c) => c.model);

console.log(`インバータ ${all.length} 件で互換判定を実行\n`);

/* ---- 1. ND定格が全件そろっている ---- */

/**
 * 現行品（FR-E800）と旧機種（FR-E700）を分けて見る。
 *
 * 旧機種は置換え資料 BCN-C21002-214C からしか起こせず、同資料に定格出力電流も
 * 定格容量も記載が無いため、キーごと不在にしてある（`0` で埋めない）。
 * 「全件が定格を持つ」を丸ごと外すと、現行品の定格が欠けても気づけなくなるので、
 * 現行品に対する要求はそのまま残し、旧機種には「持たないこと」を要求する。
 */
const current = all.filter((d) => !d.discontinued);
const legacy = all.filter((d) => d.discontinued);
const hasSpec = (d, key) => typeof d.specs?.[key] === 'number';

check('現行品40件すべてが定格出力電流と定格容量を持つ',
  all.length === 70 && current.length === 40
  && current.every((d) => hasSpec(d, 'ratedCurrentA') && hasSpec(d, 'ratedCapacityKVA')),
  `全 ${all.length} / 現行 ${current.length} / 欠け `
  + current.filter((d) => !hasSpec(d, 'ratedCurrentA') || !hasSpec(d, 'ratedCapacityKVA')).map((d) => d.model).join(' '));

check('旧機種30件は定格出力電流・定格容量をキーごと持たず、適用モータ容量だけを持つ',
  legacy.length === 30
  && legacy.every((d) => !('ratedCurrentA' in (d.specs ?? {})) && !('ratedCapacityKVA' in (d.specs ?? {}))
    && hasSpec(d, 'ratedPowerKW')),
  `旧機種 ${legacy.length} / 違反 `
  + legacy.filter((d) => 'ratedCurrentA' in (d.specs ?? {}) || 'ratedCapacityKVA' in (d.specs ?? {}) || !hasSpec(d, 'ratedPowerKW'))
    .map((d) => `${d.model}:${JSON.stringify(d.specs)}`).join(' '));

/**
 * 形名の4桁電流コード（L(名)06130-J の「電流コード」列）。
 * 定格表とは別の列なので、転記ミス・LD値の混入・括弧付き低減値の混入を検出できる。
 * 旧機種の形名（FR-E720-3.7K）には電流コードが無いので、現行品だけを突き合わせる。
 */
const CURRENT_CODE = {
  'FR-E820-0.1K-1': '0008', 'FR-E820-0.2K-1': '0015', 'FR-E820-0.4K-1': '0030',
  'FR-E820-0.75K-1': '0050', 'FR-E820-1.5K-1': '0080', 'FR-E820-2.2K-1': '0110',
  'FR-E820-3.7K-1': '0175', 'FR-E820-5.5K-1': '0240', 'FR-E820-7.5K-1': '0330',
  'FR-E820-11K-1': '0470', 'FR-E820-15K-1': '0600', 'FR-E820-18.5K-1': '0760',
  'FR-E820-22K-1': '0900',

  'FR-E840-0.4K-1': '0016', 'FR-E840-0.75K-1': '0026', 'FR-E840-1.5K-1': '0040',
  'FR-E840-2.2K-1': '0060', 'FR-E840-3.7K-1': '0095', 'FR-E840-5.5K-1': '0120',
  'FR-E840-7.5K-1': '0170', 'FR-E840-11K-1': '0230', 'FR-E840-15K-1': '0300',
  'FR-E840-18.5K-1': '0380', 'FR-E840-22K-1': '0440',

  'FR-E860-0.75K-1': '0017', 'FR-E860-1.5K-1': '0027', 'FR-E860-2.2K-1': '0040',
  'FR-E860-3.7K-1': '0061', 'FR-E860-5.5K-1': '0090', 'FR-E860-7.5K-1': '0120',

  'FR-E820S-0.1K-1': '0008', 'FR-E820S-0.2K-1': '0015', 'FR-E820S-0.4K-1': '0030',
  'FR-E820S-0.75K-1': '0050', 'FR-E820S-1.5K-1': '0080', 'FR-E820S-2.2K-1': '0110',

  'FR-E810W-0.1K-1': '0008', 'FR-E810W-0.2K-1': '0015', 'FR-E810W-0.4K-1': '0030',
  'FR-E810W-0.75K-1': '0050',
};

const codeMismatch = current.filter((d) => {
  const code = CURRENT_CODE[d.model];
  return !code || Math.round(d.specs.ratedCurrentA * 10) !== Number(code);
});
check('現行品の定格出力電流が形名の4桁電流コード（＝ND定格電流×10）と一致する',
  Object.keys(CURRENT_CODE).length === 40 && codeMismatch.length === 0,
  codeMismatch.map((d) => `${d.model}: ${d.specs.ratedCurrentA}A ≠ ${CURRENT_CODE[d.model]}`).join(' / '));

// 括弧付きの低減値（周囲温度40℃超・PWM2kHz以上）を入れていないこと。
// 抜き取りではなく、低減値と通常値が割れる代表的な3件を名指しで見る。
check('括弧付きの低減値を入れていない（FR-E820-3.7K-1 は 17.5A で 16.5A ではない）',
  get('FR-E820-3.7K-1').specs.ratedCurrentA === 17.5);

// LD定格（FR-E820-3.7K-1 なら 19.6A / 7.8kVA）が混ざっていないこと
check('LD定格が主スペックに混ざっていない',
  get('FR-E820-3.7K-1').specs.ratedCurrentA !== 19.6 && get('FR-E820-3.7K-1').specs.ratedCapacityKVA === 7,
  JSON.stringify(get('FR-E820-3.7K-1').specs));

check('LD定格用のキーを持つレコードが無い（今回はND定格のみを登録する）',
  all.every((d) => !Object.keys(d.specs).some((k) => /ld/i.test(k))),
  all.flatMap((d) => Object.keys(d.specs).filter((k) => /ld/i.test(k))).join(' '));

/* ---- 2. 候補算出が動く ---- */

const withCandidates = all.filter((d) => computeCompatibles(d, cat).length > 0);
check('主スペックが揃い、候補を算出できる型式が現れた（従来は全件0件）',
  withCandidates.length > 0, `候補が出た型式 ${withCandidates.length} / ${all.length}`);

check('FR-E820-3.7K-1 の候補に FR-E820-5.5K-1 が入る（±30%窓の内側）',
  candidates('FR-E820-3.7K-1').includes('FR-E820-5.5K-1'), candidates('FR-E820-3.7K-1').join(' '));

// 17.5A と 11.0A は差 6.5A で、大きいほうの30%（5.25A）を超える
check('FR-E820-3.7K-1 の候補に FR-E820-2.2K-1 は入らない（窓の外側）',
  !candidates('FR-E820-3.7K-1').includes('FR-E820-2.2K-1'), candidates('FR-E820-3.7K-1').join(' '));

check('候補は全件が同じ電圧クラス',
  all.every((m) => computeCompatibles(m, cat).every((c) => c.specs.voltClass === m.specs.voltClass)));

/**
 * 窓の検査は、gate の後継品バイパス（`a.id === m.successorId` は無条件に通す）を
 * 通った辺には課さない。旧機種は定格出力電流を持たないので、窓では後継へ辿れない。
 * バイパスした辺そのものは「旧機種の候補は後継1件だけ」で別に固定する。
 */
check('後継品リンク以外の候補は全件が定格出力電流の±30%窓に収まる',
  all.every((m) => computeCompatibles(m, cat)
    .filter((c) => c.id !== m.successorId)
    .every((c) => withinWindow(c.specs.ratedCurrentA, m.specs.ratedCurrentA, 0.3))));

// 窓は大きいほうを基準にしてあるので、A→B が候補なら B→A も候補になる。
// 後継品リンクだけは片方向の辺（旧機種→後継）なので対象から外す。
const asymmetric = [];
for (const m of all) {
  for (const c of computeCompatibles(m, cat)) {
    if (c.id === m.successorId) continue;
    if (!candidates(c.model).includes(m.model)) asymmetric.push(`${m.model} → ${c.model}`);
  }
}
check('候補の関係が対称（A→B なら B→A。後継品リンクを除く）', asymmetric.length === 0, asymmetric.slice(0, 3).join(' / '));

check('自分自身は候補に入らない', all.every((m) => !candidates(m.model).includes(m.model)));

/* ---- 3. 旧機種（FR-E700）は後継品へ一方向に辿るだけ ---- */

/**
 * 旧機種は主スペック（定格出力電流）を持たないので、窓の判定には一切かからない。
 * 通るのは gate 先頭の後継品バイパスだけで、候補は登録した後継1件に閉じる。
 * 逆に現行品を基準にしたときは、旧機種が候補に混ざらない（後継バイパスは
 * 旧機種側にしか張られておらず、窓は旧機種の定格が無いので false になる）。
 */
const legacyWrong = legacy.filter((d) => {
  const cs = computeCompatibles(d, cat);
  return cs.length !== 1 || cs[0].id !== d.successorId;
});
check('旧機種30件の候補は登録した後継品ちょうど1件',
  legacyWrong.length === 0,
  legacyWrong.slice(0, 3).map((d) => `${d.model}: ${candidates(d.model).join(',') || '(0件)'}`).join(' / '));

check('FR-E720-3.7K の候補は FR-E820-3.7K-1 の1件だけ',
  candidates('FR-E720-3.7K').join(' ') === 'FR-E820-3.7K-1', candidates('FR-E720-3.7K').join(' '));

const legacyLeak = current.filter((m) => computeCompatibles(m, cat).some((c) => c.discontinued));
check('現行品を基準にしたとき候補に旧機種が1件も混ざらない',
  legacyLeak.length === 0,
  legacyLeak.slice(0, 3).map((m) => `${m.model}: ${candidates(m.model).join(',')}`).join(' / '));

/* ---- 4. 電源相数の一致条件（PR #6）---- */

/**
 * FR-E820S-1.5K-1（単相200V入力）と FR-E820-1.5K-1（3相200V入力）は
 * voltClass=200・定格出力電流=8.0A で完全に同値。gate に残るのは相数の違いだけ。
 */
const single = get('FR-E820S-1.5K-1');
const three = get('FR-E820-1.5K-1');

check('前提: 単相機と3相機で電圧クラスと定格出力電流が同値（相数以外に落とす材料が無い）',
  single.specs.voltClass === three.specs.voltClass
  && single.specs.ratedCurrentA === three.specs.ratedCurrentA
  && withinWindow(single.specs.ratedCurrentA, three.specs.ratedCurrentA, 0.3),
  `${single.model} ${single.specs.ratedCurrentA}A/${single.specs.voltClass} vs ${three.model} ${three.specs.ratedCurrentA}A/${three.specs.voltClass}`);

check('FR-E820S-1.5K-1 の候補に3相入力の FR-E820 が1件も入らない',
  !candidates(single.model).some((m) => /^FR-E820-/.test(m)), candidates(single.model).join(' '));

check('FR-E820-1.5K-1 の候補に単相入力の FR-E820S が1件も入らない（逆方向）',
  !candidates(three.model).some((m) => /^FR-E820S-/.test(m)), candidates(three.model).join(' '));

check('単相200V機どうしは候補になる（相数条件が単相側を全部殺していない）',
  candidates(single.model).some((m) => /^FR-E820S-/.test(m)), candidates(single.model).join(' '));

// 相数条件を外すと実際に混ざることを確認する（テストが空振りしていないことの担保）
const withoutPhaseGate = all.filter((a) =>
  a.id !== single.id
  && a.specs.voltClass === single.specs.voltClass
  && withinWindow(a.specs.ratedCurrentA, single.specs.ratedCurrentA, 0.3));
check('相数条件が無ければ3相機が混ざる（この条件が実際に効いている）',
  withoutPhaseGate.some((d) => /^FR-E820-/.test(d.model)),
  withoutPhaseGate.map((d) => d.model).join(' '));

// 単相100V入力（FR-E810W）は voltClass=100 なので、そもそも 200V 機と交わらない
check('FR-E810W（単相100V入力）の候補は FR-E810W だけ',
  candidates('FR-E810W-0.75K-1').every((m) => /^FR-E810W-/.test(m)), candidates('FR-E810W-0.75K-1').join(' '));

// 全件通しで、相数の違う組が1つも候補になっていないこと
const phase = (d) => (/単相/.test(d.specs.voltage) ? 1 : 3);
const phaseLeak = [];
for (const m of all) {
  for (const c of computeCompatibles(m, cat)) {
    if (phase(c) !== phase(m)) phaseLeak.push(`${m.model} → ${c.model}`);
  }
}
check('全70件を通して電源相数の違う候補が1件も出ない', phaseLeak.length === 0, phaseLeak.slice(0, 3).join(' / '));

/* ---- 5. 判定に使う値と、人が見分ける値を分けている ---- */

/**
 * 主スペック（judgment）は定格出力電流のまま、曖昧一致リストの識別材料（human）は
 * 適用モータ容量。後者は specDefs の宣言順で決まるので、並べ替えると黙って変わる。
 * FR-E820-1.5K-1 と FR-E820-15K-1 は normLoose で同じ綴りになる実際の組。
 */
check('判定に使う主スペックは定格出力電流', primarySpec(cat).key === 'ratedCurrentA', primarySpec(cat).key);

const confusable = [get('FR-E820-1.5K-1'), get('FR-E820-15K-1')];
check('曖昧一致リストの識別材料は適用モータ容量（銘板から即断できるほう）',
  distinguishingSpec(cat, confusable).key === 'ratedPowerKW', distinguishingSpec(cat, confusable).key);
check('識別材料は 1.5kW と 15kW で 10倍差になる',
  confusable.map((d) => d.specs.ratedPowerKW).join('/') === '1.5/15');

/* ---- 6. 寸法未取得でも判定が壊れない ---- */

check('寸法未確認なので寸法差は算出せず null のまま',
  computeCompatibles(get('FR-E820-3.7K-1'), cat).every((c) => c.dimsTrustworthy === false && c.diff === null));

console.log('');
if (failures.length) {
  console.error(`互換判定テスト失敗: ${failures.length} / ${n} 項目が NG`);
  process.exit(1);
}
console.log(`互換判定テスト成功: ${n} / ${n} 項目すべて PASS`);
console.log(`  候補が算出できた型式 ${withCandidates.length} / ${all.length} 件`);
