/**
 * 絶縁変換器の下の段「分類が一致・違いあり」（`classMatch`）と確認項目の向きのユニットテスト。
 *
 * 設計は `docs/design-common-alternates.md` 3-5・5-1・8-1 と `docs/design-insulation-converter.md` 12-6〜12-8。
 *
 * **`tools/test-insulation-response.mjs` と別ファイルにした理由。** あちらは `gate`（上の段）の
 * 向きを見るファイルで、ここは下の段と確認項目の向きを見る。`test-compat.mjs` の「候補の関係が対称」に
 * 入れないのも同じで、向きのある性質を対称の名の下に置くと検査名が実態を語らなくなる（3-5）。
 *
 * **smoke と分けた理由。** smoke は画面を1件ずつ歩くので代表の組しか見られない。ここは72件の
 * 全組を走査して、段の件数・除外（D5）・向きの入れ替わりを見る。画面に出る側は smoke が見る。
 *
 *   node tools/test-insulation-classes.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadDevices, devicesOf } from '../src/core/store.mjs';
import { getCategory } from '../src/core/registry.mjs';
import { computeCompatibles } from '../src/core/compat.mjs';
import { computeTiers, checkRows } from '../src/core/tiers.mjs';
import { signalRowOf, SIGNAL_CLASS_ROWS } from '../src/categories/insulation-signal-classes.mjs';
import { OUTPUT_ISOLATION_UNREADABLE } from '../src/categories/insulation.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
let n = 0;
function check(name, cond, detail) {
  n++;
  if (cond) console.log(`  ${String(n).padStart(2)}. OK  ${name}`);
  else { failures.push(name); console.log(`  ${String(n).padStart(2)}. NG  ${name}${detail ? ` — ${detail}` : ''}`); }
}

loadDevices(JSON.parse(readFileSync(join(ROOT, 'data', 'insulation.json'), 'utf8')));
const cat = getCategory('insulation');
const all = devicesOf('insulation');
const tiersOfModel = new Map(all.map((m) => [m.model, computeTiers(m, cat, {})]));

/* ---- 1. 上の2段は変わらない ---- */

/**
 * 口を宣言しても、後継＋判定一致は `computeCompatibles` の戻り値の振り分けのまま（11-2-5）。
 * 宣言しないカテゴリの同じ性質は `tools/test-extensibility.mjs` が見ていて、絶縁変換器はそこから外したので、ここで見る。
 */
let upperEdges = 0;
const upperBad = [];
for (const m of all) {
  const list = computeCompatibles(m, cat, {});
  const t = tiersOfModel.get(m.model);
  upperEdges += list.length;
  const same = JSON.stringify(t.successor) === JSON.stringify(list.filter((c) => c.isSuccessor))
    && JSON.stringify(t.exact) === JSON.stringify(list.filter((c) => !c.isSuccessor));
  if (!same) upperBad.push(m.model);
}
check(`絶縁変換器 ${all.length} 件で、後継＋判定一致が computeCompatibles と中身も並びも同じ（候補の辺 ${upperEdges} 本）`,
  all.length > 0 && upperEdges > 0 && upperBad.length === 0, upperBad.slice(0, 5).join(' '));

/**
 * 「判定条件がすべて一致」は綴りの一致で決まる段なので、別メーカーの組が入るのは、どこかで綴りが
 * 別メーカーの語に寄ったとき（10-1-5・D32）。RPPD-JJ1AA1N-R の出力は MS3749・WGP-FZ と同じ綴り
 * `オープンコレクタ` で、入力の綴りと相数だけが RPPD を MS3749 の③から外している。
 * 綴りが寄ったときに黙って上の段に並ばないよう、上の段の全辺でメーカーが同じことを見る。
 *
 * 後半は空振りの担保。実データの上の段は全辺が同じメーカーなので、メーカーを見ない関数でも前半は通る。
 * WGP-FZ-14FK-1 を複製してメーカーだけを変えたレコードを検査の中だけで作り（`data/` には入れない）、
 * 同じ関数がその辺を別メーカーの組として見つけることを見る。
 */
const crossMakerExact = (pairs) => pairs.flatMap(([m, t]) => t.exact
  .filter((c) => c.maker !== m.maker).map((c) => `${m.model} → ${c.model}`));
