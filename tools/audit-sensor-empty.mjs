/**
 * センサー4カテゴリの0件画面を実測する。
 *
 * `sensorEmptyNote` は「電気的に成立しない組み合わせ（出力極性・配線本数の相違）は
 * 候補から除外しています」と名乗る。この1文がその画面で本当に起きたことなのかは、
 * 0件になった型式ごとに **どの条件で候補が落ちたか** を数えないと分からない。
 * `emptyNote(m)` は基準機しか受け取らないので、アプリ自身はこれを実行時に知れない。
 * ここで外から数えて、文面が真であることの裏を取る。
 *
 * 集計は2通り出す。どちらか片方では判断を誤るため両方出す。
 *
 *   判定順 … `sensorGate` と同じ順で「最初に落ちた条件」を数える。
 *            極性・配線は key/group の判定より **前** にあるので、そもそも
 *            互換系列を共有しない相手まで「配線で落ちた」に数え上げられる。
 *   実効   … 極性・配線の2条件を外したら通っていたか。落ちた相手が
 *            「その2条件が無ければ候補だった」ものかどうかはこちらでしか出ない。
 *
 * 判定の再実装ではなく `sensorGate` の分岐をなぞった写しなので、gate を変えたら
 * ここも追随させること（`dropReason` の分岐順が `sensorGate` と同じであること）。
 * 写しである以上ズレうるので、最後に `computeCompatibles` の結果と突き合わせ、
 * 「判定順でどこにも落ちなかった相手が居るのに候補0件」という矛盾が出たら失敗させる。
 *
 *   node tools/audit-sensor-empty.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDevices, devicesOf } from '../src/core/store.mjs';
import { getCategory } from '../src/core/registry.mjs';
import { computeCompatibles, isSeriesScope } from '../src/core/compat.mjs';
import { polarityOK, wireCount, methodOK } from '../src/categories/sensor-common.mjs';
import '../src/categories/sensors.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = ['proximity', 'photo', 'ultrasonic', 'special'];

const records = [];
for (const id of CATEGORIES) records.push(...JSON.parse(readFileSync(join(ROOT, 'data', `${id}.json`), 'utf8')));
loadDevices(records);

/** `sensorGate` と同じ判定順で、最初に落ちた条件を返す。通れば null。 */
function dropReason(a, m) {
  if (!polarityOK(a, m)) return 'polarity';
  const wm = wireCount(m);
  const wa = wireCount(a);
  if (wm && wa && wm !== wa) return 'wire';
  return seriesReason(a, m);
}

/** 極性・配線の2条件を外したときに落ちる理由。通れば null。 */
function seriesReason(a, m) {
  if (a.id === m.successorId) return null;
  if (a.compatKey && a.compatKey === m.compatKey) return null;
  if (a.specs?.compatGroup && a.specs.compatGroup === m.specs?.compatGroup) {
    if (m.category === 'proximity') return a.specs?.threadSize === m.specs?.threadSize ? null : 'thread';
    return methodOK(a.specs?.detectMethod, m.specs?.detectMethod) ? null : 'method';
  }
  return 'nokey';
}

/** compatKey か compatGroup を共有するか。ねじ径・検出方式・電気条件は問わない。 */
function sharesSeries(a, m) {
  if (a.compatKey && a.compatKey === m.compatKey) return true;
  return !!(a.specs?.compatGroup && a.specs.compatGroup === m.specs?.compatGroup);
}

const LABEL = {
  polarity: '出力極性', wire: '配線本数', thread: 'ねじ径', method: '検出方式',
  nokey: 'key/group非共有',
};

