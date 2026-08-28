/**
 * 絶縁変換器（パルスアイソレータ）。
 *
 * 入力パルスを絶縁したまま整形して出す機器で、判定材料は容量ではなく
 * **信号の種別**（入力・第1出力・第2出力）になる。接触器やインバータのような
 * 「大きい／小さい」の軸を持たないため、窓（`withinWindow`）も
 * `primaryStanding` も使わない。
 *
 * 登録してあるのは MTT MS3749 系の2件だけで、どちらも現場写真で実在を確認した
 * 型式。**型式コードから組み合わせを展開して増やさないこと。** MS3749 の型式は
 * 公式資料には型式コード表の組み合わせとしてしか存在せず、個別型式としての列挙が
 * 無いため、実在の根拠は銘板写真しかない（`data/insulation.json` の
 * `evidence.model` が写真、`evidence.specs` / `evidence.dims` が標準仕様書 MS3749
 * ＝文書番号 MQDDK-110729-33 Rev.2.00 と、側面ごとに出典が分かれている）。
 *
 * 取付穴ピッチ・入力抵抗・S/N の体系・生産終了情報は仕様書から読み取れないので
 * 登録していない。キーごと不在にしてあり、`0` や空文字で埋めていない
 * （README「データの約束」）。
 */
import { registerCategory } from '../core/registry.mjs';
import { preferTrue, ascending } from '../core/compat.mjs';
import { evidenceRank } from '../core/evidence.mjs';
import { num } from '../core/util.mjs';

/**
 * 信号種別の一致。
 *
 * **値が無い側を「一致」に倒さない。** 片方でもキーを持たなければ false を返す。
 * `a === b` だけで書くと `undefined === undefined` が真になり、
 * 「どちらも入力信号を登録していないから一致」という、根拠の無い候補が
 * 静かに混ざる（CLAUDE.md「解析できないから一致とみなす」経路を作らない）。
 * 第2出力の「両方とも持たない」＝1出力型どうしは、これとは別に gate 側で扱う。
 */
function signalMatch(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return a === b;
}

/** 周波数の表示。仕様書は 100kHz / 200kHz と kHz で書いている。 */
function formatFreq(v) {
  return v >= 1000 ? `${num(v / 1000)}kHz` : `${num(v)}Hz`;
}