const exactEdges = [...tiersOfModel.values()].reduce((s, t) => s + t.exact.length, 0);
const realCross = crossMakerExact(all.map((m) => [m, tiersOfModel.get(m.model)]));
const fkBase = all.find((d) => d.model === 'WGP-FZ-14FK-1');
const otherMaker = fkBase && { ...fkBase, id: 'VIRTUAL_WGP_FZ_14FK_1_OTHER_MAKER', model: 'WGP-FZ-14FK-1（仮想・別メーカー）', maker: '（仮想のメーカー）' };
const virtualCross = fkBase ? (() => {
  loadDevices([...all, otherMaker]);
  const t = computeTiers(fkBase, cat, {});
  loadDevices(all);
  return crossMakerExact([[fkBase, t]]);
})() : [];
check(`絶縁変換器の「判定条件がすべて一致」の辺 ${exactEdges} 本に、メーカーの違う組が無い（WGP-FZ-14FK-1 のメーカーだけを変えた仮想のレコードでは見つかる）`,
  exactEdges > 0 && realCross.length === 0 && virtualCross.includes(`WGP-FZ-14FK-1 → ${otherMaker?.model}`),
  `実データ: ${realCross.join(' / ') || '0本'} / 仮想: ${virtualCross.join(' / ') || '見つからない'}`);

/* ---- 2. 下の段の件数 ---- */

/**
 * D1（入力 14 は接点を含まない扱い）・D4（coveredBy・overlap も出す）・D5 の組み合わせで2本（12-8）。
 * 本数を名前に入れる。データを足して変わったら数え直して、12-8 と合わせる。
 */
const lowerEdges = (tier) => all.flatMap((m) => tiersOfModel.get(m.model)[tier].map((c) => ({ m, c })));
const classEdges = lowerEdges('classMatch');
const classNames = classEdges.map(({ m, c }) => `${m.model} → ${c.model}`);
check(`分類が一致・違いありの辺は ${classEdges.length} 本（MS3749-A-D44/H ⇔ WGP-FZ-14FK-1 の両向き）`,
  classNames.length === 2
  && classNames.includes('MS3749-A-D44/H → WGP-FZ-14FK-1') && classNames.includes('WGP-FZ-14FK-1 → MS3749-A-D44/H'),
  classNames.join(' / ') || '0本');
check(`分類が一致・違いありの辺 ${classEdges.length} 本はすべて別メーカー`,
  classEdges.length > 0 && classEdges.every(({ c }) => !c.sameMaker));
const reworkEdges = lowerEdges('rework');
check('配線変更または台数増の辺は0本（D1 の間は作らない。順5）', reworkEdges.length === 0,
  reworkEdges.map(({ m, c }) => `${m.model} → ${c.model}`).join(' / '));

/* ---- 3. 応答時間の遅い候補と WGP-FV は下の段に出さない（D5） ---- */

/**
 * 「下の段に遅い組が無い」だけでは、そもそも該当する組が無くても真になる。
 * 入力・出力の分類が同じで判定一致に入らないアナログ側の組を数え、それがすべて遅い側か
 * 応答時間を型式で決められない組（WGP-FV）で、どれも下の段に無いことを見る（12-8 の25本）。
 */
const classKey = (d, key) => (typeof d.specs?.[key] === 'string'
  ? signalRowOf(key === 'inputSignal' ? 'input' : 'output', d.specs[key]).classes.join('・') : null);
const analog = all.filter((d) => typeof d.specs?.outputSignal === 'string');
const sameClassNotExact = [];
for (const m of analog) {
  const t = tiersOfModel.get(m.model);
  for (const a of analog) {
    if (a.id === m.id || t.exact.some((c) => c.id === a.id)) continue;
    if (classKey(a, 'inputSignal') === classKey(m, 'inputSignal') && classKey(a, 'outputSignal') === classKey(m, 'outputSignal')) {
      sameClassNotExact.push({ m, a, inLower: t.classMatch.some((c) => c.id === a.id) });
    }
  }
}
const slowOrUnknown = ({ m, a }) => typeof a.specs.responseUs !== 'number' || typeof m.specs.responseUs !== 'number'
  || a.specs.responseUs > m.specs.responseUs;
check(`アナログ側で分類が同じで判定一致に入らない組 ${sameClassNotExact.length} 本は、すべて候補が遅いか応答時間が型式で決まらない組で、下の段に無い`,
  sameClassNotExact.length > 0 && sameClassNotExact.every(slowOrUnknown) && sameClassNotExact.every((e) => !e.inLower),
  sameClassNotExact.filter((e) => !slowOrUnknown(e) || e.inLower).map(({ m, a }) => `${m.model} → ${a.model}`).slice(0, 5).join(' / '));
