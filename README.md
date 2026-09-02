# magnet-compat — FA部品 互換サーチ

型式を入力すると互換品の候補を提示する、現場向けのオフラインWebアプリ。
電磁接触器・電磁開閉器・サーマルリレー・各種センサー・サーボを1つのアプリで扱う。

配布物は `dist/index.html` の**単一ファイル**で、外部依存はゼロ。
`file://` で直接開けるので、iPhone のホーム画面に保存してオフラインで使える。

## 使い方（開発）

```bash
npm install        # playwright のみ（テスト用）
npm run build      # dist/index.html を生成
npm run check      # データ検証 → legacy検証 → ビルド → 回帰 → 互換判定 → 0件パネル → スモーク → 拡張性
```

| コマンド | 内容 |
|---|---|
| `npm run build` | `src/**` と `data/**` を単一HTMLへインライン展開 |
| `npm run verify` | 移行元HTMLとのデータ突合＋追加レコードの規約検査 |
| `npm run verify:legacy` | `data/legacy/*.tsv` の列構成・型式重複・後継型式の実在検査 |
| `npm run regress` | 全431型式の候補リストを移行元の判定と突合 |
| `npm run test:compat` | インバータの互換判定（電圧クラス・電源相数・容量帯の窓）を直接検証。窓のペアの対称は接触器・電磁開閉器でも検査する |
| `npm run test:sensor` | センサー系の0件パネルが名乗る条件が `sensorGate` の必要条件であることの検算 |
| `npm run smoke` | `file://` で実際に開いて動作確認 |
| `npm run test:ext` | ダミーカテゴリを足して、ビルド→UI→互換判定まで動くことの確認 |

各検査の項目数と内訳は `npm run check` の出力に出る。
検査は増えていくので、ここには件数を書かない（書くと実態からずれる）。

## カテゴリを追加する

新カテゴリに要るものは次のとおり。件数ではなく、この一覧が実態。

- **`data/<id>.json`** — レコードを置く
- **`src/categories/<id>.mjs`** — `registerCategory({...})` でカテゴリを登録する
  （ファイル名とカテゴリidは一致しなくてよい。`sensors.mjs` は4カテゴリを登録する）
- **`tools/schema-map.mjs` の `ADDED_SPEC_KEYS`** — そのカテゴリの `specs` のキーを宣言する。
  宣言が無いと `specs` のキー名の綴り間違いを検出できないため
  （未宣言のキーは `npm run verify` の「追加レコードの規約」で落ちる）

そのうえで `npm run build` → `npm run check`。

`build.mjs` はモジュールとデータを自動で拾い、`import` 関係から連結順を決めるため、
**コアにも `build.mjs` にも手を入れる必要がない**。
`npm run test:ext` が確かめているのはここまでで、
`ADDED_SPEC_KEYS` の宣言漏れは `npm run verify` 側で落ちる。

```js
import { registerCategory } from '../core/registry.mjs';
import { withinWindow, preferTrue, ascending } from '../core/compat.mjs';

registerCategory({
  id: 'example', label: '例', group: 'misc',
  // カテゴリ固有スペックは単位・書式・距離関数まで含めて宣言する
  specDefs: [{ key: 'torqueNm', label: '定格トルク', unit: 'N·m', primary: true,
               format: (v) => `${v}N·m` }],
  gate: (a, m) => withinWindow(a.specs?.torqueNm, m.specs?.torqueNm, 0.3),
  rank: (a, b) => preferTrue(a.mountingMatch, b.mountingMatch) || ascending(a.diff, b.diff),
  summary: (d) => [{ label: '定格トルク', value: `${d.specs.torqueNm}N·m` }],
});
```

## データを増やす

フェーズ2以降のデータ拡充は、カテゴリごとにサブエージェント
`compat-researcher`（`.claude/agents/compat-researcher.md`）を1体ずつ起動して行う。
各エージェントは**自分の担当カテゴリの `data/<category>.json` だけ**を編集するので、
カテゴリ単位で並列に走らせられる。

```
> compat-researcher で inverter のデータを拡充して
```

追加レコードには機械的な受け入れ条件がある（`npm run verify` の「追加レコードの規約」）。

- `modelStatus` は `catalog-confirmed`
- `evidence.model.state` は `verified`
- **`evidence.model` に `srcUrl` か `srcNote`（カタログ番号など）が必須。**
  出典の無い型式は検証で落ちるので、レビュー前に止まる
- `specs` のキーは `tools/schema-map.mjs` の `SPEC_MAP` に宣言されたものだけ。
  移行元に無いスペックを新しく足すときは `ADDED_SPEC_KEYS` に宣言する
  （`SPEC_MAP` は移行元キーとの対応表なので、対応の無い左辺を混ぜない）

`tools/extract.mjs` は移行元HTMLから `data/**` を作り直すため、追加分を消してしまう。
追加レコードが残っている状態では停止する（本当に作り直すときだけ `--force`）。

## データの約束

