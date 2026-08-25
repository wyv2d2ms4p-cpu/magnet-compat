/**
 * センサー系の0件パネルが名乗る条件が、`sensorGate` に実在することの検査。
 *
 * インバータの0件20件は、コアの既定文が `sensorGate` にしか無い2条件
 * （出力極性・配線本数）を9カテゴリ共通で名乗っていたために起きた。文面が
 * 判定から離れて独り歩きする、というのがこの事故の形で、それはセンサー側でも
 * 同じように起こりうる（gate から条件が消えても、文面はそのまま残る）。
 *
 * `emptyNote(m)` は基準機しか受け取らないので、**その画面で何が落ちたか**は
 * アプリにもこの検査にも分からない。文面がそこを語らない書き方
 * （「候補に出すのは〜だけ」＝必要条件の宣言）になっていれば、真偽は
 * gate に対して機械的に決められる。ここで見るのはその必要条件だけ。
 *
 *   文面が名乗る条件 ⊆ sensorGate の必要条件
 *
 * 逆向き（gate の条件を文面が全部並べているか）は見ない。必要条件を一部だけ
 * 名乗るのは偽ではないうえ、全部並べさせると gate を変えるたびに文面が伸びる。
 *
 * 空振りしないように、名乗った条件が **実際に候補を落としていること** も併せて見る。
 * 条件が死んで1件も落とさなくなれば「必要条件である」はいつでも真になり、
 * 前半の検査だけでは気づけない。
 *
 * 文面そのもの（どの語をどう書くか）は `tools/smoke.mjs` が実画面で固定する。
 * ここは文面が **真であること**、smoke は文面が **出ていること** を見る。
 *
 * インバータ側は `tools/test-compat.mjs` の検査10・11・23 が同じ性質
 * （gate を通った候補は全件、文面が名乗る電圧クラス・電源相数・定格出力電流の
 * 条件を満たす）を既に固定しているので、ここでは扱わない。
 *
 *   node tools/test-sensor-empty.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDevices, devicesOf } from '../src/core/store.mjs';
import { isSeriesScope } from '../src/core/compat.mjs';
import { sensorGate, sensorEmptyNote, polarityOK, wireCount } from '../src/categories/sensor-common.mjs';
import '../src/categories/sensors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = ['proximity', 'photo', 'ultrasonic', 'special'];

const records = [];
for (const id of CATEGORIES) records.push(...JSON.parse(readFileSync(join(ROOT, 'data', `${id}.json`), 'utf8')));
loadDevices(records);

const failures = [];
let n = 0;
function check(name, cond, detail) {
  n++;
  if (cond) console.log(`  ${String(n).padStart(2)}. OK  ${name}`);
  else { failures.push(name); console.log(`  ${String(n).padStart(2)}. NG  ${name}${detail ? ` — ${detail}` : ''}`); }
}

/* ---------- 判定対象のペア ---------- */

/** 同カテゴリの (候補 a, 基準 m) の全組。`computeCompatibles` と同じ母集団に揃える。 */
const pairs = [];
for (const id of CATEGORIES) {
  const pool = devicesOf(id).filter((d) => !isSeriesScope(d));
  for (const m of pool) for (const a of pool) if (a.id !== m.id) pairs.push([a, m]);
}
const passing = pairs.filter(([a, m]) => sensorGate(a, m));

const note = sensorEmptyNote().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log(`センサー4カテゴリ ${pairs.length}ペア（うち gate を通る ${passing.length}ペア）で0件パネルの文面を検算\n`);
console.log(`  文面: ${note}\n`);

/* ---------- 文面が名乗る条件 ---------- */

/** 配線本数が食い違うか。片方でも不明なら判定しない（`sensorGate` と同じ扱い）。 */
function wireConflict(a, m) {
  const wa = wireCount(a);
  const wm = wireCount(m);
  return !!(wa && wm && wa !== wm);
}

function sharesSeries(a, m) {
  if (a.compatKey && a.compatKey === m.compatKey) return true;
  return !!(a.specs?.compatGroup && a.specs.compatGroup === m.specs?.compatGroup);
}

/**
 * 電気条件。文面の語 → `sensorGate` の必要条件。
 * `holds` が偽のペアは gate を通ってはいけない、という読み方をする。
 */
const ELECTRICAL = [
  { term: '出力極性', holds: (a, m) => polarityOK(a, m) },
  { term: '配線本数', holds: (a, m) => !wireConflict(a, m) },
];

/**
 * 系列条件。こちらは選択肢なので、**名乗った語のどれか1つ**が成り立てばよい。
 *
 * 分けて持つのは、片方だけを名乗った文面を落とすため。「同じ互換系列にある型式だけ」と
 * 書くと、後継品バイパス（`a.id === m.successorId`）で通るペアが反例になる
 * （近接の I-215.95HTF → PR-219.A3HTF が実際にこれで、key も group も共有しない）。
 */
