/**
 * インバータ / サーボユニット。
 *
 * 移行元の1467件のうち1440件は buildInv/buildServo による組み合わせ生成物で
 * 実在確認が取れていない。data/_seed/ に provisional として凍結してあり、
 * 誤発注防止のため配布物にも入れない。インバータの実データはこの結果0件から
 * 始まり、出典URL付きで昇格したものから順に表示される（現在は三菱 FREQROL-E800
 * の40機種。docs/mitsubishi-fr-e800-verified.md 参照）。
 *
 * 昇格したレコードは公式で確認できた項目しか持たない。FR-E800 は定格出力電流が
 * 公式資料で未取得のため specs.ratedCurrentA を持たず、gate が引く主スペックが
 * 欠けるので互換候補は出ない（「該当なし」を 0 で埋めない約束の帰結）。
 * 型式・容量・電圧クラスの確認と後継検索には使える。
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
  specDefs: [
    { key: 'ratedCurrentA', label: '定格出力電流', unit: 'A', primary: true, format: (v) => `${num(v)}A`, distance: (a, b) => Math.abs(a - b) },
    { key: 'ratedPowerKW', label: '適用モータ容量', unit: 'kW', format: (v) => `${num(v)}kW` },
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
