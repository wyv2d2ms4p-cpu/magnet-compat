/** 描画部品。3アプリに重複していたウィザード・外形図・バッジをここに集約。 */
import { esc, num } from './util.mjs';
import { primarySpec, formatSpec } from './registry.mjs';
import { evidenceRow, warningFor, stateOf } from './evidence.mjs';

export function badge(ok, label, neutralLabel) {
  if (ok === null || ok === undefined) return `<span class="badge ev-dim">? ${esc(neutralLabel || label)}</span>`;
  return `<span class="badge ${ok ? 'ev-ok' : 'ev-warn'}">${ok ? '✓' : '△'} ${esc(label)}</span>`;
}

export function panelBox({ tone, title, body }) {
  return `<div class="cmp cmp-${tone}"><b>${esc(title)}</b><span>${body}</span></div>`;
}

/** 外形寸法の図。寸法が信用できるときだけ描く。 */
export function dimDiagram(dims, holes) {
  if (!dims) return '';
  const scale = Math.min(1.6, 180 / Math.max(dims.h, dims.w, 1));
  const w = dims.w * scale;
  const h = dims.h * scale;
  // 上に穴ピッチと奥行、下に幅、左に高さを置くので上下は非対称に空ける
  const padX = 34;
  const padTop = 40;
  const padBottom = 26;
  // ラベルが収まる最低幅を確保する。細長い部品でも上端の2つのラベルが重ならない。
  const vw = Math.max(w + padX * 2, 260);
  const vh = h + padTop + padBottom;
  const left = (vw - w) / 2; // 本体は常に中央
  let inner = '';
  if (holes) {
    const hw = holes.w * scale;
    const hh = holes.h * scale;
    const hx = left + (w - hw) / 2;
    const hy = padTop + (h - hh) / 2;
    inner =
      `<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" fill="none" stroke="var(--green)" stroke-width="1.2" stroke-dasharray="4 3"/>` +
      [[hx, hy], [hx + hw, hy], [hx, hy + hh], [hx + hw, hy + hh]]
        .map(([cx, cy]) => `<circle cx="${cx}" cy="${cy}" r="3" fill="var(--green)"/>`).join('') +
      // 本体の外（上端より上）に置いて枠線と重ならないようにする
      `<text x="8" y="14" fill="var(--green)" font-size="11" text-anchor="start">穴 ${num(holes.w)}×${num(holes.h)}mm</text>`;
  }
  // 等倍で描く（width:100% で引き伸ばすと文字だけ巨大になるため）
  return `<svg viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}" style="max-width:100%" role="img" aria-label="外形寸法図">
    <rect x="${left}" y="${padTop}" width="${w}" height="${h}" fill="none" stroke="var(--amber)" stroke-width="1.6"/>
    ${inner}
    <text x="${vw - 8}" y="14" fill="var(--sub)" font-size="11" text-anchor="end">D ${num(dims.d)}mm</text>
    <text x="${vw / 2}" y="${padTop + h + 17}" fill="var(--sub)" font-size="11" text-anchor="middle">W ${num(dims.w)}mm</text>
    <text x="${left - 12}" y="${padTop + h / 2}" fill="var(--sub)" font-size="11" text-anchor="middle" transform="rotate(-90 ${left - 12} ${padTop + h / 2})">H ${num(dims.h)}mm</text>
  </svg>`;
}

/** 生産終了 / メーカー撤退 / 検証状態の見出しバッジ */
export function statusBadges(d) {
  let h = '';
  if (d.discontinued) h += '<span class="badge b-disc">生産終了</span>';
  if (d.makerExited) h += '<span class="badge b-disc">メーカー撤退</span>';
  if (stateOf(d, 'specs') !== 'verified' || stateOf(d, 'dims') !== 'verified') {
    h += '<span class="badge ev-warn">要確認</span>';
  }
  return h;
}

/** デバイスの note。移行元では一度も描画されていなかった。 */
export function noteBox(d) {
  if (!d.note) return '';
  return `<div class="note">${esc(d.note)}</div>`;
}

/**
 * 確認画面のスペック欄。
 *
 * 宣言された specDefs を必ず先頭に出し、そのあとにカテゴリ固有の summary を続ける。
 * こうしておくと、カテゴリ側が主スペックを summary に書き忘れても、
 * そのカテゴリの見出しスペック（電流／検出距離／導光路長など）が必ず表示される。
 */
export function specGrid(category, d) {
  const declared = category.specDefs.map((s) => ({ label: s.label, value: formatSpec(s, d) }));
  const rows = [];
  for (const r of [...declared, ...category.summary(d)]) {
    if (rows.some((x) => x.label === r.label)) continue;
    rows.push(r);
  }
  return `<div class="grid">${rows.map((r) =>
    `<div class="spec"><div class="l">${esc(r.label)}</div><div class="v">${esc(r.value)}</div></div>`).join('')}</div>`;
}

/** 候補カード1件 */
export function candidateCard(category, m, c, index) {
  const ps = primarySpec(category);
  const lead = c.isSuccessor
    ? '<span class="badge b-succ">メーカー後継品</span>'
    : index === 0 ? '<span class="badge ev-ok">候補No.1</span>' : '';
  const cross = c.sameMaker ? '' : '<span class="badge b-cross">他社互換</span>';

  const dimVerdict = !c.dimsTrustworthy
    ? '<span class="dim-verdict dim">寸法未確認</span>'
    : c.diff === 0 ? '<span class="dim-verdict ok">寸法一致</span>'
    : `<span class="dim-verdict warn">差 Σ${num(c.diff)}mm</span>`;

  const badges = [
    c.holeMatch === null ? badge(null, '取付穴', '取付穴 要検証') : badge(c.holeMatch, '取付穴一致'),
    badge(c.mountingMatch, '取付方式'),
    c.methodMatch !== undefined ? badge(c.methodMatch, '検出方式') : '',
    c.threadMatch !== undefined ? badge(c.threadMatch, 'サイズ/ねじ径') : '',
    c.contactMatch !== undefined ? badge(c.contactMatch, '接点形式(NO/NC)') : '',
    c.outputMatch !== undefined ? badge(c.outputMatch, '出力方式') : '',
    c.tempDown !== undefined ? badge(!c.tempDown, '使用温度') : '',
    c.auxMatch !== undefined ? badge(c.auxMatch, '補助接点') : '',
    c.ifaceMatch !== undefined ? badge(c.ifaceMatch, '指令I/F') : '',
  ].filter(Boolean).join('');

  const panels = category.detailPanels(m, c).map(panelBox).join('');

  return `<div class="card">
    <div class="card-head">
      <div>
        <div class="maker">${esc(c.maker)} ${lead}${cross}${statusBadges(c)}</div>
        <div class="model mono">${esc(c.model)}</div>
      </div>
      <div class="card-right">
        <div class="primary-spec mono">${esc(formatSpec(ps, c))}</div>
        ${dimVerdict}
      </div>
    </div>
    <div class="badges">${badges}</div>
    ${noteBox(c)}
    ${panels}
    <div class="evidence">${evidenceRow(c)}</div>
  </div>`;
}

export function warningBox(d) {
  const warns = warningFor(d);
  if (!warns.length) return '';
  return `<div class="warn">${warns.map((w) => `<div>⚠ ${w}</div>`).join('')}</div>`;
}
