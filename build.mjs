/**
 * src/** と data/** を単一の自己完結HTMLへインライン展開する。
 *
 * このアプリは iPhone のホーム画面に保存してオフラインで使われている。
 * fetch でJSONを読む構成にすると file:// では CORS で必ず失敗するため、
 * 開発時はモジュールとJSONに分離し、配布時にここで1ファイルへまとめる。
 *
 * ES Modules をそのまま <script type="module"> に入れる方法は取らない
 * （file:// でのモジュール解決に依存したくないため）。import/export を落として
 * 1つの古典的スクリプトとして連結し、IIFE で包む。
 *
 *   node build.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { Script } from 'node:vm';
import { join, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

/**
 * モジュールもデータも自動で拾う。
 *
 * カテゴリ追加は data/<id>.json と src/categories/<id>.mjs を置くだけで完結し、
 * このファイルにもコアにも手を入れない。連結順は import 関係から求めるので、
 * 手で並び順を管理する必要もない。
 */
function listModules() {
  const out = [];
  for (const dir of ['core', 'categories']) {
    for (const f of readdirSync(join(SRC, dir)).sort()) {
      if (f.endsWith('.mjs')) out.push(`${dir}/${f}`);
    }
  }
  return out;
}

/** data/*.json（_seed と reference は配布物に含めない） */
function listCategoryData() {
  return readdirSync(DATA).filter((f) => f.endsWith('.json')).sort().map((f) => f.replace(/\.json$/, ''));
}

/** 相対 import から依存グラフを作り、トポロジカル順に並べる */
function sortByDependency(files) {
  const deps = new Map();
  for (const f of files) {
    const code = readFileSync(join(SRC, f), 'utf8');
    const found = [...code.matchAll(/from\s*['"](\.[^'"]+)['"]/g)]
      .map((m) => normalize(join(dirname(f), m[1])).replace(/\\/g, '/'))
      .filter((p) => files.includes(p));
    deps.set(f, found);
  }
  const order = [];
  const state = new Map();
  const visit = (f, stack) => {
    if (state.get(f) === 'done') return;
    if (state.get(f) === 'visiting') throw new Error(`循環import: ${[...stack, f].join(' → ')}`);
    state.set(f, 'visiting');
    for (const d of deps.get(f)) visit(d, [...stack, f]);
    state.set(f, 'done');
    order.push(f);
  };
  for (const f of files) visit(f, []);
  return order;
}

/**
 * import 行を落とし、export キーワードを外す。
 *
 * 連結後は1つのスコープに同居するため、モジュール間で名前が衝突しないことが前提。
 * 衝突は下の assertNoDuplicateBindings が検出する。
 */
function stripModuleSyntax(code, file) {
  const out = [];
  let inImport = false;
  for (const line of code.split('\n')) {
    // 複数行にまたがる import 文にも対応する（from の行まで読み飛ばす）
    if (inImport) {
      if (/\bfrom\s*['"][^'"]+['"]\s*;?\s*$/.test(line)) inImport = false;
      continue;
    }
    if (/^\s*import\s/.test(line)) {
      if (!/\bfrom\s*['"][^'"]+['"]\s*;?\s*$/.test(line)) inImport = true;
      continue;
    }
    if (/^\s*export\s+default/.test(line)) throw new Error(`${file}: export default は使えません（名前付きexportのみ）`);
    out.push(line.replace(/^(\s*)export\s+/, '$1'));
  }
  if (inImport) throw new Error(`${file}: import 文が閉じていません`);
  return out.join('\n');
}

/** トップレベル宣言を集めて衝突を検出する */
function topLevelBindings(code) {
  const names = [];
  for (const line of code.split('\n')) {
    const m = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function assertNoDuplicateBindings(parts) {
  const seen = new Map();
  const dups = [];
  for (const { file, code } of parts) {
    for (const name of topLevelBindings(code)) {
      if (seen.has(name)) dups.push(`${name} (${seen.get(name)} と ${file})`);
      else seen.set(name, file);
    }
  }
  if (dups.length) throw new Error(`トップレベル名の衝突:\n  ${dups.join('\n  ')}`);
}

// ---- データ --------------------------------------------------------------

const devices = [];
for (const c of listCategoryData()) {
  devices.push(...JSON.parse(readFileSync(join(DATA, `${c}.json`), 'utf8')));
}
const reference = {
  makers: JSON.parse(readFileSync(join(DATA, 'reference/makers.json'), 'utf8')),
};

// _seed（実在未確認）は配布物に含めない。誤発注防止の要なので明示的に検査する。
const shipped = new Set(devices.map((d) => d.modelStatus));
if (shipped.has('provisional')) {
  throw new Error('provisional なレコードが data/*.json に混入しています（配布物に含めてはいけません）');
}

/*
 * アプリ側の読み込みは catalog-confirmed だけを通すホワイトリスト（store.mjs）。
 * 安全側の既定だが、modelStatus の付け忘れや綴り間違いも同じ経路で黙って消える
 * （サーボが0件表示になっていたときに真っ先に疑うべき挙動がこれ）。
 * 落ちるなら静かにではなくビルド時に落とす。
 */
const badStatus = devices.filter((d) => d.modelStatus !== 'catalog-confirmed');
if (badStatus.length) {
  const shown = badStatus.slice(0, 5).map((d) => `${d.id}: ${JSON.stringify(d.modelStatus)}`).join(', ');
  throw new Error(`modelStatus が catalog-confirmed でないレコードが ${badStatus.length} 件あります（アプリに表示されません）: ${shown}`);
}

// ---- モジュール ----------------------------------------------------------

const parts = sortByDependency(listModules()).map((rel) => {
  const code = stripModuleSyntax(readFileSync(join(SRC, rel), 'utf8'), rel);
  return { file: rel, code };
});
assertNoDuplicateBindings(parts);

const bundle = [
  '"use strict";',
  ...parts.map(({ file, code }) => `\n/* ===== ${file} ===== */\n${code}`),
  `\n/* ===== データ（ビルド時にインライン展開） ===== */`,
  `const EMBEDDED_DEVICES = ${JSON.stringify(devices)};`,
  `const EMBEDDED_REFERENCE = ${JSON.stringify(reference)};`,
  `loadDevices(EMBEDDED_DEVICES, EMBEDDED_REFERENCE);`,
  `start();`,
].join('\n');

// 連結結果が構文として成立するか検査する（import 除去のミスをここで止める）
try {
  new Script(`(function(){\n${bundle}\n})();`, { filename: 'bundle.js' });
} catch (e) {
  throw new Error(`連結後のバンドルが構文エラーです: ${e.message}`);
}

const html = readFileSync(join(SRC, 'index.html'), 'utf8')
  .replace('/*__BUNDLE__*/', () => `(function(){\n${bundle}\n})();`);

// 外部参照が混入していないことを検査（file:// で壊れる原因になる）
for (const [pattern, label] of [
  [/\bfetch\s*\(/, 'fetch()'],
  [/<script[^>]+\bsrc=/i, '外部スクリプト'],
  [/<link[^>]+stylesheet/i, '外部スタイルシート'],
  [/\bimport\s*\(/, '動的import'],
]) {
  if (pattern.test(html)) throw new Error(`配布物に ${label} が含まれています。file:// で動作しなくなります。`);
}

mkdirSync(DIST, { recursive: true });
const outPath = join(DIST, 'index.html');
writeFileSync(outPath, html, 'utf8');

const kb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(0);
console.log(`dist/index.html を生成しました (${kb} KB, ${devices.length} 型式, 外部依存なし)`);
