/* ============================================================
   三级行政区划（省 / 市 / 县）
   - 省列表本地内置（34 个省级单位）
   - 市 / 县 走 DataV 的 {code}_full.json（其 features 即下一级）
   - 任一级都可作为展示范围（面积/跨度上限仍按省级限幅）
   ============================================================ */
import { netFetch } from '../net.js';
import { PROVINCES } from './regions.js';

const DATA_V = 'https://geo.datav.aliyun.com/areas_v3/bound/';
const cache = new Map();

export const LEVEL_NAME = { 1: '省级', 2: '市级', 3: '县级' };

/** 某一级的子项；code 为空表示全国（返回省列表） */
export async function childrenOf(code) {
  if (!code) {
    return PROVINCES.map((p) => ({ code: String(p.code), name: p.name, level: 'province' }));
  }
  if (cache.has(code)) return cache.get(code);
  const p = (async () => {
    try {
      const r = await netFetch(DATA_V + code + '_full.json');
      if (!r.ok) return [];
      const j = await r.json();
      return (j.features || [])
        .map((f) => ({
          code: String(f.properties.adcode),
          name: f.properties.name,
          level: f.properties.level || '',
          center: f.properties.center || null
        }))
        .filter((x) => x.code && x.name && x.code !== String(code));
    } catch (e) {
      return [];
    }
  })();
  cache.set(code, p);
  return p;
}

/** 供编码判断层级：xxxx00 → 市，xxxxxx 非零 → 县 */
export function levelOf(code) {
  const c = String(code);
  if (c.endsWith('0000')) return 1;
  if (c.endsWith('00')) return 2;
  return 3;
}
