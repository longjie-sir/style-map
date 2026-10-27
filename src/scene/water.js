/* ============================================================
   水面图层
   - 内置：Natural Earth 10m 湖泊（面）+ 河流（线，转成带宽度带）
   - 上传：GeoJSON（WGS84）面/线，面按水面处理，线按河道处理
   - 着色：菲涅尔 + 太阳镜面 + 波纹法线，贴近写实
   ============================================================ */
import * as THREE from 'three';
import { netUrl } from '../net.js';

const NE = 'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/';
const LAKE_URL = NE + 'ne_10m_lakes.geojson';
const RIVER_URL = NE + 'ne_10m_rivers_lake_centerlines.geojson';

let lakeCache = null, riverCache = null;

async function loadNE(url, which) {
  if (which === 'lake' && lakeCache) return lakeCache;
  if (which === 'river' && riverCache) return riverCache;
  const r = await fetch(netUrl(url));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (which === 'lake') lakeCache = j; else riverCache = j;
  return j;
}

const WATER_VERT = /* glsl */`
attribute vec3 aRaw;      // 当顶点相对水体的世界坐标 + 原始高程(m)，见下方说明
varying vec3 vWorld;
varying vec2 vXZ;
varying vec3 vLocal;
uniform float uHS;        // 垂直夸张（km/m）—— 逐帧给，改夸张不必重建几何
uniform float uLift;      // 抬离地表的高度（km）
void main(){
  // position.y 里存的是「原始高程（m）」而不是最终世界 y：
  // 水面高度必须跟着垂直夸张走，否则用户一拉夸张滑块，水面就与地形脱开
  // （一半埋进坡里、一半悬在半空）。把换算放进着色器，改夸张只需改一个 uniform。
  vec3 p = position;
  p.y = position.y * uHS + uLift;
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vXZ = wp.xz;
  vLocal = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const WATER_FRAG = /* glsl */`
precision highp float;
varying vec3 vWorld;
varying vec2 vXZ;
uniform float uTime;
uniform vec3  uSunDir;
uniform vec3  uDeep;
uniform vec3  uSky;
uniform vec3  uSunCol;
uniform float uOpacity;

float h21(vec2 p){ p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.567); return fract(p.x * p.y); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1,0)), f.x), mix(h21(i + vec2(0,1)), h21(i + vec2(1,1)), f.x), f.y);
}

void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  // 波纹法线（两层不同尺度反向流动）
  vec2 p = vXZ * 0.35;
  float e = 0.06;
  float hx = vn(p + vec2(e, 0.0) + uTime * 0.05) - vn(p - vec2(e, 0.0) + uTime * 0.05);
  float hz = vn(p + vec2(0.0, e) + uTime * 0.043) - vn(p - vec2(0.0, e) + uTime * 0.043);
  vec2 q = vXZ * 1.3;
  hx += 0.5 * (vn(q + vec2(e, 0.0) - uTime * 0.08) - vn(q - vec2(e, 0.0) - uTime * 0.08));
  hz += 0.5 * (vn(q + vec2(0.0, e) - uTime * 0.07) - vn(q - vec2(0.0, e) - uTime * 0.07));
  vec3 N = normalize(vec3(-hx * 2.2, 1.0, -hz * 2.2));

  float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.0);
  vec3 c = mix(uDeep, uSky, clamp(fres * 1.15, 0.0, 1.0));

  // 太阳镜面
  vec3 Hv = normalize(uSunDir + V);
  float spec = pow(max(dot(N, Hv), 0.0), 220.0);
  float glint = pow(max(dot(N, Hv), 0.0), 26.0) * 0.18;
  c += uSunCol * (spec * 1.5 + glint);

  float a = mix(uOpacity * 0.86, uOpacity, fres);
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