/**
 * WGP-FV は実データでは分類の同じ相手がいない（2件は出力が違う）ので、上の走査では対象0件になる。
 * `test-insulation-response.mjs` と同じく電源だけを変えた仮想の組を検査の中だけで作り（`data/` には入れない）、
 * 下の段にも出ないこと、応答時間を同じ値で与えると判定一致に入ること（止めているのが応答時間だけ）を見る。
 */
const fv = all.find((d) => d.model === 'WGP-FV-14A-1');
const fvVirtual = fv && { ...fv, id: 'VIRTUAL_WGP_FV_14A_3', model: 'WGP-FV-14A-1（仮想・電源違い）', specs: { ...fv.specs, powerSupply: 'DC24V' } };
const tiersWith = (m, extra) => {
  loadDevices([...all, ...extra]);
  const t = computeTiers(m, cat, {});
  loadDevices(all);
  return t;
};
const fvTiers = fv ? tiersWith(fv, [fvVirtual]) : null;
const withRes = (d) => ({ ...d, specs: { ...d.specs, responseUs: 200000 } });
const fvResTiers = fv ? tiersWith(withRes(fv), [withRes(fvVirtual)]) : null;
check('応答時間が型式で決まらない WGP-FV どうしは下の段にも出ない（WGP-FV-14A-1 の電源だけ変えた仮想の組で確認）',
  !!fvTiers && fvTiers.exact.length === 0 && fvTiers.classMatch.length === 0
  && fvResTiers.exact.some((c) => c.id === fvVirtual.id),
  fv ? `下の段 ${fvTiers.classMatch.length} 件 / 応答時間を与えたときの判定一致 ${fvResTiers.exact.length} 件` : 'WGP-FV-14A-1 が data に無い');

/* ---- 3b. 第2出力の条件（5-1。仮想の組で固定する。8-1） ---- */

/**
 * 第2出力は「両方無いか、候補が基準の分類をすべて持つ（equal・covers）」だけを通し、coveredBy・overlap は通さない。
 * 第2出力をスイッチで選ぶ登録品が無いので、実データでは coveredBy・overlap になる組が0本で、
 * 条件を緩めても誰も落ちない。WGP-FZ-14FK-1 を複製して第2出力だけを第1出力と同じスイッチで選ぶ綴り
 * （5V・12V電圧パルス・オープンコレクタ）にしたレコードを検査の中だけで作り（`data/` には入れない）、
 *   - それが基準なら MS3749-A-D44/H（第2出力 12V電圧パルスのみ）は coveredBy なので下の段に出ない
 *   - 向きを逆にすると covers なので出る
 *   - 第2出力を元の綴りに戻した同じ仮想レコードが基準なら出る（止めているのが第2出力の条件だけ）
 * を見る。
 */
const fk1 = all.find((d) => d.model === 'WGP-FZ-14FK-1');
const d44 = all.find((d) => d.model === 'MS3749-A-D44/H');
const out2Virtual = fk1 && {
  ...fk1, id: 'VIRTUAL_WGP_FZ_14FF_1', model: 'WGP-FZ-14FK-1（仮想・第2出力を選択式）',
  specs: { ...fk1.specs, output2Signal: fk1.specs.output1Signal },
};
const out2Plain = fk1 && { ...out2Virtual, id: 'VIRTUAL_WGP_FZ_14FK_1', model: 'WGP-FZ-14FK-1（仮想・複製）', specs: { ...fk1.specs } };
const inLower = (t, d) => !!t && t.classMatch.some((c) => c.id === d.id);
const vBase = fk1 && d44 ? tiersWith(out2Virtual, [out2Virtual]) : null;
const vCand = fk1 && d44 ? tiersWith(d44, [out2Virtual]) : null;
const vPlain = fk1 && d44 ? tiersWith(out2Plain, [out2Plain]) : null;
check('第2出力が基準より狭い候補（coveredBy）は下の段に出ない（WGP-FZ-14FK-1 の第2出力だけを選択式にした仮想の組で確認）',
  !!vBase && !inLower(vBase, d44) && vBase.exact.length === 0,
  vBase ? `仮想→D44/H の下の段: ${vBase.classMatch.map((c) => c.model).join(' | ') || '0件'}` : 'WGP-FZ-14FK-1 か MS3749-A-D44/H が data に無い');
