/* ============================================================
   区域数据：阿里云 DataV 行政区划边界
   - 省/自治区/直辖市/特别行政区（省级为最大支持范围）
   - 也支持用户上传的 GeoJSON 边界
   ============================================================ */
import { netUrl } from '../net.js';

export const PROVINCES = [
  { code: 110000, name: '北京市' }, { code: 120000, name: '天津市' }, { code: 130000, name: '河北省' },
  { code: 140000, name: '山西省' }, { code: 150000, name: '内蒙古自治区' }, { code: 210000, name: '辽宁省' },
  { code: 220000, name: '吉林省' }, { code: 230000, name: '黑龙江省' }, { code: 310000, name: '上海市' },
  { code: 320000, name: '江苏省' }, { code: 330000, name: '浙江省' }, { code: 340000, name: '安徽省' },
  { code: 350000, name: '福建省' }, { code: 360000, name: '江西省' }, { code: 370000, name: '山东省' },
  { code: 410000, name: '河南省' }, { code: 420000, name: '湖北省' }, { code: 430000, name: '湖南省' },
  { code: 440000, name: '广东省' }, { code: 450000, name: '广西壮族自治区' }, { code: 460000, name: '海南省' },
  { code: 500000, name: '重庆市' }, { code: 510000, name: '四川省' }, { code: 520000, name: '贵州省' },
  { code: 530000, name: '云南省' }, { code: 540000, name: '西藏自治区' }, { code: 610000, name: '陕西省' },
  { code: 620000, name: '甘肃省' }, { code: 630000, name: '青海省' }, { code: 640000, name: '宁夏回族自治区' },
  { code: 650000, name: '新疆维吾尔自治区' }, { code: 710000, name: '台湾省' },
  { code: 810000, name: '香港特别行政区' }, { code: 820000, name: '澳门特别行政区' }
];

export const LIMIT = { area: 2.2e6, spanKm: 2600 };   // 省级上限

const DATA_V = 'https://geo.datav.aliyun.com/areas_v3/bound/';
const KM_LAT = 110.574;
const cosd = (d) => Math.cos(d * Math.PI / 180);
const kmLon = (lat) => 111.320 * cosd(lat);

/* ---------- 基础几何 ---------- */
function eachPolygon(geojson, cb) {
  const feats = geojson.type === 'FeatureCollection' ? geojson.features
    : geojson.type === 'Feature' ? [geojson] : [{ geometry: geojson }];
  for (const f of feats) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.type === 'Polygon') cb(g.coordinates);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(cb);
  }
}
function ringBBox(r) {
  let w = 1e9, e = -1e9, s = 1e9, n = -1e9;
  for (const p of r) { const x = p[0], y = p[1];
    if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
  return { w, e, s, n };
}
function bboxUnion(a, b) {
  if (!a) return { ...b };
  return { w: Math.min(a.w, b.w), e: Math.max(a.e, b.e), s: Math.min(a.s, b.s), n: Math.max(a.n, b.n) };
}
function ringAreaKm2(r, lat0) {
  let s = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const a = r[i], b = r[(i + 1) % n];
    s += (a[0] * kmLon(lat0)) * (b[1] * KM_LAT) - (b[0] * kmLon(lat0)) * (a[1] * KM_LAT);
  }
  return Math.abs(s) / 2;
}
function bboxOverlap(a, b, pad) {
  return !(a.e < b.w - pad || a.w > b.e + pad || a.n < b.s - pad || a.s > b.n + pad);
}
/* 等距抽稀（闭合环友好，DP 对首尾重合的环会退化） */
function simplify(pts, tol) {
  if (pts.length < 6) return pts;
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = out[out.length - 1], q = pts[i];
    if (Math.hypot(q[0] - p[0], q[1] - p[1]) >= tol) out.push(q);
  }
  const a = out[0], b = pts[pts.length - 1];
  if (out.length > 1 && Math.hypot(a[0] - b[0], a[1] - b[1]) > tol * 2) out.push([a[0], a[1]]);
  return out;
}

