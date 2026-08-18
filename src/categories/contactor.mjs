/** 電磁接触器 / 電磁開閉器。容量帯（定格使用電流）で候補を絞る。 */
import { registerCategory } from '../core/registry.mjs';
import { withinWindow, preferTrue, ascending } from '../core/compat.mjs';
import { evidenceRank } from '../core/evidence.mjs';
import { num } from '../core/util.mjs';

/** メーカーごとに容量の刻みが違う（日立HC10=13A / 三菱S-N10=11A）ため窓で見る */
export const CURRENT_WINDOW = 0.3;

const currentSpec = {
  key: 'ratedCurrentA', label: '定格使用電流', unit: 'A', primary: true,
  format: (v) => `${num(v)}A`,
  distance: (a, b) => Math.abs(a - b),
};

const powerSpec = { key: 'ratedPowerKW', label: '適用モータ容量', unit: 'kW', format: (v) => `${num(v)}kW` };

function baseGate(a, m) {
  if (a.id === m.successorId) return true; // メーカー公表の後継品は無条件で候補
  return withinWindow(a.specs?.ratedCurrentA, m.specs?.ratedCurrentA, CURRENT_WINDOW);
}

function auxLabel(aux) {
  return aux ? `${aux.a}a${aux.b}b` : '―';
}

function baseEnrich(a, m) {
  return {
    auxMatch: !!a.specs?.aux && !!m.specs?.aux && a.specs.aux.a === m.specs.aux.a && a.specs.aux.b === m.specs.aux.b,
    currentDiff: Math.abs((a.specs?.ratedCurrentA ?? 0) - (m.specs?.ratedCurrentA ?? 0)),
  };
}

function baseRank(a, b) {
  return (
    preferTrue(a.isSuccessor, b.isSuccessor) ||
    ascending(a.currentDiff, b.currentDiff) ||
    preferTrue(a.mountingMatch, b.mountingMatch) ||
    preferTrue(a.auxMatch, b.auxMatch) ||
    evidenceRank(a) - evidenceRank(b) ||
    preferTrue(a.holeMatch === true, b.holeMatch === true) ||
    ascending(a.diff, b.diff)
  );
}

function baseSummary(d) {
  return [
    { label: '定格使用電流', value: d.specs?.ratedCurrentA != null ? `${num(d.specs.ratedCurrentA)}A` : '―' },
    { label: '適用モータ容量', value: d.specs?.ratedPowerKW != null ? `${num(d.specs.ratedPowerKW)}kW` : '―' },
    { label: '操作コイル', value: d.specs?.coil || '―' },
    { label: '補助接点', value: auxLabel(d.specs?.aux) },
  ];
}

registerCategory({
  id: 'contactor',
  label: '電磁接触器',
  group: 'magnet',
  specDefs: [currentSpec, powerSpec],
  gate: baseGate,
  enrich: baseEnrich,
  rank: baseRank,
  summary: baseSummary,
});

registerCategory({
  id: 'starter',
  label: '電磁開閉器',
  group: 'magnet',
  specDefs: [currentSpec, powerSpec],
  /**
   * 欠相保護付き（-KP）は欠相保護付きとしか置き換えられない。
   * 保護機能を落とす置換を候補に出さない。
   */
  gate(a, m) {
    const akp = /-KP$/.test(a.compatKey || '');
    const mkp = /-KP$/.test(m.compatKey || '');
    if (akp !== mkp) return false;
    return baseGate(a, m);
  },
  enrich: baseEnrich,
  rank: baseRank,
  summary: baseSummary,
});
