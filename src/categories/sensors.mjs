/** 近接 / 光電 / 超音波 / 特殊。判定の実体は sensor-common.mjs にある。 */
import { registerCategory } from '../core/registry.mjs';
import { num } from '../core/util.mjs';
import {
  distanceSpec, distanceStanding, sensorGate, sensorEnrich, sensorRank, sensorSummary, wiringPanel,
} from './sensor-common.mjs';

const common = {
  group: 'sensor',
  gate: sensorGate,
  enrich: sensorEnrich,
  rank: sensorRank,
  summary: sensorSummary,
  detailPanels: (m, c) => [wiringPanel(m, c)].filter(Boolean),
};

/**
 * 検出距離を主スペックに持つ3カテゴリは大小を判定する。
 *
 * 超音波センサも検出距離のキー・単位・意味（届く距離）が近接／光電と同じなので
 * 同じ扱いにする。透過形は投光器と受光器の間隔、反射形はワークまでの距離だが、
 * どちらも「小さい＝そこまで届かない」で向きが一致する。
 */
registerCategory({ ...common, id: 'proximity', label: '近接スイッチ', specDefs: [distanceSpec], primaryStanding: distanceStanding });
registerCategory({ ...common, id: 'photo', label: 'フォトスイッチ', specDefs: [distanceSpec], primaryStanding: distanceStanding });
registerCategory({ ...common, id: 'ultrasonic', label: '超音波センサ', specDefs: [distanceSpec], primaryStanding: distanceStanding });

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
  /**
   * 主スペックの導光路長は大小を判定しない。
   *
   * 検出距離と違って「短い＝届かない」と言い切れない。導光路長はアンプと検出点を
   * 結ぶ光路の長さで、必要な長さは設置経路で決まる（長いほうが高性能ではない）。
   * 12件のうち6件（熱間金属検出・光学式）はそもそもこのキーを持たない。
   * 迷うものは「判定しない」に倒す。
   */
  primaryStanding: () => null,
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