/* ---------- GCJ-02 偏移（DataV 与高德为 GCJ，Terrarium 为 WGS84） ---------- */
const PI = Math.PI, AXIS = 6378245.0, EE = 0.00669342162296594323;
function outOfChina(lng, lat) { return !(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55); }
function tLat(x, y) {
  let r = -100 + 2 * x + 3 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  r += (20 * Math.sin(y * PI) + 40 * Math.sin(y / 3 * PI)) * 2 / 3;
  r += (160 * Math.sin(y / 12 * PI) + 320 * Math.sin(y * PI / 30)) * 2 / 3;
  return r;
}
function tLng(x, y) {
  let r = 300 + x + 2 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  r += (20 * Math.sin(6 * x * PI) + 20 * Math.sin(2 * x * PI)) * 2 / 3;
  r += (20 * Math.sin(x * PI) + 40 * Math.sin(x / 3 * PI)) * 2 / 3;
  r += (150 * Math.sin(x / 12 * PI) + 300 * Math.sin(x / 30 * PI)) * 2 / 3;
  return r;
}
export function wgs2gcj(lng, lat) {
  if (outOfChina(lng, lat)) return [lng, lat];
  let dLat = tLat(lng - 105, lat - 35), dLng = tLng(lng - 105, lat - 35);
  const rad = lat / 180 * PI;
  let magic = Math.sin(rad); magic = 1 - EE * magic * magic;
  const sq = Math.sqrt(magic);
  dLat = (dLat * 180) / ((AXIS * (1 - EE)) / (magic * sq) * PI);
  dLng = (dLng * 180) / (AXIS / sq * Math.cos(rad) * PI);
  return [lng + dLng, lat + dLat];
}
/** 在给定范围内建立 GCJ→WGS 的偏移场（双线性插值），避免逐像素三角函数 */
export function makeOffsetField(bbox, n = 8) {
  const g = new Float32Array((n + 1) * (n + 1) * 2);
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const lon = bbox.w + (bbox.e - bbox.w) * i / n;
      const lat = bbox.s + (bbox.n - bbox.s) * j / n;
      const p = wgs2gcj(lon, lat);
      const k = (j * (n + 1) + i) * 2;
      g[k] = p[0] - lon; g[k + 1] = p[1] - lat;
    }
  }
  return function offsetAt(lon, lat) {
    const fx = Math.min(Math.max((lon - bbox.w) / (bbox.e - bbox.w), 0), 1) * n;
    const fy = Math.min(Math.max((lat - bbox.s) / (bbox.n - bbox.s), 0), 1) * n;
    const i = Math.min(n - 1, Math.floor(fx)), j = Math.min(n - 1, Math.floor(fy));
    const tx = fx - i, ty = fy - j, k = (j * (n + 1) + i) * 2;
    const a = g[k], b = g[k + 2], c = g[k + (n + 1) * 2], d = g[k + (n + 1) * 2 + 2];
    const e = g[k + 1], f = g[k + 3], h = g[k + (n + 1) * 2 + 1], m = g[k + (n + 1) * 2 + 3];
    const o1 = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    const o2 = (e * (1 - tx) + f * tx) * (1 - ty) + (h * (1 - tx) + m * tx) * ty;
    return [o1, o2];
  };
}

