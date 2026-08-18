/**
 * 検証状態（evidence）の解決と表示。
 *
 * 移行元は unverified / dimVerified / specVerified / rangeVerified / verified /
 * anchor の6フラグに分かれ、しかも極性が逆のものが混在していた。ここでは
 * 側面（model/dims/specs）ごとの3値に統一し、既定は unverified（安全側）とする。
 */
import { esc } from './util.mjs';

export const ASPECTS = ['model', 'dims', 'specs'];

const LABEL = {
  verified: { text: '確認済', cls: 'ev-ok' },
  estimated: { text: '代表値', cls: 'ev-warn' },
  unverified: { text: '未確認', cls: 'ev-dim' },
};

const ASPECT_LABEL = { model: '型式', dims: '寸法', specs: '仕様' };

/** キー欠落は unverified 扱い（安全側に倒す） */
export function stateOf(device, aspect) {
  const s = device?.evidence?.[aspect]?.state;
  return LABEL[s] ? s : 'unverified';
}

export function isVerified(device, aspect) {
  return stateOf(device, aspect) === 'verified';
}

/** そのレコードで最も弱い側面。カード上の総合表示に使う。 */
export function weakestState(device) {
  const order = ['unverified', 'estimated', 'verified'];
  return ASPECTS.map((a) => stateOf(device, a)).sort((x, y) => order.indexOf(x) - order.indexOf(y))[0];
}

/** 並び替え用: verified を先に */
export function evidenceRank(device) {
  return { verified: 0, estimated: 1, unverified: 2 }[weakestState(device)];
}

/** 側面ごとのバッジ列（確認画面用）。出典があればリンクにする。 */
export function evidenceRow(device) {
  return ASPECTS.map((aspect) => {
    const state = stateOf(device, aspect);
    const src = device?.evidence?.[aspect] || {};
    const label = `${ASPECT_LABEL[aspect]} ${LABEL[state].text}`;
    const inner = src.srcUrl
      ? `<a href="${esc(src.srcUrl)}" target="_blank" rel="noopener">${esc(label)}</a>`
      : esc(label);
    const note = src.srcNote ? `<span class="ev-note">${esc(src.srcNote)}</span>` : '';
    const at = src.checkedAt ? `<span class="ev-note">${esc(src.checkedAt)}</span>` : '';
    return `<span class="badge ${LABEL[state].cls}">${inner}${note}${at}</span>`;
  }).join('');
}

/** 発注前の注意書き。状態に応じて出し分ける。 */
export function warningFor(device) {
  const specs = stateOf(device, 'specs');
  const dims = stateOf(device, 'dims');
  const out = [];
  if (specs === 'estimated') {
    out.push('この型式の仕様値は<b class="amber">代表値</b>です。発注前にメーカー仕様書で確定してください。');
  } else if (specs === 'unverified') {
    out.push('この型式の仕様は<b class="amber">未確認</b>です。発注前にメーカー仕様書で確認してください。');
  }
  if (dims !== 'verified') {
    out.push('外形寸法・取付穴ピッチが<b class="amber">未確認</b>のため、寸法比較は行いません。');
  }
  return out;
}
