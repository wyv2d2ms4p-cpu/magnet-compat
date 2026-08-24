/**
 * インバータ / サーボユニット。
 *
 * 移行元の1467件のうち1440件は buildInv/buildServo による組み合わせ生成物で
 * 実在確認が取れていない。data/_seed/ に provisional として凍結してあり、
 * 誤発注防止のため配布物にも入れない。インバータの実データはこの結果0件から
 * 始まり、出典URL付きで昇格したものから順に表示される（現在は三菱 FREQROL のみで、
 * 現行品 FR-E800 と生産終了品 FR-E700 の両方を含む。件数は tools/smoke.mjs と
 * tools/test-compat.mjs が持つ。docs/mitsubishi-fr-e800-verified.md と
 * docs/fr-e700-to-e800-replacement.md 参照）。
 *
 * 昇格したレコードは公式で確認できた項目しか持たない。FR-E800 の40機種は
 * 専用カタログ L(名)06130-J p.81-83 から定格出力電流と定格容量(kVA)を取得済みで、
 * gate が引く主スペック specs.ratedCurrentA が揃ったため互換候補が算出できる。
 * 外形寸法は未取得なので dims 由来のバッジは「要検証」のまま出る。
 *
 * 定格は **ND定格**（Pr.570 多重定格選択の初期設定）で統一する。形名の容量表記と
 * 4桁電流コード（FR-E820-3.7K-1 ≡ FR-E820-0175 ＝ 17.5A）がND基準なので、
 * 形名から引ける値と specs が一致する。LD定格は登録しない。ratedCurrentA という
 * 名前はどちらの定格かを語らず、多重定格を持たない接触器カテゴリとも共有している
 * ため、同じキー空間にLD値を並べると取り違えの入口になる。
 *
 * 残る27件は安川サーボの生産中止一覧（メーカー公表の実データ）で、
 * data/servo.json に入っている。1行が `SGDM / SGDH / SGDP` や
 * `CACR-SR□□BB/BC` というワイルドカード付きのシリーズ単位マスクなので
 * `modelScope:"series"` が付いており、コアが互換判定から除外する。
 * 「その型式がいつ生産中止になり、いつまで修理できるか」を引くための行。
 */
import { registerCategory, numericStanding } from '../core/registry.mjs';
import { withinWindow, preferTrue, ascending, logRatio } from '../core/compat.mjs';
import { evidenceRank } from '../core/evidence.mjs';
import { num, esc } from '../core/util.mjs';

/** 電源相数。単相入力機と3相入力機は電圧クラスが同じでも置換できない。 */
function supplyPhase(d) {
  return /単相/.test(d.specs?.voltage || '') ? 1 : 3;
}

