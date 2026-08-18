/** 状態・画面遷移・イベント。 */
import { esc, norm, mountingOptions, successorChain } from './util.mjs';
import { store, devicesOf, makersOf } from './store.mjs';
import { allCategories, getCategory, primarySpec, formatSpec } from './registry.mjs';
import { computeCompatibles } from './compat.mjs';
import { candidateCard, specGrid, dimDiagram, statusBadges, noteBox, warningBox } from './ui.mjs';
import { evidenceRow } from './evidence.mjs';

const S = {
  step: 1,
  cat: null,
  q: '',
  maker: 'すべて',
  matchedId: null,
  mounting: '',
  notFound: false,
  ambiguous: [],
  browse: false,
};

const ALL = 'すべて';

function category() {
  return getCategory(S.cat);
}

function matched() {
  return S.matchedId ? store.byId.get(S.matchedId) : null;
}

function filtered() {
  return devicesOf(S.cat).filter((d) => S.maker === ALL || d.maker === S.maker);
}

/* ---------- 検索 ---------- */

/**
 * 型式名で引く。
 *
 * norm() はハイフンを落とすため、三菱 S-N10 とパナソニック SN10 が同じ文字列に
 * 正規化される。移行元は先頭一致の1件を無条件に採用していたため、検索欄からは
 * 後者に到達できなかった。ここでは複数一致したら確定させず、選ばせる。
 */
function lookup(query) {
  const q = norm(query);
  if (!q) return { hits: [] };
  const pool = devicesOf(S.cat);
  const exact = pool.filter((d) => norm(d.model) === q);
  if (exact.length) return { hits: exact };
  const partial = pool.filter((d) => norm(d.model).includes(q));
  return { hits: partial };
}

function doSearch() {
  const { hits } = lookup(S.q);
  S.ambiguous = [];
  S.notFound = false;
  if (hits.length === 1) {
    select(hits[0].id);
    return;
  }
  if (hits.length > 1) {
    // 同名に正規化される型式が複数ある。取り違えを防ぐため選ばせる
    S.ambiguous = hits.slice(0, 20);
    render();
    return;
  }
  S.notFound = true;
  S.browse = true;
  render();
}

function select(id) {
  S.matchedId = id;
  S.mounting = '';
  S.ambiguous = [];
  S.step = 2;
  render();
}

function suggestions() {
  const q = norm(S.q);
  if (q.length < 2) return [];
  const pool = filtered();
  const pre = pool.filter((d) => norm(d.model).indexOf(q) === 0);
  const mid = pool.filter((d) => norm(d.model).indexOf(q) > 0);
  return [...pre, ...mid].slice(0, 12);
}

/* ---------- 画面 ---------- */

function header() {
  const total = store.devices.length;
  return `<header>
    <h1>FA部品 互換サーチ</h1>
    <div class="sub">${allCategories().length}カテゴリ / ${total}型式 ・ 完全オフライン</div>
  </header>`;
}

function steps() {
  const labels = ['型式を検索', '仕様を確認', '互換品を表示'];
  return `<div class="steps">${labels.map((l, i) => {
    const n = i + 1;
    const cls = n === S.step ? 'on' : n < S.step ? 'done' : '';
    return `<div class="st ${cls}"><span class="sn">${n}</span><span class="sl">${esc(l)}</span></div>`;
  }).join('')}</div>`;
}

/** カテゴリチップ。大分類は設けず横一列。増えても縦に伸びないよう横スクロールにする。 */
function categoryChips() {
  return `<div class="chiprow" role="tablist">${allCategories().map((c) => {
    const n = devicesOf(c.id).length;
    const on = c.id === S.cat ? ' on' : '';
    const dis = n === 0 ? ' empty' : '';
    return `<button class="chip${on}${dis}" role="tab" aria-selected="${c.id === S.cat}" data-act="cat" data-v="${esc(c.id)}">${esc(c.label)}<span class="cnt">${n}</span></button>`;
  }).join('')}</div>`;
}

function makerChips() {
  const makers = [ALL, ...makersOf(S.cat)];
  return `<div class="chiprow">${makers.map((m) =>
    `<button class="chip sm${m === S.maker ? ' on' : ''}" data-act="maker" data-v="${esc(m)}">${esc(m)}</button>`).join('')}</div>`;
}

function deviceRow(d, act) {
  const ps = primarySpec(category());
  return `<button class="row" data-act="${act}" data-v="${esc(d.id)}">
    <span class="row-main"><span class="mono">${esc(d.model)}</span> ${statusBadges(d)}</span>
    <span class="row-sub">${esc(d.maker)} ・ ${esc(formatSpec(ps, d))}</span>
  </button>`;
}

