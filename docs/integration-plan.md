# 3アプリ統合 — 現状分析と統合方針

このリポジトリには、同じ「型式を入力 → 互換候補を提示する」UXを持つ独立した
単一HTMLアプリが3本ある。本書はそれらを1アプリ＋カテゴリモジュール構成へ
統合するための現状分析と方針をまとめたもの。

| ファイル | タイトル | 件数 | 記法 | 互換判定の中核 |
|---|---|---|---|---|
| `index.html` | マグネット互換サーチ | 172（実データ） | ES5 `var`/`function` | `ratedA` ±30% 線形窓 |
| `index_3.html` | センサー互換サーチ | 259（実データ） | ES6 アロー/`const` | `capacityClass`/`compatGroup` 一致 |
| `fa-compat.html` | FA部品 互換サーチ | 1467（**うち実データ0**） | ES5 `var`/`function` | `capacityClass` 完全一致 |

カテゴリ追加のたびにHTMLが1本増える構造になっており、共通部分
（`dimDiff`・`esc`・`successorChain`・ウィザードUI・SVG外形図）は3本にコピーで
重複している。統合の目的は、今後のカテゴリ追加を
「データ1ファイル＋モジュール1ファイルの追加」で済ませられるようにすること。

**最重要の前提**: 3ファイルとも外部依存・`fetch`・Service Worker・`localStorage` が
すべてゼロの完全自己完結ファイルで、iOSホーム画面PWA用メタタグを持つ。
実際に iPhone のホーム画面に保存してオフラインで使われているため、
**`file://` で動作すること**は統合後も維持しなければならない絶対条件。

---

## 現状分析

### 1. `ratedA` が異なる物理量を保持している

「カテゴリごとに違う」ではなく**同一カテゴリ内でも違う**。

| アプリ / カテゴリ | `ratedA` の実体 | 実例 | 表示形式 |
|---|---|---|---|
| index.html / contactor・starter | 定格使用電流 **A** | `S-T10` → `11` | `index.html:338` → `+"A"` |
| index.html / thermal | **持たない**（`rangeMin`/`rangeMax`） | `TH-T18` → `0.12〜15` | 別経路 |
| index_3.html / proximity・photo・ultrasonic | 検出距離 **mm** | `E2E-X1R5E1` → `1.5` | `index_3.html:93` → `+'mm'` |
| index_3.html / special（PR-LLK系 6件） | 光ファイバ**導光路長 mm** | `PR-LLK 15m` → `15000` | 同上 |
| index_3.html / special（OSA・OACF系 6件） | **該当なし** → `0` センチネル | `OACF 104` → `0` | `―` |
| fa-compat.html / インバータ | 定格出力電流 **A** | `FR-A820-3.7K` → `17.5` | `fa-compat.html:509` → `+"A"` |
| fa-compat.html / サーボ | **持たない**（`ratedW` を使用） | — | — |

決定的なのは、同じフィールド名が `index.html:338` では `+"A"`、
`index_3.html:93` では `+'mm'` と整形されている点。フィールド名が単位を決めていない。

派生している被害:

- **`ratedA: 0` がセンチネル**として11件（3カテゴリにまたがる）で使われている。
  「検出距離0mm」という実在の値ではなく「規定なし/不明」の意味。
  `index_3.html` は `dist()` の `if(!v||v<=0)return'―'` と順位計算の
  `dr:(m.ratedA>0&&a.ratedA>0)?…:99` で防御しているが、**そのガードを
  アプリごとに再実装する必要がある**。1つ忘れると「0mm同士だから完全一致」となる。
- **距離関数の数学がカテゴリごとに違う**のに同じ名前のフィールドに乗っている。
  `index.html` は ±30% の線形窓（`m` 基準なので**非対称**）、
  `index_3.html` は対数比 `Math.abs(Math.log10(a.ratedA/m.ratedA))`。
  `photo` の検出距離は 2mm〜100,000mm と4桁半に広がるため対数比が正しく、
  電流は容量帯で刻まれるため窓が正しい。**1フィールドに1比較関数という前提が誤り。**
- 両アプリとも既に**カテゴリ別ラベルの回避策を独自に発明済み**
  （`index.html:280` の `CATEGORY_META.primaryLabel`/`unit`、
  `index_3.html:81` の `CAT.pl`）。再設計すべき箇所を現場が既に指している。

### 2. `buildInv`/`buildServo` による組み合わせ生成

`buildInv`（`fa-compat.html:181-198`）と `buildServo`（同 `255-270`）が
`シリーズ × 電圧クラス × 容量` の直積を回し、`code(kw,v)` クロージャで
型式文字列を合成している。**1467件中1440件（98.2%）が機械生成。**

