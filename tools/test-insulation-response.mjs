/**
 * 絶縁変換器の応答時間の判定が**非対称であること**のユニットテスト。
 *
 * 依頼者の確定事項は「候補の応答時間が基準以下（同じか速い）であること。遅いものは
 * 候補にしない」で、これは互換判定の中で**唯一、向きのある条件**になっている
 * （`src/categories/insulation.mjs` の `responseWithin`）。
 *
 *   WVP-DS-15P-1（約25ms）を基準  →  WVP-DE-15P-4（約500μs）は候補になる
 *   WVP-DE-15P-4（約500μs）を基準 →  WVP-DS-15P-1（約25ms）は候補にならない
 *
 * **`tools/test-compat.mjs` に足さなかった理由。** あちらは「候補の関係が対称
 * （A→B なら B→A）」を固定する検査を持っていて、ファイル冒頭の JSDoc も
 * 「窓（`withinWindow`）を使う全カテゴリの性質」としてその対称性を宣言している。
 * ここで固定したいのは**その否定**なので、同じファイル・同じ実行名の下に置くと、
 * 1つの検査名が反対の2つの性質を同時に名乗ることになる。対象カテゴリが違う
 * （あちらはインバータ・電磁接触器・電磁開閉器で、絶縁変換器を含まない）ことは
 * 既に `docs/design-c-legacy-inverters.md` 6-18 節に記録があるが、
 * 記録があることと、検査名が実態を語ることは別の話。
 *
 * **`tools/smoke.mjs` に足さなかった理由。** smoke は playwright で `file://` を
 * 実際に開く検査で、1件ずつ画面を歩く。ここで見たいのは**62件すべてを通した
 * 候補の辺の向き**なので、画面を歩く形では代表の数件しか見られない。
 * `Math.max` のような対称化は、検査が拾っていない組から静かに壊れる。
 * 画面に出る側（②の応答時間の表示・③に誰が並ぶか）は smoke が見ているので、
 * こちらは判定そのものを全件走査で見る。
 *
 * **将来 `Math.max` のような対称化が持ち込まれたら落ちる。** 検査4が、
 * 対称化した `gate` を実際に組み立てて非対称な辺が消えることを示すので、
 * 「非対称な辺がある」が空振りしていないことまで言える。
 *
 *   node tools/test-insulation-response.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDevices, devicesOf } from '../src/core/store.mjs';
import { getCategory } from '../src/core/registry.mjs';
import { computeCompatibles } from '../src/core/compat.mjs';
import '../src/categories/insulation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
let n = 0;
function check(name, cond, detail) {
  n++;
  if (cond) console.log(`  ${String(n).padStart(2)}. OK  ${name}`);
  else { failures.push(name); console.log(`  ${String(n).padStart(2)}. NG  ${name}${detail ? ` — ${detail}` : ''}`); }
}

loadDevices(JSON.parse(readFileSync(join(ROOT, 'data', 'insulation.json'), 'utf8')));

const cat = getCategory('insulation');
const all = devicesOf('insulation');
const byModel = new Map(all.map((d) => [d.model, d]));
const get = (model) => {
  const d = byModel.get(model);
  if (!d) throw new Error(`${model} が data/insulation.json に無い`);
  return d;
};
const candidates = (model) => computeCompatibles(get(model), cat).map((c) => c.model);
/** 応答時間（μs）。持たないレコード（MS3749）は null */
const res = (model) => get(model).specs?.responseUs ?? null;

console.log(`絶縁変換器 ${all.length} 件で候補の辺を全件走査する`);
console.log('見る性質は「候補の応答時間は基準以下（同じか速い）」＝向きのある条件\n');

/* ---- 1. 前提：応答時間が割れる組が実在する ---- */

/**
 * 検査が空振りしていないことを先に固定する。
 *
 * WVP-DS 25件だけを登録していた時点（PR #40）は全件が 25000μs で、応答時間で
 * 落ちる組が0件だった。だから「遅いものを候補にしない」検査を作らなかった
 * （対象0件のまま「全項目PASS」と出る検査を作らない。CLAUDE.md）。
 * WVP-DE（500μs）・WVP-DZ（200000μs）が入って初めて判定が働くので、
 * **その前提そのものを検査にする**。データが減って再び全件同値に戻ったら、
 * 下の非対称性の検査は真になってしまうが、この検査が落ちる。
 *
 * **値の通り数は「N通り以上」ではなく現在の数で固定する。** PR #42 で
 * WGP-DE（120μs）が入って3通りから4通りに増え、この検査が落ちて気づけた。
 * 「2通り以上」と緩めると、値が増えたことも減ったことも黙って通る。
 * 増えたときは、増えた値が資料どおりか（`formatResponse` の μs / ms の
 * 出し分けを含めて）を確かめてからこの数を直すこと。
 */