registerCategory({
  id: 'inverter',
  label: 'インバータ',
  group: 'drive',
  /**
   * 宣言順は「見分けやすさ」の順。主スペック（判定に使う値）とは別で、
   * `primary` フラグのほうが主スペックを決める。
   *
   * 適用モータ容量を先頭に置くのは、曖昧一致リストの識別材料が
   * `distinguishingSpec` によって宣言順の先頭から選ばれるため。現場の保全員は
   * 設備の銘板やモータ側から型式に入ることが多く、`FR-E820-1.5K-1` と
   * `FR-E820-15K-1` の取り違えは「1.5kW / 15kW」なら即断できるが、
   * 「8A / 60A」だとモータ容量からの変換が一段挟まる。判定は定格出力電流で
   * 行いつつ、人が見分ける材料は容量を出す。並べ替えないこと。
   */
  specDefs: [
    { key: 'ratedPowerKW', label: '適用モータ容量', unit: 'kW', format: (v) => `${num(v)}kW` },
    { key: 'ratedCurrentA', label: '定格出力電流', unit: 'A', primary: true, format: (v) => `${num(v)}A`, distance: (a, b) => Math.abs(a - b) },
    { key: 'ratedCapacityKVA', label: '定格容量', unit: 'kVA', format: (v) => `${num(v)}kVA` },
  ],
  gate(a, m) {
    if (a.id === m.successorId) return true;
    if (a.specs?.voltClass !== m.specs?.voltClass) return false;
    // 電圧クラスだけでは電源相数が区別できない。FR-E820S(単相200V入力) は
    // モータへの出力が3相200Vなので FR-E820(3相200V入力) と同じ 200 クラスだが、
    // 電源が違うので置換できない。voltClass の数値比較に任せると通ってしまう。
    if (supplyPhase(a) !== supplyPhase(m)) return false;
    return withinWindow(a.specs?.ratedCurrentA, m.specs?.ratedCurrentA, 0.3);
  },
  enrich(a, m) {
    return { currentDiff: Math.abs((a.specs?.ratedCurrentA ?? 0) - (m.specs?.ratedCurrentA ?? 0)) };
  },
  /**
   * 定格出力電流は接触器と同じく「小さい＝要注意」の一方向なので判定する。
   *
   * ただし旧機種30件（FR-E700）は置換え資料にしか載っておらず定格出力電流を
   * キーごと持たないため、旧機種を基準にした組は全件 'unknown' になる。
   * ここで 0 を補うと「0A は基準より小さくない」と読める判定が静かに混ざるので、
   * numericStanding が値の不在を 'unknown' として返すことに任せる。
   */
  primaryStanding: (a, m) => numericStanding(a, m, 'ratedCurrentA'),
  /**
   * 添える1文。接触器と同じ量・同じ要点なので文面も同じだが、カテゴリどうしは
   * 互いに import しないので、文はここに持つ（インバータが接触器の文言に
   * 追随する関係ではない。多重定格の話を足すなら、直すのはこの1行）。
   */
  standingNote: '実際の負荷電流は定格とはかぎらないので、現場で確認してください。',
  rank(a, b) {
    return (
      preferTrue(a.isSuccessor, b.isSuccessor) ||
      ascending(a.currentDiff, b.currentDiff) ||
      preferTrue(a.sameMaker, b.sameMaker) ||
      evidenceRank(a) - evidenceRank(b) ||
      ascending(a.diff, b.diff)
    );
  },
  /**
   * 候補0件のときの説明。
   *
   * インバータの0件20件（FR-E800 の最小容量帯）は、同じ電圧クラス・同じ電源相数の
   * 型式が**登録済み**で、定格出力電流が窓に入らないだけ。コアの既定文が言っていた
   * 「互換候補が登録されていません」も「出力極性・配線本数の相違で除外」も、
   * ここでは事実と違う（後者はそもそも `sensorGate` にしかない条件）。
   *
   * 書くのは gate が実際に見ている3つ（電圧クラス・電源相数・定格出力電流）まで。
   * **窓幅（±ratio）は画面に出さない。** `withinWindow` は大きい方を基準に取るので
   * （`src/core/compat.mjs:13-16`）、基準値から見た許容幅は下側 -30%・上側 +42.9% と
   * 非対称になる。「±30%」と書くと、実装がしていない判定を画面が説明することになる。
   * 数値を出すなら窓幅を drive.mjs から受け渡す必要もあり、二重管理の入口にもなる。
   *
   * 可否は断定しない。アプリが知っているのは登録された定格だけで、現場の実負荷は
   * 知らない（段4で「容量不足」と書かないと決めたのと同じ原則。
   * `docs/design-c-legacy-inverters.md` 6-10 節・`src/core/ui.mjs` の
   * `loadCheckNote` の JSDoc）。範囲外であることは使えないことを意味しない、と明示する。
   */
  emptyNote() {
    return `<b class="amber">電圧クラス・電源相数・定格出力電流の3条件を満たす型式が、登録データの中に見つかりませんでした。</b>
      <div>インバータの候補は、電圧クラスと電源相数が一致し、定格出力電流が基準に近い型式に絞っています。
      定格出力電流がこの範囲に入らないことは、その機種が使えないことを意味しません。
      実際に必要な容量は現場の負荷で決まるので、容量が近い機種についてはメーカーの選定資料で確認してください。</div>`;
  },
  summary(d) {
    return [
      { label: '定格出力電流', value: d.specs?.ratedCurrentA != null ? `${num(d.specs.ratedCurrentA)}A` : '―' },
      { label: '適用モータ容量', value: d.specs?.ratedPowerKW != null ? `${num(d.specs.ratedPowerKW)}kW` : '―' },
      { label: '定格容量', value: d.specs?.ratedCapacityKVA != null ? `${num(d.specs.ratedCapacityKVA)}kVA` : '―' },
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
  /**
   * 主スペックの定格出力は大小を判定しない。
   *
   * 登録済みの27件はすべて安川の生産中止一覧の**シリーズ単位マスク**で、
   * `ratedPowerW` を1件も持たない（`modelScope:"series"` なのでコアが互換判定から
   * 外し、候補は常に0件になる）。比べる値も、比べる相手も存在しない。
   * 個別型式が登録されたときに大小を語ってよいかは、アンプ単体ではなく
   * モータ・エンコーダ・指令I/F の組み合わせで決まるため、実例が出るまで倒さない。
   */
  primaryStanding: () => null,
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
    // 生産中止シリーズは寸法も定格も持たない。持っている行だけを出す
    if (d.modelScope === 'series') {
      return [
        { label: 'シリーズ', value: d.series || '―' },
        { label: '生産中止', value: d.specs?.discontinuedAt || '―' },
        { label: '補修部品 受付終了', value: d.specs?.partsOrderUntil || '―' },
        { label: '修理対応 期限', value: d.specs?.repairUntil || '受付終了' },
        { label: 'メーカー案内の代替', value: d.specs?.altSeries || 'なし' },
      ];
    }
    return [
      { label: '定格出力', value: d.specs?.ratedPowerW != null ? (d.specs.ratedPowerW >= 1000 ? `${num(d.specs.ratedPowerW / 1000)}kW` : `${num(d.specs.ratedPowerW)}W`) : '―' },
      { label: '指令インタフェース', value: d.specs?.iface || '―' },
      { label: '電源電圧', value: d.specs?.voltage || '―' },
      { label: 'エンコーダ', value: d.specs?.encoder || '―' },
    ];
  },
  emptyNote(m) {
    if (m.modelScope !== 'series') return '';
    const alt = m.specs?.altSeries;
    const lead = alt
      ? `メーカーが案内する代替は <b class="amber">${esc(alt)}</b> です。`
      : 'メーカーが案内する代替シリーズはありません。';
    return `<b class="amber">この行はシリーズ単位のため、型式ごとの互換判定は行いません。</b>
      <div>${lead}
      置換にはアンプ・モータ・エンコーダ・指令インタフェースの組み合わせが関わるため、
      現物の銘板から個別型式を確定させたうえでメーカー選定資料で確認してください。</div>`;
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