誤発注リスクとして重大な点:

1. **存在しない容量×電圧の組が必ず生成される。** ガードは `if(!FRAME[kw])return;`
   のみで、寸法表の有無しか見ておらず実在性を検証していない。
2. **`code()` が型式ですらない文字列を返す系列がある。**
   `"GA700 "+kwDot(kw)+"kW/"+v+"V"` → `GA700 3.7kW/200V`。
   `note` 自身が「実形式コードは定格電流ベース」と認めている。
3. **後継品リンクが無検証の仮定。** `successorId:makeId(s.successor,v,kw)` は
   「後継機は同一電圧・同一kWで必ず存在する」と決め打ちしている。
4. **`anchor`（●公式確認）バッジがシリーズ単位で継承される。**
   シリーズに1つ印を付けると生成物**全件**に「公式確認」が付く。最も危険。

判定ロジック側の空洞: `FRAME`/`FRAME_S` は容量のみをキーにした共有表で、
`capacityClass` が既に容量と電圧を固定している。結果として**同一クラス内の
全候補は寸法が完全に同一**（実測でクラス内全組の `dimDiff===0` が100%）。
「外形同一」「取付穴一致」バッジと寸法ソートは常時グリーンの装飾でしかない。

### 3. 検証フラグの不統一

6種類あり、うち1つは死にコード、1つは極性が逆。件数は `node:vm` での実測値。

| フラグ | 所在 | データ上の値 | コードから読まれるか |
|---|---|---|---|
| `unverified` | index.html | `true`×103 | ○ |
| `dimVerified` | index.html | `true`/`false` 計59 | ○ |
| `specVerified` | index.html | `true`×55 | **× 参照ゼロ＝死にコード** |
| `rangeVerified` | index.html | `false`×14 | × |
| `verified` | index_3.html | `true`×238 / `false`×21 | ○ |
| `anchor` | fa-compat.html | シリーズ単位 | ○ |

本質は数ではなく意味論の衝突:

- **極性が逆**: `unverified` は「疑いを明示」、`anchor` は「確認を明示」。
  未印のレコードが前者では「確認済み」、後者では「未確認」を意味する。
  単純マージすると全件の意味が反転する。
- **粒度がバラバラ**: record全体 / 寸法のみ / **シリーズ単位**（→ 2. の危険な継承）。
- **表現力が不足**: `index.html` の富士SCブロックは `unverified:true` と
  `specVerified:true` を同時に持つ（意図は「電気仕様は確認済み、寸法は未確認」）。
  しかし `specVerified` は読まれないのでUIはこの区別を表現できない。
- **出典が存在しない**: 真偽値だけでは再検証も鮮度判断もできない。

### 4. コードの重複とモジュール化

`dimDiff`（マンハッタン距離）・`esc`・`successorChain` は3本すべてに同一実装。
ウィザード3ステップ・SVG外形図・バッジ生成も酷似。
一方でコード規約は分岐（ES5 / ES6）、関数名の粒度もバラバラ
（`isCompatibleCandidate` vs `compat`）。

「カテゴリ別JSONに分離」を素直に `fetch('./data/contactor.json')` で実装すると
**`file://` では CORS で必ず失敗し、オフライン利用が壊れる**。
分離は「ソース上の分離」と「配布物の形」を分けて設計する必要がある。

---

## 統合方針

### 全体構成（ソース分離 + ビルドで単一HTML化）

```
src/
  index.html            … シェル（#app のみ）
  core/                 … schema / compat / evidence / ui（3本の重複を統合）
  categories/           … contactor.js starter.js thermal.js proximity.js …
data/                   … カテゴリ別JSON
build.mjs               … data/*.json と src/**/*.js を単一HTMLへインライン展開
dist/index.html         … 配布物（従来どおり単一自己完結ファイル）
```

開発時は分離、配布時は `build.mjs` が単一の自己完結HTMLを出力する。
これによりオフライン / `file://` / iOSホーム画面PWA の配布特性を壊さずに
分離構造を得る。依存パッケージは追加しない。

### 1. カテゴリ固有スペックの再設計

`ratedA` を廃止し、**意味が名前に入った名前付き量**を `specs` に格納する。
カテゴリモジュールが単位・ラベル・比較関数を宣言する。

```js
export default {
  id: "proximity", label: "近接スイッチ",
  specDefs: [
    { key: "sensingDistanceMM", label: "検出距離", unit: "mm",
      format: v => v >= 1000 ? (v / 1000) + "m" : v + "mm",
      distance: (a, b) => Math.abs(Math.log10(a / b)) }   // 対数比
  ],
  gate(a, m) {…}, rank(a, b, m) {…}
}
```

