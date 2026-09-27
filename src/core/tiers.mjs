/**
 * 候補の段（successor / exact / classMatch / rework）と確認項目。
 *
 * 設計は `docs/design-common-alternates.md`（1章 段・2章 確認項目・6章 一致の結果の共通の形）。
 *
 * **既存の2段は振り分けるだけ。** `computeCompatibles` の戻り値の中身と順番には触らない
 * （`docs/design-insulation-converter.md` 11-2-5）。下の2段はカテゴリが任意で宣言する
 * `alternates(m, ctx)` から足す加算の口で、宣言しないカテゴリでは空配列になる。
 * 宣言の無いカテゴリの画面が1つも変わらないことは `tools/test-extensibility.mjs` が
 * 全カテゴリ・全基準機で見ている。
 */
import { store } from './store.mjs';
import { computeCompatibles, isSeriesScope, dimsTrustworthy, holeMatch } from './compat.mjs';
import { dimDiff, normalizeMounting } from './util.mjs';

/**
 * 段の順番と見出し。順番がそのまま「上の段が勝つ」の優先順になる。
 *
 * 見出しの語は根拠で付ける（11-2-2）。カテゴリに持たせないのは、段の名前が
 * カテゴリごとに揺れると、同じ根拠の候補が画面ごとに違う名前で並ぶため。
 */
export const TIERS = [
  { id: 'successor', title: 'メーカー指定の後継品' },
  { id: 'exact', title: '判定条件がすべて一致' },
  { id: 'classMatch', title: '分類が一致・違いあり' },
  { id: 'rework', title: '配線変更または台数増が必要' },
];

/** 口が返してよい段。上の2段は `computeCompatibles` の振り分けで決まり、口からは足せない */
const LOWER_TIERS = ['classMatch', 'rework'];

/**
 * 確認項目の4状態。印と文言はコアが持つ（設計 2-1）。
 *
 * カテゴリごとに「違う」の言い方を書かせると、断定語が1つのカテゴリから混ざる。
 * 並び順（違う → 未登録 → 現場で確認 → 同じ）もここで決める（設計 2-4）。
 * `missing` の色が `differs` と同じ橙なのは D7（灰色は読み流される側の色）。
 */
export const CHECK_STATES = [
  { id: 'differs', mark: '△', label: '違う' },
  { id: 'missing', mark: '？', label: '未登録・現物で確認' },
  { id: 'field', mark: '◇', label: '現場で確認' },
  { id: 'same', mark: '✓', label: '同じ' },
];

/** 値が無いか。`??` で 0 を補わない（README「データの約束」）。'' も値ではない */
function absent(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}

function requireNumber(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    // 書式違いを unknown に倒すと「解析できないから未登録」として黙って流れる。止めて直させる
    throw new Error(`比べ方 ${name} は数値を受け取ります: ${JSON.stringify(v)}`);
  }
  return v;
}

function requireRange(v, name) {
  if (!v || typeof v !== 'object') throw new Error(`比べ方 ${name} は {min, max} を受け取ります: ${JSON.stringify(v)}`);
  const min = requireNumber(v.min, name);
  const max = requireNumber(v.max, name);
  if (min > max) throw new Error(`比べ方 ${name} の区間が逆です: ${JSON.stringify(v)}`);
  return { min, max };
}

/** 集合どうし・区間どうしの包含関係。向きは「候補 c が基準 b を」で読む */
function containment(bInC, cInB, meet) {
  if (bInC && cInB) return 'equal';
  if (bInC) return 'covers';
  if (cInB) return 'coveredBy';
  return meet ? 'overlap' : 'disjoint';
}

/**
 * 共通の比べ方（設計 6章）。`(基準の値, 候補の値, 項目の定義)` を受けて
 * `{ verdict, relation }` を返す。
 *
 * **どの比べ方も、片方でも値が無ければ `unknown`**（`match` に倒さない）。
 * これは確認項目（表示）のための形で、既存の `gate` には使わない。`gate` は
 * 候補にするかの判断で、たとえば `responseWithin` はパルス側で「両方とも持たなければ通す」。
 * 揃えると `computeCompatibles` の戻り値が変わる余地が生まれる（設計 6章）。
 */