function eachPolygon(geom, cb) {
  if (!geom) return;
  if (geom.type === 'Polygon') cb(geom.coordinates);
  else if (geom.type === 'MultiPolygon') geom.coordinates.forEach(cb);
}
function eachLine(geom, cb) {
  if (!geom) return;
  if (geom.type === 'LineString') cb(geom.coordinates);
  else if (geom.type === 'MultiLineString') geom.coordinates.forEach(cb);
}

/* Douglas-Peucker：10m 湖泊的环常有上万点，
   直接丢给 ShapeGeometry 的 earcut 会退化成 O(n²)，几秒起步。
   按「一个 DEM 像元」的容差抽稀后顶点数掉到几十分之一，肉眼无差。 */
function rdp(pts, tol) {
  const n = pts.length;
  if (n < 4) return pts;
  const keep = new Uint8Array(n);
  keep[0] = 1; keep[n - 1] = 1;
  const tol2 = tol * tol;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j - i < 2) continue;
    const x1 = pts[i][0], y1 = pts[i][1];
    const x2 = pts[j][0], y2 = pts[j][1];
    const dx = x2 - x1, dy = y2 - y1;
    const L2 = dx * dx + dy * dy;
    let maxD = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const px = pts[k][0], py = pts[k][1];
      let d;
      if (L2 < 1e-20) { const ex = px - x1, ey = py - y1; d = ex * ex + ey * ey; }
      else {
        let t = ((px - x1) * dx + (py - y1) * dy) / L2;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - (x1 + t * dx), ey = py - (y1 + t * dy);
        d = ex * ex + ey * ey;
      }
      if (d > maxD) { maxD = d; idx = k; }
    }
    if (maxD > tol2) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

