/**
 * data/legacy/*.tsv を検証する。
 *
 * legacy の TSV は「カタログから読み取った生の対応表」を人手で置く場所で、
 * data/*.json のようにスキーマで守られていない。どこからも読まれないまま
 * 内容が壊れていくのを防ぐため、規約だけを独立に検査する（検査1〜7）。
 *
 * さらに、同じ情報が TSV と data/inverter.json の旧機種30件の2箇所にある。
 * 片方だけ更新されても画面は動いてしまうので、TSV を単一の情報源として
 * JSON 側を機械照合する（検査8〜13）。TSV の綴りが資料どおりであることは
 * 人が資料と見比べて担保し、そこから先の写し崩れはこの検査が止める。
 *
 * 1項目でも落ちたら非ゼロ終了。data/legacy と data/*.json は読み取りのみで変更しない。
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

/**
 * 突合相手。TSV は資料 BCN-C21002-214C p.2 の対応表を写した原文台帳で、
 * data/inverter.json の旧機種はそこから起こした表示用データ。同じ情報が2箇所にある。
 * TSV を単一の情報源として、JSON 側が写し崩れていないことを以下の検査8〜13で見る。
 */
const inverterRecords = JSON.parse(readFileSync(join(DATA, 'inverter.json'), 'utf8'));
const inverterById = new Map(inverterRecords.map((r) => [r.id, r]));
const legacyRecords = inverterRecords.filter((r) => r.discontinued === true);
const legacyByModel = new Map(legacyRecords.map((r) => [r.model, r]));

/** TSV の note 列から置換えに必要な型式を取り出す。data/inverter.json への分離時と同じ書式 */
const REPLACEMENT_NOTE_RE = /^置換えに\s+(\S+)\s+が必要$/;

/** 行と JSON レコードが両方そろった組だけ。片方しか無いものは検査9が報告する */
const paired = wellFormed
  .map((r) => ({ row: r, rec: legacyByModel.get(r.get('model')) }))
  .filter((p) => p.rec);

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

// ---- 8. 件数 -------------------------------------------------------------

/**
 * TSV の行数と、JSON 側の旧機種（discontinued）件数が合っていること。
 *
 * 片方だけ追加・削除されたときに真っ先に出るのがこの検査。以降の 9〜13 は
 * 「同じ型式どうしの中身」を見るので、件数のずれはここでしか捕まらない。
 */
check(`TSV の行数と data/inverter.json の旧機種件数が一致する（TSV ${wellFormed.length} 行）`, (fail) => {
  if (wellFormed.length !== legacyRecords.length) {
    fail(`TSV ${wellFormed.length} 行 ≠ data/inverter.json の discontinued ${legacyRecords.length} 件`);
  }
});

// ---- 9. model の1対1 -----------------------------------------------------

check('TSV の型式と JSON の旧機種が過不足なく1対1で対応する', (fail) => {
  const tsvModels = new Set(wellFormed.map((r) => r.get('model')));
  for (const r of wellFormed) {
    if (!legacyByModel.has(r.get('model'))) {
      fail(`${r.file}:${r.lineNo}: "${r.get('model')}" が data/inverter.json に無い`
        + '（または discontinued が付いていない）');
    }
  }
  for (const rec of legacyRecords) {
    if (!tsvModels.has(rec.model)) {
      fail(`data/inverter.json ${rec.id} "${rec.model}" が data/legacy の TSV に無い`);
    }
  }
});

// ---- 10. 適用モータ容量 --------------------------------------------------

check('motorKW と specs.ratedPowerKW が一致する', (fail) => {
  for (const { row, rec } of paired) {
    const tsv = row.get('motorKW');
    const json = rec.specs?.ratedPowerKW;
    if (tsv === '') { fail(`${row.file}:${row.lineNo}: ${rec.model}: motorKW が空`); continue; }
    if (Number(tsv) !== json) {
      fail(`${rec.model}: motorKW=${tsv} ≠ specs.ratedPowerKW=${JSON.stringify(json)}`);
    }
  }
});

// ---- 11. 電源相数・電圧 --------------------------------------------------

/**
 * TSV は相数と電圧を数値2列で持ち、JSON は表示用の文字列（"3相200V"）と
 * 判定用の数値（voltClass）に分けて持つ。綴り方が違うだけで出所は同じ列なので、
 * TSV 側から JSON の表記を組み立てて突き合わせる。
 */
