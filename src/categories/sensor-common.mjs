/** センサー4カテゴリで共有する判定要素。 */
import { logRatio, preferTrue, ascending } from '../core/compat.mjs';
import { evidenceRank } from '../core/evidence.mjs';
import { num } from '../core/util.mjs';

/** 限定反射形と距離設定形は相互に置換しうる */
const METHOD_EQUIV = { '限定反射形': ['距離設定形'], '距離設定形': ['限定反射形'] };

export function methodOK(a, b) {
  if (!a || !b) return true;
  return a === b || (METHOD_EQUIV[b] || []).includes(a);
}

/** 2線式 / 3線式。配線本数が違うものは物理的に置換できない。 */
export function wireCount(d) {
  const s = `${d.specs?.outputSpec || ''} ${d.specs?.voltage || ''}`;
  if (s.includes('3線')) return 3;
  if (s.includes('2線')) return 2;
  return null;
}

/**
 * 出力極性の集合を返す。
 *
 * `NPN/PNP(3線式)` のような選択可能品があるため、単一値ではなく集合として扱う。
 * 極性を持たない表記（`N.O.`、`2線式`、`リレー接点` など）は null を返し、判定に使わない。
 */
export function polarities(d) {
  const s = d.specs?.outputSpec || '';
  const set = [];
  if (/NPN/.test(s)) set.push('NPN');
  if (/PNP/.test(s)) set.push('PNP');
  return set.length ? set : null;
}

/**
 * 出力極性の適合。
 *
 * 移行元では NPN/PNP の不一致が第7位のタイブレークでしかなく、検出距離が近ければ
 * PNP品がNPN品より上位に出た。シンク入力PLCに対して動作しない置換が候補No.1に
 * なりうるため、ここでは候補段階で除外する。
 * 集合が交わればよい（NPN/PNP選択可能品は NPN機の代替になる）。
 */
export function polarityOK(a, m) {
  const pa = polarities(a);
  const pm = polarities(m);
  if (!pa || !pm) return true; // どちらかが極性を持たない表記なら判定しない
  return pa.some((p) => pm.includes(p));
}

/** 接点形式（NO/NC）。論理が反転するのでバッジと順位で明示する。 */
export function contactForms(d) {
  const s = d.specs?.outputSpec || '';
  const set = [];
  if (/N\.?O\.?/i.test(s) || /\bNO\b/.test(s)) set.push('NO');
  if (/N\.?C\.?/i.test(s) || /\bNC\b/.test(s)) set.push('NC');
  return set.length ? set : null;
}

export function contactFormOK(a, m) {
  const ca = contactForms(a);
  const cm = contactForms(m);
  if (!ca || !cm) return true;
  return ca.some((x) => cm.includes(x));
}

export const distanceSpec = {
  key: 'sensingDistanceMM', label: '検出距離', unit: 'mm', primary: true,
  format: (v) => (v >= 1000 ? `${num(v / 1000)}m` : `${num(v)}mm`),
  // 検出距離は 2mm〜100m と4桁半に広がるため、線形差ではなく対数比で見る
  distance: logRatio,
};

/** 検出距離の近さ。片方でも値が無ければ最下位（旧 dr:99 相当）。 */
export function distanceGap(a, m) {
  const r = logRatio(a.specs?.sensingDistanceMM, m.specs?.sensingDistanceMM);
  return r == null ? Infinity : r;
}

export function sensorGate(a, m) {
  if (!polarityOK(a, m)) return false; // 電気的に成立しない置換は出さない
  const wm = wireCount(m);
  const wa = wireCount(a);
  if (wm && wa && wm !== wa) return false;
  if (a.id === m.successorId) return true;
  if (a.compatKey && a.compatKey === m.compatKey) return true;
  if (a.specs?.compatGroup && a.specs.compatGroup === m.specs?.compatGroup) {
    if (m.category === 'proximity') return a.specs?.threadSize === m.specs?.threadSize;
    return methodOK(a.specs?.detectMethod, m.specs?.detectMethod);
  }
  return false;
}

export function sensorEnrich(a, m) {
  return {
    methodMatch: methodOK(a.specs?.detectMethod, m.specs?.detectMethod),
    threadMatch: !m.specs?.threadSize || a.specs?.threadSize === m.specs?.threadSize,
    contactMatch: contactFormOK(a, m),
    outputMatch: a.specs?.outputSpec === m.specs?.outputSpec,
    tempDown: !!(m.specs?.tempMaxC && a.specs?.tempMaxC && a.specs.tempMaxC < m.specs.tempMaxC),
    distGap: distanceGap(a, m),
  };
}

export function sensorRank(a, b) {
  return (
    preferTrue(a.isSuccessor, b.isSuccessor) ||
    preferTrue(a.methodMatch, b.methodMatch) ||
    preferTrue(a.threadMatch, b.threadMatch) ||
    preferTrue(a.contactMatch, b.contactMatch) ||
    // 対数比 0.01 ≒ 距離差 2.3% 以内は同等とみなす
    (Math.abs(a.distGap - b.distGap) > 0.01 ? a.distGap - b.distGap : 0) ||
    preferTrue(!a.tempDown, !b.tempDown) ||
    preferTrue(a.mountingMatch, b.mountingMatch) ||
    preferTrue(a.outputMatch, b.outputMatch) ||
    evidenceRank(a) - evidenceRank(b) ||
    ascending(a.diff, b.diff)
  );
}

export function sensorSummary(d) {
  return [
    { label: '検出方式', value: d.specs?.detectMethod || '―' },
    { label: 'サイズ/ねじ径', value: d.specs?.threadSize || '―' },
    { label: '電源電圧', value: d.specs?.voltage || '―' },
    { label: '出力方式', value: d.specs?.outputSpec || '―' },
    { label: '使用温度(最高)', value: d.specs?.tempMaxC ? `〜${d.specs.tempMaxC}℃` : '―' },
  ];
}

/** 電線の被覆色の比較。既設との差異を明示する。 */
export function wiringPanel(m, c) {
  const a = m.specs?.cableColors;
  const b = c.specs?.cableColors;
  if (!a || !b) return null;
  const rows = [['+ (茶)', 'plus'], ['- (青)', 'minus'], ['出力 (黒)', 'out']];
  const diff = rows.filter(([, k]) => a[k] !== b[k]).length;
  return {
    tone: diff ? 'warn' : 'ok',
    title: '電線の被覆色',
    body: diff
      ? `既設と ${diff} 箇所で異なります（${rows.filter(([, k]) => a[k] !== b[k]).map(([, k]) => `${a[k]}→${b[k]}`).join(' / ')}）。結線時に注意してください。`
      : '既設品と同一です。',
  };
}