export const COMPARES = {
  /** 完全一致。配列・オブジェクトは中身で比べる */
  equal(b, c) {
    return JSON.stringify(b) === JSON.stringify(c)
      ? { verdict: 'match', relation: 'equal' }
      : { verdict: 'mismatch', relation: null };
  },
  /** 集合（設計 3-4）。重なりが1つでもあれば match で、disjoint だけが mismatch */
  set(b, c) {
    const bs = new Set(Array.isArray(b) ? b : [b]);
    const cs = new Set(Array.isArray(c) ? c : [c]);
    const bInC = [...bs].every((v) => cs.has(v));
    const cInB = [...cs].every((v) => bs.has(v));
    const relation = containment(bInC, cInB, [...bs].some((v) => cs.has(v)));
    return { verdict: relation === 'disjoint' ? 'mismatch' : 'match', relation };
  },
  /** 区間 {min, max}。集合と同じ関係の名前で返す */
  range(b, c) {
    const br = requireRange(b, 'range');
    const cr = requireRange(c, 'range');
    const bInC = cr.min <= br.min && br.max <= cr.max;
    const cInB = br.min <= cr.min && cr.max <= br.max;
    const relation = containment(bInC, cInB, Math.max(br.min, cr.min) <= Math.min(br.max, cr.max));
    return { verdict: relation === 'disjoint' ? 'mismatch' : 'match', relation };
  },
  /** ±比率の窓。大きいほうを基準にするのは `withinWindow` と同じ理由（対称にする） */
  window(b, c, def) {
    const bv = requireNumber(b, 'window');
    const cv = requireNumber(c, 'window');
    const ratio = requireNumber(def.ratio, 'window の ratio');
    if (bv === cv) return { verdict: 'match', relation: 'equal' };
    return Math.abs(bv - cv) <= Math.max(bv, cv) * ratio
      ? { verdict: 'match', relation: 'within' }
      : { verdict: 'mismatch', relation: 'outside' };
  },
  /**
   * 基準の区間が候補の区間に収まるか（向きのある包含。絶縁変換器の入力の H 電圧。12-6 の決定1）。
   * 収まれば `fits` で「同じ」、一部だけ重なれば `overlap` で「現場で確認」、重ならなければ「違う」。
   * `range` は候補が広い `covers` を「現場で確認」にする（スイッチで選ぶ集合と同じ扱い）。
   * ここは基準で受けていた信号を候補も受けるかだけを問うので、候補が広い向きは確かめることが無い。
   */
  fits(b, c) {
    const br = requireRange(b, 'fits');
    const cr = requireRange(c, 'fits');
    if (br.min === cr.min && br.max === cr.max) return { verdict: 'match', relation: 'equal' };
    if (cr.min <= br.min && br.max <= cr.max) return { verdict: 'match', relation: 'fits' };
    return Math.max(br.min, cr.min) <= Math.min(br.max, cr.max)
      ? { verdict: 'match', relation: 'overlap' }
      : { verdict: 'mismatch', relation: 'disjoint' };
  },
  /** 候補が基準以下（向きのある条件。応答時間など） */
  atMost(b, c) {
    const bv = requireNumber(b, 'atMost');
    const cv = requireNumber(c, 'atMost');
    if (bv === cv) return { verdict: 'match', relation: 'equal' };
    return cv < bv ? { verdict: 'match', relation: 'within' } : { verdict: 'mismatch', relation: 'outside' };
  },
};

/** 比べ方の入口。値の欠けはここで一度だけ見るので、個々の比べ方は欠けを気にしない */
export function compareValues(name, b, c, def = {}) {
  const fn = COMPARES[name];
  if (!fn) throw new Error(`比べ方 ${name} はコアにありません（${Object.keys(COMPARES).join('・')}）`);
  if (absent(b) || absent(c)) return { verdict: 'unknown', relation: null };
  return fn(b, c, def);
}

