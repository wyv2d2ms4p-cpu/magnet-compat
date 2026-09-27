/** 描画部品。3アプリに重複していたウィザード・外形図・バッジをここに集約。 */
import { esc, num, dimDeltaText } from './util.mjs';
import { primarySpec, formatSpec } from './registry.mjs';
import { evidenceRow, warningFor, stateOf } from './evidence.mjs';
import { CHECK_STATES } from './tiers.mjs';

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
  if (d.modelScope === 'series') h += '<span class="badge b-scope">シリーズ単位</span>';
  if (d.discontinued) h += '<span class="badge b-disc">生産終了</span>';
  if (d.makerExited) h += '<span class="badge b-disc">メーカー撤退</span>';
  if (stateOf(d, 'specs') !== 'verified' || stateOf(d, 'dims') !== 'verified') {
    h += '<span class="badge ev-warn">要確認</span>';
  }
  return h;
}

/**
 * シリーズ単位のレコードであることの注意書き。
 *
 * 安川の生産中止一覧は1行が `SGDM / SGDH / SGDP` や `CACR-SR□□BB/BC` という
 * ワイルドカード付きのマスクで、個別の発注可能型式ではない。型式欄をそのまま
 * 発注番号と読まれると誤発注になるため、確認画面で明示する。
 */
export function scopeNote(d) {
  if (d.modelScope !== 'series') return '';
  return `<div class="warn"><div>⚠ この行は<b class="amber">シリーズ単位の記載</b>です
    （<span class="mono">□</span> <span class="mono">△</span> は容量などのワイルドカード）。
    個別の発注可能型式ではないので、実機の銘板で型式を確認してください。</div></div>`;
}

/**
 * 生産終了品であることの注意書き。
 *
 * ②の確認画面は型式を最大文字で見せる画面なので、ここに「新規発注できない」と
 * 書かれていなければ、その型式がそのまま発注番号として読まれる。
 * 後継は successorId から byId で解決する（型式名を文面に直書きしない。
 * データ側の後継指定が変われば表示もそのまま追随する）。
 *
 * ここが出すのは「生産終了・新規発注できない・後継は○○」だけで、note は取り込まない。
 * 生産終了品25件のうち note が置換えの条件なのは5件（「置換えに FR-E8AT03 が必要」など）で、
 * 残り20件は仕様説明・来歴・データ品質の注記。全部を ⚠ にすると本当に警告すべき5件と
 * 同じ重みになり、警告そのものが読み流される。note は noteBox が中立の枠で出す。
 */
export function discontinuedNote(d, byId) {
  if (!d.discontinued) return '';
  const succ = d.successorId ? byId?.get(d.successorId) : null;
  const succLine = succ ? `後継は <b class="amber mono">${esc(succ.model)}</b> です。` : '';
  return `<div class="warn"><div>⚠ この型式は<b class="amber">生産終了</b>です。
    新規発注はできません。${succLine}</div></div>`;
}

/**
 * 後継品への置換えに別途必要な部品の1行。後継品枠の中に置く。
 *
 * 「FR-E820-3.7K-1 に置換えられる」と「そのために FR-E8AT03 が要る」は
 * ひとつづきの手順なので、後継型式と物理的に離さない。別枠の警告にすると、
 * 後継型式だけを読んで発注され、アタッチメントが無くて取り付けられない。
 *
 * 品名も型式も replacementNote から解決する（表示側には直書きしない）。
 * `.cmp b` が色を上書きするため、橙にする語は b ではなく span で出す。
 */
export function replacementLine(d) {
  const r = d.replacementNote;
  if (!r) return '';
  return `<span>置換えには <span class="amber">${esc(r.partType)}</span>
    <span class="amber mono">${esc(r.partModel)}</span> が別途必要です。</span>`;
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
  const declared = category.specDefs
    .map((s) => ({ label: s.label, value: formatSpec(s, d) }))
    // シリーズ単位の行は個別型式の定格を持たない。「― だけの枠」を並べても読めない
    .filter((r) => !(d.modelScope === 'series' && r.value === '―'));
  const rows = [];
  for (const r of [...declared, ...category.summary(d)]) {
    if (rows.some((x) => x.label === r.label)) continue;
    rows.push(r);
  }
  return `<div class="grid">${rows.map((r) =>
    `<div class="spec"><div class="l">${esc(r.label)}</div><div class="v">${esc(r.value)}</div></div>`).join('')}</div>`;
}

