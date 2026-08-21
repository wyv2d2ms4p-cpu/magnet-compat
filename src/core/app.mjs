/** 状態・画面遷移・イベント。 */
import { esc, normLoose, normExact, num, mountingOptions, successorChain } from './util.mjs';
import { store, devicesOf, makersOf } from './store.mjs';
import { allCategories, getCategory, primarySpec, distinguishingSpec, formatSpec, formatSpecValue } from './registry.mjs';
import { computeCompatibles } from './compat.mjs';
import { candidateCard, specGrid, dimDiagram, statusBadges, noteBox, warningBox, scopeNote, discontinuedNote } from './ui.mjs';
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
 * 検索欄が見る母集団。
 *
 * メーカーチップは一覧パネルの絞り込みであって検索欄の絞り込みではない。
 * 以前は lookup() がカテゴリ全体を、suggestions() が絞り込み後を見ており、
 * サジェストに出ない型式が Enter では出るという食い違いがあった。画面外の
 * 絞り込みで候補が消えると取り違えの温床になるので、どちらもカテゴリ全体を見る。
 */
function searchPool() {
  return devicesOf(S.cat);
}

/**
 * 型式名で引く。集めるのは normLoose、見分けるのは normExact。
 *
 * normLoose はハイフンも小数点も落とすため、三菱 S-N10 とパナソニック SN10、
 * FR-E820-1.5K-1（1.5kW）と FR-E820-15K-1（15kW）が同じ綴りになる。移行元は
 * 先頭一致の1件を無条件に採用していたため、前者では後者の型式に到達できず、
 * インバータでは10倍容量の違う機種を黙って掴んでいた。
 * ここでは複数一致したら確定させず、必ず選ばせる。
 */
function lookup(query) {
  const q = normLoose(query);
  if (!q) return [];
  const pool = searchPool();
  const exact = pool.filter((d) => normLoose(d.model) === q);
  if (exact.length) return exact;
  return pool.filter((d) => normLoose(d.model).includes(q));
}

function doSearch() {
  const hits = lookup(S.q);
  S.ambiguous = [];
  S.notFound = false;
  if (hits.length === 1) {
    select(hits[0].id);
    return;
  }
  if (hits.length > 1) {
    // loose では同じ綴りになる型式が複数ある。取り違えを防ぐため選ばせる。
    // normExact が入力と一致する候補は先頭に出すが、それでも確定はさせない。
    // 小数点を省いた入力（FRE82015K1）は 1.5K ではなく 15K と exact 一致するため、
    // 一致を根拠に確定させると「黙って10倍の機種を掴む」経路が復活する。
    S.ambiguous = [...hits]
      .sort((a, b) => Number(isExactInput(b)) - Number(isExactInput(a)))
      .slice(0, 20);
    render();
    return;
  }
  S.notFound = true;
  S.browse = true;
  render();
}

/** 入力の綴りと（小数点まで含めて）完全に一致するか */
function isExactInput(d) {
  return normExact(d.model) === normExact(S.q);
}

function select(id) {
  S.matchedId = id;
  S.mounting = '';
  S.ambiguous = [];
  S.step = 2;
  render();
}

