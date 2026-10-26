/**
 * 互換判定の回帰チェック。
 *
 * 移行元3アプリの判定関数を node:vm でそのまま動かし、全431型式について
 * 候補リストを取る。同じ入力を統合アプリのエンジンに流し、差分が
 * 「意図した修正」だけで説明できることを確認する。
 *
 * 説明できる差分:
 *   A. 容量帯の窓を対称化した（index.html:328 の m 基準の非対称を解消）
 *      → 接触器・開閉器で候補が増えることがある
 *   B. 出力極性(NPN/PNP)をハードフィルタにした
 *      → センサーで候補が減ることがある
 *   C. 移行元に無い型式（追加レコード）が候補に加わった
 *      → 出典つきで足した型式が、移行元の型式の候補に増えることがある
 *
 * 寸法の信頼性を evidence で判定するようにした修正もあるが、並び順のみに影響し、
 * 候補の集合は変わらないので分類を持たない（以前はここに C として並べていた。
 * 出力に出る分類の記号と重ならないよう、記号を外した）。
 *
 * これら以外の増減が1件でもあれば失敗させる。
 *
 * C を足した理由（`docs/design-mitsubishi-legacy-magnets.md` D69・10章）。
 * この突合は移行元にある型式の候補集合しか見ないので、移行元に無い型式を出典つきで
 * 足すと、その型式が既存の画面の候補に加わるだけで「説明不能」になる
 * （TH-N20TA を足すと、既存のサーマル16画面に TH-N20TA が1件ずつ増える）。
 * C は「増えた候補の id が移行元に無い」ことだけで判定し、A・B の判定には触れない。
 * **増えた候補が移行元の型式なら今までどおり説明不能。** 既存どうしの辺が増えたら
 * 落ちる性質は残り、移行元に無い型式の分だけを説明できる差分として数える。
 * 移行元に無い型式が候補から「消える」ことは起きない（移行元の候補は移行元の型式だけ）。
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
const explained = { symmetry: 0, polarity: 0, added: 0 };
/** C の対象になった追加レコード（出力に型式名を出し、何が説明に使われたかを残す） */
const addedModels = new Set();

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
    // C. 移行元に無い型式（追加レコード）。A の判定を先に通すので、A の件数は今までと変わらない
    if (a && !legacy.has(x)) { explained.added++; stats.added++; addedModels.add(a.model); continue; }
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
console.log(`  C. 移行元に無い型式（追加レコード）が候補に加わった ${explained.added} 件`
  + (addedModels.size ? `（${[...addedModels].join('・')}）` : ''));
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