function viewSearch() {
  const cat = category();
  const list = filtered();
  const sug = suggestions();
  const empty = devicesOf(S.cat).length === 0;

  let body = `${categoryChips()}
    <div class="panel">
      <label class="lbl" for="q">型式を入力</label>
      <div class="searchbar">
        <input id="q" type="search" autocomplete="off" autocapitalize="off" spellcheck="false"
               value="${esc(S.q)}" placeholder="例: S-T10 / TH-T18 / E2E-X4D1" />
        <button class="btn primary" data-act="search">検索</button>
      </div>
      <div id="sug">${sug.length ? sug.map((d) => deviceRow(d, 'pick')).join('') : ''}</div>
      ${S.notFound ? '<div class="warn"><div>該当する型式が見つかりませんでした。下の一覧から選んでください。</div></div>' : ''}
      ${S.ambiguous.length ? `<div class="warn"><div>⚠ 同じ綴りに正規化される型式が ${S.ambiguous.length} 件あります。取り違えを防ぐため、目的の型式を選んでください。</div></div>
        <div class="rows">${S.ambiguous.map((d) => deviceRow(d, 'pick')).join('')}</div>` : ''}
    </div>`;

  if (empty) {
    body += `<div class="panel empty-note">
      <b class="amber">${esc(cat.label)}は実在確認済みのデータが未登録です。</b>
      <div>組み合わせ生成による型式は、実在しない品番を候補に出し誤発注を招くため表示していません。
      メーカー型式表で確認できたものから順次登録します。</div>
    </div>`;
  } else {
    body += `<div class="panel">
      <button class="btn ghost wide" data-act="browse">${S.browse ? '一覧を閉じる' : `一覧から選ぶ（${list.length}件）`}</button>
      ${S.browse ? `${makerChips()}<div class="rows scroll">${list.map((d) => deviceRow(d, 'pick')).join('')}</div>` : ''}
    </div>`;
  }
  return body;
}

function viewConfirm() {
  const m = matched();
  const cat = category();
  if (!m) return viewSearch();

  const options = mountingOptions(devicesOf(S.cat));
  const chain = successorChain(m, store.byId);

  return `<div class="panel">
      <div class="card-head">
        <div>
          <div class="maker">${esc(m.maker)} ${statusBadges(m)}</div>
          <div class="model mono big">${esc(m.model)}</div>
        </div>
      </div>
      ${noteBox(m)}
      ${warningBox(m)}
      ${chain.length ? `<div class="cmp cmp-info"><b>後継品</b><span>${[m, ...chain].map((d) => esc(d.model)).join(' → ')}</span></div>` : ''}
      ${specGrid(cat, m)}
      <div class="evidence">${evidenceRow(m)}</div>
      ${m.evidence?.dims?.state === 'verified' && m.dims ? dimDiagram(m.dims, m.holes) : '<div class="dim-none">外形寸法は未確認のため図を表示しません。</div>'}
    </div>
    <div class="panel">
      <label class="lbl">取付方式（既設に合わせて選択）</label>
      <div class="chiprow">${options.map((o) =>
        `<button class="chip sm${(S.mounting || m.mounting) === o ? ' on' : ''}" data-act="mount" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>
      <button class="btn primary wide" data-act="step" data-v="3">この仕様で互換品を表示</button>
      <button class="btn ghost wide" data-act="step" data-v="1">型式を選び直す</button>
    </div>`;
}

function viewResult() {
  const m = matched();
  const cat = category();
  if (!m) return viewSearch();
  const ps = primarySpec(cat);
  const list = computeCompatibles(m, cat, { mounting: S.mounting });

  const head = `<div class="panel">
    <div class="result-head">
      <span class="mono big">${esc(m.model)}</span>
      <span class="sub">${esc(m.maker)} ・ ${esc(formatSpec(ps, m))}</span>
    </div>
    <div class="sub">互換品候補 ${list.length}件</div>
  </div>`;

  const body = list.length
    ? list.map((c, i) => candidateCard(cat, m, c, i)).join('')
    : `<div class="panel empty-note"><b class="amber">互換候補が登録されていません。</b>
       <div>電気的に成立しない組み合わせ（出力極性・配線本数の相違）は候補から除外しています。</div></div>`;

  return `${head}${body}
    <div class="panel">
      <button class="btn ghost wide" data-act="step" data-v="2">仕様の確認に戻る</button>
      <button class="btn ghost wide" data-act="reset">最初からやり直す</button>
    </div>
    <div class="foot">表示内容はカタログ値に基づく参考情報です。発注前にメーカー仕様書で確定してください。</div>`;
}

/* ---------- 描画 ---------- */

function render() {
  const app = document.getElementById('app');
  const view = S.step === 1 ? viewSearch() : S.step === 2 ? viewConfirm() : viewResult();
  app.innerHTML = header() + steps() + view;

  const q = document.getElementById('q');
  if (q) {
    q.addEventListener('input', () => {
      S.q = q.value;
      S.notFound = false;
      S.ambiguous = [];
      // iOS Safari 対策: 入力中は全体を再描画せず候補欄だけ差し替える
      const sug = document.getElementById('sug');
      if (sug) sug.innerHTML = suggestions().map((d) => deviceRow(d, 'pick')).join('');
    });
    q.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); q.blur(); doSearch(); }
    });
  }
  window.scrollTo(0, 0);
}

const ACTIONS = {
  cat(v) {
    S.cat = v;
    S.q = ''; S.maker = ALL; S.matchedId = null; S.step = 1;
    S.notFound = false; S.ambiguous = []; S.browse = false;
  },
  maker(v) { S.maker = v; },
  pick(v) { select(v); return true; },
  mount(v) { S.mounting = v; },
  search() { doSearch(); return true; },
  browse() { S.browse = !S.browse; },
  step(v) { S.step = Number(v); },
  reset() { S.q = ''; S.matchedId = null; S.mounting = ''; S.step = 1; S.notFound = false; S.ambiguous = []; S.browse = false; },
};

export function start() {
  S.cat = allCategories().find((c) => devicesOf(c.id).length > 0)?.id || allCategories()[0].id;
  document.getElementById('app').addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const fn = ACTIONS[t.dataset.act];
    if (!fn) return;
    if (fn(t.dataset.v) === true) return; // 自前で render 済み
    render();
  });
  render();
}
