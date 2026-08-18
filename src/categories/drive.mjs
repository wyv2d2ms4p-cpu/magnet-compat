/**
 * インバータ / サーボユニット。
 *
 * 現時点で実データは0件。移行元の1467件のうち1440件は buildInv/buildServo による
 * 組み合わせ生成物で実在確認が取れておらず、data/_seed/ に provisional として
 * 凍結してある（誤発注防止のため候補に出さない）。残る27件は安川サーボの
 * 生産中止シリーズ参照行で、SGDM / CACR-SR□□BB のようなワイルドカード付きの
 * シリーズ単位マスクであり個別の発注可能型式ではないため、
 * data/reference/servo-discontinued.json に参照情報として分離してある。
 *
 * カテゴリの枠組みだけ先に用意しておき、フェーズ2で出典URL付きの実データが
 * 入り次第そのまま動きはじめる。
 */
import { registerCategory } from '../core/registry.mjs';
import { withinWindow, preferTrue, ascending, logRatio } from '../core/compat.mjs';
import { evidenceRank } from '../core/evidence.mjs';
import { num } from '../core/util.mjs';

registerCategory({
  id: 'inverter',
  label: 'インバータ',
  group: 'drive',
  specDefs: [
    { key: 'ratedCurrentA', label: '定格出力電流', unit: 'A', primary: true, format: (v) => `${num(v)}A`, distance: (a, b) => Math.abs(a - b) },
    { key: 'ratedPowerKW', label: '適用モータ容量', unit: 'kW', format: (v) => `${num(v)}kW` },
  ],
  gate(a, m) {
    if (a.id === m.successorId) return true;
    if (a.specs?.voltClass !== m.specs?.voltClass) return false;
    return withinWindow(a.specs?.ratedCurrentA, m.specs?.ratedCurrentA, 0.3);
  },
  enrich(a, m) {
    return { currentDiff: Math.abs((a.specs?.ratedCurrentA ?? 0) - (m.specs?.ratedCurrentA ?? 0)) };
  },
  rank(a, b) {
    return (
      preferTrue(a.isSuccessor, b.isSuccessor) ||
      ascending(a.currentDiff, b.currentDiff) ||
      preferTrue(a.sameMaker, b.sameMaker) ||
      evidenceRank(a) - evidenceRank(b) ||
      ascending(a.diff, b.diff)
    );
  },
  summary(d) {
    return [
      { label: '定格出力電流', value: d.specs?.ratedCurrentA != null ? `${num(d.specs.ratedCurrentA)}A` : '―' },
      { label: '適用モータ容量', value: d.specs?.ratedPowerKW != null ? `${num(d.specs.ratedPowerKW)}kW` : '―' },
      { label: '電源電圧', value: d.specs?.voltage || '―' },
    ];
  },
});

registerCategory({
  id: 'servo',
  label: 'サーボユニット',
  group: 'drive',
  specDefs: [
    {
      key: 'ratedPowerW', label: '定格出力', unit: 'W', primary: true,
      format: (v) => (v >= 1000 ? `${num(v / 1000)}kW` : `${num(v)}W`),
      distance: logRatio,
    },
  ],
  gate(a, m) {
    if (a.id === m.successorId) return true;
    if (a.specs?.voltClass !== m.specs?.voltClass) return false;
    return withinWindow(a.specs?.ratedPowerW, m.specs?.ratedPowerW, 0.3);
  },
  enrich(a, m) {
    return {
      ifaceMatch: a.specs?.ikey === m.specs?.ikey,
      powerGap: logRatio(a.specs?.ratedPowerW, m.specs?.ratedPowerW) ?? Infinity,
    };
  },
  rank(a, b) {
    return (
      preferTrue(a.isSuccessor, b.isSuccessor) ||
      preferTrue(a.ifaceMatch, b.ifaceMatch) ||
      ascending(a.powerGap, b.powerGap) ||
      preferTrue(a.sameMaker, b.sameMaker) ||
      evidenceRank(a) - evidenceRank(b) ||
      ascending(a.diff, b.diff)
    );
  },
  summary(d) {
    return [
      { label: '定格出力', value: d.specs?.ratedPowerW != null ? (d.specs.ratedPowerW >= 1000 ? `${num(d.specs.ratedPowerW / 1000)}kW` : `${num(d.specs.ratedPowerW)}W`) : '―' },
      { label: '指令インタフェース', value: d.specs?.iface || '―' },
      { label: '電源電圧', value: d.specs?.voltage || '―' },
      { label: 'エンコーダ', value: d.specs?.encoder || '―' },
    ];
  },
  detailPanels(m, c) {
    if (c.ifaceMatch) return [];
    return [{
      tone: 'warn',
      title: '指令インタフェース',
      body: `${m.specs?.iface || '不明'} → ${c.specs?.iface || '不明'} と異なります。アンプ単体では置換できません。`,
    }];
  },
});
