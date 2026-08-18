/**
 * 3つの移行元HTMLから、生のデータオブジェクトを取り出す。
 *
 * いずれも <script> 内のJSリテラルなので、該当区間を node:vm で評価して取得する
 * （正規表現でのパースはしない）。HTMLファイル自体は読み取りのみで変更しない。
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** src の [開始マーカー, 終了マーカー) を切り出して評価し、コンテキストを返す */
function evalRegion(src, startMarker, endMarker, file) {
  const i = src.indexOf(startMarker);
  const j = src.indexOf(endMarker);
  if (i < 0) throw new Error(`${file}: 開始マーカーが見つかりません: ${startMarker}`);
  if (j < 0 || j <= i) throw new Error(`${file}: 終了マーカーが見つかりません: ${endMarker}`);
  const ctx = {};
  createContext(ctx);
  runInContext(src.slice(i, j), ctx);
  return ctx;
}

/** index.html → 電磁接触器・電磁開閉器・サーマルリレー 172件 + メーカー参照 11件 */
export function readMagnet() {
  const file = join(REPO_ROOT, 'index.html');
  const src = readFileSync(file, 'utf8');
  const ctx = evalRegion(src, 'var ALL_DEVICES', 'var MAKERS =', 'index.html');
  // MAKER_REFERENCE は MAKERS より後ろにあるため別途切り出す
  const refCtx = evalRegion(src, 'var MAKER_REFERENCE', '/* ================= ロジック', 'index.html');
  return { devices: ctx.ALL_DEVICES, makerReference: refCtx.MAKER_REFERENCE };
}

/** index_3.html → センサー 259件（既に純JSONなので JSON.parse でよい） */
export function readSensor() {
  const file = join(REPO_ROOT, 'index_3.html');
  const src = readFileSync(file, 'utf8');
  const marker = 'const DEVICES = ';
  const i = src.indexOf(marker);
  if (i < 0) throw new Error('index_3.html: const DEVICES が見つかりません');
  const j = src.indexOf('\n', i);
  const literal = src.slice(i + marker.length, j).replace(/;\s*$/, '');
  return { devices: JSON.parse(literal) };
}

/**
 * fa-compat.html → 生成データ 1440件 + 安川生産中止参照 27件
 *
 * buildInv/buildServo をここで一度だけ実行して結果を凍結する。
 * 1b 以降でこの生成器を呼ぶことはない。
 */
export function readFa() {
  const file = join(REPO_ROOT, 'fa-compat.html');
  const src = readFileSync(file, 'utf8');
  const ctx = evalRegion(src, 'function kw3', 'var TERMINAL_FUNCTIONS', 'fa-compat.html');
  return {
    inverterGenerated: [...ctx.GENERAL_DEVICES, ...ctx.VECTOR_DEVICES],
    servoGenerated: ctx.SV_CURRENT,
    servoDiscontinued: ctx.YASKAWA_DISC,
  };
}