check('向きを逆にすると（第2出力が covers）下の段に出て、第2出力を元の綴りに戻した複製が基準でも出る（止めているのは第2出力の条件だけ）',
  inLower(vCand, out2Virtual) && inLower(vPlain, d44),
  `D44/H→仮想 ${inLower(vCand, out2Virtual)} / 複製→D44/H ${inLower(vPlain, d44)}`);
/**
 * 第2出力が「現場で確認」になるのはこの仮想の組だけ（実データに第2出力をスイッチで選ぶ登録品が無い）。
 * やることに第2出力のスイッチの行が、第1出力の行の直後に出ることを見る（設計 2-7-4。並びは `todoOrder`）。
 */
const vCandTodos = vCand?.classMatch.find((c) => c.id === out2Virtual.id)?.guide.todos ?? [];
const out2At = vCandTodos.indexOf('第2出力のディップスイッチを「12V電圧パルス」に設定する');
check('第2出力が covers の候補では、やることに第2出力のスイッチの行が第1出力の行の直後に出る（仮想の組で確認）',
  out2At > 0 && vCandTodos[out2At - 1] === '第1出力のディップスイッチを「12V電圧パルス」に設定する',
  vCandTodos.join(' | ') || '下の段に無い');

/* ---- 4. 確認項目の向き（3-5・12-6 の決定1） ---- */

/**
 * 「入力の H と見る電圧」は、MS3749 が基準・WGP-FZ が候補なら必ず「現場で確認」、逆向きは「同じ」。
 * 向きの違う組が実在すること、その組は「同じ」の側がいつも候補のほうが広いこと、比べ方を対称な
 * `range` に差し替えると向きの違う組が0本になること（この検査が空振りしていないこと）を見る。
 */
const rowOf = (checks, key) => checks.find((r) => r.key === key);
const reverseOf = (m, c) => tiersOfModel.get(c.model).classMatch.find((x) => x.id === m.id);
function directional(category, key) {
  const out = [];
  for (const { m, c } of classEdges) {
    const back = reverseOf(m, c);
    if (!back) continue;
    const there = rowOf(checkRows(category, m, c), key);
    const here = rowOf(checkRows(category, c, m), key);
    if (there && here && there.state !== here.state) out.push({ m, c, there: there.state, back: here.state });
  }
  return out.filter(({ m, c }) => m.model < c.model);
}
const highV = directional(cat, 'inputHighV');
check(`入力の H と見る電圧の状態が向きで入れ替わる組が実在する（${highV.length} 組）`,
  highV.length === 1 && highV[0].m.model === 'MS3749-A-D44/H'
  && highV[0].there === 'field' && highV[0].back === 'same',
  highV.map((x) => `${x.m.model}→${x.c.model} ${x.there} / 逆 ${x.back}`).join(' | ') || '0組');
const rangeOf = (d) => signalRowOf('input', d.specs.inputSignal).highV;
const wideSide = highV.every(({ m, c, there }) => {
  const [base, cand] = there === 'same' ? [m, c] : [c, m];
  return rangeOf(cand).min <= rangeOf(base).min && rangeOf(base).max <= rangeOf(cand).max;
});
check('その組はすべて「同じ」になる向きで候補の範囲のほうが広い', highV.length > 0 && wideSide);
const symmetricCat = { ...cat, checkDefs: cat.checkDefs.map((d) => (d.key === 'inputHighV' ? { ...d, compare: 'range' } : d)) };
const symHighV = directional(symmetricCat, 'inputHighV');
check('比べ方を対称な range に差し替えると、向きの違う組が0本になる（この検査が空振りでない）',
  symHighV.length === 0 && highV.length > 0, `差し替え後 ${symHighV.length} 組 / 現在 ${highV.length} 組`);

/**
 * 第1出力の分類は、候補がスイッチで選ぶ側なら covers、逆向きは coveredBy（3-4・3-5）。どちらも「現場で確認」。
 */
const out1 = classEdges.map(({ m, c }) => ({ m, c, rel: rowOf(c.checks, 'output1Class')?.relation, state: rowOf(c.checks, 'output1Class')?.state }));
const coversPair = out1.filter((x) => x.rel === 'covers');
check(`第1出力の分類は向きで covers ⇔ coveredBy に入れ替わり、どちらも現場で確認（covers ${coversPair.length} 本）`,
  coversPair.length > 0 && coversPair.every((x) => out1.some((y) => y.m.id === x.c.id && y.c.id === x.m.id && y.rel === 'coveredBy'))
  && out1.every((x) => x.state === 'field'),
  out1.map((x) => `${x.m.model}→${x.c.model} ${x.rel}/${x.state}`).join(' | '));

