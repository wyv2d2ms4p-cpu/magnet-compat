/**
 * 互換判定の回帰チェック。
 *
 * 移行元3アプリの判定関数を node:vm でそのまま動かし、全431型式について
 * 候補リストを取る。同じ入力を統合アプリのエンジンに流し、差分が
 * 「意図した修正」だけで説明できることを確認する。
 *
 * 意図した修正:
 *   A. 容量帯の窓を対称化した（index.html:328 の m 基準の非対称を解消）
 *      → 接触器・開閉器で候補が増えることがある
 *   B. 出力極性(NPN/PNP)をハードフィルタにした
 *      → センサーで候補が減ることがある
 *   C. 寸法の信頼性を evidence で判定するようにした
 *      → 並び順のみに影響し、候補の集合は変わらない
 *
 * これら以外の増減が1件でもあれば失敗させる。
 *
 *   node tools/regress.mjs
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDevices, devicesOf } from '../src/core/store.mjs';
import { getCategory } from '../src/core/registry.mjs';
import { computeCompatibles } from '../src/core/compat.mjs';
import { polarities } from '../src/categories/sensor-common.mjs';
import { withinWindow } from '../src/core/compat.mjs';
import '../src/categories/contactor.mjs';
import '../src/categories/thermal.mjs';
import '../src/categories/sensors.mjs';
import '../src/categories/drive.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CATEGORIES = ['contactor', 'starter', 'thermal', 'proximity', 'photo', 'ultrasonic', 'special'];

/* ---------- 移行元の判定を動かす ---------- */

function legacyMagnet() {
  const src = readFileSync(join(ROOT, 'index.html'), 'utf8');
  const i = src.indexOf('var ALL_DEVICES');
  const j = src.indexOf('/* ================= 状態');
  const ctx = {};
  createContext(ctx);
  runInContext(src.slice(i, j), ctx);
  const out = new Map();
  for (const d of ctx.ALL_DEVICES) {
    out.set(d.id, ctx.computeCompatibles(d, '').map((c) => c.id));
  }
  return out;
}

function legacySensor() {
  const src = readFileSync(join(ROOT, 'index_3.html'), 'utf8');
  const i = src.indexOf('const DEVICES = [');
  const j = src.indexOf('function pick(');
  const ctx = {};
  createContext(ctx);
  // データ行の末尾にある DOM 参照だけ落として評価する
  const region = src.slice(i, j).replace(/document\.getElementById\([^)]*\)\.textContent[^;]*;/g, '');
  // このファイルは const 宣言なので、vm のコンテキスト変数には自動で現れない。明示的に取り出す。
  runInContext(`${region}\n;globalThis.__DEVICES=DEVICES;globalThis.__S=S;globalThis.__compat=compat;`, ctx);
  const out = new Map();
  for (const d of ctx.__DEVICES) {
    ctx.__S.matched = d;
    ctx.__S.mount = '';
    out.set(d.id, ctx.__compat().map((c) => c.id));
  }
  return out;
}

/* ---------- 統合アプリの判定 ---------- */

const devices = CATEGORIES.flatMap((c) => JSON.parse(readFileSync(join(ROOT, 'data', `${c}.json`), 'utf8')));
loadDevices(devices);

function current() {
  const out = new Map();
  for (const c of CATEGORIES) {
    const category = getCategory(c);
    for (const d of devicesOf(c)) {
      out.set(d.id, computeCompatibles(d, category, { mounting: '' }).map((x) => x.id));
    }
  }
  return out;
}

/* ---------- 突合 ---------- */

const byId = new Map(devices.map((d) => [d.id, d]));
const legacy = new Map([...legacyMagnet(), ...legacySensor()]);
const now = current();

const stats = { same: 0, added: 0, removed: 0, reordered: 0 };
const unexplained = [];
const explained = { symmetry: 0, polarity: 0 };

for (const [id, before] of legacy) {
  const after = now.get(id);
  if (!after) { unexplained.push(`${id}: 統合後に存在しない`); continue; }
  const m = byId.get(id);

  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  const added = after.filter((x) => !beforeSet.has(x));
  const removed = before.filter((x) => !afterSet.has(x));

  for (const x of added) {
    const a = byId.get(x);
    // A. 窓の対称化: 旧は m 基準だったため、m が小さいほうだと落ちていた
    const symmetricOnly =
      ['contactor', 'starter'].includes(m.category) &&
      withinWindow(a.specs?.ratedCurrentA, m.specs?.ratedCurrentA, 0.3) &&
      Math.abs(a.specs.ratedCurrentA - m.specs.ratedCurrentA) > m.specs.ratedCurrentA * 0.3;
    if (symmetricOnly) { explained.symmetry++; stats.added++; continue; }
    unexplained.push(`${id} (${m.category}): 候補に ${x} が増えた（説明不能）`);
  }

  for (const x of removed) {
    const a = byId.get(x);
    // B. 極性フィルタ: 集合が交わらないものを除外した
    const pa = a && polarities(a);
    const pm = polarities(m);
    const polarityBlocked = pa && pm && !pa.some((p) => pm.includes(p));
    if (polarityBlocked) { explained.polarity++; stats.removed++; continue; }
    unexplained.push(`${id} (${m.category}): 候補から ${x} が消えた（説明不能）`);
  }

  if (!added.length && !removed.length) {
    stats.same++;
    if (before.join() !== after.join()) stats.reordered++;
  }
}

console.log(`移行元 ${legacy.size} 型式 / 統合後 ${now.size} 型式\n`);
console.log('候補集合の差分:');
console.log(`  完全一致              ${stats.same} 型式（うち並び順のみ変化 ${stats.reordered}）`);
console.log(`  A. 窓の対称化で増加    ${explained.symmetry} 件`);
console.log(`  B. 極性フィルタで減少  ${explained.polarity} 件`);
console.log(`  説明できない差分       ${unexplained.length} 件`);

/*
 * 差分が無いことだけを見ると、修正が黙って戻されたときに検出できない
 * （修正を外すと移行元と一致してしまい「説明不能な差分ゼロ」になる）。
 * 意図した修正が実際に効いていることも確認する。
 */
const notApplied = [];
if (explained.symmetry === 0) notApplied.push('容量帯の窓の対称化が効いていない');
if (explained.polarity === 0) notApplied.push('出力極性のハードフィルタが効いていない');

if (unexplained.length) {
  console.error('\n意図しない差分:');
  for (const u of unexplained.slice(0, 20)) console.error(`  - ${u}`);
  if (unexplained.length > 20) console.error(`  - ... 他 ${unexplained.length - 20} 件`);
}
if (notApplied.length) {
  console.error('\n意図した修正が適用されていません:');
  for (const u of notApplied) console.error(`  - ${u}`);
}
if (unexplained.length || notApplied.length) process.exit(1);

console.log('\n回帰チェック成功: 差分はすべて意図した修正で説明でき、修正はいずれも有効です');