/**
 * 一致の結果から状態へ（設計 6章）。
 * unknown → 未登録／mismatch → 違う／match かつ equal → 同じ／それ以外の match → 現場で確認。
 * `covers` や窓の内側は値が同じではないので「同じ」にしない。現場の設定や条件で決まる。
 * `fits`（基準の区間が候補に収まる）だけは「同じ」にする。基準で成り立っていた信号が候補でも
 * 成り立つので現場で確かめることが無い、という依頼者の決定（12-6 の決定1）。
 */
export function checkStateOf(result) {
  if (result.verdict === 'unknown') return 'missing';
  if (result.verdict === 'mismatch') return 'differs';
  return result.relation === 'equal' || result.relation === 'fits' ? 'same' : 'field';
}

/**
 * カテゴリの `checkDefs` で1枚分の確認項目を作る。並びは状態の順（設計 2-4）。
 * 値の表示は `format`、無い値は「―」。文面は事実と「何を確かめるか」まで。
 *
 * 任意の2つ：
 * - `applies(m, c)` … その組に意味の無い項目を出さない（1出力型どうしの「出力間の絶縁」など）。
 *   出さないのは「該当しない」組だけで、値が無い組は従来どおり「未登録」で出す（11-2-3）
 * - `compareBy(v)` … 比べる量と見せる値を分ける（出典つきの文を見せ、順序だけで比べるなど）。
 *   値が無いときは呼ばないので、欠けは従来どおり `unknown` になる
 */
export function checkRows(category, m, c) {
  const defs = (category.checkDefs || []).filter((def) => typeof def.applies !== 'function' || def.applies(m, c));
  const order = CHECK_STATES.map((s) => s.id);
  const rows = defs.map((def) => {
    if (!def.key || !def.label || typeof def.read !== 'function' || !def.compare) {
      throw new Error(`checkDefs の項目には key・label・read・compare が要ります: ${def.key || def.label || '(名前なし)'}`);
    }
    const bv = def.read(m);
    const cv = def.read(c);
    const by = (v) => (typeof def.compareBy === 'function' && !absent(v) ? def.compareBy(v) : v);
    const result = compareValues(def.compare, by(bv), by(cv), def);
    const state = checkStateOf(result);
    const show = (v) => (absent(v) ? '―' : def.format ? def.format(v) : Array.isArray(v) ? v.join('・') : String(v));
    const note = state === 'differs' ? def.whenDiffers : state === 'field' ? def.whenField : state === 'missing' ? def.whenMissing : '';
    return { key: def.key, label: def.label, state, relation: result.relation, base: show(bv), cand: show(cv), note: note || '' };
  });
  return rows.sort((x, y) => order.indexOf(x.state) - order.indexOf(y.state));
}

/**
 * 「やること」の並び（カテゴリの `todoOrder`）の中で、別メーカーの行を置く位置を示す印。
 * 別メーカーの行は項目の定義ではなく組み合わせ（`sameMaker`）から出るので、項目の key と
 * 同じ並びに置けるよう印で示す。`checkDefs` の key と重ならない綴りにしてある。
 */
export const MAKER_TODO = '@別メーカー';

/**
 * 別メーカーの行の文（設計 2-7-4 の2・D20）。端子番号は書かない（付け替え表は 9章の10 で未決。
 * 端子配列をデータに持たない決定 8-6-4 のままで書ける1行だけにする）。カテゴリに持たせないのは、
 * 条件が「別メーカー」のバッジ（D10）と同じで、どのカテゴリでも同じ文になるため。
 */
const MAKER_TODO_TEXT = '別メーカーのため、端子の並びを確認して配線する';

/** 要約とやることに使う短い言い方（D19・依頼者の決定 2026-09-27）。宣言が無ければ見出しのまま */
function shortOf(def) {
  return def.short || def.label;
}

