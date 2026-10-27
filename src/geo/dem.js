/* ============================================================
   DEM：Terrarium 高程瓦片（≈90m 级，SRTM / NED / ASTER 混合）
   https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
   高程 = R*256 + G + B/256 - 32768（米）
   ============================================================ */
import { makeOffsetField } from './regions.js';
import { netUrl } from '../net.js';

const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const TS = 256;

const lon2tx = (lon, z) => (lon + 180) / 360 * Math.pow(2, z);
const lat2ty = (lat, z) => {
  const r = lat * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z);
};
const tx2lon = (x, z) => x / Math.pow(2, z) * 360 - 180;
const ty2lat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

/** 选取分辨率最高的、瓦片数不超过 maxTiles 的层级 */
function planGrid(bb, maxTiles = 60, minZ = 4, maxZ = 12) {
  let best = null;
  for (let z = minZ; z <= maxZ; z++) {
    const x0 = Math.floor(lon2tx(bb.w, z)), x1 = Math.floor(lon2tx(bb.e, z));
    const y0 = Math.floor(lat2ty(bb.n, z)), y1 = Math.floor(lat2ty(bb.s, z));
    const nx = x1 - x0 + 1, ny = y1 - y0 + 1;
    if (nx * ny > maxTiles) break;
    best = { z, x0, y0, nx, ny };
  }
  return best || { z: minZ, x0: 0, y0: 0, nx: 1, ny: 1 };
}

async function fetchBitmap(url) {
  const res = await fetch(url, { mode: 'cors', cache: 'force-cache' });
  if (!res.ok) throw new Error(String(res.status));
  const blob = await res.blob();
  return createImageBitmap(blob);
}

export async function loadDem(region, { size = 1536, maxTiles = 96, onProgress } = {}) {
  const b = region.bbox;
  const padX = (b.east - b.west) * 0.02, padY = (b.north - b.south) * 0.02;
  const bb = { w: b.west - padX, e: b.east + padX, s: b.south - padY, n: b.north + padY };

  const g = planGrid(bb, maxTiles);
  const total = g.nx * g.ny;

  const cv = document.createElement('canvas');
  cv.width = g.nx * TS; cv.height = g.ny * TS;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#808000';               // 缺块 → 0 米
  ctx.fillRect(0, 0, cv.width, cv.height);

  let done = 0;
  const queue = [];
  for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) queue.push([i, j]);
  const worker = async () => {
    while (queue.length) {
      const [i, j] = queue.shift();
      try {
        const bmp = await fetchBitmap(netUrl(TILE_URL(g.z, g.x0 + i, g.y0 + j)));
        ctx.drawImage(bmp, i * TS, j * TS);
        if (bmp.close) bmp.close();
      } catch (e) { /* 海上/缺失瓦片按 0 处理 */ }
      done++;
      onProgress && onProgress(done, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, total) }, worker));

  const img = ctx.getImageData(0, 0, cv.width, cv.height).data;
  const W = cv.width;
  const elev = new Float32Array(W * cv.height);
  for (let p = 0, k = 0; p < elev.length; p++, k += 4)
    elev[p] = img[k] * 256 + img[k + 1] + img[k + 2] / 256 - 32768;

  // —— 重采样到「地形网格 UV 空间」：南→北排列，同时把 GCJ 坐标换算到 WGS84 再取瓦片 ——
  const N = size;
  const data = new Float32Array(N * N);
  const off = makeOffsetField({ w: b.west, e: b.east, s: b.south, n: b.north });
  
  const spanLon = b.east - b.west, spanLat = b.north - b.south;

  for (let j = 0; j < N; j++) {
    const lat = b.south + spanLat * (j / (N - 1));
    for (let i = 0; i < N; i++) {
      const lon = b.west + spanLon * (i / (N - 1));
      const o = off(lon, lat);
      const wlon = lon - o[0], wlat = lat - o[1];
      const px = (lon2tx(wlon, g.z) - g.x0) * TS;
      const py = (lat2ty(wlat, g.z) - g.y0) * TS;
      const x0 = Math.max(0, Math.min(W - 2, Math.floor(px)));
      const y0 = Math.max(0, Math.min(elev.length / W - 2, Math.floor(py)));
      const tx = Math.min(1, Math.max(0, px - x0)), ty = Math.min(1, Math.max(0, py - y0));
      const i00 = y0 * W + x0;
      const a = elev[i00], b1 = elev[i00 + 1], c = elev[i00 + W], d = elev[i00 + W + 1];
      data[j * N + i] = (a * (1 - tx) + b1 * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }

  // —— 统计（2% / 98% 分位，避免个别噪点拉爆色带） ——
  // Terrarium 瓦片含海底水深（负值），色带只按陆地高程归一化，否则整条色带会被压扁
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
  const lo = Math.max(0, min);
  const rng = Math.max(1, max - lo);
  const hist = new Uint32Array(1024);
  let land = 0;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v < lo) continue;
    land++;
    hist[Math.min(1023, ((v - lo) / rng * 1023) | 0)]++;
  }
  const pick = (q) => {
    if (!land) return lo;
    let acc = 0; const target = land * q;
    for (let i = 0; i < 1024; i++) { acc += hist[i]; if (acc >= target) return lo + (i / 1023) * rng; }
    return max;
  };
  const p02 = Math.max(lo, pick(0.02)), p98 = Math.max(p02 + 1, Math.min(max, pick(0.98)));
  min = lo;                       // 对外的“最低高程”按陆地口径，海底不参与

  return { data, N, min, max, p02, p98, zoom: g.z, tiles: total, grid: g, elevRes: 156543.03 * Math.cos(b.south * Math.PI / 180) / Math.pow(2, g.z) };
}