/* ---- 5. 第1出力と第2出力の間の絶縁（資料の値。向きがある） ---- */

/**
 * 値は資料から系列と出力の組み合わせで決まる（`insulation.mjs` の `OUTPUT_ISOLATION`）。
 * 2出力型のうち、資料から読み取れないと宣言した系列（`OUTPUT_ISOLATION_UNREADABLE`。RPPD。D39）を除く全件が値を持ち
 * （資料の値の付け忘れは「未登録」になって画面では読み取れない場合と見分けがつかない）、同電位と絶縁の両方が実在することを見る。
 *
 * もとは「2出力型の全件に値がある」の1件だった。RPPD を足すとそのままでは落ちるが、消さずに2つに分けた。
 * 宣言から系列を外すと前者が落ち、宣言した系列に推測の値を足すと後者が落ちる。
 */
const isoDef = cat.checkDefs.find((d) => d.key === 'outputIsolation');
const twoOut = all.filter((d) => typeof d.specs?.output2Signal === 'string');
const unreadableOut = twoOut.filter((d) => OUTPUT_ISOLATION_UNREADABLE.includes(d.series));
const isoVals = twoOut.filter((d) => !OUTPUT_ISOLATION_UNREADABLE.includes(d.series)).map((d) => ({ d, v: isoDef.read(d) }));
const samePot = isoVals.filter((x) => x.v?.coupled === 1);
const isolated = isoVals.filter((x) => x.v?.coupled === 0);
check(`2出力型 ${twoOut.length} 件のうち、資料から読み取れないと宣言した系列（${OUTPUT_ISOLATION_UNREADABLE.join('・')} ${unreadableOut.length} 件）を除く全件に出力間の絶縁の資料の値がある（同電位 ${samePot.length} 件・絶縁 ${isolated.length} 件）`,
  isoVals.length > 0 && samePot.length > 0 && isolated.length > 0 && samePot.length + isolated.length === isoVals.length,
  isoVals.filter((x) => !x.v).map((x) => x.d.model).join(' / '));

/**
 * 宣言した系列は data に1件以上あり（宣言が古くならない）、全件が値を持たず、確認項目が「未登録・現物で確認」になる。
 * 確認項目は、同じレコードの複製を候補にした組で見る（RPPD は実データの下の段に出ないため。13-8）。
 */
const unreadableBySeries = OUTPUT_ISOLATION_UNREADABLE.map((series) => {
  const recs = all.filter((d) => d.series === series);
  const bad = recs.filter((d) => {
    const row = rowOf(checkRows(cat, d, { ...d, id: `VIRTUAL_${d.id}` }), 'outputIsolation');
    return isoDef.read(d) !== undefined || row?.state !== 'missing';
  });
  return { series, n: recs.length, bad };
});
check('出力間の絶縁を読み取れないと宣言した系列は data に1件以上あり、全件が値を持たない（「未登録・現物で確認」になる）',
  unreadableBySeries.length > 0 && unreadableBySeries.every((x) => x.n > 0 && x.bad.length === 0),
  unreadableBySeries.map((x) => `${x.series} ${x.n} 件（値を持つか未登録にならない: ${x.bad.map((d) => d.model).join(' / ') || '0件'}）`).join(' | ') || '宣言が空');

/**
 * 基準が同電位・候補が絶縁 → 現場で確認、基準が絶縁・候補が同電位 → 違う。実データの下の段に1組ある。
 * 比べ方を向きの無い equal に差し替えると、向きの違う組が0本になること（空振りでない）も見る。
 */
const iso = directional(cat, 'outputIsolation');
check(`出力間の絶縁の状態が向きで入れ替わる組が実在する（${iso.length} 組。同電位→絶縁は現場で確認、絶縁→同電位は違う）`,
  iso.length === 1 && iso[0].m.model === 'MS3749-A-D44/H' && iso[0].there === 'field' && iso[0].back === 'differs',
  iso.map((x) => `${x.m.model}→${x.c.model} ${x.there} / 逆 ${x.back}`).join(' | ') || '0組');