| カテゴリ | スペックキー | 単位 | 距離関数 |
|---|---|---|---|
| contactor / starter | `ratedCurrentA`, `ratedPowerKW` | A / kW | ±30%窓（**対称化して修正**） |
| thermal | `setRangeA:{min,max}` | A | 区間重なり率（現行 `rangeOverlap` を移植） |
| proximity / photo / ultrasonic | `sensingDistanceMM` | mm | 対数比 |
| special（PR-LLK系） | `lightGuideLengthMM` | mm | 対数比 |
| special（OSA/OACF系） | **キー自体を持たない** | — | — |
| inverter | `ratedCurrentA`, `ratedPowerKW` | A / kW | ±30%窓 |
| servo | `ratedPowerW` | W | 対数比 |

**`ratedA:0` センチネルは「キーの不在」で表現し、値としては消滅させる。**
`specDefs` に無いキーはUIも判定も自動的にスキップするため、
各アプリで `if(!v||v<=0)` を書き直す必要がなくなる。

### 2. fa-compat の実データ化

`buildInv`/`buildServo` を削除し、生成物を候補として表示しない。

1. **凍結**: 生成結果1440件を `data/_seed/` に書き出し、作業用の台帳とする。
2. **`modelStatus`**: `catalog-confirmed` / `provisional` を持たせ、
   **`provisional` は既定で候補から除外**。凍結分は全件 `provisional` から出発。
3. **昇格条件**: `evidence.model.srcUrl`（出典URL）が入って初めて
   `catalog-confirmed` に昇格し、候補表示の対象になる。
4. **`anchor` の廃止**: シリーズ単位の継承バッジを削除し、レコード単位の
   `evidence` に置き換える。
5. **寸法表の分離**: 容量キーだけの `FRAME`/`FRAME_S` 共有表は偽の一致を生むため、
   実測/カタログ由来の寸法をレコードごとに持たせる。埋まるまでは
   寸法一致バッジと寸法ソートを出さない。

**この規則は生成データにのみ適用する。** 既存431件は人手でカタログから
起こした実データなので `catalog-confirmed` として移行する。ここに同じ規則を
適用すると431件すべてが非表示になり、現在動いている2アプリの機能が消える。

### 3. 検証フラグの統一（出典URL付き）

6フラグを廃止し、**側面ごとの状態＋出典**を持つ `evidence` に統一する。

```json
"evidence": {
  "model": { "state": "verified", "srcUrl": "https://…", "srcNote": "総合カタログ p.42", "checkedAt": "2026-03" },
  "dims":  { "state": "unverified" },
  "specs": { "state": "verified" }
}
```

- `state` は `verified` / `estimated` / `unverified` の3値。
  **キー欠落時は `unverified`**（安全側）。極性衝突は既定を明示することで解消。
- 側面を `model`/`dims`/`specs` に分けることで「電気仕様は確認済み・寸法は未確認」
  が初めて表現できる（`specVerified` の死にコード解消）。

移行マッピング:

| 現行 | 変換後 |
|---|---|
| `unverified:true` | `dims.state`・`specs.state` = `unverified` |
| `dimVerified:true` / `false` | `dims.state` = `verified` / `estimated` |
| `specVerified:true` | `specs.state` = `verified` |
| `rangeVerified:false` | `specs.state` = `estimated` |
| `verified:true` / `false` | 3側面すべて = `verified` / `estimated` |
| `anchor:true` | **破棄**（レコード単位で再取得） |

**注**: `index_3.html` の `verified:false` は「型式が未確認」ではなく
「値が代表値であり要データシート確認」の意味（UI文言「この型式の値は
代表値(要データシート確認)です」）。`unverified` に潰すと21件の意味が変わるため
3値目 `estimated` が必要。`dimVerified:false`（寸法は入っているが推定値）も同じ性質。

### 4. カテゴリモジュール構成

各カテゴリが同一インターフェースを実装してレジストリに登録する:

```js
registerCategory({
  id, label, group,   // group は並び順のメタデータ。UIの階層には使わない
  specDefs,           // 方針1: 名前付きスペックの宣言
  gate(a, m),         // 候補に入れるか
  rank(a, b, m),      // 並び替え
  enrich(a, m),       // バッジ用の派生値
  detailPanels(m, c)  // カテゴリ固有の詳細比較
});
```