export class Water {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.world.add(this.group);
    this.enabled = false;
    this.showLakes = true;
    this.showRivers = true;
    this.userFC = null;
    this.mats = [];
  }

  makeMat() {
    const m = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uHS: { value: this.view.u.uHeightScale.value },
        uLift: { value: 0.14 },
        uSunDir: this.view.u.uSunDir,
        uDeep: { value: new THREE.Color('#123a4d') },
        uSky: { value: new THREE.Color('#9fc4d8') },
        uSunCol: { value: new THREE.Color('#fff4dc') },
        uOpacity: { value: 0.92 }
      },
      vertexShader: WATER_VERT, fragmentShader: WATER_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    this.mats.push(m);
    return m;
  }

  /** 垂直夸张变化：同步水面着色器，不必重建几何（旧实现把高度烘进了顶点） */
  syncExag() {
    const hs = this.view.u.uHeightScale.value;
    for (const m of this.mats) m.uniforms.uHS.value = hs;
  }

  setTheme(style) {
    const dark = !!style.dark;
    const deep = style.key === 'realistic' ? '#123a4d'
      : style.key === 'parchment' ? '#7d8fa0'
        : dark ? '#0d2a3a' : '#2d5f74';
    const sky = style.key === 'parchment' ? '#cfd8dd'
      : dark ? '#7ea8c4' : '#a8cadb';
    for (const m of this.mats) {
      m.uniforms.uDeep.value.set(deep);
      m.uniforms.uSky.value.set(sky);
      m.uniforms.uSunCol.value.set(dark ? '#e9f2ff' : '#fff4dc');
    }
  }

  setVisible(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled;
  }

  setLayers(patch) {
    Object.assign(this, patch);
    if (this.meshLakes) this.meshLakes.visible = this.showLakes;
    if (this.meshRivers) this.meshRivers.visible = this.showRivers;
  }

  async build(region, opts = {}) {
    this.dispose();
    this.group.visible = this.enabled;
    if (!region) return;
    const b = region.bbox;
    const pad = 0.05;
    const frame = { w: b.west - pad, e: b.east + pad, s: b.south - pad, n: b.north + pad };
    // 水面高度由顶点着色器按当前垂直夸张换算，这里不再需要用 hs
    // 只画落在本区域内的水体：地形本身是按区域裁掉的，
    // 水体若按 bbox 画，会在海面/背景上留下悬空的河道
    const inside = (lon, lat) => lon >= frame.w && lon <= frame.e
      && lat >= frame.s && lat <= frame.n && this.view.inRegion(lon, lat);
    // 抽稀容差 ≈ 一个 DEM 像元的 1/3，几何精度对齐纹理分辨率
    const tol = Math.max(2e-5, (frame.e - frame.w) / 2048 / 3);

    const lakePos = [];
    const riverPos = [];
    const stats = { lakeFeat: 0, ringIn: 0, ringOut: 0, lakeTri: 0, riverFeat: 0 };
    this.stats = stats;

    // —— 湖（面）：整块按平均水位做平面，像真的湖面而不是"贴纸" ——
    const addLake = (ringsLO) => {
      if (!ringsLO.length) return;
      const raw = ringsLO[0];
      if (!raw || raw.length < 4) return;
      stats.ringIn += raw.length;
      const outer = rdp(raw, tol);
      stats.ringOut += outer.length;
      if (outer.length < 3) return;
      let sum = 0, cnt = 0;
      for (const p of outer) {
        if (!inside(p[0], p[1])) continue;
        // 用「量化后的地表高度」：像素方块风格下地表是台阶，
        // 按原始 DEM 高度铺水面会一半埋进方块、一半浮在半空，出现白色破面
        sum += this.view.quantHeight ? this.view.quantHeight(p[0], p[1]) : this.view.heightAt(p[0], p[1]); cnt++;
      }
      if (!cnt) return;
      stats.lakeFeat++;
      const level = sum / cnt;
      // 注意：Shape 的构造点必须是 Vector2，传 [x, y] 普通数组会静默变成 NaN，
      // earcut 只会吐一个退化三角形，湖面看起来"完全没有"
      const toWorld = (p) => {
        const w = this.view.lonLatToWorld(p[0], p[1]);
        return new THREE.Vector2(w.x, -w.z);   // shape 空间 y 取 -z，旋转后回到 +z
      };
      const shape = new THREE.Shape(outer.map(toWorld));
      for (const h of ringsLO.slice(1)) {
        if (h.length > 3) {
          const hh = rdp(h, tol);
          if (hh.length > 3) shape.holes.push(new THREE.Path(hh.map(toWorld)));
        }
      }
      let g;
      try { g = new THREE.ShapeGeometry(shape); } catch (e) { console.warn('[water] lake shape failed:', e && e.message, outer.length); return; }
      g.rotateX(-Math.PI / 2);
      const arr = g.attributes.position.array;
      // 注意：这里存的是「原始高程（m）」，不是世界 y ——
      // 最终的 y 由顶点着色器按当前垂直夸张算（见 WATER_VERT 注释）。
      const y = level;
      for (let i = 0; i < arr.length; i += 3) { arr[i + 1] = y; }
      stats.lakeTri += arr.length / 3;
      if (lakePos.length > 900000) { g.dispose(); return; }
      for (let i = 0; i < arr.length; i++) lakePos.push(arr[i]);
      g.dispose();
    };

    // —— 河（线）：沿线生成带宽度的带子，贴地 ——
    const addRiver = (line, widthKm) => {
      const pts = [];
      let lx = 1e9, ly = 1e9, hit = false;
      for (const p of line) {
        if (!inside(p[0], p[1])) { if (pts.length > 1) flushRiver(pts, widthKm); pts.length = 0; lx = ly = 1e9; continue; }
        // 河道同样按容差抽稀
        if (Math.abs(p[0] - lx) < tol && Math.abs(p[1] - ly) < tol) continue;
        const w = this.view.lonLatToWorld(p[0], p[1]);
        pts.push({ x: w.x, z: w.z, lon: p[0], lat: p[1] });
        lx = p[0]; ly = p[1];
      }
      if (pts.length > 1) { flushRiver(pts, widthKm); hit = true; }
      if (hit) stats.riverFeat++;
    };
    const flushRiver = (pts, widthKm) => {
      if (riverPos.length > 1200000) return;   // 软上限，防止极端区域把显卡压死
      const hw = widthKm * 0.5;
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1];
        let dx = c.x - a.x, dz = c.z - a.z;
        const L = Math.hypot(dx, dz) || 1;
        dx /= L; dz /= L;
        const nx = -dz * hw, nz = dx * hw;
        const yA = this.view.quantHeight ? this.view.quantHeight(a.lon, a.lat) : this.view.heightAt(a.lon, a.lat);
        const yC = this.view.quantHeight ? this.view.quantHeight(c.lon, c.lat) : this.view.heightAt(c.lon, c.lat);
        // 同样存原始高程（m），由着色器换算世界 y
        const ya = yA;
        const yc = yC;
        const A = [a.x + nx, ya, a.z + nz], B = [a.x - nx, ya, a.z - nz];
        const C = [c.x + nx, yc, c.z + nz], D = [c.x - nx, yc, c.z - nz];
        riverPos.push(...A, ...B, ...C, ...B, ...D, ...C);
      }
    };

    // 内置数据
    if (opts.builtin !== false) {
      try {
        const lakes = await loadNE(LAKE_URL, 'lake');
        for (const f of (lakes.features || [])) {
          eachPolygon(f.geometry, (rings) => {
            const any = rings[0].some((p) => inside(p[0], p[1]));
            if (any) addLake(rings);
          });
        }
      } catch (e) { console.warn('[water] lakes failed:', e && e.message, 'built', lakePos.length / 3, 'verts'); }
      try {
        const rivers = await loadNE(RIVER_URL, 'river');
        for (const f of (rivers.features || [])) {
          const rk = f.properties.scalerank ?? f.properties.min_zoom ?? 6;
          const w = THREE.MathUtils.clamp(2.6 - rk * 0.22, 0.35, 2.6);
          eachLine(f.geometry, (line) => {
            if (line.some((p) => inside(p[0], p[1]))) addRiver(line, w);
          });
        }
      } catch (e) { console.warn('[water] rivers failed:', e && e.message, 'built', riverPos.length / 3, 'verts'); }
    }

    // 用户上传
    if (this.userFC) {
      const l0 = stats.lakeFeat, r0 = stats.riverFeat;
      this.addFeatureCollection(this.userFC, inside, addLake, addRiver);
      stats.userLake = stats.lakeFeat - l0;
      stats.userRiver = stats.riverFeat - r0;
    }

    const mkMesh = (arr, name) => {
      if (!arr.length) return null;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.makeMat());
      m.renderOrder = 5;
      m.frustumCulled = false;
      m.name = name;
      return m;
    };
    this.meshLakes = mkMesh(lakePos, 'lakes');
    this.meshRivers = mkMesh(riverPos, 'rivers');
    if (this.meshLakes) this.group.add(this.meshLakes);
    if (this.meshRivers) this.group.add(this.meshRivers);
    this.setLayers({ showLakes: this.showLakes, showRivers: this.showRivers });
    this.setTheme(this.view.style || {});
  }

  addFeatureCollection(fc, inside, addLake, addRiver) {
    for (const f of (fc.features || [])) {
      const g = f.geometry;
      if (!g) continue;
      eachPolygon(g, (rings) => {
        if (rings[0] && rings[0].some((p) => inside(p[0], p[1]))) addLake(rings);
      });
      eachLine(g, (line) => {
        if (line.some((p) => inside(p[0], p[1]))) addRiver(line, 1.2);
      });
    }
  }

  setUserData(fc) {
    this.userFC = fc;
  }

  update(t) {
    if (!this.enabled) return;
    for (const m of this.mats) m.uniforms.uTime.value = t;
  }

  dispose() {
    this.group.clear();
    for (const m of this.mats) m.dispose();
    this.mats = [];
    this.meshLakes = null;
    this.meshRivers = null;
  }
}
