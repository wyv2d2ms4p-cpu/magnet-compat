# magnet-compat — FA部品 互換サーチ

型式を入力すると互換品の候補を提示する、現場向けのオフラインWebアプリ。
電磁接触器・電磁開閉器・サーマルリレー・各種センサーを1つのアプリで扱う。

配布物は `dist/index.html` の**単一ファイル**で、外部依存はゼロ。
`file://` で直接開けるので、iPhone のホーム画面に保存してオフラインで使える。

## 使い方（開発）

```bash
npm install        # playwright のみ（テスト用）
npm run build      # dist/index.html を生成
npm run check      # データ検証 → ビルド → 回帰 → スモーク → 拡張性
```

| コマンド | 内容 |
|---|---|
| `npm run build` | `src/**` と `data/**` を単一HTMLへインライン展開 |
| `npm run verify` | 移行元HTMLとのデータ突合（11項目） |
| `npm run regress` | 全431型式の候補リストを移行元の判定と突合 |
| `npm run smoke` | `file://` で実際に開いて動作確認（18項目） |
| `npm run test:ext` | カテゴリ追加が2ファイルで完結することの確認 |

## カテゴリを追加する

1. `data/<id>.json` にレコードを置く
2. `src/categories/<id>.mjs` で `registerCategory({...})` する
3. `npm run build`

`build.mjs` はモジュールとデータを自動で拾い、`import` 関係から連結順を決めるため、
**コアにも `build.mjs` にも手を入れる必要がない**。

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

## データの約束

- **スペックは名前に単位を含める。** `ratedCurrentA` / `sensingDistanceMM` /
  `lightGuideLengthMM` のように、フィールド名だけで物理量が決まるようにする。
  かつて `ratedA` が電流・検出距離・導光路長を兼ねていた問題への対応。
- **「該当なし」は 0 ではなくキーの不在で表す。** `0` を番兵に使うと、
  ガードを1つ忘れた瞬間に「0同士だから完全一致」という誤判定になる。
- **`evidence` は側面ごとに持つ。** `model` / `dims` / `specs` それぞれに
  `verified` / `estimated` / `unverified` と、任意で `srcUrl` / `srcNote` / `checkedAt`。
  **キーが無ければ `unverified` 扱い**（安全側）。
- **`modelStatus` が `provisional` のレコードは配布物に入らない。**
  実在確認が取れていない型式を候補に出すと誤発注につながるため、
  `data/_seed/` に凍結し、出典URLが付いたものだけを `data/` へ昇格させる。
  ビルドはこの混入を検出して失敗する。

## リポジトリ構成

```
dist/index.html      配布物（単一自己完結ファイル）
src/                 アプリのソース（core / categories / シェル）
data/                カテゴリ別JSON
  _seed/             実在未確認のため配布しない台帳
  reference/         デバイスではない参照情報
tools/               移行・検証スクリプト
docs/integration-plan.md   現状分析と統合方針
index.html  index_3.html  fa-compat.html   統合前の旧アプリ（参照用）
```

旧3アプリは移行元および回帰チェックの基準として残してある
（`tools/regress.mjs` がこれらの判定関数を実際に動かして突合する）。
