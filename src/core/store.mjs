/** デバイスとカテゴリの保管庫。ブラウザでもNodeテストでも同じものを使う。 */
import { normalizeMounting } from './util.mjs';

export const store = {
  devices: [],
  byId: new Map(),
  reference: { makers: [] },
};

/**
 * data/**.json のレコードを読み込む。
 *
 * provisional（実在未確認）は既定で候補にも検索にも出さない。判定はホワイトリスト
 * （catalog-confirmed だけを通す）なので、modelStatus の付け忘れや綴り間違いも
 * ここで落ちる。黙って消えると原因が追いにくいため、混入は build.mjs が
 * ビルド時に検出して失敗させる。
 */
export function loadDevices(list, reference) {
  const usable = list.filter((d) => d.modelStatus === 'catalog-confirmed');
  store.devices = usable.map((d) => ({ ...d, mounting: normalizeMounting(d.mounting) }));
  store.byId = new Map(store.devices.map((d) => [d.id, d]));
  if (reference) store.reference = reference;
  return store;
}

export function devicesOf(categoryId) {
  return store.devices.filter((d) => d.category === categoryId);
}

export function makersOf(categoryId) {
  const seen = [];
  for (const d of devicesOf(categoryId)) if (!seen.includes(d.maker)) seen.push(d.maker);
  return seen;
}