const symIsoCat = { ...cat, checkDefs: cat.checkDefs.map((d) => (d.key === 'outputIsolation' ? { ...d, compare: 'equal' } : d)) };
check('出力間の絶縁の比べ方を equal に差し替えると、向きの違う組が0本になる（この検査が空振りでない）',
  directional(symIsoCat, 'outputIsolation').length === 0 && iso.length > 0);

/** 1出力型どうしの組には行を出さない。片方が2出力型なら出す（applies） */
const oneA = all.find((d) => d.model === 'MS3749-A-D4/H');
const oneRows = oneA ? checkRows(cat, oneA, { ...oneA, id: 'VIRTUAL_COPY' }) : [];
const mixedRows = oneA && d44 ? checkRows(cat, oneA, d44) : [];
check('1出力型どうしの組には「第1出力と第2出力の間の絶縁」の行を出さず、片方が2出力型なら出す（MS3749-A-D4/H で確認）',
  oneRows.length > 0 && !rowOf(oneRows, 'outputIsolation') && !!rowOf(mixedRows, 'outputIsolation'),
  `1出力どうし: ${rowOf(oneRows, 'outputIsolation') ? '出る' : '出ない'} / D4/H と D44/H: ${rowOf(mixedRows, 'outputIsolation') ? '出る' : '出ない'}`);

/* ---- 6. アナログ側の下の段のカード（docs/design-insulation-converter.md 14-6・14-9 の検査の案1〜4。D52〜D54・D62・D63） ---- */

/**
 * 実データにはアナログ側の下の段の組が1本も無い（M2VS の登録は PR-B2。14-10）。`phasesMatch`・WGP-FV と同じく、
 * 仮想の組を検査の中だけで作って固定する（`data/` には入れない）。
 *
 * WVP-DS-15A-1 を複製してメーカーを変えた2件を作る。片方は応答時間を速くし（500μs）、入力抵抗・許容負荷抵抗・
 * 電源電圧も変える（14-6 の例1・例2 の「違う」がそろう形）。もう片方は応答時間を基準と同じにする。
 *
 * **分類表の行を検査の中だけで足す。** 綴りが基準と同じだと `gate` を通って「判定条件がすべて一致」に入り、
 * 下の段に来ない（下の段は綴りが違い分類が同じ組。M2VS の `0～10V DC` 対 `DC0～10V` がその形）。
 * そこで、既存の分類の綴りだけを変えた仮想の行を `SIGNAL_CLASS_ROWS` に足し、走査が終わったら必ず外す。
 * ファイルの分類表は変えないので、`verify-data` が見る文書・コード・データの突き合わせには触れない。
 */
const ANALOG_ITEMS_PULSE_ONLY = ['inputHighV', 'inputPhases', 'output1Class', 'output1MaxFreqHz', 'outputRating'];
const ANALOG_ITEMS_OUTPUT2 = ['output2Class', 'output2MaxFreqHz', 'outputIsolation'];
const ds15 = all.find((d) => d.model === 'WVP-DS-15A-1');
const virtualRows = ds15 ? [
  { ...signalRowOf('input', ds15.specs.inputSignal), src: 'VIRTUAL-IN', spelling: `${ds15.specs.inputSignal}（仮想）` },
  { ...signalRowOf('output', ds15.specs.outputSignal), src: 'VIRTUAL-OUT', spelling: `${ds15.specs.outputSignal}（仮想）` },
] : [];
const analogVirtual = (suffix, specs) => ({
  ...ds15, id: `VIRTUAL_WVP_DS_15A_1_${suffix}`, model: `WVP-DS-15A-1（仮想・別メーカー・${suffix === 'FAST' ? '速い' : '応答時間が同じ'}）`,
  maker: '（仮想のメーカー）',
  specs: { ...ds15.specs, inputSignal: virtualRows[0].spelling, outputSignal: virtualRows[1].spelling, ...specs },
});
const vFast = ds15 && analogVirtual('FAST', { responseUs: 500, inputResistance: '1MΩ以上', outputLoad: '550Ω以下', powerSupply: 'DC24V' });
const vSameRes = ds15 && analogVirtual('SAME', {});
/** 仮想の行と組を足して下の段の全カードを集める。壊したときに例外で止まっても、検査として NG を出すよう捕まえる */
const lowerCardsWithVirtual = (() => {
  if (!ds15) return { cards: [], error: 'WVP-DS-15A-1 が data に無い' };
  SIGNAL_CLASS_ROWS.push(...virtualRows);
  try {
    loadDevices([...all, vFast, vSameRes]);
    const cards = devicesOf('insulation').flatMap((m) => computeTiers(m, cat, {}).classMatch.map((c) => ({ m, c })));
    return { cards, error: '' };
  } catch (e) {
    return { cards: [], error: e.message };
  } finally {
    SIGNAL_CLASS_ROWS.splice(SIGNAL_CLASS_ROWS.length - virtualRows.length, virtualRows.length);
    loadDevices(all);
  }
})();
const cardOf = (base, cand) => lowerCardsWithVirtual.cards.find(({ m, c }) => m.model === base && c.id === cand?.id)?.c;
const fastCard = cardOf('WVP-DS-15A-1', vFast);
const sameCard = cardOf('WVP-DS-15A-1', vSameRes);
const virtualCards = [fastCard, sameCard].filter(Boolean);
const keysOf = (card) => card.checks.map((r) => r.key);