/**
 * 下の段のカードの要約と「この候補を使うときにやること」（設計 2-7-3・2-7-4。D19・D20）。
 *
 * 返すのは `{ same, differs, todos, count }`。
 * - `same` / `differs` … 要約の2行に並べる短い言い方。「違う」には状態が「違う」と「現場で確認」の
 *   項目を入れ、並びは表と同じ状態の順（D19）。「未登録」はどちらにも入れず、やることの最後の1行に回す
 * - `todos` … 「違う」「現場で確認」の項目ごとに1行と、別メーカーの1行を、カテゴリの `todoOrder`
 *   （重要度の順）で並べ、未登録があれば最後に件数と項目名の1行を**必ず**足す。未登録の行を
 *   カテゴリの並びに入れないのは、どのカテゴリでも最後に置く決定だから（D20 の3）
 * - `count` … 詳細の見出しの件数。詳細に並ぶ項目の数で、「同じ」の項目も数える（依頼者の決定 2026-09-27。9章の12）
 *
 * **「違う」「現場で確認」の項目に `todo` が無い、または `todoOrder` に無ければ例外で止める。**
 * 黙って飛ばすと、表を開かない人にはその違いが見えなくなる（未登録の行を必ず出すのと同じ理由）。
 * 項目の `todo(row, m, c)` が返す文は動作や確認までで、可否は書かない（8-4）。
 */
export function cardGuide(category, m, c, rows) {
  const order = category.todoOrder || [];
  const defs = new Map((category.checkDefs || []).map((d) => [d.key, d]));
  for (const key of order) {
    if (key !== MAKER_TODO && typeof defs.get(key)?.todo !== 'function') {
      throw new Error(`todoOrder の ${key} は、todo を持つ checkDefs の項目ではありません`);
    }
  }
  if (order.filter((k) => k === MAKER_TODO).length !== 1) throw new Error('todoOrder には別メーカーの行の位置（MAKER_TODO）を1回だけ置いてください');

  const open = rows.filter((r) => r.state === 'differs' || r.state === 'field');
  const lines = new Map();
  for (const r of open) {
    const def = defs.get(r.key);
    if (typeof def?.todo !== 'function' || !order.includes(r.key)) {
      throw new Error(`${m.model} → ${c.model}: 確認項目 ${r.key} が「${r.state}」ですが、やることの文（todo）か並び（todoOrder）がありません`);
    }
    const text = def.todo(r, m, c);
    if (typeof text !== 'string' || !text.trim()) throw new Error(`${m.model} → ${c.model}: 確認項目 ${r.key} の todo が空です`);
    lines.set(r.key, text);
  }
  if (!c.sameMaker) lines.set(MAKER_TODO, MAKER_TODO_TEXT);
  const todos = order.filter((k) => lines.has(k)).map((k) => lines.get(k));
  const missing = rows.filter((r) => r.state === 'missing');
  if (missing.length) {
    todos.push(`登録の無い項目が ${missing.length} 件ある（${missing.map((r) => shortOf(defs.get(r.key))).join('・')}）。詳細で確認`);
  }
  return {
    same: rows.filter((r) => r.state === 'same').map((r) => shortOf(defs.get(r.key))),
    differs: open.map((r) => shortOf(defs.get(r.key))),
    todos,
    count: rows.length,
  };
}

/**
 * 口が返した1件を検める。形は `{ tier, parts: [{ id, qty }], rule }`（設計 4-1）。
 *
 * **口は型式の文字列を作れない**（設計 1-2 の3、引き継ぎ書 §2 ルール2）。部品は
 * `store.byId` で解決できる id だけで、画面の型式は登録された綴りのまま。
 * 知らないキー（`model` など）を黙って読み飛ばすと、口が綴りを作った跡が残らないので止める。
 * 並びは同じ型式1件（qty 1 か 2）に限る。違う型式の組は当面出さない（D3）。
 */