コアが提供してカテゴリ側では書かないもの: `dimDiff`・`esc`・`successorChain`・
ウィザード3ステップ・型式サジェスト・SVG外形図・バッジ生成・`evidence` 表示・
**取付方式の語彙正規化**。

語彙正規化: 現状 `mounting` は同義語が併存している
（proximity のみ `ブラケット型`、他は `ブラケット取付`）。コア側に語彙表を置き、
カテゴリはそこから参照する。併せて**選択肢を実データから導出**する
（固定配列をやめる）ことで「実データにある値が選択肢に無い」不具合を構造的に防ぐ。

カテゴリモジュールが `gate` で必ず扱うべき電気的成立条件:
2線式/3線式の別、および **NPN/PNP の別**。

### UI構成

**大分類タブは設けず、カテゴリチップを横一列**に並べる（統合直後は9カテゴリ）。
チップ行は横スクロール可（`overflow-x:auto`）とし、折り返しで縦に伸びないようにする。
カテゴリ数が15を超えたあたりで入口画面または上位タブを再検討する。

---

## 既知の不具合（統合時に同時修正する）

いずれも現行の実害。1b で対応する。

- `index.html:328` の ±30% 窓が `m` 基準で**非対称**（A→B が候補でも B→A は候補にならない）
- `index.html` の `"接触器直付"` が `MOUNTING` 配列に無く、サーマル47件で
  取付方式ボタンがどれも選択されず、押すと全候補の `mountingMatch` が false になる
- `index.html` の `norm()` がハイフンを除去するため 三菱 `S-N10` と
  パナソニック `SN10` が同一正規化になり、検索ボックスから後者に到達できない
- `index.html` のデバイス `note`（24件）が一度も描画されていない
- `fa-compat.html` の寸法比較が構造上常時「一致」
- **`index_3.html` で NPN/PNP がハードフィルタでない。** 不一致は `△` バッジと
  第7位のタイブレークにすぎず、検出距離が近ければPNP品がNPN品より上位に来る。
  シンク入力PLCに対して動作しない置換が候補No.1になりうる
- `index_3.html` の `MOUNT.photo` に実データに無い `'アングル一体型'` があり、
  逆に photo 4件が持つ `'ねじ込み型'` が選択肢に無い
- **生成データのID衝突40件**（フェーズ1aで判明）。`makeId()` が系列キー・電圧・容量
  しか見ないため、`FRA800` のように `INV_SERIES` と `VEC_SERIES` の両方に登録された
  系列でIDが重複する。元アプリでは2配列が同時表示されないため露見していなかった

---

## 段階計画

| フェーズ | 内容 | 状態 |
|---|---|---|
| 0 | `index 3.html` → `index_3.html` リネーム | 完了 |
| 1a | `data/**` へのデータ分離とスキーマ移行。アプリHTMLは無変更 | 完了 |
| **1b** | **統合アプリ本体・`src/categories/*.mjs`・`build.mjs`。既知の不具合も対応** | **完了** |
| 2 | fa-compat の実データ化（`_seed` から出典URL付きで昇格） | 未着手 |
| 3 | 既存431件の `evidence.*.srcUrl` を充実 | 未着手 |

### フェーズ1a の成果物

```
data/
  contactor.json (95)   starter.json (29)   thermal.json (48)
  proximity.json (123)  photo.json (118)    ultrasonic.json (6)   special.json (12)
  inverter.json (0)     servo.json (0)
  reference/makers.json (10)  reference/servo-discontinued.json (27)
  _seed/inverter-generated.json (904)  _seed/servo-generated.json (536)
tools/
  schema-map.mjs    … 移行仕様の宣言（唯一の仕様）
  read-sources.mjs  … HTML から node:vm で生データを取り出す
  extract.mjs       … 仕様に従って data/** を生成（冪等）
  verify-data.mjs   … 仕様に従って移行元と移行先を突合（11項目）
```

`extract.mjs` と `verify-data.mjs` は変換コードを共有せず、`schema-map.mjs` の
宣言だけを共有して独立に実装している。同じバグを共有しないための構成。

**インバータ・サーボの実データは0件。** 承認された「1467→27件」の27件は
`YASKAWA_DISC` の安川サーボ生産中止シリーズ参照行で、個別の発注可能型式ではなく
`SGDM / SGDH / SGDP`、`CACR-SR□□BB/BC/BD` のようなワイルドカード付きの
シリーズ単位マスクだった。デバイスレコードに押し込むと `ratedW:0`・`voltClass:-1`
というセンチネル濫用になるため、参照データとして別ファイルに置いている。
1b でインバータ/サーボのカテゴリを表示するにはフェーズ2が前提。