/**
 * 案1。パルス側だけの項目と、両方とも持たない第2出力の項目（出力間の絶縁を含む）とオプション（D52）は、
 * アナログ側のカードに行が出ない。`applies` を1つでも外すと「未登録」の行が出て落ちる。
 * 空振りでないことは、同じ項目がパルス側の実データの2枚には出ていることで見る（`applies` が全部の組で行を消していない）。
 */
const leaked = virtualCards.flatMap((card) => keysOf(card)
  .filter((k) => [...ANALOG_ITEMS_PULSE_ONLY, ...ANALOG_ITEMS_OUTPUT2, 'option'].includes(k)).map((k) => `${card.model}: ${k}`));
const pulseCards = classEdges.map(({ c }) => c);
const pulseHasAll = pulseCards.length > 0 && pulseCards.every((card) => [...ANALOG_ITEMS_PULSE_ONLY, ...ANALOG_ITEMS_OUTPUT2, 'option']
  .every((k) => keysOf(card).includes(k)));
check('アナログ側の下の段のカードに、パルス側だけの項目（入力の H と見る電圧・入力の相数・第1出力 最大周波数・出力の定格）と、'
  + '両方とも持たない第2出力の行とオプションの行が出ない（WVP-DS-15A-1 のメーカーと応答時間を変えた仮想の組で確認。パルス側の2枚には出る）',
  virtualCards.length === 2 && leaked.length === 0 && pulseHasAll,
  lowerCardsWithVirtual.error || `${leaked.join(' / ') || '漏れ無し'} / パルス側の2枚に全項目: ${pulseHasAll}`);

/**
 * 案2。新設の2項目（許容負荷抵抗・応答時間）がアナログ側のカードに出て、応答時間は向きのある `atMost` で、
 * 速い候補は「現場で確認」・同じ値は「同じ」になる。比べ方を `equal` にすると速い候補が「違う」になって落ちる。
 */
const rowIn = (card, key) => card?.checks.find((r) => r.key === key);
check('同じ仮想の組のカードに許容負荷抵抗と応答時間の行が出て、速い候補の応答時間は「現場で確認」、同じ値は「同じ」になる',
  !!fastCard && !!sameCard && !!rowIn(fastCard, 'outputLoad') && !!rowIn(sameCard, 'outputLoad')
  && rowIn(fastCard, 'responseUs')?.state === 'field' && rowIn(sameCard, 'responseUs')?.state === 'same',
  lowerCardsWithVirtual.error || virtualCards.map((card) => `${card.model}: 許容負荷抵抗 ${rowIn(card, 'outputLoad')?.state ?? '行が無い'}・`
    + `応答時間 ${rowIn(card, 'responseUs')?.state ?? '行が無い'}`).join(' / '));

/**
 * 案3。アナログ側は出力が1系統なので「第1出力」と呼ばない（`summary` の「WVP は出力が1系統なので『第1』と呼ばない」を
 * カードにも当てる）。要約の2行と表の見出しの両方で見る。出力の分類の項目を分けずに戻すと「第1出力の方式」が出て落ちる。
 */
const gistWords = (card) => [...card.guide.same, ...card.guide.differs];
const calledFirst = virtualCards.flatMap((card) => [...gistWords(card), ...card.checks.map((r) => r.label)]
  .filter((w) => w.includes('第1出力')).map((w) => `${card.model}: ${w}`));
check('アナログ側の下の段のカードの要約で、出力を「出力の方式」と呼び「第1出力」と呼ばない',
  virtualCards.length === 2 && virtualCards.every((card) => gistWords(card).includes('出力の方式')) && calledFirst.length === 0,
  lowerCardsWithVirtual.error || `${calledFirst.join(' / ') || '第1出力と呼ぶ語は無い'} / 要約 ${virtualCards.map((card) => gistWords(card).join('・')).join(' | ')}`);