function resolveAlternate(alt, m) {
  const where = `${m.model} の alternates`;
  if (!alt || typeof alt !== 'object') throw new Error(`${where}: 候補はオブジェクトで返してください`);
  for (const k of Object.keys(alt)) {
    if (!['tier', 'parts', 'rule'].includes(k)) throw new Error(`${where}: 候補に知らないキー ${k} があります`);
  }
  if (!LOWER_TIERS.includes(alt.tier)) throw new Error(`${where}: 段 ${alt.tier} は口から足せません（${LOWER_TIERS.join('・')} のみ）`);
  if (alt.tier === 'rework' && !(typeof alt.rule === 'string' && alt.rule)) {
    // 台数増・配線変更は機能についての主張なので、名前付きのルールが無いものは出さない（設計 4-3）
    throw new Error(`${where}: rework の候補には rule（ルール名）が要ります`);
  }
  if (!Array.isArray(alt.parts) || alt.parts.length !== 1) {
    throw new Error(`${where}: parts は同じ型式1件だけです（違う型式の組は当面出さない。D3）`);
  }
  const part = alt.parts[0];
  for (const k of Object.keys(part)) {
    if (!['id', 'qty'].includes(k)) throw new Error(`${where}: 部品に知らないキー ${k} があります`);
  }
  const d = store.byId.get(part.id);
  if (!d) throw new Error(`${where}: 登録に無い id ${JSON.stringify(part.id)} を返しました`);
  if (d.category !== m.category) throw new Error(`${where}: 別カテゴリの id ${part.id} を返しました`);
  if (part.qty !== 1 && part.qty !== 2) throw new Error(`${where}: qty は 1 か 2 です（${part.id}: ${part.qty}）`);
  return { device: d, qty: part.qty, rule: alt.rule || '' };
}

/**
 * `computeCompatibles` の戻り値を段に振り分け、口の候補を足す。
 *
 * viewResult は「候補No.1」の添字に振り分け前の `list` を使うので、`list` を受け取る形にしてある。
 * `computeTiers` はこれを `computeCompatibles` と組み合わせただけのもの。
 */
export function tiersOf(list, m, category, ctx = {}) {
  const tiers = {
    successor: list.filter((c) => c.isSuccessor),
    exact: list.filter((c) => !c.isSuccessor),
    classMatch: [],
    rework: [],
  };
  if (typeof category.alternates !== 'function' || isSeriesScope(m)) return tiers;

  // 1つの型式は1つの段だけ。上の段が勝つ（設計 1-2 の1）。基準機自身も最初から埋めておく
  const taken = new Set([m.id, ...list.map((c) => c.id)]);
  const wanted = normalizeMounting(ctx.mounting) || m.mounting;
  const resolved = (category.alternates(m, ctx) || []).map((alt) => ({ alt, ...resolveAlternate(alt, m) }));
  for (const tier of LOWER_TIERS) {
    for (const { alt, device: a, qty, rule } of resolved) {
      if (alt.tier !== tier || taken.has(a.id) || isSeriesScope(a)) continue;
      taken.add(a.id);
      const trustworthy = dimsTrustworthy(a, m);
      // 上の段のカードと同じ派生値を持たせる（取付・寸法のバッジを下の段だけ欠かさない）
      const card = {
        ...a,
        isSuccessor: false,
        sameMaker: a.maker === m.maker,
        mountingMatch: a.mounting === wanted,
        dimsTrustworthy: trustworthy,
        holeMatch: holeMatch(a, m, trustworthy),
        diff: trustworthy ? dimDiff(a.dims, m.dims) : null,
        ...category.enrich(a, m, ctx),
      };
      const checks = checkRows(category, m, a);
      // 要約とやることはここで作る（描画の中で作ると、例外が画面を開くまで出ない。node の検査で全組を通す）
      tiers[tier].push({ ...card, tier, qty, rule, checks, guide: cardGuide(category, m, card, checks) });
    }
  }
  return tiers;
}

/**
 * 候補を4段で返す。`{ successor, exact, classMatch, rework }`。
 * successor・exact は `computeCompatibles` の戻り値の振り分けで、中身も順番もそのまま。
 */
export function computeTiers(m, category, ctx = {}) {
  return tiersOf(computeCompatibles(m, category, ctx), m, category, ctx);
}

/**
 * 基準機についての現場への問い（設計 2-5）。基準機だけを受け取る。
 * 文字列でないものを黙って捨てると、問いが1つ消えても気づけないので止める。
 */
export function fieldQuestionsOf(category, m) {
  if (typeof category.fieldQuestions !== 'function') return [];
  const qs = category.fieldQuestions(m) || [];
  for (const q of qs) {
    if (typeof q !== 'string' || !q.trim()) throw new Error(`${m.model} の fieldQuestions: 問いは空でない文字列で返してください`);
  }
  return qs;
}