/**
 * ③の候補リストのゾーン見出し。
 *
 * 「メーカーが後継として指定した1件」と「当アプリが窓や重なりで拾った候補」は
 * 根拠の強さが違う。1つの列に並べると、公式後継が候補No.1として並ぶだけになり、
 * 「No.1がだめならNo.2で代用」と読める。見出しで根拠を分けて、後者が
 * メーカーの保証ではないことを列の入口で言う。
 *
 * `.zone-head` は `.card` の外側に置く（カード内の見出しにすると、1件目の候補に
 * 属する説明のように読める）。
 */
export function zoneHead(kind, title, note) {
  return `<div class="zone-head ${esc(kind)}"><div class="t">${esc(title)}</div>${
    note ? `<div class="n">${esc(note)}</div>` : ''}</div>`;
}

/**
 * 主スペックが基準より小さい候補の数。
 *
 * `primaryStanding` は 'below' / 'atOrAbove' / 'unknown' / null を返す。
 * ここで数えるのは 'below' だけで、'unknown'（値が無くて比較できない）を
 * 小さい側にも大きい側にも寄せない。
 */
export function belowCount(category, m, list) {
  return list.filter((c) => category.primaryStanding(c, m) === 'below').length;
}

/**
 * カテゴリが `standingNote` を用意していないときに当てる中立文。
 *
 * どの物理量にも掛かる書き方にしてある。ここに電流の文を置くと、宣言を忘れた
 * カテゴリの画面へ「実際の負荷電流は…」が出る。実際、検出距離を主スペックに持つ
 * センサ3カテゴリで一度これが起きた（文面がコアに直書きされていたため）。
 * 中立文はぼやけるが、掛からない量の話をするよりはよい。
 */
const NEUTRAL_STANDING_NOTE = '実際に必要な値は現場の条件で決まるので、現場で確認してください。';

/**
 * 「基準より小さい」候補があるときの注意書き。候補リストの前に1回だけ出す。
 *
 * **書けるのは大小という事実までで、適合の可否は書かない。** アプリが知っているのは
 * 交換前の機器について登録されている値であって、現場で実際に必要な値ではない。
 * 34A の機器が付いていても実負荷が 20A なら 26A 品で足りるので、「容量不足」
 * 「使用不可」と書くと、成立する置換えを現場が捨てることになる。
 *
 * 前後の2文（何と比べたのか／表示が無い候補は何なのか）は**このアプリの挙動の説明**
 * なのでコアが持つ。真ん中の1文だけが物理量ごとに変わるので、カテゴリから受け取る。
 * 全文をカテゴリに持たせると、挙動を変えたときに全カテゴリの文面を直して回ることになる。
 *
 * 表示が無い候補について断りを入れているのは、無印が「基準以上」と
 * 「比較できる値が登録されていない」の2つを兼ねるため。無印を黙って
 * 「基準以上」と読ませない。
 */
export function loadCheckNote(category, n) {
  if (!n) return '';
  return `<div class="load-note">「基準より小さい」は、交換前の機器の登録値との比較です。
    ${esc(category.standingNote || NEUTRAL_STANDING_NOTE)}
    表示が無い候補は、基準以上か、比較できる値が登録されていないかのどちらかです。</div>`;
}

/**
 * 候補の主スペックが基準より小さいことの表示。
 *
 * 出すのは 'below' のときだけ。'atOrAbove' に「基準以上」と出すと、それ自体が
 * 使えるという保証に読める（実負荷を確認しないと決まらないのは大きい側も同じ）。
 * 'unknown' と null に何も出さないのは、判定していないものを判定したように
 * 見せないため。どちらも無印になるが、その断りは loadCheckNote が引き受ける。
 *
 * 置き場所は主スペックの値の直下。バッジ行に混ぜると「生産終了」「要確認」と
 * 同じ橙のピルが並び、どれが何の話なのか見分けがつかなくなる。
 */