/**
 * 案4。下の段の全カード（実データのパルス側2枚＋仮想の組）で、「違う」「現場で確認」の項目すべてに、やることの文と並びがある。
 * コアは欠けを例外で止める（`cardGuide`）ので、例外は捕まえて NG にする。やることの行の数が「違う」「現場で確認」の項目の数
 * ＋別メーカーの行＋登録の無い項目の行と合うことも見る（黙って行が落ちていない）。
 * 対象が0件や、アナログ側の新しい項目が1つも「違う」「現場で確認」にならない形では通さない
 * （入力抵抗・許容負荷抵抗・応答時間の todo を消したら落ちることを、検査の中で担保する）。
 */
const todoOrder = cat.todoOrder || [];
const defsByKey = new Map(cat.checkDefs.map((d) => [d.key, d]));
const openRows = lowerCardsWithVirtual.cards.flatMap(({ m, c }) => c.checks
  .filter((r) => r.state === 'differs' || r.state === 'field').map((r) => ({ m, c, r })));
const noTodo = openRows.filter(({ r }) => typeof defsByKey.get(r.key)?.todo !== 'function' || !todoOrder.includes(r.key));
const lineCountBad = lowerCardsWithVirtual.cards.filter(({ c }) => {
  const open = c.checks.filter((r) => r.state === 'differs' || r.state === 'field').length;
  const missing = c.checks.some((r) => r.state === 'missing') ? 1 : 0;
  return c.guide.todos.length !== open + (c.sameMaker ? 0 : 1) + missing;
});
const openKeys = new Set(openRows.map(({ r }) => r.key));
const analogOpen = ['inputResistance', 'outputLoad', 'responseUs'].filter((k) => openKeys.has(k));
check(`絶縁変換器の下の段の全カード（${lowerCardsWithVirtual.cards.length} 枚。実データのパルス側 ${classEdges.length} 枚＋仮想の組）で、`
  + `「違う」「現場で確認」の項目すべて（${openRows.length} 行）にやることの文と並びがある`,
  !lowerCardsWithVirtual.error && lowerCardsWithVirtual.cards.length > classEdges.length && classEdges.length > 0
  && openRows.length > 0 && noTodo.length === 0 && lineCountBad.length === 0 && analogOpen.length === 3,
  lowerCardsWithVirtual.error || [
    noTodo.map(({ m, c, r }) => `${m.model} → ${c.model}: ${r.key}`).join(' / '),
    lineCountBad.map(({ m, c }) => `${m.model} → ${c.model} の行数`).join(' / '),
    `アナログ側の項目で開いたもの: ${analogOpen.join('・') || '無し'}`,
  ].filter(Boolean).join(' | '));

/**
 * やることの並び（D54）。アナログ側で入力抵抗 → 許容負荷抵抗 → 応答時間が、電源電圧の後・別メーカーの端子の前に並ぶ。
 * パルス側の並びは smoke が2枚のやることの全行で固定している（ここで二重に持たない）。
 */
const fastTodos = fastCard?.guide.todos ?? [];
const wantFastTodos = [
  '盤の電源電圧が候補の範囲（DC24V）に入るか確認する',
  '送り側の機器が候補の入力抵抗（1MΩ以上）で働くか確認する',
  '受け側（負荷）の抵抗が候補の許容負荷抵抗（550Ω以下）に入るか確認する',
  '応答が速くなる（約25ms → 約500μs）。受け側の制御で困らないか確認する',
  '別メーカーのため、端子の並びを確認して配線する',
];
check('アナログ側の仮想の組のやることが、電源電圧 → 入力抵抗 → 許容負荷抵抗 → 応答時間 → 別メーカーの端子の順に並ぶ（D54）',
  JSON.stringify(fastTodos) === JSON.stringify(wantFastTodos),
  lowerCardsWithVirtual.error || fastTodos.map((t, i) => `${i + 1}. ${t}`).join(' | ') || '下の段に無い');

console.log('');
if (failures.length) {
  console.error(`絶縁変換器 分類テスト失敗: ${failures.length} / ${n} 項目が NG`);
  process.exit(1);
}
console.log(`絶縁変換器 分類テスト成功: ${n} / ${n} 項目すべて PASS`);
