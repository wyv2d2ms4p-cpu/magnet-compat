/** 近接 / 光電 / 超音波 / 特殊。判定の実体は sensor-common.mjs にある。 */
import { registerCategory } from '../core/registry.mjs';
import { num } from '../core/util.mjs';
import {
  distanceSpec, sensorGate, sensorEnrich, sensorRank, sensorSummary, wiringPanel,
} from './sensor-common.mjs';

const common = {
  group: 'sensor',
  gate: sensorGate,
  enrich: sensorEnrich,
  rank: sensorRank,
  summary: sensorSummary,
  detailPanels: (m, c) => [wiringPanel(m, c)].filter(Boolean),
};

registerCategory({ ...common, id: 'proximity', label: '近接スイッチ', specDefs: [distanceSpec] });
registerCategory({ ...common, id: 'photo', label: 'フォトスイッチ', specDefs: [distanceSpec] });
registerCategory({ ...common, id: 'ultrasonic', label: '超音波センサ', specDefs: [distanceSpec] });

/**
 * 特殊（熱間金属 / 光学式 / 導光路）。
 *
 * このカテゴリは移行前、同じ ratedA に「導光路長(mm)」と「該当なしを表す 0」が
 * 同居していた。移行後は導光路品だけが lightGuideLengthMM を持ち、熱間金属・光学式は
 * 距離系のキーを持たない。specDefs に無いキーは表示も判定も自動的にスキップされるため、
 * 「0mm 同士だから完全一致」といった誤判定が起こらない。
 */
registerCategory({
  ...common,
  id: 'special',
  label: '特殊(熱間/光学/導光)',
  specDefs: [
    {
      key: 'lightGuideLengthMM', label: '導光路長', unit: 'mm', primary: true,
      format: (v) => (v >= 1000 ? `${num(v / 1000)}m` : `${num(v)}mm`),
      distance: (a, b) => Math.abs(Math.log10(a / b)),
    },
  ],
  summary(d) {
    const rows = sensorSummary(d);
    if (d.specs?.lightGuideLengthMM != null) {
      rows.unshift({ label: '導光路長', value: `${num(d.specs.lightGuideLengthMM / 1000)}m` });
    }
    return rows;
  },
});