### 検証

```bash
node tools/extract.mjs      # data/** を生成
node tools/verify-data.mjs  # 11項目すべて PASS を確認
```


---

## フェーズ1b の成果物

```
src/
  index.html              … シェル（CSS変数でテーマを一元管理）
  core/
    util.mjs              … esc / norm / dimDiff / successorChain / 取付方式の語彙正規化
    store.mjs             … デバイス保管庫。provisional は読み込み時に除外
    registry.mjs          … registerCategory とカテゴリ取得
    compat.mjs            … gate→enrich→rank の枠組みと数値ヘルパー
    evidence.mjs          … 検証状態の解決と表示
    ui.mjs                … ウィザード部品・外形図・バッジ・候補カード
    app.mjs               … 状態・画面遷移・イベント
  categories/
    contactor.mjs（接触器・開閉器） thermal.mjs
    sensor-common.mjs sensors.mjs（近接・光電・超音波・特殊）
    drive.mjs（インバータ・サーボ／データ0件の枠組み）
build.mjs                 … 単一HTMLへインライン展開
dist/index.html           … 配布物（266KB・外部依存ゼロ）
tools/
  regress.mjs             … 移行元の判定と突合（回帰チェック）
  smoke.mjs               … file:// で実際に開いて確認
  test-extensibility.mjs  … カテゴリ追加が2ファイルで完結することの自動確認
```

### カテゴリ追加の手順

1. `data/<id>.json` を置く
2. `src/categories/<id>.mjs` で `registerCategory({...})` する
3. `node build.mjs`

`build.mjs` はモジュールとデータを自動で拾い、`import` 関係から連結順を決めるため、
**コアにも `build.mjs` にも手を入れる必要がない**。この保証は
`tools/test-extensibility.mjs` がダミーカテゴリを実際に追加・ビルド・操作して
検証し、必ず後始末する。

### 単一HTML化の方式

ES Modules をそのまま `<script type="module">` に置く方式は取らず、`import`/`export`
を落として1つの古典的スクリプトに連結し IIFE で包む。`file://` でのモジュール解決に
依存しないため、iPhone のホーム画面に保存したオフライン利用が確実に動く。
ビルド時に次を検査し、1つでも該当すれば失敗する。

- 連結結果が構文として成立するか（`node:vm` でパース）
- トップレベル名の衝突（連結後は1スコープに同居するため）
- `fetch(` / 外部 `<script src>` / 外部スタイルシート / 動的 `import(` の混入
- `provisional` レコードの混入（誤発注防止の要）

### 既知の不具合の対応結果

| 不具合 | 対応 |
|---|---|
| ±30%窓が `m` 基準で非対称 | 大きい方を基準にして対称化（`withinWindow`）。取りこぼしより1件多く見せるほうが安全なため `max` を採用 |
| `接触器直付` が選択肢に無い | 取付方式の選択肢を実データから導出（`mountingOptions`）。固定配列を廃止したので同種のずれが構造的に起きない |
| `ブラケット型` / `ブラケット取付` の同義語併存 | コア側の語彙表で正規化（`normalizeMounting`） |
| `norm()` の `S-N10` / `SN10` 衝突 | 複数一致時は確定させず選ばせる。取り違えの警告を出す |
| デバイスの `note` が未描画 | 確認画面と候補カードに描画 |
| NPN/PNP がハードフィルタでない | `gate` へ移動。`NPN/PNP` 選択可能品があるため集合の交わりで判定する |
| `fa-compat` の寸法比較が常時「一致」 | 寸法の信頼性を `evidence.dims` で判定。未確認なら比較もバッジも出さない |

### 検証

```bash
npm run check   # データ検証 → ビルド → 回帰 → スモーク → 拡張性
```

| 種別 | 内容 | 結果 |
|---|---|---|
| データ検証 | 移行の非破壊性11項目 | 11/11 PASS |
| 回帰チェック | 全431型式の候補リストを移行元の判定と突合 | 説明できない差分 0件 |
| スモーク | `file://` で実際に開いて18項目 | 18/18 PASS |
| 拡張性 | カテゴリ追加が2ファイルで完結するか | 6/6 PASS |

回帰チェックの差分内訳（いずれも意図した修正）:

- 候補集合が完全一致 349型式（うち並び順のみ変化 138）
- 窓の対称化で候補が増えた 187件
- 極性フィルタで候補が減った 174件

差分がゼロであることだけを見ると修正が黙って戻されたときに検出できない
（修正を外すと移行元と一致してしまう）ため、意図した修正が実際に効いていることも
併せて検査している。