/* ---------- 载入 ---------- */
async function getJSON(url) {
  const r = await fetch(netUrl(url), { mode: 'cors' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export async function loadRegion(code, name) {
  const [outline, detail] = await Promise.all([
    getJSON(DATA_V + code + '.json'),
    getJSON(DATA_V + code + '_full.json').catch(() => null)
  ]);
  const nm = name
    || (outline.features && outline.features[0] && outline.features[0].properties.name)
    || (PROVINCES.find(p => String(p.code) === String(code)) || {}).name
    || String(code);
  const region = buildRegion(outline, nm, String(code));
  if (detail) {
    // 界线按**全域**包围盒采（含三沙这类远离主体的飞地）。
    // 原来用 region.bbox，海南视图里 112 个三沙岛屿的区划边界一个都进不来。
    region.borders = collectBorders(detail, region.allBBox || region.bbox);
    // 下一级行政区（用于名称标注 / 下钻）
    region.children = (detail.features || [])
      .map(f => ({
        code: String(f.properties.adcode),
        name: f.properties.name,
        center: f.properties.center || null
      }))
      .filter(x => x.code && x.name && x.center);
  }
  return region;
}
/* 兼容旧调用 */
export const loadProvince = loadRegion;

export function loadGeoJSON(json, name = '自定义区域') {
  return buildRegion(json, name, 'custom');
}

function collectBorders(detail, frame) {
  const out = [];
  eachPolygon(detail, (rings) => {
    const outer = rings[0];
    if (!outer || outer.length < 4) return;
    const b = ringBBox(outer);
    if (!bboxOverlap(b, frame, 0.02)) return;
    out.push(outer.map(p => [p[0], p[1]]));
  });
  return out;
}

function buildRegion(geojson, name, id) {
  const polys = [];
  eachPolygon(geojson, (rings) => {
    if (!rings.length) return;
    const outer = rings[0];
    if (!outer || outer.length < 4) return;
    polys.push({ outer: outer.map(p => [p[0], p[1]]), holes: rings.slice(1).map(h => h.map(p => [p[0], p[1]])) });
  });
  if (!polys.length) throw new Error('未在文件中找到合法的面要素');

  // 面积（用于挑主体、限幅）
  const latAll = polys.map(p => (ringBBox(p.outer).s + ringBBox(p.outer).n) / 2);
  polys.forEach((p, i) => { p.area = ringAreaKm2(p.outer, latAll[i]); p.bbox = ringBBox(p.outer); });

  // 主体 = 面积最大的面；游离飞地（如三沙）不参与取景，避免包围盒被拉爆
  const main = polys.reduce((a, b) => (b.area > a.area ? b : a), polys[0]);
  const mSpanX = (main.bbox.e - main.bbox.w) * kmLon(latAll[0]);
  const mSpanY = (main.bbox.n - main.bbox.s) * KM_LAT;
  // 0.55 太宽：海南会被 175km 外的 5 块西沙礁盘带进来，主图从 261×223 撑到 397×399，
  // 本岛缩在左上角、右下留一大片空画框。0.30 只留真正挨着主体的近岸岛。
  const pad = Math.max(mSpanX, mSpanY) * 0.30;
  const kept = polys.filter(p => bboxOverlap(p.bbox, main.bbox, pad / KM_LAT * 1.2));

  // 远岛 / 飞地（海南的三沙、各省沿海离岛）：不进地形与取景 ——
  // 否则包围盒被拉到上千公里，本岛缩成一个点。
  // 但它们**必须保留**：面积太小、没有 DEM 数据，边界照样要画出来。
  const keptSet = new Set(kept);
  const far = polys.filter(p => !keptSet.has(p));

  let bb = null;
  for (const p of kept) bb = bboxUnion(bb, p.bbox);
  let bbAll = null;
  for (const p of polys) bbAll = bboxUnion(bbAll, p.bbox);

  const center = [(bb.w + bb.e) / 2, (bb.s + bb.n) / 2];
  const spanX = (bb.e - bb.w) * kmLon(center[1]);
  const spanY = (bb.n - bb.s) * KM_LAT;
  const area = kept.reduce((s, p) => s + p.area, 0);

  if (area > LIMIT.area || Math.max(spanX, spanY) > LIMIT.spanKm) {
    const err = new Error(`范围超出限制：约 ${(spanX / 1000).toFixed(0)}×${(spanY / 1000).toFixed(0)} km（最大支持省级范围）`);
    err.code = 'OUT_OF_RANGE';
    throw err;
  }

  const tol = Math.max(spanX, spanY) / 900 / 110;  // 度，约 0.5km 间距
  return {
    id, name, polys: kept, farPolys: far, borders: [],
    bbox: { west: bb.w, east: bb.e, south: bb.s, north: bb.n },
    allBBox: { west: bbAll.w, east: bbAll.e, south: bbAll.s, north: bbAll.n },
    center: { lon: center[0], lat: center[1] },
    spanX, spanY, area,
    world: { w: spanX, d: spanY, kmLon: kmLon(center[1]), kmLat: KM_LAT },
    rings: kept.map(p => simplify(p.outer, tol)),
    // 远岛不抽稀：本身只有 6~20 个点，一抽就退化成三角形
    farRings: far.map(p => ({ outer: p.outer, holes: p.holes })),
    _simplify: tol
  };
}

/* ---------- 遮罩画布（用于裁剪地形 + 投影） ---------- */
export function buildMaskCanvas(region, size = 1600) {
  const { west, east, south, north } = region.bbox;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  const X = (lon) => (lon - west) / (east - west) * size;
  const Y = (lat) => (north - lat) / (north - south) * size;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (const p of region.polys) {
    const path = [p.outer, ...p.holes];
    for (const ring of path) {
      ctx.moveTo(X(ring[0][0]), Y(ring[0][1]));
      for (let i = 1; i < ring.length; i++) ctx.lineTo(X(ring[i][0]), Y(ring[i][1]));
      ctx.closePath();
    }
  }
  ctx.fill('evenodd');
  return cv;
}

/** 由遮罩生成柔边黑色投影（透明底），用于“浮雕落在纸面上的影子” */
export function buildShadowCanvas(maskCanvas, size = 640, blur = 10) {
  const tmp = document.createElement('canvas');
  tmp.width = tmp.height = size;
  const tc = tmp.getContext('2d');
  tc.drawImage(maskCanvas, 0, 0, size, size);
  const img = tc.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const a = d[i]; d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = a; }
  tc.putImageData(img, 0, 0);

  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(tmp, 0, 0);
  return cv;
}
