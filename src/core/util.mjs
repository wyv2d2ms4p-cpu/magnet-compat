/** 3アプリに重複していた汎用ユーティリティ。ここが唯一の実装。 */

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * 型式検索用の正規化は2段ある。用途を取り違えると容量を取り違える。
 *
 * - normLoose … 候補を「集める」ための綴り。空白・ハイフン・小数点を落とし、
 *   O（英字）を 0（数字）に寄せる。うろ覚えや読み違いの入力
 *   （S-N10 を SN10、I-210.31 を I21031、MS3749-A-O25 を MS3749-A-025）を
 *   拾うために緩くする。
 * - normExact … 候補を「見分ける」ための綴り。小数点は残す。
 *
 * 小数点を落とすと FR-E820-1.5K-1（1.5kW）と FR-E820-15K-1（15kW）が同じ綴りに
 * なる。10倍の取り違えは誤発注に直結するので、識別に loose を使ってはいけない。
 * 逆に収集を exact にすると、ドットを省いた入力が引けなくなる（型式にドットを
 * 含むレコードは131件ある）うえ、「1.5K のつもりで打った綴り」が 15K と完全一致
 * してしまい、曖昧一致リストを経由せず黙って別容量を掴む。
 *
 * したがって collect は loose、identify は exact と役割を分ける。
 *
 * ## O（英字）と 0（数字）を同一視するのは loose だけ
 *
 * 絶縁変換器の MS3749-A-O25 は3セグメント目の1桁目が英字 O で、現場が銘板を見て
 * MS3749-A-025 とゼロで打つと完全一致・部分一致とも0件になり、サジェストも消える。
 * これは「値そのものの違い」ではなく**印字を読み取るときの曖昧さ**なので、
 * 候補を集める loose 側だけを緩める。1.5K と 15K は打った人が別の容量を意図して
 * いるが、O と 0 は同じ1文字を指していて、どちらを打ったかに意味が無い。
 *
 * normExact には入れない。exact は曖昧一致リストに並んだ候補を「見分ける」ため
 * のもので、ここまで寄せると MS3749-A-O25 と（もし将来 025 の型式が入れば）
 * その両方が入力と完全一致になり、「入力と完全一致」バッジが選別の役に立たなく
 * なる。緩めるのは集めるほうだけ、という上の役割分担をそのまま守る。
 *
 * 寄せ先は数字の 0。0 には大文字小文字が無いので、`[oO]` からの置換は
 * toLowerCase の前後どちらで実行しても結果が同じになる。逆向き（0 → o）に
 * すると英字側の case 畳み込みが toLowerCase 頼みになり、将来この関数の
 * 処理順を入れ替えたときに黙って挙動が変わる。
 *
 * **対象は O と 0 だけ。** I と 1、B と 8 も字形は似ているが、現場で取り違えた
 * 事例が無いため依頼者の判断で対象外にしている。同一視は候補を増やす操作なので、
 * 実例が無いまま広げると衝突（同じ綴りに読める型式）だけが増える。
 * 増やすときは、実際の誤打鍵の事例と、衝突が増えないことの確認をそろえること。
 */
export function normLoose(s) {
  return (s || '').replace(/[\s\-.]/g, '').replace(/[oO]/g, '0').toLowerCase();
}

export function normExact(s) {
  return (s || '').replace(/[\s\-]/g, '').toLowerCase();
}

/** 外形寸法の差（マンハッタン距離, mm）。どちらか欠けていれば null。 */
export function dimDiff(a, b) {
  if (!a || !b) return null;
  return Math.abs(a.w - b.w) + Math.abs(a.h - b.h) + Math.abs(a.d - b.d);
}

/**
 * 寸法の差の頭に添える、差をどちらから見たかの語（依頼者の決定 2026-09-27）。
 *
 * 「高さ +19mm」だけでは、候補が大きいのか今の機器が大きいのかを画面から読み取れなかった
 * （依頼者が実機の iPhone で確認）。`dimDeltaText` の中には入れず、右上とやることの2か所が
 * この定数を前に置く。右上は1方向1行の頭に独立した行として出したいので、文字列に混ぜると分けられない。
 * 2か所が同じ定数を使うので、片方だけ語が変わることはない。
 */
export const DIM_DELTA_LEAD = '今の機器より';

/**
 * 方向ごとの寸法の差（候補 c − 基準 b。候補のほうが大きければ ＋）。どちらか欠けていれば null。
 *
 * `dimDiff` の和では、どの方向がどれだけ違うかも、候補が大きいのか小さいのかも読めない（設計 1-7）。
 * 下の段のやることの文（取付スペース）と、全カテゴリの候補カード右上の寸法の表示（`dim-verdict`。D23）が使う。
 * 同じ関数で作るので、同じカードの右上とやることの文で差の書き方が食い違わない。
 * 差が 0 の方向も省かずに出す（省くと「その方向は比べていない」と読める）。
 */
export function dimDeltaText(c, b) {
  if (!c || !b) return null;
  const one = (label, v) => `${label} ${v > 0 ? '+' : v < 0 ? '−' : '±'}${num(Math.abs(v))}mm`;
  return [one('高さ', c.h - b.h), one('幅', c.w - b.w), one('奥行き', c.d - b.d)].join('・');
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
