/* ============================================================
   背景场景：厚度底部的「中国」底衬
   - 底图用离线烘焙好的遥感影像（assets/china_sat.jpg，见 scripts/bake_backdrop.py）
     → 运行时零网络请求，断网也能出图
   - 影像做去饱和 + 主题染色 + 径向衰减，永远退在后面不抢主体
   - 省界与当前区域高亮用 2D 画布现画（矢量，任何缩放下都清晰）
   ============================================================ */
import * as THREE from 'three';
import { netUrl } from '../net.js';

/* 与 scripts/bake_backdrop.py 里的 BBOX 必须完全一致，否则影像会整体偏移 */
const RECT = { west: 72.0, east: 136.5, south: 16.0, north: 55.0 };
const SAT_URL = './assets/china_sat.jpg';
const CN_URL = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';

let cnCache = null;
let satTex = null;
let satPromise = null;

async function loadChina() {
  if (cnCache) return cnCache;
  const r = await fetch(netUrl(CN_URL));
  if (!r.ok) throw new Error('HTTP ' + r.status);
  cnCache = await r.json();
  return cnCache;
}

function ensureSat() {
  if (satTex) return Promise.resolve(satTex);
  if (!satPromise) {
    satPromise = new Promise((res) => {
      new THREE.TextureLoader().load(SAT_URL, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.minFilter = THREE.LinearFilter;
        t.magFilter = THREE.LinearFilter;
        t.anisotropy = 4;
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        satTex = t;
        res(t);
      }, undefined, () => res(null));
    });
  }
  return satPromise;
}

/* 影像层：去饱和 + 对比 + 染色 + 径向衰减 */
const SAT_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SAT_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec3  uTint;
uniform float uSat;       // 保留多少原始色彩
uniform float uContrast;
uniform float uOpacity;
uniform float uVig;       // 衰减起点
uniform float uSoft;      // 柔化强度（纸本风格用：把影像揉成均匀纸色底纹）
uniform float uHas;
void main(){
  if (uHas < 0.5) discard;
  vec3 c = texture2D(map, vUv).rgb;
  // 四抽平均 = 一次小半径模糊。纸本风格下必须柔化：
  // 全国影像按 0.3 透明度叠在纸白上，海岸线与云系会变成一块块脏灰斑。
  if (uSoft > 0.001) {
    vec2 e = vec2(0.0065, 0.0090) * uSoft;
    vec3 s2 = texture2D(map, vUv + e).rgb;
    vec3 s3 = texture2D(map, vUv - e).rgb;
    vec3 s4 = texture2D(map, vUv + vec2(e.x, -e.y)).rgb;
    c = (c * 2.0 + s2 + s3 + s4) * 0.2;
  }
  float lum = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(lum), c, uSat);
  c = (c - 0.5) * uContrast + 0.5;
  c = max(c, vec3(0.0)) * uTint;
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(uVig, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(c, a);
}`;

/* 线条层：省界 + 高亮，纯 2D 画布贴图 */
const LINE_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D map;
uniform float uOpacity;
uniform float uVig;
void main(){
  vec4 t = texture2D(map, vUv);
  float d = length(vUv - 0.5) * 2.0;
  float a = (1.0 - smoothstep(uVig, 1.0, d)) * uOpacity;
  gl_FragColor = vec4(t.rgb, t.a * a);
}`;

