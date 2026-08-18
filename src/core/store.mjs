/** デバイスとカテゴリの保管庫。ブラウザでもNodeテストでも同じものを使う。 */
import { normalizeMounting } from './util.mjs';

export const store = {
  devices: [],
  byId: new Map(),
  reference: { makers: [], servoDiscontinued: [] },
};

/**
 * data/**.json のレコードを読み込む。
 * provisional（実在未確認）は既定で候補にも検索にも出さない。
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
