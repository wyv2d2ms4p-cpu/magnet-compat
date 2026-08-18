/** サーマルリレー。整定電流の調整範囲の重なりで候補を絞る。 */
import { registerCategory } from '../core/registry.mjs';
import { rangeOverlap, preferTrue, ascending } from '../core/compat.mjs';
import { evidenceRank } from '../core/evidence.mjs';
import { num } from '../core/util.mjs';

export const OVERLAP_THRESHOLD = 0.3;

/** 保護方式の変化。2E→1E は欠相保護を失うので最下位に落とす。 */
function protectDiff(a, m) {
  const pa = a.specs?.protect;
  const pm = m.specs?.protect;
  if (!pa || !pm) return { level: 'diff', text: '保護方式不明' };
  if (pa === pm) return { level: 'same', text: `${pa} 同一` };
  if (pm === '1E' && pa === '2E') return { level: 'up', text: '1E→2E 欠相保護が追加' };
  if (pm === '2E' && pa === '1E') return { level: 'down', text: '2E→1E 欠相保護を失う' };
  return { level: 'diff', text: `${pm}→${pa}` };
}

/** 取付先の接触器が共通かどうか。共通でなければ接触器ごと交換になる。 */
function fitLevel(a, m) {
  const am = a.specs?.mountsOn || [];
  const mm = m.specs?.mountsOn || [];
  const shared = am.filter((x) => mm.includes(x));
  if (shared.length) return { level: 'ok', text: `共通取付: ${shared.slice(0, 3).join(' / ')}`, shared };
  if (a.maker === m.maker) return { level: 'warn', text: '同一メーカーだが取付可能な接触器が異なる', shared: [] };
  return { level: 'ng', text: '取付穴が異なるため接触器も交換が必要', shared: [] };
}

const PROTECT_ORDER = { same: 0, up: 1, diff: 2, down: 3 };
const FIT_ORDER = { ok: 0, warn: 1, ng: 2 };

registerCategory({
  id: 'thermal',
  label: 'サーマルリレー',
  group: 'magnet',
  specDefs: [
    {
      key: 'setRangeA', label: '整定電流調整範囲', unit: 'A', primary: true,
      format: (v) => `${num(v.min)}〜${num(v.max)}A`,
      distance: (a, b) => 1 - rangeOverlap(a, b),
    },
  ],
  gate(a, m) {
    if (a.id === m.successorId) return true;
    // 保護方式が違っても候補には出す（バッジで明示し、順位で落とす）
    return rangeOverlap(a.specs?.setRangeA, m.specs?.setRangeA) >= OVERLAP_THRESHOLD;
  },
  enrich(a, m) {
    return {
      overlap: rangeOverlap(a.specs?.setRangeA, m.specs?.setRangeA),
      protectDiff: protectDiff(a, m),
      fitLevel: fitLevel(a, m),
    };
  },
  rank(a, b) {
    return (
      preferTrue(a.isSuccessor, b.isSuccessor) ||
      PROTECT_ORDER[a.protectDiff.level] - PROTECT_ORDER[b.protectDiff.level] ||
      FIT_ORDER[a.fitLevel.level] - FIT_ORDER[b.fitLevel.level] ||
      b.overlap - a.overlap ||
      preferTrue(a.mountingMatch, b.mountingMatch) ||
      evidenceRank(a) - evidenceRank(b) ||
      ascending(a.diff, b.diff)
    );
  },
  summary(d) {
    const r = d.specs?.setRangeA;
    return [
      { label: '整定電流調整範囲', value: r ? `${num(r.min)}〜${num(r.max)}A` : '―' },
      { label: '保護方式', value: d.specs?.protect === '2E' ? '2E（過負荷＋欠相）' : d.specs?.protect === '1E' ? '1E（過負荷）' : '―' },
      { label: '取付可能な接触器', value: (d.specs?.mountsOn || []).join(' / ') || '―' },
      { label: '単独取付アダプタ', value: d.specs?.standalone || '―' },
    ];
  },
  detailPanels(m, c) {
    const panels = [];
    if (c.protectDiff) {
      panels.push({
        tone: c.protectDiff.level === 'down' ? 'warn' : c.protectDiff.level === 'same' ? 'ok' : 'info',
        title: '保護方式',
        body: c.protectDiff.text + (c.protectDiff.level === 'down' ? '。欠相保護が必要な用途では使用できません。' : ''),
      });
    }
    if (c.fitLevel) {
      panels.push({
        tone: c.fitLevel.level === 'ok' ? 'ok' : c.fitLevel.level === 'warn' ? 'info' : 'warn',
        title: '取付適合',
        body: c.fitLevel.text,
      });
    }
    return panels;
  },
});