export class Backdrop {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.world.add(this.group);
    this.enabled = true;
    this.opacity = 1;
    this.mesh = null;
    this.lineMesh = null;
    this.style = null;
    this.rect = null;
    ensureSat();
  }

  async build(region, style) {
    this.dispose();
    if (!region) return;
    this.style = style;
    this.region = region;

    // 底衬铺多大：区域跨度的 1.7 倍，但不小于 ±250km（县级视图也要有上下文）
    const span = Math.max(region.spanX, region.spanY);
    const halfKm = Math.max(span * 1.5, 240);
    const b = region.bbox;
    const kmLon = region.world.kmLon, kmLat = region.world.kmLat;
    const cLon = (b.west + b.east) / 2, cLat = (b.south + b.north) / 2;

    // 与烘焙范围取交集：影像只有这么大的覆盖，超出部分不画
    const sub = {
      west: Math.max(cLon - halfKm / kmLon, RECT.west),
      east: Math.min(cLon + halfKm / kmLon, RECT.east),
      south: Math.max(cLat - halfKm / kmLat, RECT.south),
      north: Math.min(cLat + halfKm / kmLat, RECT.north)
    };
    if (sub.east - sub.west < 0.05 || sub.north - sub.south < 0.05) return;
    this.rect = sub;

    const wKm = (sub.east - sub.west) * kmLon;
    const dKm = (sub.north - sub.south) * kmLat;
    this.meshPos = {
      x: ((sub.west + sub.east) / 2 - cLon) * kmLon,
      z: (cLat - (sub.south + sub.north) / 2) * kmLat
    };
    const y = -(this.view.params.depth || 8) - 0.6;

    // ① 影像层
    this.satU = {
      map: { value: satTex },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uSat: { value: 0.5 }, uContrast: { value: 0.9 },
      uSoft: { value: 0 },
      uOpacity: { value: 1 }, uVig: { value: 0.20 },
      uHas: { value: satTex ? 1 : 0 }
    };
    this.satMat = new THREE.ShaderMaterial({
      uniforms: this.satU, vertexShader: SAT_VERT, fragmentShader: SAT_FRAG,
      transparent: true, depthWrite: false
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(wKm, dKm).rotateX(-Math.PI / 2), this.satMat);
    this.mesh.position.set(this.meshPos.x, y, this.meshPos.z);
    this.mesh.renderOrder = 0;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
    ensureSat().then((t) => {
      if (!t || !this.satU) return;
      this.satU.map.value = t;
      this.satU.uHas.value = 1;
    });

    // ② 线条层（省界 + 当前区域高亮）
    const cv = this.lineCanvas(sub, 1024);
    this.lineTex = new THREE.CanvasTexture(cv);
    this.lineTex.colorSpace = THREE.SRGBColorSpace;
    this.lineTex.minFilter = THREE.LinearFilter;
    this.lineU = {
      map: { value: this.lineTex },
      uOpacity: { value: 1 }, uVig: { value: 0.20 }
    };
    this.lineMat = new THREE.ShaderMaterial({
      uniforms: this.lineU, vertexShader: SAT_VERT, fragmentShader: LINE_FRAG,
      transparent: true, depthWrite: false
    });
    this.lineMesh = new THREE.Mesh(new THREE.PlaneGeometry(wKm, dKm).rotateX(-Math.PI / 2), this.lineMat);
    this.lineMesh.position.set(this.meshPos.x, y + 0.35, this.meshPos.z);
    this.lineMesh.renderOrder = 1;
    this.lineMesh.frustumCulled = false;
    this.group.add(this.lineMesh);

    this.setTheme(style || this.style);
    this.setVisible(this.enabled);
    // 省界依赖联网数据；拿不到就只留区域高亮（已经画好）
    loadChina().then(() => this.redrawLines()).catch(() => {});
  }

  lineCanvas(sub, S) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    this._S = S;
    this._sub = sub;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    this._ctx = ctx;
    this.drawLines();
    return cv;
  }

  drawLines() {
    const ctx = this._ctx, S = this._S, sub = this._sub;
    if (!ctx) return;
    ctx.clearRect(0, 0, S, S);
    const X = (lon) => (lon - sub.west) / (sub.east - sub.west) * S;
    const Y = (lat) => (sub.north - lat) / (sub.north - sub.south) * S;
    const dark = !!(this.style && this.style.dark);
    const paper = this.style && ['sketch', 'line', 'parchment', 'paper'].includes(this.style.key);

    // 邻省界线
    const cn = cnCache;
    if (cn) {
      ctx.strokeStyle = dark ? 'rgba(150,200,240,0.34)' : (paper ? 'rgba(96,92,84,0.26)' : 'rgba(96,104,116,0.30)');
      ctx.lineWidth = Math.max(1, S / 1400);
      ctx.beginPath();
      for (const f of (cn.features || [])) {
        const polys = toPolys(f.geometry);
        for (const rings of polys) {
          for (const ring of rings) {
            if (ring.length < 3) continue;
            ctx.moveTo(X(ring[0][0]), Y(ring[0][1]));
            for (let i = 1; i < ring.length; i++) ctx.lineTo(X(ring[i][0]), Y(ring[i][1]));
            ctx.closePath();
          }
        }
      }
      ctx.stroke();

      // 邻省名（弱化，只做方位参考）
      ctx.font = `500 ${Math.round(S / 44)}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = dark ? 'rgba(160,190,215,0.40)' : (paper ? 'rgba(90,86,78,0.34)' : 'rgba(90,98,110,0.36)');
      for (const f of (cn.features || [])) {
        const c = (f.properties || {}).center;
        if (!c) continue;
        const x = X(c[0]), y = Y(c[1]);
        if (x < 8 || x > S - 8 || y < 8 || y > S - 8) continue;
        const nm = String(f.properties.name || '')
          .replace(/(维吾尔自治区|壮族自治区|回族自治区|自治区|特别行政区|省|市)/g, '');
        if (nm) ctx.fillText(nm, x, y);
      }
    }

    // 当前区域：淡填充 + 亮描边，一眼看出「我在这里」
    const r = this.region;
    if (r && r.polys) {
      const accent = dark ? 'rgba(120,200,255,' : 'rgba(58,120,200,';
      ctx.beginPath();
      for (const p of r.polys) {
        const ring = p.outer;
        if (!ring || ring.length < 3) continue;
        ctx.moveTo(X(ring[0][0]), Y(ring[0][1]));
        for (let i = 1; i < ring.length; i++) ctx.lineTo(X(ring[i][0]), Y(ring[i][1]));
        ctx.closePath();
      }
      ctx.fillStyle = accent + '0.10)';
      ctx.fill('evenodd');
      ctx.strokeStyle = accent + (dark ? '0.75)' : '0.55)');
      ctx.lineWidth = Math.max(1.6, S / 620);
      ctx.stroke();
    }
  }

  redrawLines() {
    if (!this._ctx) return;
    this.drawLines();
    if (this.lineTex) this.lineTex.needsUpdate = true;
  }

  setTheme(style) {
    if (!style) return;
    const prevKey = this.style && this.style.key;
    this.style = style;
    const dark = !!style.dark;
    const key = style.key;
    const paperish = ['sketch', 'line', 'parchment', 'paper'].includes(key);
    const u = this.satU;
    if (dark) {
      this._themeA = 0.40;
      if (u) {
        u.uTint.value.setRGB(0.46, 0.56, 0.70);
        u.uSat.value = 0.34; u.uContrast.value = 0.88;
        u.uSoft.value = 0.0;
      }
    } else if (paperish) {
      // 纸本风格：影像压成单色纸张纹理，不能有彩色照片感。
      // 关键是「柔化 + 低对比 + 低透明度」三件一起降：
      // 只降饱和度的话，海岸线与云系仍是硬边，叠在纸白上就是一块块脏灰斑。
      this._themeA = 0.20;
      if (u) {
        const hex = (style.palettes && style.palettes[0] && style.palettes[0].paper) || '#f4f1e8';
        const c = new THREE.Color(hex);
        u.uTint.value.setRGB(Math.min(1, c.r * 1.10), Math.min(1, c.g * 1.08), Math.min(1, c.b * 1.0));
        u.uSat.value = 0.04; u.uContrast.value = 0.30;
        u.uSoft.value = 1.0;
      }
    } else {
      this._themeA = 0.26;
      if (u) {
        u.uTint.value.setRGB(0.92, 0.94, 0.96);
        u.uSat.value = 0.22; u.uContrast.value = 0.92;
        u.uSoft.value = 0.15;
      }
    }
    this.setVisible(this.enabled);
    if (prevKey !== key || !this._ctx) this.redrawLines();
  }

  setOpacity(v) {
    this.opacity = v;
    this.setVisible(this.enabled);
  }

  setVisible(on) {
    this.enabled = !!on;
    const k = this.enabled ? this.opacity : 0;
    // 市/县级视图里卫星底图只会糊成一团灰（一张全国底图放大到几百公里），
    // 这时候只留矢量界线，画面反而干净
    const span = this.region ? Math.max(this.region.spanX, this.region.spanY) : 9999;
    const satK = span > 260 ? 1 : 0;
    const a = k * satK;
    if (this.mesh) this.mesh.visible = a > 0.004;
    if (this.lineMesh) this.lineMesh.visible = k > 0.004;
    if (this.satU) this.satU.uOpacity.value = (this._themeA ?? 0.55) * a;
    if (this.lineU) this.lineU.uOpacity.value = k * 0.55;
  }

  dispose() {
    this.group.clear();
    if (this.lineTex) this.lineTex.dispose();
    if (this.satMat) this.satMat.dispose();
    if (this.lineMat) this.lineMat.dispose();
    this.mesh = null; this.lineMesh = null; this.lineTex = null;
    this.satU = null; this.lineU = null; this._ctx = null;
  }
}

function toPolys(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}