function standingMark(category, m, c) {
  if (category.primaryStanding(c, m) !== 'below') return '';
  const ps = primarySpec(category);
  // 頭の △ は、カード内のバッジで「相違あり」を表しているのと同じ記号。値の直下に
  // 置くと主スペック（同じ橙）と地続きに見えるので、行の始まりを記号で示す。
  return `<span class="standing below">△ 基準 ${esc(formatSpec(ps, m))} より小さい</span>`;
}

/**
 * 下の段（classMatch / rework）の候補か。`c.tier` は `tiersOf` が下の段にだけ付ける。
 * 上の2段のカードは `computeCompatibles` の戻り値そのままで、`tier` を持たない。
 */
function isLowerTier(c) {
  return c.tier === 'classMatch' || c.tier === 'rework';
}

/**
 * 確認項目の表（設計 2-4）。1枚のカードに1つ。
 *
 * 違う・未登録・現場で確認は1行ずつ、1つも省かない（件数で打ち切ると、未登録を隠さない決定
 * 11-2-3 の目的に反する）。「同じ」は1行にまとめるが、項目名を並べて数えられる形で残す。
 * チェック欄は置かない（D14。保存する場所が無く、付いたチェックが「確認済み」と読まれる）。
 */
export function checkTable(rows) {
  if (!rows.length) return '';
  const st = new Map(CHECK_STATES.map((s) => [s.id, s]));
  const mark = (id) => `<span class="ck-mark">${esc(st.get(id).mark)} ${esc(st.get(id).label)}</span>`;
  const open = rows.filter((r) => r.state !== 'same').map((r) => `<div class="ck-row ck-${esc(r.state)}">
      <span class="ck-l">${esc(r.label)}</span>
      <span class="ck-v">基準 <span class="mono">${esc(r.base)}</span> / 候補 <span class="mono">${esc(r.cand)}</span></span>
      ${mark(r.state)}${r.note ? `<span class="ck-n">${esc(r.note)}</span>` : ''}
    </div>`).join('');
  const same = rows.filter((r) => r.state === 'same');
  const sameLine = same.length
    ? `<div class="ck-row ck-same">${mark('same')}<span class="ck-l">${same.map((r) => esc(r.label)).join('・')}</span></div>`
    : '';
  return `<div class="checks"><b>確認項目</b>${open}${sameLine}</div>`;
}

/**
 * 下の段のカードの中身（設計 2-7。D18〜D21）。要約 → この候補を使うときにやること → 確認項目の詳細の順。
 *
 * 故障対応中に表を最後まで読む人はいない（2-7-1）ので、やることを先に並べ、表は折りたたむ。
 * 表の中身は `checkTable` のまま変えずに `<details>` で包むだけにしてある。折りたたんでも DOM に残るので、
 * 行を `textContent` で読む検査はそのまま読める。見出しの件数は詳細に並ぶ項目の数（`guide.count`）。
 * 要約の空の行を消さずに「なし」と書くのは、行が無いと「同じ」「違う」のどちらかを読み落としたように見えるため。
 */
export function lowerCardBody(c) {
  const g = c.guide;
  const line = (cls, head, items) => `<div class="${cls}">${esc(head)}：${items.length ? items.map(esc).join('・') : 'なし'}</div>`;
  const todos = g.todos.length
    ? `<div class="todo"><b>この候補を使うときにやること</b><ol>${g.todos.map((t) => `<li>${esc(t)}</li>`).join('')}</ol></div>`
    : '';
  return `<div class="gist">${line('gist-same', '同じ', g.same)}${line('gist-differs', '違う', g.differs)}</div>${todos}`
    + `<details class="ck-detail"><summary>確認項目の詳細（${num(g.count)}件）</summary>${checkTable(c.checks)}</details>`;
}

/**
 * 現場への問い（設計 2-5）。③の結果ヘッダの直下に1回だけ出す。
 * 問いは基準機の性質から出るので、候補の数だけ繰り返すと同じ文が何十回も並ぶ。
 * 答えを入力させて絞る仕組みは作らない（答えを保存する場所が無い）。
 */