const withResponse = all.filter((d) => typeof d.specs?.responseUs === 'number');
const distinct = [...new Set(withResponse.map((d) => d.specs.responseUs))].sort((a, b) => a - b);
check(`応答時間を持つ型式が4通りの値を持つ（保有 ${withResponse.length} 件）`,
  withResponse.length > 0 && distinct.length === 4,
  `値: ${distinct.join(' / ') || 'なし'}`);

/**
 * 入力信号・出力信号が一致するのに応答時間が割れる組（＝判定が実際に働く組）。
 * この組が0なら、`responseWithin` は一度も可否を左右していない。
 */
const mixedGroups = new Map();
for (const d of withResponse) {
  if (typeof d.specs.outputSignal !== 'string') continue;
  const key = `${d.specs.inputSignal} / ${d.specs.outputSignal}`;
  if (!mixedGroups.has(key)) mixedGroups.set(key, []);
  mixedGroups.get(key).push(d);
}
const mixed = [...mixedGroups.entries()]
  .filter(([, v]) => new Set(v.map((d) => d.specs.responseUs)).size > 1);
check(`入力信号・出力信号が同じで応答時間が割れる組が実在する（${mixed.length} 組）`,
  mixed.length > 0,
  mixed.map(([k, v]) => `[${k}] ${v.map((d) => d.model).join(' ')}`).join(' ／ '));

/* ---- 2. 非対称な辺が実際に生じている ---- */

/**
 * A→B が候補なのに B→A が候補にならない辺を全件から拾う。
 *
 * **このカテゴリではこれが正しい姿**で、0本になったら判定が対称化されたか、
 * 応答時間の割れる組がデータから消えたかのどちらか。前者は検査4が、
 * 後者は検査1が別に落とす。
 */
const asymmetric = [];
for (const m of all) {
  for (const c of computeCompatibles(m, cat)) {
    if (!candidates(c.model).includes(m.model)) asymmetric.push([m.model, c.model]);
  }
}
check(`候補の関係が非対称な辺が実在する（${asymmetric.length} 本）`,
  asymmetric.length > 0,
  asymmetric.slice(0, 3).map(([a, b]) => `${a} → ${b}`).join(' / ') || '非対称な辺が1本も無い');

/**
 * 非対称な辺は**すべて応答時間が理由**で、向きは「候補のほうが速い」に限る。
 *
 * 向きを見ないと、`responseWithin` が逆向き（遅いものだけを候補にする）に
 * 壊れても「非対称な辺がある」は真のまま通ってしまう。
 * 入力信号・出力信号は `signalMatch` が対称に見るので、そこが理由で非対称に
 * なることは無い——なっていたら別の壊れ方なので、それもここで落とす。
 */
const wrongWay = asymmetric.filter(([a, b]) => {
  const [ra, rb] = [res(a), res(b)];
  return typeof ra !== 'number' || typeof rb !== 'number' || !(rb < ra);
});
check('非対称な辺はすべて「候補のほうが応答時間が速い」向き（遅い側へは辿らない）',
  wrongWay.length === 0,
  wrongWay.slice(0, 3).map(([a, b]) => `${a}(${res(a)}) → ${b}(${res(b)})`).join(' / '));

/* ---- 3. 入力・出力が一致しても、遅ければ候補にしない ---- */

/**
 * 応答時間**だけ**を理由に落ちている辺を数える。
 *
 * 入力信号・出力信号が一致し、出力信号のキーも同じで、第2出力もどちらも持たない
 * ——つまり `responseWithin` 以外の条件をすべて満たすのに候補にならない組。
 * これが `gate` の非対称条件が実際に効いている辺そのもの。
 */
const droppedBySpeed = [];
for (const m of withResponse) {
  for (const a of withResponse) {
    if (a.id === m.id) continue;
    const sameIO = a.specs.inputSignal === m.specs.inputSignal
      && a.specs.outputSignal === m.specs.outputSignal;
    if (!sameIO) continue;
    if (!candidates(m.model).includes(a.model)) droppedBySpeed.push([m.model, a.model]);
  }
}
check(`入力・出力が一致しても遅い側は候補にならない辺が実在する（${droppedBySpeed.length} 本）`,
  droppedBySpeed.length > 0,
  droppedBySpeed.slice(0, 3).map(([m, a]) => `基準 ${m} ← ${a}`).join(' / ') || '落ちる辺が1本も無い');

check('その辺はすべて「候補のほうが応答時間が遅い」ことが理由（他の条件では落ちていない）',
  droppedBySpeed.every(([m, a]) => res(a) > res(m)),
  droppedBySpeed.filter(([m, a]) => !(res(a) > res(m)))
    .slice(0, 3).map(([m, a]) => `基準 ${m}(${res(m)}) ← ${a}(${res(a)})`).join(' / '));

/* ---- 4. 対称化を持ち込むと、この検査が落ちる ---- */

