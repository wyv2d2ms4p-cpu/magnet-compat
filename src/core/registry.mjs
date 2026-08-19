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
 */
export function registerCategory(def) {
  if (!def.id || !def.label) throw new Error('カテゴリには id と label が必要です');
  if (categories.some((c) => c.id === def.id)) throw new Error(`カテゴリ重複: ${def.id}`);
  categories.push({ enrich: () => ({}), summary: () => [], detailPanels: () => [], emptyNote: () => '', specDefs: [], ...def });
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
 * （インバータの主スペックは定格出力電流だが、公式未取得のため全40件が未登録）。
 * specDefs の宣言順に見て、最初に値が割れたものを返す。
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

/** スペック値の表示。値が無ければ「―」（旧 ratedA:0 センチネルの置き換え） */
export function formatSpecValue(specDef, v) {
  if (!specDef || v == null) return '―';
  return specDef.format ? specDef.format(v) : `${v}${specDef.unit || ''}`;
}

/** デバイスのスペック値の表示。キーが無ければ「―」 */
export function formatSpec(specDef, device) {
  return formatSpecValue(specDef, specDef ? device.specs?.[specDef.key] : null);
}
