/** カテゴリ非依存の互換判定の枠組み: gate → enrich → rank */
import { store, devicesOf } from './store.mjs';
import { dimDiff, normalizeMounting } from './util.mjs';

/**
 * 容量帯の一致判定（±ratio の窓）。
 *
 * 移行元 index.html:328 は `Math.abs(a-m) <= m*0.3` と **m 基準の非対称**で、
 * A→B が候補でも B→A が候補にならないことがあった。ここでは大きい方を基準に
 * することで対称にする（どちらから引いても同じ結果になる）。
 * 検索の性質上、取りこぼしより1件多く見せるほうが安全なので max を採る。
 */
export function withinWindow(a, b, ratio) {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= Math.max(a, b) * ratio;
}

/** 桁で広がる量（検出距離など）の距離。対数比なので元から対称。 */
export function logRatio(a, b) {
  if (!a || !b || a <= 0 || b <= 0) return null;
  return Math.abs(Math.log10(a / b));
}

/** 区間の重なり率。狭いほうの幅で正規化するので、包含関係なら 1.0。 */
export function rangeOverlap(a, b) {
  if (!a || !b) return 0;
  const lo = Math.max(a.min, b.min);
  const hi = Math.min(a.max, b.max);
  if (hi <= lo) return 0;
  const span = Math.min(a.max - a.min, b.max - b.min);
  return span > 0 ? (hi - lo) / span : 0;
}

/** 取付穴ピッチの一致。寸法が未検証なら断定せず null（?表示）を返す。 */
export function holeMatch(a, m, trustworthy) {
  if (!trustworthy) return null;
  if (!a.holes || !m.holes) return null;
  return a.holes.w === m.holes.w && a.holes.h === m.holes.h;
}

/** 寸法を信用してよいか（両側の evidence.dims が verified のときだけ） */
export function dimsTrustworthy(a, m) {
  return a.evidence?.dims?.state === 'verified' && m.evidence?.dims?.state === 'verified' && !!a.dims && !!m.dims;
}

/** 比較用ヘルパー: true を先に */
export function preferTrue(a, b) {
  if (a === b) return 0;
  return a ? -1 : 1;
}

/** 比較用ヘルパー: 小さい値を先に。null は最後。 */
export function ascending(a, b) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a - b;
}

/**
 * 候補の算出。
 * @param m        基準デバイス
 * @param category カテゴリモジュール
 * @param ctx      { mounting } 利用者が選んだ取付方式など
 */
export function computeCompatibles(m, category, ctx = {}) {
  const wanted = normalizeMounting(ctx.mounting) || m.mounting;

  // シリーズ単位のレコード（型式マスク）は個別の発注可能型式ではないので、
  // 基準にも候補にもしない。カテゴリ側で毎回書くと1つ忘れた時点で穴が開くため、
  // ratedA:0 の番兵ガードと同じ轍を踏まないようここで一度だけ落とす。
  if (isSeriesScope(m)) return [];

  const enriched = devicesOf(m.category)
    .filter((a) => a.id !== m.id && !isSeriesScope(a) && category.gate(a, m, ctx))
    .map((a) => {
      const trustworthy = dimsTrustworthy(a, m);
      return {
        ...a,
        isSuccessor: a.id === m.successorId,
        sameMaker: a.maker === m.maker,
        mountingMatch: a.mounting === wanted,
        dimsTrustworthy: trustworthy,
        holeMatch: holeMatch(a, m, trustworthy),
        diff: trustworthy ? dimDiff(a.dims, m.dims) : null,
        ...category.enrich(a, m, ctx),
      };
    });

  enriched.sort((a, b) => category.rank(a, b, m, ctx));
  return enriched;
}

/** シリーズ単位のマスク（`SGDM / SGDH` や `CACR-SR□□BB`）かどうか */
export function isSeriesScope(d) {
  return d?.modelScope === 'series';
}

/** 型式から1件引く。曖昧な場合の扱いは呼び出し側に委ねる。 */
export function findById(id) {
  return store.byId.get(id) || null;
}
