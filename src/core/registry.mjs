/**
 * カテゴリレジストリ。
 *
 * カテゴリ追加は data/<id>.json と src/categories/<id>.mjs の2ファイル追加＋
 * ここへの登録だけで完結し、コアもHTMLも変更しない。
 */
const categories = [];

/**
 * @param {object} def
 *   id, label            … 識別子と表示名
 *   group                … 並び順のグルーピング。UIの階層には使わない
 *   specDefs             … カテゴリ固有スペックの宣言（単位・書式・距離関数）
 *   gate(a, m)           … a を m の候補に入れてよいか
 *   rank(a, b, m)        … 候補の並び順
 *   enrich(a, m)         … バッジ用の派生値（任意）
 *   summary(d)           … 確認画面のスペック欄（任意）
 *   detailPanels(m, c)   … カテゴリ固有の詳細比較（任意）
 *   emptyNote(m)         … 候補0件のときの説明（任意・HTML）
 *   primaryStanding(a, m)… 主スペックが基準より小さいか（任意）。既定は「判定しない」
 *   standingNote         … 大小の表示に添える1文（任意）。既定は量に依らない中立文
 */
export function registerCategory(def) {
  if (!def.id || !def.label) throw new Error('カテゴリには id と label が必要です');
  if (categories.some((c) => c.id === def.id)) throw new Error(`カテゴリ重複: ${def.id}`);
  categories.push({
    enrich: () => ({}), summary: () => [], detailPanels: () => [], emptyNote: () => '', specDefs: [],
    // 既定は「判定しない」。大小に意味があるかはカテゴリ固有の知識なので、
    // 宣言していないカテゴリでコアが勝手に大小を語らない（新カテゴリの既定も同じ）。
    primaryStanding: () => null,
    // 大小が何の話なのかもカテゴリ固有の知識。既定は空にしておき、
    // 用意し忘れたカテゴリには loadCheckNote が量に依らない中立文を当てる。
    // ここに電流の文を既定として置くと、宣言を忘れた瞬間に検出距離の画面へ
    // 「実際の負荷電流は…」が出る（実際に起きた）。
    standingNote: '',
    ...def,
  });
  return def;
}

/** 登録順＝表示順 */
export function allCategories() {
  return categories.slice();
}

export function getCategory(id) {
  return categories.find((c) => c.id === id);
}

/** そのカテゴリの主スペック（確認画面や候補カードの見出しに使う） */
export function primarySpec(category) {
  return category.specDefs.find((s) => s.primary) || category.specDefs[0] || null;
}

/**
 * 候補集合の中で値が割れているスペックを1つ選ぶ。
 *
 * 曖昧一致リストは「取り違えを防ぐため選んでください」と言う以上、見分ける材料を
 * 出さなければ意味がない。主スペック固定にすると、その値が未登録のカテゴリで
 * 全行が「―」になり、区別できるのが取り違えている型式文字列だけになる
 * （インバータは主スペックの定格出力電流が全40件で未登録だった時期があり、
 *   そのあいだ見分ける材料になれるのは適用モータ容量だけだった）。
 * specDefs の宣言順に見て、最初に値が割れたものを返す。宣言順は「見分けやすさ」を
 * 表すので、判定に使う主スペック（primary）が先頭とはかぎらない。インバータは
 * 判定を定格出力電流で行いつつ、識別材料には適用モータ容量を先に出す。
 *
 * 全スペックが同値なら null。呼び出し側は主スペックとメーカー表示に委ねる
 * （S-N10 / SN10 は容量が同じでメーカーが違う、という組がこれにあたる）。
 */
export function distinguishingSpec(category, devices) {
  if (!category || devices.length < 2) return null;
  for (const sd of category.specDefs) {
    const seen = new Set(devices.map((d) => JSON.stringify(d.specs?.[sd.key] ?? null)));
    if (seen.size > 1) return sd;
  }
  return null;
}

/**
 * 数値スペックを基準と比べて、候補が「基準より小さい」かどうかを返す。
 * `primaryStanding` を宣言するカテゴリのための共通部品。
 *
 * 返す値は4つで、**「判定できない」と「基準以上」を必ず別物として返す**。
 *   'below'     … 基準より小さい
 *   'atOrAbove' … 基準以上
 *   'unknown'   … 大小に意味はあるが、この組は値が無くて比較できない
 *   null        … そのカテゴリでは大小を判定しない（registerCategory の既定）
 *
 * 片方でも値が無いときに 'atOrAbove'（＝安全側に見える方）を返してはいけない。
 * 値の不在は README の「データの約束」どおりキーの不在で表されるため、`??` で
 * 0 を補って比較すると「0 は基準より小さくない」といった、根拠のない判定が
 * 静かに混ざる。旧機種インバータ30件は定格出力電流をキーごと持たないので、
 * この経路が実際に走る（`tools/test-compat.mjs` 検査2）。
 */
export function numericStanding(a, m, key) {
  const av = a.specs?.[key];
  const mv = m.specs?.[key];
  if (typeof av !== 'number' || typeof mv !== 'number') return 'unknown';
  return av < mv ? 'below' : 'atOrAbove';
}

/** スペック値の表示。値が無ければ「―」（旧 ratedA:0 センチネルの置き換え） */
export function formatSpecValue(specDef, v) {
  if (!specDef || v == null) return '―';
  return specDef.format ? specDef.format(v) : `${v}${specDef.unit || ''}`;
}

/** デバイスのスペック値の表示。キーが無ければ「―」 */
export function formatSpec(specDef, device) {
  return formatSpecValue(specDef, specDef ? device.specs?.[specDef.key] : null);
}
