/**
 * 絶縁変換器の信号の分類表。別メーカー品を比べる（`classMatch` の段）ためだけに使う。
 *
 * 中身は `docs/design-insulation-converter.md` 12章の表をそのまま写したもので、各行の `src` が
 * その表の行 ID を指す。表の形と検査は `docs/design-common-alternates.md` 3-1・3-3。
 *
 * **`specs` の信号名（綴り）は変えない。** 綴りを寄せると `gate` がそのまま一致させ、
 * 別メーカー品が「判定条件がすべて一致」の段に入る（同 3-1。案A'' の実測で候補の辺 81本 → 83本）。
 * 綴りはそのままにして、比べるときだけこの表で分類に引き直す。
 *
 * **表に無い綴りを「一致」にも「不一致」にも倒さない。** `signalRowOf` は例外で止め、
 * `tools/verify-data.mjs` の「絶縁変換器の信号名 … 表に無い綴り 0」がビルド前に落とす
 * （CLAUDE.md「解析できないから一致とみなす」経路を作らない）。
 *
 * `src/categories/` に置くのは、`build.mjs` がこのディレクトリのモジュールを自動で拾うため。
 * `data/reference/` に置くと `build.mjs` を直すことになる（同 3-1）。カテゴリの登録はしない。
 */

/**
 * 分類名の閉じた一覧（12-3。入力18・出力10の28個）。表の行はこの一覧の名前しか使えない。
 * 一覧を別に持つのは、行の分類名の綴り間違いが「どれとも重ならない新しい分類」として
 * 黙って通り、候補が静かに消えるのを検査で落とすため（3-3 の検査4）。
 */
export const SIGNAL_CLASS_NAMES = {
  input: [
    '直流電圧入力 0〜10V', '直流電圧入力 0〜5V', '直流電圧入力 1〜5V', '直流電圧入力 0〜60mV',
    '直流電圧入力 ±10V', '直流電圧入力 ±5V', '直流電圧入力 ±1V', '直流電圧入力 ±100mV', '直流電圧入力 ±50mV',
    '直流電流入力 4〜20mA', '直流電流入力 0〜1mA',
    '抵抗入力 0〜500Ω', '抵抗入力 0〜1kΩ', '抵抗入力 0〜2kΩ',
    '電圧パルス入力', '接点・オープンコレクタ入力', '接点入力（検出 5V／10mA）', 'ラインドライバ入力',
  ],
  output: [
    '直流電圧出力 0〜10V', '直流電圧出力 0〜5V', '直流電圧出力 1〜5V', '直流電圧出力 ±10V',
    '直流電流出力 4〜20mA',
    '12V電圧パルス出力', '10V電圧パルス出力', '5V電圧パルス出力', 'オープンコレクタ出力', 'ラインドライバ出力',
  ],
};

/**
 * 分類表（12-4・12-5 の30行）。1行は「入力か出力か」と「綴り」の組。
 *
 * 出力は `outputSignal`・`output1Signal`・`output2Signal` を1つの欄として扱う（12-2）。
 * 「出力ごとに1台」のとき各台のどちらの出力を使ってもよい（D16）ので、第1出力と第2出力で
 * 別の表を持つと比べ方が書けない。
 *
 * `mode` の `selectable` は、1台がスイッチで複数の分類のどれか1つに設定されるもの（3-4）。
 *
 * `highV` は電圧パルス入力の2行だけが持つ「H と見る電圧の範囲」（12-6 の決定1）。
 * 同じ分類にした2社の入力で H の範囲が違い、その違いを向きのある確認項目で出すための値で、
 * 出典は同じ行（IN-15 は WGP-FZ の資料、IN-18 は MS3749 の **Rev.1.90**。登録済みの出典 Rev.2.10 では
 * 確かめていない。12-10 の1）。`data/` に持たないのは、綴り（型式コードの1欄）で決まる資料の値で、
 * レコードごとに変わらないため。
 */