check('phaseIn / voltageIn と specs.voltage / specs.voltClass が一致する', (fail) => {
  const PHASE = { '1': '単相', '3': '3相' };
  for (const { row, rec } of paired) {
    const phaseIn = row.get('phaseIn');
    const voltageIn = row.get('voltageIn');
    const phase = PHASE[phaseIn];
    if (!phase) {
      fail(`${row.file}:${row.lineNo}: ${rec.model}: phaseIn="${phaseIn}" は 1 か 3 のいずれかであること`);
      continue;
    }
    const want = `${phase}${voltageIn}V`;
    if (rec.specs?.voltage !== want) {
      fail(`${rec.model}: phaseIn=${phaseIn} voltageIn=${voltageIn} → "${want}"`
        + ` ≠ specs.voltage=${JSON.stringify(rec.specs?.voltage)}`);
    }
    if (rec.specs?.voltClass !== Number(voltageIn)) {
      fail(`${rec.model}: voltageIn=${voltageIn} ≠ specs.voltClass=${JSON.stringify(rec.specs?.voltClass)}`);
    }
  }
});

// ---- 12. 後継型式 --------------------------------------------------------

/**
 * TSV は後継を型式名で、JSON は successorId（レコードID）で持つ。
 * ID を解決して型式名に戻し、資料の対応表と同じ相手を指していることを見る。
 * 型式名が同じでも別レコードを指していれば、画面には違う機種が出る。
 */
check('successors と successorId が指すレコードの model が一致する', (fail) => {
  for (const { row, rec } of paired) {
    const tsv = row.get('successors');
    const succ = rec.successorId ? inverterById.get(rec.successorId) : null;
    if (tsv === '') {
      if (rec.successorId) fail(`${rec.model}: TSV の successors が空なのに successorId=${rec.successorId} がある`);
      continue;
    }
    if (!rec.successorId) { fail(`${rec.model}: TSV は successors="${tsv}" だが successorId が無い`); continue; }
    if (!succ) { fail(`${rec.model}: successorId=${rec.successorId} が data/inverter.json に無い`); continue; }
    if (succ.model !== tsv) {
      fail(`${rec.model}: successors="${tsv}" ≠ successorId=${rec.successorId} の model="${succ.model}"`);
    }
  }
});

// ---- 13. 置換えの条件 ----------------------------------------------------

/**
 * TSV は「置換えに FR-E8AT03 が必要」という1文、JSON は { partType, partModel } の構造。
 * 形式が違うので TSV 側を解析して型式を取り出し、partModel と突き合わせる。
 *
 * partType（"取付互換アタッチメント"）は TSV に無い値で、同資料 p.26「４．オプション」の
 * 名称欄から起こしたもの。TSV を情報源にできないため、ここでは突合しない
 * （partType の規約は tools/verify-data.mjs の replacementNote 検査が見る）。
 */
check('TSV の note 列と replacementNote が一致する', (fail) => {
  let tsvNotes = 0;
  for (const { row, rec } of paired) {
    const note = row.get('note');
    const rn = rec.replacementNote;
    if (note === '') {
      if (rn) fail(`${rec.model}: TSV の note が空なのに replacementNote=${JSON.stringify(rn)} がある`);
      continue;
    }
    tsvNotes++;
    const m = REPLACEMENT_NOTE_RE.exec(note);
    if (!m) {
      // 読み飛ばすと「解析できないから一致とみなす」になる。書式違いはここで落とす
      fail(`${row.file}:${row.lineNo}: ${rec.model}: note="${note}" が「置換えに ○○ が必要」の書式でない`);
      continue;
    }
    if (!rn) { fail(`${rec.model}: TSV は note="${note}" だが replacementNote が無い`); continue; }
    if (rn.partModel !== m[1]) {
      fail(`${rec.model}: note の型式 "${m[1]}" ≠ replacementNote.partModel="${rn.partModel}"`);
    }
  }
  // 片方だけ増減する事故は、対応する行が無いと上のループでは見えない
  const jsonNotes = legacyRecords.filter((r) => r.replacementNote).length;
  if (tsvNotes !== jsonNotes) {
    fail(`note 列が非空の TSV 行 ${tsvNotes} 件 ≠ replacementNote を持つレコード ${jsonNotes} 件`);
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
