/**
 * smoke・test:ext が起動するブラウザ（Chromium）の実行ファイルを、環境から探す。
 *
 * 以前は両方のスクリプトが `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` を
 * 直書きしていた。統合時（28f29ae）の作業環境の場所がそのまま残ったもので、
 * 環境のブラウザが入れ替わる（chromium-1243 になり、中のフォルダも chrome-linux64 になった）
 * たびに走らなくなり、環境側でシンボリックリンクを作って回避していた。
 * 回避を忘れると smoke が走らないまま報告される危険があるので、探す処理を1か所に置く。
 *
 * 探す順番（上から見て、最初に見つかったものを使う）：
 *   1. 環境変数 MAGNET_CHROMIUM_PATH
 *   2. playwright 自身が期待する場所（chromium.executablePath()）
 *   3. PLAYWRIGHT_BROWSERS_PATH と ~/.cache/ms-playwright の下の chromium-<数字>
 *   見つからなければ例外を投げる。検査を飛ばして PASS と出す経路は作らない
 *   （ブラウザが無ければ `npm run check` が exit≠0 で止まる、という約束を守るため）。
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { chromium } from 'playwright';

/** 3 で中を見るフォルダ名。古い版は chrome-linux、chromium-1243 は chrome-linux64 だった */
const PLATFORM_DIRS = ['chrome-linux', 'chrome-linux64'];

/** chromium_headless_shell-<数字> などを拾わないよう、名前全体で一致させる */
const CHROMIUM_DIR = /^chromium-(\d+)$/;

/**
 * @returns {{ executablePath: string, step: 1 | 2 | 3, label: string }}
 *   executablePath は chromium.launch() にそのまま渡す。step・label は出力の1行用で、
 *   報告書でどのブラウザで走ったかを読めるようにするためのもの（check() の項目にはしない）。
 */
export function findChromium() {
  // 1. 指定があるのにファイルが無いときは、2・3 へ進まずに失敗させる。
  //    黙って次へ進むと、指定したのと別のブラウザで走ったことに気づけないため。
  const env = process.env.MAGNET_CHROMIUM_PATH;
  if (env) {
    if (!existsSync(env)) {
      throw new Error(`MAGNET_CHROMIUM_PATH に指定されたブラウザが見つかりません: ${env}`
        + '（指定がある間は、ほかの場所を探しません）');
    }
    return { executablePath: env, step: 1, label: 'MAGNET_CHROMIUM_PATH' };
  }

  // 2. playwright の版と組み合わせが保証されたブラウザなので、あれば最優先にする。
  //    環境のブラウザは playwright の版と揃っていないことが多く（1.49.1 は chromium-1148 を
  //    期待するが、環境にあるのは chromium-1243）、ここで見つからないのは普通のこと。
  const looked = [];
  const expected = chromium.executablePath();
  looked.push(expected);
  if (existsSync(expected)) return { executablePath: expected, step: 2, label: 'chromium.executablePath()' };

  // 3. 数字は playwright が振るブラウザの版（リビジョン）。複数あれば新しいものを選ぶ。
  //    古いものが残っているだけの環境で、古いほうに固定されてしまうのを避けるため。
  //    フォルダがあっても実行ファイルが無いもの（取得の途中で止まったものなど）は候補にしない。
  const roots = [process.env.PLAYWRIGHT_BROWSERS_PATH, join(homedir(), '.cache', 'ms-playwright')].filter(Boolean);
  const found = [];
  for (const root of roots) {
    looked.push(join(root, 'chromium-<数字>', `{${PLATFORM_DIRS.join(',')}}`, 'chrome'));
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const m = CHROMIUM_DIR.exec(name);
      if (!m) continue;
      for (const dir of PLATFORM_DIRS) {
        const p = join(root, name, dir, 'chrome');
        if (existsSync(p)) found.push({ rev: Number(m[1]), p });
      }
    }
  }
  if (found.length) {
    found.sort((a, b) => b.rev - a.rev);
    return { executablePath: found[0].p, step: 3, label: 'chromium-<数字> の中で一番新しいもの' };
  }

  // 4. どこにも無い。見た場所をすべて並べ、どこに置けばよいかを読めるようにする。
  throw new Error('ブラウザ（Chromium）が見つかりません。見た場所：\n'
    + looked.map((p) => `  - ${p}`).join('\n')
    + '\n  （MAGNET_CHROMIUM_PATH に実行ファイルの場所を指定することもできます）');
}