export const SIGNAL_CLASS_ROWS = [
  { src: 'IN-01', field: 'input', spelling: 'DC0～10V', classes: ['直流電圧入力 0〜10V'], mode: 'single' },
  { src: 'IN-02', field: 'input', spelling: 'DC0～5V', classes: ['直流電圧入力 0〜5V'], mode: 'single' },
  { src: 'IN-03', field: 'input', spelling: 'DC1～5V', classes: ['直流電圧入力 1〜5V'], mode: 'single' },
  { src: 'IN-04', field: 'input', spelling: 'DC0～60mV', classes: ['直流電圧入力 0〜60mV'], mode: 'single' },
  { src: 'IN-05', field: 'input', spelling: 'DC±10V', classes: ['直流電圧入力 ±10V'], mode: 'single' },
  { src: 'IN-06', field: 'input', spelling: 'DC±5V', classes: ['直流電圧入力 ±5V'], mode: 'single' },
  { src: 'IN-07', field: 'input', spelling: 'DC±1V', classes: ['直流電圧入力 ±1V'], mode: 'single' },
  { src: 'IN-08', field: 'input', spelling: 'DC±100mV', classes: ['直流電圧入力 ±100mV'], mode: 'single' },
  { src: 'IN-09', field: 'input', spelling: 'DC±50mV', classes: ['直流電圧入力 ±50mV'], mode: 'single' },
  { src: 'IN-10', field: 'input', spelling: 'DC4～20mA', classes: ['直流電流入力 4〜20mA'], mode: 'single' },
  { src: 'IN-11', field: 'input', spelling: 'DC0～1mA', classes: ['直流電流入力 0〜1mA'], mode: 'single' },
  { src: 'IN-12', field: 'input', spelling: 'ポテンショメータ 0～500Ω', classes: ['抵抗入力 0〜500Ω'], mode: 'single' },
  { src: 'IN-13', field: 'input', spelling: 'ポテンショメータ 0～1kΩ', classes: ['抵抗入力 0〜1kΩ'], mode: 'single' },
  { src: 'IN-14', field: 'input', spelling: 'ポテンショメータ 0～2kΩ', classes: ['抵抗入力 0〜2kΩ'], mode: 'single' },
  // D1（入力 14 は確認できるまで接点入力を含まない）で single。FV の ON-OFF パルスは表に現れない（12-4 の注1）
  { src: 'IN-15', field: 'input', spelling: '電圧パルス（大信号レベル）', classes: ['電圧パルス入力'], mode: 'single',
    highV: { min: 5, max: 30, text: '5V以上30V以下' } },
  { src: 'IN-16', field: 'input', spelling: '無電圧接点・オープンコレクタ', classes: ['接点・オープンコレクタ入力'], mode: 'single' },
  { src: 'IN-17', field: 'input', spelling: 'ラインドライバ・パルス', classes: ['ラインドライバ入力'], mode: 'single' },
  { src: 'IN-18', field: 'input', spelling: 'DC電圧パルス', classes: ['電圧パルス入力'], mode: 'single',
    highV: { min: 2, max: 50, text: '約2V以上50V以下（資料 Rev.1.90 の値）' } },
  { src: 'IN-19', field: 'input', spelling: '無電圧スイッチ', classes: ['接点入力（検出 5V／10mA）'], mode: 'single' },
  { src: 'OUT-01', field: 'output', spelling: 'DC0～10V', classes: ['直流電圧出力 0〜10V'], mode: 'single' },
  { src: 'OUT-02', field: 'output', spelling: 'DC0～5V', classes: ['直流電圧出力 0〜5V'], mode: 'single' },
  { src: 'OUT-03', field: 'output', spelling: 'DC1～5V', classes: ['直流電圧出力 1〜5V'], mode: 'single' },
  { src: 'OUT-04', field: 'output', spelling: 'DC±10V', classes: ['直流電圧出力 ±10V'], mode: 'single' },
  { src: 'OUT-05', field: 'output', spelling: 'DC4～20mA', classes: ['直流電流出力 4〜20mA'], mode: 'single' },
  { src: 'OUT-06', field: 'output', spelling: '電圧パルス12V', classes: ['12V電圧パルス出力'], mode: 'single' },
  { src: 'OUT-07', field: 'output', spelling: '電圧パルス10V', classes: ['10V電圧パルス出力'], mode: 'single' },
  { src: 'OUT-08', field: 'output', spelling: 'オープンコレクタ', classes: ['オープンコレクタ出力'], mode: 'single' },
  { src: 'OUT-09', field: 'output', spelling: 'ラインドライバ・パルス', classes: ['ラインドライバ出力'], mode: 'single' },
  { src: 'OUT-10', field: 'output', spelling: '電圧パルス／オープンコレクタ（ディップスイッチ選択）',
    classes: ['5V電圧パルス出力', '12V電圧パルス出力', 'オープンコレクタ出力'], mode: 'selectable' },
  { src: 'OUT-11', field: 'output', spelling: '12V電圧パルス', classes: ['12V電圧パルス出力'], mode: 'single' },
];

/** `specs` のキーから表の欄へ。出力の3つのキーは1つの欄（12-2） */
export const SIGNAL_FIELD_OF_KEY = {
  inputSignal: 'input', outputSignal: 'output', output1Signal: 'output', output2Signal: 'output',
};

/**
 * 綴りの行を引く。表に無ければ例外で止める（冒頭の「表に無い綴りを倒さない」）。
 * 表に同じ欄・同じ綴りの行が2つあっても止める。どちらを採ったかで分類が変わるため。
 */
export function signalRowOf(field, spelling) {
  const hits = SIGNAL_CLASS_ROWS.filter((r) => r.field === field && r.spelling === spelling);
  if (hits.length !== 1) {
    throw new Error(`絶縁変換器の分類表: ${field} の綴り ${JSON.stringify(spelling)} の行が ${hits.length} 行あります（1行であること）`);
  }
  return hits[0];
}
