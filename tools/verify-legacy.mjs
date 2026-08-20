/**
 * data/legacy/*.tsv を検証する。
 *
 * legacy の TSV は「カタログから読み取った生の対応表」を人手で置く場所で、
 * data/*.json のようにスキーマで守られていない。どこからも読まれないまま
 * 内容が壊れていくのを防ぐため、規約だけを独立に検査する。1項目でも
 * 落ちたら非ゼロ終了。data/legacy と data/*.json は読み取りのみで変更しない。
 *
 *   node tools/verify-legacy.mjs
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './read-sources.mjs';

const DATA = join(REPO_ROOT, 'data');
const LEGACY = join(DATA, 'legacy');

/** ヘッダー行はこの13列と順序まで完全一致であること */
const HEADER = [
  'model', 'series', 'phaseIn', 'voltageIn', 'phaseOut', 'voltageOut',
  'motorKW', 'ratedCurrentA', 'capacityKVA', 'successors',
  'srcModel', 'srcSpec', 'note',
];

/**
 * 未取得は空文字で表す規約なので、埋め草として入りがちな値を単独セルとして禁止する。
 * 数値として意味のある 0 が入る列は現時点で存在しないため "0" もまとめて弾く。
 */
const PLACEHOLDERS = ['0', '-', '--', '不明', 'N/A', 'なし'];

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

// ---- 読み込み ------------------------------------------------------------

console.log('data/legacy 検証中...\n');

/**
 * TSV を行番号つきで読む。行番号はヘッダーを1行目とする実ファイル上の番号
 * （エラーが出たらそのままエディタで開ける番号にする）。
 * 末尾改行による空行だけは落とし、途中の空行は列数不足として検出させる。
 */
function readTsv(file) {
  const text = readFileSync(join(LEGACY, file), 'utf8');
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line, i) => ({ lineNo: i + 1, cols: line.split('\t') }));
}

const tsvFiles = existsSync(LEGACY)
  ? readdirSync(LEGACY).filter((f) => f.endsWith('.tsv')).sort()
  : [];

/** { file, lineNo, cols } のリスト。ヘッダー行は含めない */
const rows = [];
const parsed = new Map();
for (const f of tsvFiles) {
  const all = readTsv(f);
  parsed.set(f, all);
  for (const r of all.slice(1)) rows.push({ file: f, ...r });
}

/** 列数が正しい行だけ、列名でひけるようにする（列数不明の行は検査2で報告済み） */
const wellFormed = rows.filter((r) => r.cols.length === HEADER.length)
  .map((r) => ({ ...r, get: (key) => r.cols[HEADER.indexOf(key)].trim() }));

/** data/ 直下の JSON に載っている全型式 */
const jsonFiles = readdirSync(DATA).filter((f) => f.endsWith('.json')).sort();
const knownModels = new Set();
for (const f of jsonFiles) {
  const records = JSON.parse(readFileSync(join(DATA, f), 'utf8'));
  for (const r of records) if (r.model) knownModels.add(r.model);
}

// ---- 1. 検査対象が存在すること -------------------------------------------

/**
 * 対象が0件でも「全項目PASS」と出てしまうと、この検査を足した意味が消える。
 * 空振りしていないことを最初に固定する。
 */
check('data/legacy に .tsv が1つ以上ある', (fail) => {
  if (!existsSync(LEGACY)) fail('data/legacy ディレクトリが無い');
  else if (tsvFiles.length === 0) fail('data/legacy に .tsv が1つも無い');
});

// ---- 2. ヘッダー ---------------------------------------------------------

check(`ヘッダー行が規定の${HEADER.length}列と順序まで一致する`, (fail) => {
  for (const f of tsvFiles) {
    const header = parsed.get(f)[0];
    if (!header) { fail(`${f}: ファイルが空`); continue; }
    if (header.cols.join('\t') === HEADER.join('\t')) continue;
    fail(`${f}:1: ヘッダー不一致`);
    fail(`${f}:1:   期待 ${HEADER.join(', ')}`);
    fail(`${f}:1:   実際 ${header.cols.join(', ')}`);
  }
});

// ---- 3. 列数 -------------------------------------------------------------

check(`全行のフィールド数が${HEADER.length}である`, (fail) => {
  for (const f of tsvFiles) {
    for (const { lineNo, cols } of parsed.get(f)) {
      if (cols.length !== HEADER.length) {
        fail(`${f}:${lineNo}: フィールド数 ${cols.length}（期待 ${HEADER.length}）`);
      }
    }
  }
});

// ---- 4. model の重複 -----------------------------------------------------

/** legacy 全体で型式は一意。同じ型式が2箇所にあると、どちらが正か決められない */
check('model 列に重複が無い', (fail) => {
  const seen = new Map();
  for (const r of wellFormed) {
    const model = r.get('model');
    if (!model) continue; // 空は検査5で報告する
    const where = `${r.file}:${r.lineNo}`;
    if (seen.has(model)) fail(`${where}: model "${model}" が ${seen.get(model)} と重複`);
    else seen.set(model, where);
  }
});

// ---- 5. 必須列 -----------------------------------------------------------

check('model / series / srcModel が空でない', (fail) => {
  for (const r of wellFormed) {
    for (const key of ['model', 'series', 'srcModel']) {
      if (r.get(key) === '') fail(`${r.file}:${r.lineNo}: ${key} が空`);
    }
  }
});

// ---- 6. successors の実在 ------------------------------------------------

/**
 * 後継型式は data/*.json に実在する型式でなければ、アプリ側で辿れない
 * 行き止まりになる。空（＝後継未取得）は許す。
 */
check('successors が data/ 直下の JSON に実在する型式である', (fail) => {
  for (const r of wellFormed) {
    const raw = r.get('successors');
    if (raw === '') continue;
    for (const model of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!knownModels.has(model)) {
        fail(`${r.file}:${r.lineNo}: successors "${model}" が data/*.json に存在しない`
          + `（model=${r.get('model')}）`);
      }
    }
  }
});

// ---- 7. 埋め草の禁止 -----------------------------------------------------

check(`未取得を表す埋め草（${PLACEHOLDERS.join(' / ')}）がどの列にも入っていない`, (fail) => {
  for (const r of wellFormed) {
    for (const key of HEADER) {
      const v = r.get(key);
      if (PLACEHOLDERS.includes(v)) {
        fail(`${r.file}:${r.lineNo}: ${key} が "${v}"（未取得は空文字で表す規約）`);
      }
    }
  }
});

// ---- 結果 ----------------------------------------------------------------

console.log('');
if (failures.length) {
  console.error(`legacy 検証失敗: ${failures.length} / ${checkNo} 項目が NG`);
  process.exit(1);
}
console.log(`legacy 検証成功: ${checkNo} / ${checkNo} 項目すべて PASS`);
console.log(`  ${tsvFiles.length} ファイル / ${rows.length} 行 … ${tsvFiles.join(', ')}`);
console.log(`  照合先 data/*.json ${jsonFiles.length} ファイル ${knownModels.size} 型式`);