function suggestions() {
  const q = normLoose(S.q);
  if (q.length < 2) return [];
  const pool = searchPool();
  const pre = pool.filter((d) => normLoose(d.model).indexOf(q) === 0);
  const mid = pool.filter((d) => normLoose(d.model).indexOf(q) > 0);
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

/**
 * カテゴリチップ。大分類は設けず全カテゴリを並べる。
 *
 * 以前は横一列＋横スクロールにしていたが、スマホでは画面外のカテゴリに
 * 気づけない（スクロールバーも出ない）。折り返して全件を一度に見せる。
 */
function categoryChips() {
  return `<div class="chiprow cats" role="tablist">${allCategories().map((c) => {
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

/**
 * 一覧の1行。
 *
 * opts.spec を渡すと、主スペックではなくそのスペックをラベル付きで副表示にする。
 * 曖昧一致リストが「候補どうしで値が割れているスペック」を出すために使う。
 * 主スペック任せにすると、インバータのように主スペック（定格出力電流）が
 * 全件未登録のカテゴリで副表示が系列名に落ち、1.5kW と 15kW が同じ見た目になる。
 */
function deviceRow(d, act, opts = {}) {
  const sd = opts.spec || primarySpec(category());
  const spec = formatSpec(sd, d);
  let sub;
  if (opts.spec) {
    // 識別用の指定時は「―」であること自体が識別材料なので、系列名にすり替えない
    sub = `${esc(opts.spec.label)} ${esc(spec)}`;
  } else {
    // 主スペックを持たない行（シリーズ単位のマスクなど）は「―」だけになるので系列名を出す
    sub = esc(spec === '―' && d.series ? d.series : spec);
  }
  const exact = opts.exact ? '<span class="badge b-exact">入力と完全一致</span>' : '';
  return `<button class="row" data-act="${act}" data-v="${esc(d.id)}">
    <span class="row-main"><span class="mono">${esc(d.model)}</span> ${exact}${statusBadges(d)}</span>
    <span class="row-sub">${esc(d.maker)} ・ ${sub}</span>
  </button>`;
}

/**
 * 曖昧一致リスト。
 *
 * 「取り違えを防ぐため選んでください」と言う以上、見分ける材料を必ず添える。
 * 候補どうしで値が割れているスペックを1つ選んで全行に併記し、その差が大きい
 * ときは何倍違うのかまで警告文に書く（1.5kW と 15kW の取り違えは誤発注になる）。
 */
function ambiguousPanel() {
  if (!S.ambiguous.length) return '';
  const sd = distinguishingSpec(category(), S.ambiguous);
  // 全候補が完全一致（S-N10 / SN10 のようにハイフン差だけの組）ならバッジは選別の
  // 役に立たないので出さない。一部だけが一致するときに絞り込みの手がかりになる
  const exactCount = S.ambiguous.filter(isExactInput).length;
  const marksExact = exactCount > 0 && exactCount < S.ambiguous.length;
  const rows = S.ambiguous
    .map((d) => deviceRow(d, 'pick', { spec: sd, exact: marksExact && isExactInput(d) }))
    .join('');
  return `<div class="warn"><div>⚠ 入力と同じ綴りに読める型式が ${S.ambiguous.length} 件あります。
      ${spreadNote(sd, S.ambiguous)}取り違えを防ぐため、目的の型式を選んでください。</div></div>
    <div class="rows">${rows}</div>`;
}

/** 識別スペックの開きが大きいときに、何倍違うのかを名指しする */
function spreadNote(sd, devices) {
  if (!sd) return '';
  const vals = devices.map((d) => d.specs?.[sd.key]).filter((v) => typeof v === 'number' && v > 0);
  if (vals.length < 2) return '';
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const ratio = hi / lo;
  if (ratio < 2) return '';
  return `<b class="amber">${esc(sd.label)}が ${esc(formatSpecValue(sd, lo))} と ${esc(formatSpecValue(sd, hi))} で
    約${num(Math.round(ratio * 10) / 10)}倍違います。</b>`;
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
      ${ambiguousPanel()}
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
  const disc = discontinuedNote(m, store.byId);

  return `<div class="panel">
      <div class="card-head">
        <div>
          <div class="maker">${esc(m.maker)} ${statusBadges(m)}</div>
          <div class="model mono big">${esc(m.model)}</div>
        </div>
      </div>
      ${scopeNote(m)}
      ${disc}
      ${noteBox(m)}
      ${warningBox(m)}
      ${chain.length ? `<div class="cmp cmp-info"><b>後継品</b><span>${[m, ...chain].map((d) => esc(d.model)).join(' → ')}</span></div>` : ''}
      ${specGrid(cat, m)}
      <div class="evidence">${evidenceRow(m)}</div>
      ${m.evidence?.dims?.state === 'verified' && m.dims ? dimDiagram(m.dims, m.holes) : '<div class="dim-none">外形寸法は未確認のため図を表示しません。</div>'}
    </div>
    <div class="panel">
      ${options.length ? `<label class="lbl">取付方式（既設に合わせて選択）</label>
      <div class="chiprow">${options.map((o) =>
        `<button class="chip sm${(S.mounting || m.mounting) === o ? ' on' : ''}" data-act="mount" data-v="${esc(o)}">${esc(o)}</button>`).join('')}</div>` : ''}
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

  // 型式を画面で最大に見せる場所なので、生産終了バッジは他の呼び出し箇所と同様にここでも出す。
  // バッジが無いと「発注してはいけない型式」が一番目立つ見た目になる。
  const head = `<div class="panel">
    <div class="result-head">
      <span class="mono big">${esc(m.model)}</span>${statusBadges(m)}
      <span class="sub">${esc(m.maker)} ・ ${esc(formatSpec(ps, m))}</span>
    </div>
    <div class="sub">互換品候補 ${list.length}件</div>
  </div>`;

  // 0件の理由はカテゴリごとに違う。説明を持っているカテゴリにはそれを言わせる
  const empty = cat.emptyNote(m) ||
    `<b class="amber">互換候補が登録されていません。</b>
     <div>電気的に成立しない組み合わせ（出力極性・配線本数の相違）は候補から除外しています。</div>`;
  const body = list.length
    ? list.map((c, i) => candidateCard(cat, m, c, i)).join('')
    : `<div class="panel empty-note">${empty}</div>`;

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