export function fieldQuestionsPanel(questions) {
  if (!questions.length) return '';
  return `<div class="panel field-q"><b>交換前に現場で確かめること</b><ol>${
    questions.map((q, i) => `<li><span class="fq-n">問い${i + 1}</span> ${esc(q)}</li>`).join('')}</ol></div>`;
}

/**
 * 候補カード1件。
 *
 * 下の段のカードは同じ部品を使い、次だけを変える（設計 1-5）。
 * - 「候補No.1」は付けない。呼び出し側が添字 -1 を渡すうえ、ここでも下の段なら付けない。
 *   下の段の先頭が No.1 を名乗ると「一番の候補」と読まれる。
 * - 別メーカーのバッジは「別メーカー」。「互換」を名乗らない（11-2-1 ③）。
 *   上の段の「他社互換」は変えない（接触器・サーマルの画面が広く変わるため。D10）。
 * - `detailPanels` の代わりに確認項目の表。両方出すと同じ差が枠と表で2回出る（設計 2-3）。
 *   表の前に要約とやることを置き、表は折りたたむ（`lowerCardBody`。D18）。`note` は今までどおりその前
 * - 右上の寸法の表示（`dim-verdict`）は上の段と同じ（方向ごとの差。D23 は全カテゴリ・全段のカードに当てる）
 * - rework で2台なら型式の横に「× 2台」。`.model` の中身は登録された綴りのままにする。
 */
export function candidateCard(category, m, c, index) {
  const ps = primarySpec(category);
  const lower = isLowerTier(c);
  const lead = c.isSuccessor
    ? '<span class="badge b-succ">メーカー後継品</span>'
    : index === 0 && !lower ? '<span class="badge ev-ok">候補No.1</span>' : '';
  const cross = c.sameMaker ? ''
    : lower ? '<span class="badge b-cross">別メーカー</span>'
    : '<span class="badge b-cross">他社互換</span>';

  /*
   * 寸法が違うときは方向ごとの差（候補 − 基準）を出す（設計 1-7。D23）。
   * 「差 Σ…mm」（`dimDiff` の和）では、どの方向がどれだけ違うかも、候補が大きいのか小さいのかも読めなかった。
   * 分岐の条件（寸法未確認・寸法一致の判定）は `c.diff` のまま変えない。`diff` は各カテゴリの `rank` が
   * 並び順に使っているので、表示のためだけに別の値を作り、`diff` そのものには触れない。
   *
   * 1方向を1行にする（`.dd` を block に。区切りの「・」は文字として残し、画面では隠す）。
   * `.card-right` は縮まない（`flex-shrink:0`）ので、1行のままだと 375px 幅で右の列が 250px 前後に広がり、
   * 型式の列が細って折り返し、10枚はカードの枠からはみ出した（実測）。文字として「・」を残すのは、
   * 読み上げやコピーで3方向がつながって読めなくならないようにするため。
   */
  const dimVerdict = !c.dimsTrustworthy
    ? '<span class="dim-verdict dim">寸法未確認</span>'
    : c.diff === 0 ? '<span class="dim-verdict ok">寸法一致</span>'
    : `<span class="dim-verdict warn">${dimDeltaText(c.dims, m.dims).split('・')
      .map((t) => `<span class="dd">${esc(t)}</span>`).join('<span class="dd-sep">・</span>')}</span>`;

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

  const panels = lower ? lowerCardBody(c) : category.detailPanels(m, c).map(panelBox).join('');
  const qty = lower && c.qty > 1 ? ` <span class="qty">× ${num(c.qty)}台</span>` : '';

  return `<div class="card">
    <div class="card-head">
      <div>
        <div class="maker">${esc(c.maker)} ${lead}${cross}${statusBadges(c)}</div>
        <div class="model mono">${esc(c.model)}</div>${qty}
      </div>
      <div class="card-right">
        <div class="primary-spec mono">${esc(formatSpec(ps, c))}</div>
        ${standingMark(category, m, c)}
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