const rows = [];
let judged = 0;
for (const id of CATEGORIES) {
  const category = getCategory(id);
  const pool = devicesOf(id).filter((d) => !isSeriesScope(d));
  for (const m of pool) {
    judged++;
    if (computeCompatibles(m, category).length) continue;
    const others = pool.filter((a) => a.id !== m.id);
    const order = { polarity: 0, wire: 0, thread: 0, method: 0, nokey: 0 };
    const effective = { pass: 0, thread: 0, method: 0, nokey: 0 };
    const blocked = [];   // 極性・配線が無ければ候補だった相手
    const seriesOnly = []; // 系列は共有するが、ねじ径・検出方式で落ちた相手
    let series = 0;
    for (const a of others) {
      const first = dropReason(a, m);
      if (first === null) {
        // 写しが gate とズレている。ここに来たら数字を信じてはいけない
        console.error(`矛盾: ${m.model} は候補0件だが ${a.model} がどの条件でも落ちていない`);
        process.exit(1);
      }
      order[first]++;
      const later = seriesReason(a, m);
      if (later === null) { effective.pass++; blocked.push(`${a.model}(${LABEL[first]})`); }
      else effective[later]++;
      if (sharesSeries(a, m)) {
        series++;
        if (later !== null && later !== 'nokey') seriesOnly.push(`${a.model}(${LABEL[later]})`);
      }
    }
    rows.push({
      category: id, model: m.model, maker: m.maker, others: others.length,
      order, effective, series, blocked, seriesOnly,
      compatKey: m.compatKey || '', compatGroup: m.specs?.compatGroup || '',
      threadSize: m.specs?.threadSize || '', detectMethod: m.specs?.detectMethod || '',
      outputSpec: m.specs?.outputSpec || '', voltage: m.specs?.voltage || '', wire: wireCount(m),
      // 依頼の分類。判定順と実効で結論が割れる型式があるので、両方の立場で分ける
      classByOrder: order.polarity + order.wire > 0 ? 'A' : series === 0 ? 'B' : 'C',
      classByEffect: effective.pass > 0 ? 'A' : series === 0 ? 'B' : 'C',
    });
  }
}

const tsv = (...cells) => cells.join('\t');
console.log(`センサー4カテゴリ 判定対象 ${judged}件 / 候補0件 ${rows.length}件\n`);

console.log('■ カテゴリ別');
for (const id of CATEGORIES) {
  const n = devicesOf(id).filter((d) => !isSeriesScope(d)).length;
  console.log(`  ${id}: 判定対象 ${n}件 / 候補0件 ${rows.filter((r) => r.category === id).length}件`);
}

console.log('\n■ 判定順（最初に落ちた条件の件数）');
console.log(tsv('型式', '母集団', '出力極性', '配線本数', 'ねじ径', '検出方式', 'key/group非共有', '分類'));
for (const r of rows) {
  console.log(tsv(r.model, r.others, r.order.polarity, r.order.wire, r.order.thread,
    r.order.method, r.order.nokey, r.classByOrder));
}

console.log('\n■ 実効（極性・配線を外したら通ったか）');
console.log(tsv('型式', '通る', 'ねじ径', '検出方式', 'key/group非共有', '系列共有', '分類'));
for (const r of rows) {
  console.log(tsv(r.model, r.effective.pass, r.effective.thread, r.effective.method,
    r.effective.nokey, r.series, r.classByEffect));
}

const split = rows.filter((r) => r.classByOrder !== r.classByEffect);
console.log(`\n■ 判定順と実効で分類が割れる型式 ${split.length}件`);
for (const r of split) console.log(`  ${r.model}: 判定順=${r.classByOrder} / 実効=${r.classByEffect}`);

console.log('\n■ 分類の内訳');
for (const c of ['A', 'B', 'C']) {
  console.log(`  ${c}: 判定順 ${rows.filter((r) => r.classByOrder === c).length}件`
    + ` / 実効 ${rows.filter((r) => r.classByEffect === c).length}件`);
}

console.log('\n■ 型式ごとの内訳');
for (const r of rows) {
  console.log(`[${r.category}] ${r.model}（${r.maker}）`);
  console.log(`  key=${r.compatKey || '―'} group=${r.compatGroup || '―'}`
    + ` ねじ径=${r.threadSize || '―'} 検出方式=${r.detectMethod || '―'}`);
  console.log(`  出力=${r.outputSpec || '―'} 電源=${r.voltage || '―'} 配線=${r.wire ? `${r.wire}線` : '―'}`);
  console.log(`  極性・配線が無ければ候補だった相手 ${r.blocked.length}件: ${r.blocked.join(', ') || 'なし'}`);
  console.log(`  系列は共有するが他条件で落ちた相手 ${r.seriesOnly.length}件: ${r.seriesOnly.join(', ') || 'なし'}`);
}
