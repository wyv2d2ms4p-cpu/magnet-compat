/**
 * 移行仕様（宣言）。
 *
 * extract.mjs と verify-data.mjs は、このファイルを「唯一の仕様」として
 * それぞれ独立に実装する。extract は仕様に従って変換し、verify は仕様に従って
 * 移行元と移行先を突合する。両者が同じ変換コードを共有しないことで、
 * 変換バグを検証側が検出できるようにしている。
 */

/** 移行元キー → 移行先トップレベルキー（値は無変換） */
export const TOP_LEVEL = {
  id: 'id',
  maker: 'maker',
  model: 'model',
  category: 'category',
  capacityClass: 'compatKey',
  dims: 'dims',
  holes: 'holes',
  mounting: 'mounting',
  discontinued: 'discontinued',
  makerExited: 'makerExited',
  successorId: 'successorId',
  note: 'note',
  series: 'series',
};

/** 移行元キー → specs.* のキー（カテゴリ別、値は無変換） */
export const SPEC_MAP = {
  contactor: { ratedA: 'ratedCurrentA', ratedKW: 'ratedPowerKW', coil: 'coil', aux: 'aux', widthMM: 'widthMM' },
  starter:   { ratedA: 'ratedCurrentA', ratedKW: 'ratedPowerKW', coil: 'coil', aux: 'aux', widthMM: 'widthMM' },
  thermal:   { protect: 'protect', mountsOn: 'mountsOn', standalone: 'standalone', coil: 'coil', aux: 'aux' },

  proximity:  { ratedA: 'sensingDistanceMM', threadSize: 'threadSize', voltage: 'voltage', outputSpec: 'outputSpec', tempMax: 'tempMaxC', cableColors: 'cableColors', compatGroup: 'compatGroup' },
  photo:      { ratedA: 'sensingDistanceMM', threadSize: 'threadSize', voltage: 'voltage', outputSpec: 'outputSpec', tempMax: 'tempMaxC', cableColors: 'cableColors', compatGroup: 'compatGroup', detectMethod: 'detectMethod' },
  ultrasonic: { ratedA: 'sensingDistanceMM', threadSize: 'threadSize', voltage: 'voltage', outputSpec: 'outputSpec', tempMax: 'tempMaxC', cableColors: 'cableColors', compatGroup: 'compatGroup', detectMethod: 'detectMethod' },
  // special の ratedA は下記 SPECIAL_DISTANCE_KEY で動的に決まる
  special:    { threadSize: 'threadSize', voltage: 'voltage', outputSpec: 'outputSpec', tempMax: 'tempMaxC', cableColors: 'cableColors', compatGroup: 'compatGroup', detectMethod: 'detectMethod' },

  inverter: { ratedA: 'ratedCurrentA', ratedKW: 'ratedPowerKW', voltage: 'voltage', voltClass: 'voltClass', brand: 'brand', controlTerminals: 'controlTerminals', parameters: 'parameters', controlModes: 'controlModes', vclass: 'vclass', pgOption: 'pgOption', pgFeedback: 'pgFeedback' },
  servo:    { ratedW: 'ratedPowerW', voltage: 'voltage', voltClass: 'voltClass', brand: 'brand', iface: 'iface', ikey: 'ikey', motor: 'motor', encoder: 'encoder', io: 'io' },
};

/**
 * thermal の rangeMin/rangeMax は specs.setRangeA:{min,max} へ集約する。
 * 1対1でないため SPEC_MAP と分けて宣言する。
 */
export const THERMAL_RANGE = { from: ['rangeMin', 'rangeMax'], to: 'setRangeA' };

/**
 * special カテゴリの ratedA は detectMethod によって意味が変わる。
 * LLK(導光路) のみ長さを持ち、それ以外は ratedA:0（＝該当なし）でキーを持たない。
 */
export const SPECIAL_LLK_METHOD = 'LLK(導光路/ライトガイド)';
export const SPECIAL_DISTANCE_KEY = 'lightGuideLengthMM';

/**
 * 生成データのID名前空間化。
 *
 * fa-compat.html の makeId(key, volt, kw) は系列キー・電圧・容量しか見ないため、
 * 同じ系列キーが INV_SERIES と VEC_SERIES の両方に登録されている FR-A800 系で
 * IDが衝突する（40件）。元アプリでは GENERAL_DEVICES と VECTOR_DEVICES が
 * 別配列で同時に表示されないため露見していなかったが、1つの名前空間に統合すると
 * 衝突する。
 *
 * 元コードが capacityClass に対して既に使っている INV / VINV / SV の接頭辞を
 * IDにも適用して解決する（新しい規則を発明しない）。
 * model（実際の型式名）は一切変更しない。
 */
export function generatedId(rawId, capacityClass) {
  const prefix = String(capacityClass || '').split('-')[0];
  if (!prefix) throw new Error(`capacityClass から接頭辞を導出できません: ${rawId}`);
  return `${prefix}_${rawId}`;
}

/** evidence の状態を導出する元になるキー（specs へは移さない） */
export const EVIDENCE_SOURCE_KEYS = [
  'unverified', 'dimVerified', 'specVerified', 'rangeVerified', 'verified', 'anchor',
];

