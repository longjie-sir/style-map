/* ============================================================
   像素方块地形：把 DEM 采样成一方一方的柱体，用「方块」堆出场景。

   为什么不直接在片元着色器里把颜色像素化：
   那样只有纹理是方块的，山体轮廓仍是光滑斜面；要的是「用方块形成场景」，
   所以这里生成真正的方块几何：每格一个顶面，落差处补竖面，边界处落到基座。
   —— 一个格子 = 一个柱体，只生成看得见的面（顶面 + 露出侧面的部分）。
   ============================================================ */
import * as THREE from 'three';

const VERT = /* glsl */`
attribute vec3  aColor;
attribute float aDelay;   // 生长动画的逐格延迟（0~1）
attribute float aBase;    // 该柱体的基座高度（km），生长时从基座往上长
attribute float aT;       // 0 = 竖面顶端，1 = 竖面底端（做竖向渐变用）
varying vec3  vN;
varying vec3  vC;
varying vec3  vW;
varying float vT;
uniform float uGrowth;
void main(){
  vec3 p = position;
  float g = clamp((uGrowth * 1.55 - aDelay) / 0.75, 0.0, 1.0);
  g = g * g * (3.0 - 2.0 * g);
  p.y = mix(aBase, p.y, g);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * normal);
  vC = aColor;
  vT = aT;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */`
precision highp float;
varying vec3  vN;
varying vec3  vC;
varying vec3  vW;
varying float vT;
uniform vec3  uSunDir;
uniform vec3  uSkyAmb;     // 天光（冷）
uniform vec3  uGroundAmb;  // 地面反弹（暖）
uniform vec3  uFogColor;
uniform float uFog;

/* 方块场景的体积感只靠三档明暗：
   顶面最亮 → 朝阳侧次之 → 背光侧最暗，再加一点竖向渐变把侧面压深。
   坚决不做平滑着色：方块就是要「一眼看出是平面」。 */
