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

/** スペック値の表示。キーが無ければ「―」（旧 ratedA:0 センチネルの置き換え） */
export function formatSpec(specDef, device) {
  if (!specDef) return '―';
  const v = device.specs?.[specDef.key];
  if (v == null) return '―';
  return specDef.format ? specDef.format(v) : `${v}${specDef.unit || ''}`;
}
