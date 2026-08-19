/**
 * インバータ / サーボユニット。
 *
 * 移行元の1467件のうち1440件は buildInv/buildServo による組み合わせ生成物で
 * 実在確認が取れていない。data/_seed/ に provisional として凍結してあり、
 * 誤発注防止のため配布物にも入れない。インバータの実データはこの結果0件から
 * 始まり、出典URL付きで昇格したものから順に表示される（現在は三菱 FREQROL-E800
 * の40機種。docs/mitsubishi-fr-e800-verified.md 参照）。
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
import { registerCategory } from '../core/registry.mjs';
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