/**
 * **この検査が空振りしていないことの担保。**
 *
 * `responseWithin` を `Math.max` で対称化した版（＝どちらから見ても
 * 「速いほうに合わせる」形）で同じ走査をやり直し、非対称な辺が0本に
 * なることを実際に確かめる。0本にならないなら、上の「非対称な辺が実在する」は
 * 応答時間以外の何かを拾っていることになる。
 *
 * `test-compat.mjs` の「相数条件が無ければ3相機が混ざる（この条件が実際に効いて
 * いる）」と同じ形。条件を外した世界を実際に作って、結果が変わることを見る。
 *
 * 対称化の例として `Math.max` を選んだのは、窓（`withinWindow`）が対称性を
 * 得るために使っている手であり、他カテゴリから持ち込まれるとしたらこの形に
 * なるため（`src/core/compat.mjs` の JSDoc）。
 */
const symmetricGate = (a, m) => {
  if (a.specs?.inputSignal !== m.specs?.inputSignal) return false;
  if (typeof a.specs?.outputSignal !== 'string') return false;
  if (a.specs.outputSignal !== m.specs?.outputSignal) return false;
  const [ra, rm] = [a.specs?.responseUs, m.specs?.responseUs];
  if (typeof ra !== 'number' || typeof rm !== 'number') return false;
  // 対称化：どちらから見ても速いほうを基準に取る（＝常に真になる）
  return Math.min(ra, rm) <= Math.max(ra, rm);
};
const symCandidates = new Map(withResponse.map((m) => [
  m.model,
  withResponse.filter((a) => a.id !== m.id && symmetricGate(a, m)).map((a) => a.model),
]));
const symAsymmetric = [];
for (const [model, list] of symCandidates) {
  for (const c of list) if (!symCandidates.get(c)?.includes(model)) symAsymmetric.push(`${model} → ${c}`);
}
check('対称化（Math.max 相当）を当てると非対称な辺が0本になる（この検査が空振りでない）',
  symAsymmetric.length === 0 && asymmetric.length > 0,
  `対称化後の非対称な辺 ${symAsymmetric.length} 本 / 現在 ${asymmetric.length} 本`);

/* ---- 5. 名指しの3件（②③の実測に使う足場） ---- */

/**
 * 全件走査は「どこかで非対称が起きている」までしか言わない。
 * 依頼者が画面で確かめる3件を名指しで固定して、走査が拾っている辺と
 * 画面で見ている辺が同じものだと言えるようにする。
 * 同じ3件を `tools/smoke.mjs` が②③の画面から見ているので、
 * 判定（ここ）と表示（smoke）の両方で同じ組を押さえる形になる。
 */
check('WVP-DS-15P-1（25ms）の候補に WVP-DE-15P-4（500μs）が入る（速い側は候補になる）',
  candidates('WVP-DS-15P-1').includes('WVP-DE-15P-4'),
  candidates('WVP-DS-15P-1').join(' ') || '候補0件');
check('WVP-DE-15P-4（500μs）の候補に WVP-DS-15P-1（25ms）は入らない（逆向き・遅い側）',
  !candidates('WVP-DE-15P-4').includes('WVP-DS-15P-1'),
  candidates('WVP-DE-15P-4').join(' ') || '候補0件');
check('WVP-DS-15P-1（25ms）の候補に WVP-DZ-15P-1（200ms）は入らない（遅い側）',
  !candidates('WVP-DS-15P-1').includes('WVP-DZ-15P-1'),
  candidates('WVP-DS-15P-1').join(' ') || '候補0件');
check('WVP-DZ-15P-1（200ms）の候補に WVP-DS-15P-1 と WVP-DE-15P-4 の両方が入る',
  candidates('WVP-DZ-15P-1').includes('WVP-DS-15P-1')
  && candidates('WVP-DZ-15P-1').includes('WVP-DE-15P-4'),
  candidates('WVP-DZ-15P-1').join(' ') || '候補0件');

/**
 * 応答時間を持たない MS3749 は、この判定の外にいる。
 *
 * `responseWithin` は「片方だけが応答時間を持つ組は候補にしない」で、
 * 両方とも持たない MS3749 どうしだけを判定材料にしないで通す。
 * 非対称な辺に MS3749 が1件も現れないことで、この扱いが保たれていると言える
 * （現れたら、応答時間を持たないレコードが向きのある比較に巻き込まれている）。
 */
check('非対称な辺に MS3749（応答時間を持たない系列）が1件も現れない',
  asymmetric.every(([a, b]) => !a.startsWith('MS3749') && !b.startsWith('MS3749')),
  asymmetric.filter(([a, b]) => a.startsWith('MS3749') || b.startsWith('MS3749'))
    .slice(0, 3).map(([a, b]) => `${a} → ${b}`).join(' / '));

console.log('');
if (failures.length) {
  console.error(`絶縁変換器 応答時間テスト失敗: ${failures.length} / ${n} 項目が NG`);
  process.exit(1);
}
console.log(`絶縁変換器 応答時間テスト成功: ${n} / ${n} 項目すべて PASS`);
console.log(`  非対称な辺 ${asymmetric.length} 本 / 遅くて落ちた辺 ${droppedBySpeed.length} 本`
  + ` / 応答時間が割れる組 ${mixed.length} 組`);
