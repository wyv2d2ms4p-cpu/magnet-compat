/** 3アプリに重複していた汎用ユーティリティ。ここが唯一の実装。 */

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * 型式検索用の正規化は2段ある。用途を取り違えると容量を取り違える。
 *
 * - normLoose … 候補を「集める」ための綴り。空白・ハイフン・小数点を落とす。
 *   うろ覚えの入力（S-N10 を SN10、I-210.31 を I21031）を拾うために緩くする。
 * - normExact … 候補を「見分ける」ための綴り。小数点は残す。
 *
 * 小数点を落とすと FR-E820-1.5K-1（1.5kW）と FR-E820-15K-1（15kW）が同じ綴りに
 * なる。10倍の取り違えは誤発注に直結するので、識別に loose を使ってはいけない。
 * 逆に収集を exact にすると、ドットを省いた入力が引けなくなる（型式にドットを
 * 含むレコードは131件ある）うえ、「1.5K のつもりで打った綴り」が 15K と完全一致
 * してしまい、曖昧一致リストを経由せず黙って別容量を掴む。
 *
 * したがって collect は loose、identify は exact と役割を分ける。
 */
export function normLoose(s) {
  return (s || '').replace(/[\s\-.]/g, '').toLowerCase();
}

export function normExact(s) {
  return (s || '').replace(/[\s\-]/g, '').toLowerCase();
}

/** 外形寸法の差（マンハッタン距離, mm）。どちらか欠けていれば null。 */
export function dimDiff(a, b) {
  if (!a || !b) return null;
  return Math.abs(a.w - b.w) + Math.abs(a.h - b.h) + Math.abs(a.d - b.d);
}

/** 後継品の連鎖。循環は seen で止める。 */
export function successorChain(device, byId) {
  const chain = [];
  const seen = new Set([device.id]);
  let cur = device;
  while (cur.successorId) {
    const next = byId.get(cur.successorId);
    if (!next || seen.has(next.id)) break;
    chain.push(next);
    seen.add(next.id);
    cur = next;
  }
  return chain;
}

/**
 * 取付方式の語彙正規化。
 *
 * 移行元では同義語が併存していた（proximity のみ「ブラケット型」、他は「ブラケット取付」）。
 * 統合後は1アプリ内に同居するため、コア側で正規化する。
 */
const MOUNTING_SYNONYMS = {
  'ブラケット型': 'ブラケット取付',
};

export function normalizeMounting(v) {
  if (!v) return v;
  return MOUNTING_SYNONYMS[v] || v;
}

/**
 * 選択肢は固定配列ではなく実データから導出する。
 *
 * 移行元では固定配列と実データがずれており、index.html の「接触器直付」（サーマル47件）と
 * index_3.html の「ねじ込み型」（光電4件）が選択肢に無く、どのボタンも選択状態に
 * ならないうえ、押すと全候補の取付一致が false になる不具合があった。
 * 実データから導出すればこの種のずれは構造的に起きない。
 */
export function mountingOptions(devices) {
  const seen = [];
  for (const d of devices) {
    const m = normalizeMounting(d.mounting);
    if (m && !seen.includes(m)) seen.push(m);
  }
  return seen;
}

/** 数値を短く整形（12.0 → 12, 2.20 → 2.2） */
export function num(v) {
  if (v == null) return '';
  return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(3)));
}