- **スペックは名前に単位を含める。** `ratedCurrentA` / `sensingDistanceMM` /
  `lightGuideLengthMM` のように、フィールド名だけで物理量が決まるようにする。
  かつて `ratedA` が電流・検出距離・導光路長を兼ねていた問題への対応。
- **`specDefs` の宣言順は「人が見分けやすい順」。判定に使う主スペック（`primary`）
  とは別物。** 曖昧一致リストの識別材料は `distinguishingSpec` が宣言順の先頭から
  選ぶので、インバータは判定を定格出力電流で行いつつ、識別材料には適用モータ容量を
  先に出す。現場の保全員は銘板やモータ側から型式に入るため、
  `1.5kW / 15kW` は即断できるが `8A / 60A` は変換が一段挟まる。
- **同じ物理量に複数の定格がある場合は、1つだけを選んで全件そろえる。**
  インバータの多重定格（ND / LD）は `ratedCurrentA` / `ratedCapacityKVA` に
  **ND定格だけ**を入れる。形名の容量表記と4桁電流コードがND基準なので、
  形名から引ける値と `specs` が一致する。`ratedCurrentA` という名前はどちらの
  定格かを語らず、多重定格を持たない接触器カテゴリともキーを共有しているため、
  同じキー空間にLD値を並べると `ratedA` と同じ取り違えを招く。
  低減値（周囲温度40℃超・PWM2kHz以上の括弧付き）も通常定格ではないので入れない。
- **「該当なし」は 0 ではなくキーの不在で表す。** `0` を番兵に使うと、
  ガードを1つ忘れた瞬間に「0同士だから完全一致」という誤判定になる。
- **`evidence` は側面ごとに持つ。** `model` / `dims` / `specs` それぞれに
  `verified` / `estimated` / `unverified` と、任意で `srcUrl` / `srcNote` / `checkedAt`。
  **キーが無ければ `unverified` 扱い**（安全側）。
- **`modelStatus` が `provisional` のレコードは配布物に入らない。**
  実在確認が取れていない型式を候補に出すと誤発注につながるため、
  `data/_seed/` に凍結し、出典URLが付いたものだけを `data/` へ昇格させる。
  ビルドはこの混入を検出して失敗する。`modelStatus` の付け忘れや綴り間違いも
  （読み込みがホワイトリストなので黙って消える）同じくビルドで検出して失敗する。
- **個別の発注可能型式でない行は `modelScope:"series"` を付ける。**
  `SGDM / SGDH / SGDP` のようなシリーズ単位のマスクを型式と同列に扱うと
  誤発注につながるため、互換判定から外し、UIで明示する。
- **型式の正規化は「集める」と「見分ける」で分ける。**
  `normLoose`（空白・ハイフン・小数点を除去し、英字 O を数字 0 に寄せる）は
  候補を集めるためだけに使い、
  `normExact`（小数点は残す）で見分ける。小数点を落とすと
  `FR-E820-1.5K-1`（1.5kW）と `FR-E820-15K-1`（15kW）が同じ綴りになり、
  10倍容量の違う機種を掴む。逆に集めるほうを厳しくすると、うろ覚え入力
  （`I-210.31` を `I21031`）が引けなくなるうえ、小数点を省いた入力が
  15K 側と完全一致して曖昧一致リストを素通りする。
  O と 0 の同一視も集める側だけ。銘板の `MS3749-A-O25` をゼロで打った入力を
  拾うためのもので、読み取りの曖昧さであって値の違いではない
  （I と 1、B と 8 は事例が無いので対象外。理由は `src/core/util.mjs` の JSDoc）。
- **同じ綴りに読める型式が並ぶときは、見分ける材料を必ず併記する。**
  曖昧一致リストは候補どうしで値が割れているスペックを選んで全行に出す。
  主スペック固定にすると、それが未登録のカテゴリで全行が系列名になり、
  区別できるのが取り違えている型式だけになる。
  `npm run verify` はこの見分けがつかない衝突をビルド前に落とす。

## リポジトリ構成

```
dist/index.html      配布物（単一自己完結ファイル）
src/                 アプリのソース（core / categories / シェル）
data/                カテゴリ別JSON
  _seed/             実在未確認のため配布しない台帳
  reference/         デバイスではない参照情報
  legacy/            旧機種→後継の対応表（TSV・`npm run verify:legacy` が検査）
tools/               移行・検証スクリプト
docs/integration-plan.md   現状分析と統合方針
docs/mitsubishi-fr-e800-verified.md   三菱 FREQROL-E800 の公式確認済み情報（出典と未取得項目）
docs/mitsubishi-fr-e800-ratings.md    同上の定格データ（L(名)06130-J p.81-83 から抽出）
index.html  index_3.html  fa-compat.html   統合前の旧アプリ（参照用）
```

旧3アプリは移行元および回帰チェックの基準として残してある
（`tools/regress.mjs` がこれらの判定関数を実際に動かして突合する）。