registerCategory({
  id: 'insulation',
  label: '絶縁変換器',
  group: 'signal',
  /**
   * 宣言順は「人が見分けやすい順」。銘板の印字（IN / OUT1 / OUT2）と
   * 型式コードの並び（電源・入力・第1出力・第2出力）がどちらもこの順で、
   * 現場は端子番号と銘板からこの機器に入る。
   *
   * 曖昧一致リストの識別材料は `distinguishingSpec` が宣言順の先頭から
   * 「値が割れている最初のスペック」を選ぶので、入力・第1出力が同じで
   * 第2出力だけが違う MS3749-A-O22 / -O25 では第2出力が識別材料になる。
   *
   * 主スペック（`primary`）は暫定で入力信号。カード右上とヘッダに出るのは
   * この値で、置換えの可否をいちばん左右するのが「その信号を受けられるか」
   * だから。文字数が多く、実機での見え方は PR の報告に記載してある。
   */
  specDefs: [
    { key: 'inputSignal', label: '入力信号', primary: true },
    { key: 'output1Signal', label: '第1出力' },
    { key: 'output2Signal', label: '第2出力' },
    { key: 'output1MaxFreqHz', label: '第1出力 最大周波数', unit: 'Hz', format: formatFreq },
    { key: 'output2MaxFreqHz', label: '第2出力 最大周波数', unit: 'Hz', format: formatFreq },
    { key: 'powerSupply', label: '電源電圧' },
  ],
  /**
   * 主スペックの入力信号は大小を判定しない。
   *
   * `inputSignal` は信号種別の名前で、「無電圧接点・オープンコレクタ」と
   * 「ラインドライバ」のあいだに大小は無い。順序が無いものに
   * `numericStanding` を当てると、比較できない組を無理やり2値に倒すことになる。
   * 判定しないカテゴリなので `standingNote` も持たない（出番が無い）。
   */
  primaryStanding: () => null,
  /**
   * 候補の必要条件は、入力信号・第1出力・第2出力の3つが一致すること。
   *
   * 入力が違えば信号を受けられない。第1出力は型式コード上かならず指定される
   * （＝必ず存在する）出力なので、違えば受け側が動かない可能性が高い。
   * 第2出力は「なし」があり得るため、**両方が持つときだけ一致を要求し、
   * 片方だけが持つ組は候補にしない**。1出力型を2出力型の代わりに挿すと
   * 使っていた出力が消え、逆向きは端子が余るだけに見えて実際には
   * 端子割付が変わる。どちらも「そのまま挿せる」ではない。
   *
   * 窓（`withinWindow`）は使わない。この判定に大小の概念が無いため。
   *
   * 後継品バイパス（`a.id === m.successorId`）は置いていない。生産終了・後継の
   * 情報を MTT について調べておらず、`data/insulation.json` に `successorId` を
   * 持つレコードが1件も無いので、いま書いても一度も通らない経路になる。
   * 「後継指定なら信号種別が違っても候補に出してよいか」は、実例が出てから
   * その実例と一緒に決める。
   *
   * ---
   * **保留した課題：OUT1 と OUT2 が入れ替わった機器を候補に出したい（未実装）**
   *
   * 依頼者から要求があったが、今回は実装していない。次にこの gate を触る人へ:
   *
   * 1. これは判定の意味を「そのまま挿せる」から「配線を直せば使える」へ
   *    広げる変更になる。いまの候補は前者だけを指している。
   * 2. MS3749 では第1出力にラインドライバを選べない（型式コードの第1出力は
   *    1〜4 のみで、5＝ラインドライバ・パルスは第2出力専用）。つまり
   *    「OUT1 がラインドライバ、OUT2 がオープンコレクタ」という入れ替え品は
   *    同シリーズ内に存在せず、いま実装しても対象は0件になる。
   * 3. 端子割付が出力種別で変わる。第2出力がラインドライバのときは
   *    端子⑥⑦⑧が Y / Z / COM になる（仕様書 p.2）。入れ替えは盤内の
   *    配線変更を伴うので、「候補に出す」と「そのまま置換えられる」が一致しない。
   * 4. 応答周波数が出力種別で違う（オープンコレクタ 100kHz /
   *    ラインドライバ 200kHz）。入れ替えの可否は種別だけでなく周波数まで
   *    見ないと決まらない。
   *
   * 実装するなら完全一致の候補とは別ゾーンに分け、配線変更が要ることを
   * 明示すること（③の2分割＝`zoneHead` が前例）。同じ列に混ぜると、
   * そのまま挿せる候補と見分けがつかなくなる。
   */
  gate(a, m) {
    if (!signalMatch(a.specs?.inputSignal, m.specs?.inputSignal)) return false;
    if (!signalMatch(a.specs?.output1Signal, m.specs?.output1Signal)) return false;
    const a2 = a.specs?.output2Signal;
    const m2 = m.specs?.output2Signal;
    // 両方とも第2出力を持たない（1出力型どうし）なら、第2出力は判定材料にならない
    if (a2 == null && m2 == null) return true;
    return signalMatch(a2, m2);
  },
  rank(a, b) {
    return (
      preferTrue(a.mountingMatch, b.mountingMatch) ||
      preferTrue(a.sameMaker, b.sameMaker) ||
      evidenceRank(a) - evidenceRank(b) ||
      ascending(a.diff, b.diff)
    );
  },
  /**
   * 候補0件のときの説明。
   *
   * 語るのは「その画面で何が落ちたか」ではなく「候補の必要条件」。
   * `emptyNote(m)` は基準機しか受け取らないので、**アプリはその画面で
   * どの条件が効いたかを実行時に知らない**（`src/categories/sensor-common.mjs`
   * の `sensorEmptyNote` と同じ制約）。起きたことを語ると、実際には
   * 別の条件で落ちた画面で偽になる。
   *
   * 見出しで「登録されていません」と断定しないのも同じ理由。0件は登録の
   * 欠落とは限らず、登録済みの型式が判定で外れただけのこともある。
   * この語は検索画面が「実在確認済みのデータが未登録です」の意味で
   * 使っている（`src/core/app.mjs`）。
   *
   * gate を変えたらこの文面も追随させること。名指ししている3条件が
   * `gate` の必要条件でなくなった瞬間、文面だけが残る。
   */
  emptyNote() {
    return `<b class="amber">互換品候補は見つかりませんでした。</b>
      <div>このカテゴリが候補に出すのは、入力信号と第1出力の種別が一致し、
      第2出力も種別が一致する型式だけです。第2出力を一方だけが持つ組は候補にしません。
      この型式では、それを満たす登録型式がありませんでした。
      どの条件で外れたかはこの画面では判別できません。</div>`;
  },
});