void main(){
  vec3 n = normalize(vN);
  float up = step(0.5, n.y);
  float d = max(dot(n, uSunDir), 0.0);

  vec3 amb = mix(uSkyAmb, uGroundAmb, 0.5 - 0.5 * n.y);
  // 背光面别压到近黑：方块地形块面多，死黑会连成一片、看不清台阶
  float diff = up > 0.5 ? (0.56 + 0.58 * d) : (0.42 + 0.52 * d);
  vec3 col = vC * (amb * 0.30 + diff);

  // 侧面自上而下压深一档：让每级台阶有厚度
  col *= mix(1.0, 0.87, vT * (1.0 - up));

  // 极轻的逐块抖动，避免大片纯色死板（按块抖，不按像素抖，否则像噪点）
  float jit = fract(sin(dot(floor(vW.xz * 1.7) + floor(vW.y * 3.0), vec2(12.9898, 78.233))) * 43758.5453);
  col *= 0.985 + 0.03 * jit;

  float f = 1.0 - exp(-distance(cameraPosition, vW) * uFog * 0.0009);
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0) * 0.55);

  gl_FragColor = vec4(col, 1.0);
}
`;

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/**
 * 生成方块地形几何。
 * @param {object} t            TerrainView 实例（用它的 region / dem / 色带）
 * @param {object} opt
 * @param {number} opt.cols     长边方向的格数
 * @param {number} opt.levels   高程台阶数
 */
export function buildVoxelGeometry(t, opt = {}) {
  const region = t.region, hs = t.u.uHeightScale.value;
  if (!region) return null;
  const b = region.bbox;
  const spanX = region.spanX, spanY = region.spanY;

  const cols = opt.cols || 132;
  const cellW = spanX / cols;
  const rows = Math.max(8, Math.round(spanY / cellW));
  const cellH = spanY / rows;

  const loH = Math.max(0, t.u.uMinH.value);
  const hiH = Math.max(loH + 200, t.u.uMaxH.value);
  const levels = opt.levels || 20;
  const stepM = (hiH - loH) / levels;

  // 基座：与 buildWall 同口径，方块体的厚度才和别的风格的侧壁一致
  const diag = Math.max(spanX, spanY) * 0.5;
  const baseY = -Math.max(1.2, t.params.depth * Math.min(1, Math.max(0.05, diag / 130)));

  // 色带：按归一化高程取色，再量化成 10 档 —— 方块的「色块感」靠这一步
  const ramp = t._rampCanvas;
  let lut = null;
  if (ramp) {
    const g = ramp.getContext('2d', { willReadFrequently: true });
    lut = g.getImageData(0, 0, ramp.width, 1).data;
  }
  // 色带画布取出来的是 sRGB 分量，而着色器里的颜色是线性工作空间。
  // 不转换直接当线性用，整片地块会明显发白、发灰（这也是「色块发灰」的真因）。
  const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const pick = (k) => {
    if (!lut) return [0.35, 0.35, 0.35];
    const n = lut.length / 4;
    const i = Math.min(n - 1, Math.max(0, Math.round(k * (n - 1)))) * 4;
    return [s2l(lut[i] / 255), s2l(lut[i + 1] / 255), s2l(lut[i + 2] / 255)];
  };
  const sea = t.u.uSeaCol.value;

  // 先把每格的量化高度算出来（世界 y，km），NaN = 该格没有方块
  const hy = new Float32Array(cols * rows).fill(NaN);
  const hq = new Float32Array(cols * rows);
  const hRaw = new Float32Array(cols * rows);
  // 内外判定走遮罩位图查表：十几万次调用，逐顶点射线法会把主线程卡死
  const inside = t.maskSampler();
  for (let r = 0; r < rows; r++) {
    const lat = b.south + (r + 0.5) / rows * (b.north - b.south);
    for (let c = 0; c < cols; c++) {
      const lon = b.west + (c + 0.5) / cols * (b.east - b.west);
      if (!inside(lon, lat)) continue;
      const hm = t.heightAt(lon, lat);
      // 海面以下压到 0：行政界线含海域，负高程不压平会切出一堆水下碎片
      const hl = Math.max(0, hm);
      const lv = Math.min(levels, Math.max(0, Math.round((hl - loH) / stepM)));
      const q = loH + lv * stepM;
      const i = r * cols + c;
      hq[i] = q;
      hRaw[i] = hm;
      hy[i] = q * hs;
    }
  }

  const pos = [], nor = [], col = [], del = [], bas = [], at = [];
  const hx = cellW * 0.5, hz = cellH * 0.5;

  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, nx, ny, nz, rgb, delay, ta, tb, tc) => {
    pos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    nor.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    col.push(rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2], rgb[0], rgb[1], rgb[2]);
    del.push(delay, delay, delay);
    bas.push(baseY, baseY, baseY);
    at.push(ta, tb, tc);
  };
  // 竖面：a→b 是地面上的一条边（x,z），从 yb 升到 yt，法线 (nx,nz)
  const wall = (ax, az, bx, bz, yb, yt, nx, nz, rgb, delay) => {
    tri(ax, yb, az, bx, yb, bz, bx, yt, bz, nx, 0, nz, rgb, delay, 1, 1, 0);
    tri(ax, yb, az, bx, yt, bz, ax, yt, az, nx, 0, nz, rgb, delay, 1, 0, 0);
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const y = hy[i];
      if (!isFinite(y)) continue;

      const lon = b.west + (c + 0.5) / cols * (b.east - b.west);
      const lat = b.south + (r + 0.5) / rows * (b.north - b.south);
      const w = t.lonLatToWorld(lon, lat);

      // 生长延迟：与地形网格同一条公式（中心向外扩）
      const uu = (lon - b.west) / Math.max(1e-6, b.east - b.west);
      const vv = (lat - b.south) / Math.max(1e-6, b.north - b.south);
      const delay = Math.min(1.05, Math.hypot(uu - 0.5, vv - 0.5) * 1.05);

      let rgb;
      if (hRaw[i] <= 0.5) {
        // 海面提亮：直接吃 uSeaCol 会被方块着色压成一块近黑的塑料板
        rgb = [Math.min(1, sea.r * 1.42), Math.min(1, sea.g * 1.32), Math.min(1, sea.b * 1.24)];
      } else {
        const k = Math.round(((hq[i] - loH) / Math.max(1, hiH - loH)) * 6) / 6;
        const j = (hash2(c, r) - 0.5) * 0.12;
        rgb = pick(k).map((x) => Math.min(1, Math.max(0, x * (1 + j))));
      }

      const x0 = w.x - hx, x1 = w.x + hx, z0 = w.z - hz, z1 = w.z + hz;

      // 顶面：两个三角形，法线朝上，aT 记 0（不参与竖向渐变）
      tri(x0, y, z0, x0, y, z1, x1, y, z1, 0, 1, 0, rgb, delay, 0, 0, 0);
      tri(x0, y, z0, x1, y, z1, x1, y, z0, 0, 1, 0, rgb, delay, 0, 0, 0);

      // 四个方向：邻居更低（或该方向没有方块）时补一面竖墙
      /* 行列与世界坐标的对应关系必须算清楚，否则竖墙会补到错误的一侧，
         格子之间留下真实缺口（表现为方块之间透出背景的白色细带）：
         lonLatToWorld 里 z = (centerLat - lat) * kmLat —— 纬度越高 z 越小。
         所以 r-1（纬度更低）在 z1 一侧，r+1 在 z0 一侧。 */
      const nb = [
        [c, r - 1, 0, 1, x0, z1, x1, z1],    // 南邻：z1 边，法线 +z
        [c, r + 1, 0, -1, x0, z0, x1, z0],   // 北邻：z0 边，法线 -z
        [c - 1, r, -1, 0, x0, z0, x0, z1],   // 西邻：x0 边
        [c + 1, r, 1, 0, x1, z0, x1, z1]     // 东邻：x1 边
      ];
      for (const d of nb) {
        const nc = d[0], nr = d[1];
        const ok = nc >= 0 && nc < cols && nr >= 0 && nr < rows;
        const ny = ok ? hy[nr * cols + nc] : NaN;
        if (isFinite(ny) && ny >= y - 1e-6) continue;           // 邻居不低 → 这面看不见
        const yb = isFinite(ny) ? Math.max(ny, baseY) : baseY;
        // 侧面压一档：同一色带，靠明暗区分朝向
        const sc = [rgb[0] * 0.93, rgb[1] * 0.93, rgb[2] * 0.93];
        wall(d[4], d[5], d[6], d[7], yb, y, d[2], d[3], sc, delay);
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aColor', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aDelay', new THREE.Float32BufferAttribute(del, 1));
  g.setAttribute('aBase', new THREE.Float32BufferAttribute(bas, 1));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.computeBoundingSphere();
  g.userData = { cols, rows, vertexCount: pos.length / 3, stepM, loH };
  return g;
}

export function createVoxelMaterial(terrain) {
  const u = {
    uGrowth: { value: 1 },
    uSunDir: terrain.u.uSunDir,
    uSkyAmb: { value: new THREE.Color('#8ea9c8') },
    uGroundAmb: { value: new THREE.Color('#b9a684') },
    uFogColor: terrain.u.uFogColor,
    uFog: { value: 0.12 },
    uStepK: { value: 1 }      // 画质档系数（terrain.setQuality 会写这个）
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: u, vertexShader: VERT, fragmentShader: FRAG,
    // 双面：柱体的朝向由法线属性决定，不依赖绕序，省掉一堆 winding 判断
    side: THREE.DoubleSide
  });
  return mat;
}