/**
 * 意図的に破棄するキーと、その理由。
 * verify-data.mjs は「移行元の全キーが TOP_LEVEL / SPEC_MAP / THERMAL_RANGE /
 * EVIDENCE_SOURCE_KEYS / DROPPED のいずれかに属すること」を検査する。
 * 未知のキーが1つでもあれば失敗する（将来データが増えた際の取りこぼし検出）。
 */
export const DROPPED = {
  anchor: 'シリーズ単位の継承バッジ。レコード単位の evidence に置換するため破棄',
  ratedLabel: 'ratedW から導出可能な表示用文字列',
  discRef: '参照専用行を示すフラグ。参照データを別ファイルに分離したため不要',
};

/** evidence の状態は3値。キー欠落時は unverified（安全側）とみなす。 */
export const EVIDENCE_STATES = ['verified', 'estimated', 'unverified'];
export const EVIDENCE_ASPECTS = ['model', 'dims', 'specs'];

/**
 * evidence 状態の導出規則。上から順に最初に一致したものを採用する。
 * extract.mjs / verify-data.mjs はこの規則をそれぞれ実装する。
 *
 *  dims :  dimVerified===true → verified
 *          dimVerified===false → estimated
 *          その他 → unverified
 *  specs:  rangeVerified===false → estimated
 *          specVerified===true → verified
 *          その他 → unverified
 *  model:  常に verified（人手でカタログから起こした実データのため）
 *
 * index_3.html は record 全体の verified しか持たないため、
 * true → 3側面すべて verified / false → 3側面すべて estimated と展開する。
 * fa-compat.html の生成データは3側面すべて unverified。
 */

/** modelStatus の2値 */
export const MODEL_STATUS = { CONFIRMED: 'catalog-confirmed', PROVISIONAL: 'provisional' };

/** 期待される件数（移行元を node:vm で評価して確定させた実測値） */
export const EXPECTED_COUNTS = {
  contactor: 95, starter: 29, thermal: 48,
  proximity: 123, photo: 118, ultrasonic: 6, special: 12,
  inverter: 0, servo: 27,
  _seed_inverter: 904, _seed_servo: 536,
  reference_makers: 10,
};

/**
 * 安川電機のサーボ生産中止一覧（fa-compat.html の `YASKAWA_DISC` 27行）。
 *
 * 1a ではこれを data/reference/servo-discontinued.json に「参照情報」として置いた。
 * だが参照情報を描画する経路はどこにも無く、配布物に埋め込まれたまま画面には
 * 一度も出ていなかった（サーボが0件表示になっていた原因）。生成物1440件と違って
 * この27行はメーカー公表の実データなので、サーボカテゴリのレコードとして扱う。
 *
 * 1行が `SGDM / SGDH / SGDP` や `CACR-SR□□BB/BC/BD` のようなワイルドカード付きの
 * シリーズ単位マスクである点は変わらないため、`modelScope:"series"` で明示する。
 * 個別の発注可能型式ではないことをUIが表示し、互換判定にも入れない。
 *
 * `catalog-confirmed` にするのは、生成物ではなくメーカー公表値を人手で起こした
 * データだからで、既存431件と同じ扱い（出典URLの付与はフェーズ3の対象）。
 */
export const DISCONTINUED_SERIES = {
  category: 'servo',
  maker: '安川電機',
  modelScope: 'series',

  /** 移行元キー → 移行先トップレベルキー（値は無変換） */
  TOP_LEVEL: { models: 'model', name: 'series' },

  /** 移行元キー → specs.* のキー（値は無変換） */
  SPEC_MAP: { stop: 'discontinuedAt', parts: 'partsOrderUntil', repair: 'repairUntil', alt: 'altSeries' },

  /** 「値が無い」を表す表記。キーごと落とす（0番兵と同じ考え方） */
  ABSENT: ['-', 'なし', ''],

  /** 意図的に破棄するキーと理由 */
  DROPPED: {
    altKey: '代替シリーズの内部キー。指す先のレコードが data/ に存在しないため、表示名(alt)だけを残す',
  },

  /** 3側面の evidence。寸法は移行元に無いので unverified */
  EVIDENCE: { model: 'verified', dims: 'unverified', specs: 'verified' },

  /** 出典の注記（URLはフェーズ3で付与する） */
  SRC_NOTE: '安川電機 サーボ生産中止機種一覧',
};

/**
 * 生産中止シリーズのID。
 *
 * 先頭の型式トークン（`□△` などのワイルドカードと記号を除いた英数字）＋生産中止年。
 * これだけでは `Σシリーズ SGDB-□□AD/VD/DD/AN/AM` と
 * `大容量Σシリーズ(22kW以上) SGDB-□□AD / DD` が同じ 2008 年で衝突するため、
 * 衝突時は入力順に連番を足す。入力は移行元HTMLの配列なので順序は決定的。
 */
export function discontinuedSeriesIds(rows) {
  const taken = new Set();
  return rows.map((row) => {
    const head = String(row.models).split(/[\s/]/)[0];
    const token = head.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const year = String(row.stop).split('.')[0];
    if (!token || !/^\d{4}$/.test(year)) throw new Error(`IDを導出できません: ${JSON.stringify(row)}`);
    const base = `SVD_${token}_${year}`;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
    taken.add(id);
    return id;
  });
}