const SERIES = [
  { term: 'メーカー指定の後継品', holds: (a, m) => a.id === m.successorId },
  { term: '互換系列', holds: sharesSeries },
];

/** `sensorGate` が見ていない条件。文面に混ざったらインバータで起きたことの再来。 */
const FOREIGN = ['電圧クラス', '電源相数', '定格出力電流', '容量帯', '適用モータ容量',
  '検出距離', '使用温度', '取付方式'];

/* ---------- 検査 ---------- */

const named = [...ELECTRICAL, ...SERIES].filter((c) => note.includes(c.term));
check('0件パネルの文面が、判定条件を1つ以上名指ししている（名乗らない文面なら以下が空振りする）',
  note.length > 0 && named.length > 0,
  `文面「${note}」から拾えた条件: ${named.map((c) => c.term).join(' / ') || 'なし'}`);

const foreignHit = FOREIGN.filter((t) => note.includes(t));
check('文面が、sensorGate が見ていない条件を名乗らない（インバータの0件20件で起きた形）',
  foreignHit.length === 0, `混ざった語: ${foreignHit.join(' / ')}`);

check('gate を通るペアが存在する（以下の「全ペアで成り立つ」が対象0件で通らないこと）',
  passing.length > 0, `gate を通るペア ${passing.length}件`);

// 文面が名乗る電気条件は、gate を通った候補では必ず成り立っていなければならない
for (const c of ELECTRICAL.filter((x) => note.includes(x.term))) {
  const bad = passing.filter(([a, m]) => !c.holds(a, m));
  check(`文面が名乗る「${c.term}」が sensorGate の必要条件になっている（通った候補は全件これを満たす）`,
    bad.length === 0,
    `反例 ${bad.length}件: ${bad.slice(0, 3).map(([a, m]) => `${m.model} ← ${a.model}`).join(' / ')}`);
}

// 系列条件は選択肢。名乗った語のどれかが成り立てばよいが、どれも成り立たないペアが
// 通っていたら、文面が経路を1つ書き落としている
const namedSeries = SERIES.filter((c) => note.includes(c.term));
if (namedSeries.length) {
  const bad = passing.filter(([a, m]) => !namedSeries.some((c) => c.holds(a, m)));
  check(`文面が名乗る「${namedSeries.map((c) => c.term).join('／')}」が sensorGate の必要条件になっている`,
    bad.length === 0,
    `どの経路にも当てはまらないのに通ったペア ${bad.length}件: `
    + bad.slice(0, 3).map(([a, m]) => `${m.model} ← ${a.model}`).join(' / '));
}

/* ---- 名乗った条件が実際に候補を落としているか（空振り防止） ---- */

/**
 * 電気条件の「実効」。その条件が無ければ通っていたペアを数える。
 *
 * 単に「条件が偽のペアがある」では足りない。極性・配線は系列判定より前にあるので、
 * そもそも系列を共有しない相手も条件が偽になり、条件が死んでいても数が立つ
 * （`docs/sensor-empty-note-audit.md` §4-3 の取りこぼしと同じ形）。
 * 数えるのは **その条件だけが理由で候補から外れたペア** に限る。
 */
function effectiveDrops(cond) {
  return pairs.filter(([a, m]) => {
    if (cond.holds(a, m)) return false;
    const others = ELECTRICAL.filter((c) => c !== cond);
    if (!others.every((c) => c.holds(a, m))) return false;
    return a.id === m.successorId || sharesSeries(a, m);
  });
}

for (const c of ELECTRICAL.filter((x) => note.includes(x.term))) {
  const drops = effectiveDrops(c);
  check(`「${c.term}」が実際に候補を落としている（この条件だけが理由で外れる組がある）`,
    drops.length > 0,
    `実効0件。条件が死んでいても必要条件の検査は通るので、文面から落とすか gate を直す`);
}

// 名乗った系列の経路が、実際に候補を通している。使われない経路を文面に書かない
for (const c of namedSeries) {
  const used = passing.filter(([a, m]) => c.holds(a, m));
  check(`「${c.term}」の経路が実際に候補を通している（使われない経路を文面に書かない）`,
    used.length > 0, '通ったペア0件');
}

// 系列条件そのものが候補を絞っている。全ペアが系列を共有していたら、この条件は無力
const seriesDrops = pairs.filter(([a, m]) => !namedSeries.some((c) => c.holds(a, m)));
check('系列の条件が実際に候補を絞っている（系列を共有しない組が存在する）',
  namedSeries.length > 0 && seriesDrops.length > 0, `系列を共有しない組 ${seriesDrops.length}件`);

console.log(failures.length
  ? `\n0件パネルの検算に失敗: ${failures.length} / ${n} 項目\n  ${failures.join('\n  ')}`
  : `\n0件パネルの検算成功: ${n} / ${n} 項目すべて PASS`);
if (failures.length) process.exit(1);
