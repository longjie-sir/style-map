/* ============================================================
   云层：两种方案（可一键切换）
   ------------------------------------------------------------
   A. 体积云 volume —— 仍然是 raymarch，但密度场来自【预烘焙 3D 噪声纹理】
      ---------------------------------------------------------------
      上一版慢在哪：密度是片元里现算的 fbm，
        density() = domain warp(3×vnoise3) + fbm3(pw) + fbm3(pw·2.1)
        每个 vnoise3 = 8 次 hash，每次 hash 里 3 次 fract + 若干乘法
        → 单次密度 ≈ 9 次 vnoise ≈ 72 次 hash
      再看采样数：22 步 × (1 次密度 + 2 次朝太阳遮蔽) = 66 次密度
        → 单像素约 4800 次 hash，还要乘上云覆盖的屏幕面积。
      现在：把 fbm 预烘焙进 64³ 的 3D 纹理
        R = 三倍频 fbm（主形状）  G = 高频细节  B = 大尺度 domain warp
        单次密度 = 1 次硬件三线性采样（1 条指令级别）
        遮蔽 = 1 次采样，且只在密度显著（>0.03）时才做
        → 18 步 × 平均 1.35 次采样 ≈ 24 次纹理取样
      这不是"调参"，是把每像素的 ALU 量换成了纹理带宽，量级差 10~30 倍。
      另外还做了：盒外 discard、视锥剔除（frustumCulled）、
      早停（透明度 <0.03 就 break）。

   B. 平面云 plane —— 上一版的效果：几张半透明 fbm 云图平铺在天上，
      6 个四边形、零 raymarch，几乎不耗性能；观感偏"层"。
      体积云在低配机上还是卡时，直接切这一档。
   ============================================================ */
import * as THREE from 'three';

/* ============================================================
   一、预烘焙 3D 噪声（可平铺的值噪声）
   ============================================================ */
let noiseTex = null;

function hash3i(x, y, z, seed) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483629) ^ Math.imul(seed, 1013904223);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** 周期为 P 的值噪声：坐标用「格」为单位，P 为整数即可无缝平铺 */
function vnoise(x, y, z, P, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);

  const w = (n) => ((n % P) + P) % P;
  const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1), z0 = w(zi), z1 = w(zi + 1);

  const c000 = hash3i(x0, y0, z0, seed), c100 = hash3i(x1, y0, z0, seed);
  const c010 = hash3i(x0, y1, z0, seed), c110 = hash3i(x1, y1, z0, seed);
  const c001 = hash3i(x0, y0, z1, seed), c101 = hash3i(x1, y0, z1, seed);
  const c011 = hash3i(x0, y1, z1, seed), c111 = hash3i(x1, y1, z1, seed);

  const a = c000 + (c100 - c000) * fx, b = c010 + (c110 - c010) * fx;
  const c = c001 + (c101 - c001) * fx, d = c011 + (c111 - c011) * fx;
  const e = a + (b - a) * fy, f = c + (d - c) * fy;
  return e + (f - e) * fz;
}

function buildNoise3D(N = 64) {
  const data = new Uint8Array(N * N * N * 4);
  let o = 0;
  for (let k = 0; k < N; k++) {
    const z = k / N;
    for (let j = 0; j < N; j++) {
      const y = j / N;
      for (let i = 0; i < N; i++, o += 4) {
        const x = i / N;
        // 主形状：三倍频（周期 4 / 8 / 16，都能整除 64 格，天衣无缝）
        const r = vnoise(x * 4, y * 4, z * 4, 4, 11) * 0.55
          + vnoise(x * 8, y * 8, z * 8, 8, 11) * 0.28
          + vnoise(x * 16, y * 16, z * 16, 16, 11) * 0.17;
        // 细节：单频但更细，和主形状一起采样就有"两层"的通透感
        const g = vnoise(x * 13, y * 13, z * 13, 13, 37) * 0.65
          + vnoise(x * 26, y * 26, z * 26, 26, 37) * 0.35;
        // domain warp：只用低频，负责把"蛋形"揉成絮状轮廓
        const bl = vnoise(x * 3, y * 3, z * 3, 3, 71);
        data[o] = (r * 255) | 0;
        data[o + 1] = (g * 255) | 0;
        data[o + 2] = (bl * 255) | 0;
        data[o + 3] = 255;
      }
    }
  }
  const t = new THREE.Data3DTexture(data, N, N, N);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping;
  t.unpackAlignment = 1;
  t.needsUpdate = true;
  return t;
}

function ensureNoise() {
  if (!noiseTex) noiseTex = buildNoise3D(64);
  return noiseTex;
}

/* ---------- 平面云：一张 fbm 云图 ---------- */
let sheetTex = null;
function ensureSheetTex(N = 256) {
  if (sheetTex) return sheetTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N, v = y / N;
      const n = vnoise(u * 4, v * 4, 0.5, 4, 5) * 0.55
        + vnoise(u * 8, v * 8, 0.5, 8, 5) * 0.28
        + vnoise(u * 16, v * 16, 0.5, 16, 5) * 0.17;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = (n * 255) | 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 2;
  sheetTex = t;
  return t;
}

/* ============================================================
   二、体积云着色器
   ============================================================ */
const CLOUD_VERT = /* glsl */`
varying vec3 vLocal;
void main(){
  vLocal = position;                       // 单位立方体 [-1,1]
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */`
precision highp float;
precision highp sampler3D;
varying vec3 vLocal;

/* GLSL3 里没有 gl_FragColor：自己声明输出口，再把老名字映射过去，
   这样 three 的 <tonemapping_fragment> / <colorspace_fragment> 才能照常工作。
   （不声明就会是 "gl_FragColor : undeclared identifier"，整条 shader 编译失败、
   云静默消失 —— 这类错误只在控制台里，页面上什么都看不到。） */
layout(location = 0) out highp vec4 outColor;
#define gl_FragColor outColor

uniform sampler3D uNoise;
uniform vec3  uOrigin;    // 云团中心（世界坐标）
uniform vec3  uHalf;      // 包围盒半尺寸（世界坐标，km）
uniform float uTime;
uniform float uSeed;
uniform float uCover;     // 密度阈值：越大云越薄
uniform float uDensity;   // 整体浓度
uniform float uOpacity;
uniform vec3  uLit;
uniform vec3  uShade;
uniform vec3  uSunDir;
uniform float uSteps;
uniform float uScale;

/* 单位立方体 slab 求交 */
bool boxHit(vec3 ro, vec3 rd, out float tN, out float tF){
  vec3 inv = 1.0 / rd;
  vec3 a = (-1.0 - ro) * inv;
  vec3 b = ( 1.0 - ro) * inv;
  vec3 lo = min(a, b), hi = max(a, b);
  lo = mix(lo, vec3(-1e6), isnan(lo)); hi = mix(hi, vec3(1e6), isnan(hi));
  tN = max(max(lo.x, lo.y), lo.z);
  tF = min(min(hi.x, hi.y), hi.z);
  return tF > max(tN, 0.0);
}

/* 密度场：整个函数只有 1 次 3D 纹理采样。
   R 主形状 / G 细节 / B warp 都在同一次采样里拿到 —— 这是"提速 10 倍"的关键。 */
float density(vec3 p, vec3 flow){
  vec3 q = p * uScale + flow + uSeed;
  vec3 nt = texture(uNoise, q).rgb;

  // 用 B 通道做大尺度 warp：把规规矩矩的椭球揉出絮状凸起
  float dw = (nt.b - 0.5) * 0.62;
  vec3 pw = p + vec3(dw);

  float r2 = dot(pw, pw);
  if (r2 > 1.0) return 0.0;
  float shape = 1.0 - smoothstep(0.30, 1.0, sqrt(r2));
  // 云底收一收、云顶蓬松：积云的典型剖面
  shape *= smoothstep(-1.0, -0.28, pw.y) * (1.0 - 0.30 * smoothstep(0.35, 1.0, pw.y));
  if (shape < 0.014) return 0.0;

  float n = nt.r * 0.74 + nt.g * 0.26;
  return max(0.0, (n - uCover) / max(1e-3, 1.0 - uCover)) * shape;
}

void main(){
  /* 世界坐标 → 单位立方体：local = (world - origin) / half。
     射线在相机与「本片元所在的盒面点」之间求得，逐片元算，不能用顶点插值方向。 */
  vec3 surfW = uOrigin + vLocal * uHalf;
  vec3 rdW = normalize(surfW - cameraPosition);
  vec3 ro = (cameraPosition - uOrigin) / uHalf;
  vec3 rd = normalize(rdW / uHalf);

  float tN, tF;
  if (!boxHit(ro, rd, tN, tF)) discard;
  tN = max(tN, 0.0);
  if (tF - tN < 1e-4) discard;

  vec3 flow = vec3(uTime * 0.014, uTime * 0.004, uTime * 0.008);
  vec3 sunL = normalize(uSunDir / uHalf);

  float steps = clamp(uSteps, 6.0, 40.0);
  float dt = (tF - tN) / steps;
  float t = tN + dt * 0.5;

  vec3 acc = vec3(0.0);
  float trans = 1.0;
  for (int i = 0; i < 40; i++){
    if (float(i) >= steps || trans < 0.03) break;
    vec3 p = ro + rd * t;
    float d = density(p, flow);
    if (d > 0.004){
      // 自遮蔽：稀薄处直接用自身密度当遮蔽（0 成本），
      // 只有实心的地方才多花 1 次采样朝太阳探一步
      float sh = d * 0.55;
      if (d > 0.03) sh = max(sh, density(p + sunL * 0.26, flow));
      vec3 c = mix(uShade, uLit, clamp(1.0 - sh * 1.55, 0.0, 1.0));
      float a = clamp(d * uDensity * dt * 5.0, 0.0, 1.0) * trans;
      acc += c * a;
      trans *= (1.0 - a);
    }
    t += dt;
  }

  float alpha = (1.0 - trans) * uOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(acc / max(1.0 - trans, 1e-4), alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

/* ============================================================
   三、平面云着色器（降级方案）
   ============================================================ */
const SHEET_VERT = /* glsl */`
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SHEET_FRAG = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D map;
uniform vec3  uLit;
uniform vec3  uShade;
uniform float uOpacity;
uniform float uCover;
uniform vec2  uOffset;
void main(){
  vec2 uv = vUv + uOffset;
  float n = texture2D(map, uv).r;
  // 边缘羽化：否则一张方图会露出四条直边
  vec2 d = abs(vUv - 0.5) * 2.0;
  float edge = (1.0 - smoothstep(0.42, 1.0, d.x)) * (1.0 - smoothstep(0.42, 1.0, d.y));
  float a = smoothstep(uCover, uCover + 0.26, n) * edge * uOpacity;
  if (a < 0.004) discard;
  // 用偏移采样做一点假明暗，才不像一张贴纸
  float n2 = texture2D(map, uv + vec2(0.014, 0.018)).r;
  vec3 c = mix(uShade, uLit, clamp(0.28 + n2 * 1.05, 0.0, 1.0));
  gl_FragColor = vec4(c, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/* ============================================================
   四、一团体积云
   ============================================================ */
class Puff {
  constructor(clouds, lon, lat, opt = {}) {
    const view = clouds.view;
    this.clouds = clouds;
    this.view = view;
    this.lon = lon; this.lat = lat;
    this._h = opt.height || 1;
    this.radius = Math.max(view.region.spanX, view.region.spanY) * (opt.size || 0.28);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uNoise: { value: ensureNoise() },
        uOrigin: { value: new THREE.Vector3() },
        uHalf: { value: new THREE.Vector3(this.radius, this.radius * 0.46, this.radius) },
        uTime: { value: 0 },
        uSeed: { value: Math.random() * 7 },
        uCover: { value: 0.36 },
        uDensity: { value: 2.4 },
        uOpacity: { value: 0.95 },
        uLit: { value: new THREE.Color('#ffffff') },
        uShade: { value: new THREE.Color('#9fb2c2') },
        uSunDir: view.u.uSunDir,
        uSteps: { value: 18 },
        uScale: { value: opt.scale || 1.6 }
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,     // 只画背面：相机进到盒子里也不会被近裁剪面切开
      glslVersion: THREE.GLSL3,
      blending: THREE.NormalBlending
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), mat);
    this.mesh.position.set(0, 0, 0);
    const w = view.lonLatToWorld(lon, lat);
    this.baseY = this.floorY();
    this.mesh.position.set(w.x, this.baseY, w.z);
    this.mesh.scale.set(this.radius, this.radius * 0.46, this.radius);
    this.mesh.renderOrder = 22;
    // 视锥剔除：盒子飞出去的云不再跑 raymarch（旧版是 frustumCulled = false，全屏白算）
    this.mesh.frustumCulled = true;
    clouds.group.add(this.mesh);
    this.syncBox();
  }
  /** 盒中心的 y：保证「盒底」不低于 baseHeight（否则云会插进山里） */
  floorY() {
    return this.clouds.baseHeight() * this._h + this.radius * 0.46;
  }
  syncBox() {
    const u = this.mesh.material.uniforms;
    u.uOrigin.value.copy(this.mesh.position);
    const s = this.mesh.scale;
    u.uHalf.value.set(s.x, s.y, s.z);
  }
  /** 垂直夸张 / 高度倍数改变后重新定位 */
  reflow() {
    this.baseY = this.floorY();
    this.mesh.position.y = this.baseY;
    this.syncBox();
  }
}

/* ============================================================
   五、平面云：一片薄薄的云图
   ============================================================ */
class Sheet {
  constructor(clouds, i, n) {
    const view = clouds.view;
    this.clouds = clouds;
    const span = Math.max(view.region.spanX, view.region.spanY);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: ensureSheetTex() },
        uLit: { value: new THREE.Color('#ffffff') },
        uShade: { value: new THREE.Color('#c9d3dc') },
        uOpacity: { value: 0.5 },
        uCover: { value: 0.32 },
        uOffset: { value: new THREE.Vector2(Math.random(), Math.random()) }
      },
      vertexShader: SHEET_VERT,
      fragmentShader: SHEET_FRAG,
      transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    const size = span * (1.5 + Math.random() * 0.6);
    const geo = new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    const base = clouds.baseHeight();
    this.mesh.position.set(
      (Math.random() - 0.5) * span * 0.5,
      base * (1.0 + (i / Math.max(1, n - 1)) * 0.55),
      (Math.random() - 0.5) * span * 0.5
    );
    this.mesh.rotation.y = Math.random() * Math.PI * 2;
    this.mesh.renderOrder = 20 + i;
    this.mesh.frustumCulled = true;
    this.radius = size * 0.45;
    clouds.group.add(this.mesh);
  }
  reflow() {
    const span = Math.max(this.clouds.view.region.spanX, this.clouds.view.region.spanY);
    const base = this.clouds.baseHeight();
    this.mesh.position.y = base * (1.0 + this._k * 0.55);
    this.mesh.position.x = Math.max(-span * 0.35, Math.min(span * 0.35, this.mesh.position.x));
    this.mesh.position.z = Math.max(-span * 0.35, Math.min(span * 0.35, this.mesh.position.z));
  }
}

/* ============================================================
   六、总控
   ============================================================ */
export class Clouds {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    this.group.visible = false;
    view.world.add(this.group);
    this.puffs = [];
    this.sheets = [];
    this.enabled = false;
    this.placeMode = false;
    this.mode = 'volume';
    this.params = { amount: 0.5, height: 1, speed: 1, shadow: 0.55, steps: 0.62 };
    this._quality = 'high';

    // 噪声 LUT 有 ~250ms 的构建成本：空闲时先备好，别在第一次开云时卡一下
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 900));
    idle(() => { try { ensureNoise(); } catch (e) { /* 交给首次使用时重试 */ } }, { timeout: 3000 });
  }

  /** 云底高度：明显高于最高峰，否则云会插进山里 */
  baseHeight() {
    const r = this.view.region;
    if (!r) return 200;
    const span = Math.max(r.spanX, r.spanY);
    const maxY = (this.view.u.uMaxH.value || 1000) * this.view.u.uHeightScale.value;
    return Math.max(maxY * 3.2, span * 0.10);
  }

  /* ---------- 方案切换 ---------- */
  setMode(m) {
    const next = m === 'plane' ? 'plane' : 'volume';
    if (next === this.mode) return;
    this.clear();
    this.mode = next;
    if (this.enabled) this._fillDefault();
    this.applyParams();
  }

  _fillDefault() {
    if (!this.view.region) return;
    if (this.mode === 'plane') this._buildSheets(6);
    else this.scatter(5);
  }

  _buildSheets(n) {
    for (const s of this.sheets) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    this.group.clear();
    this.sheets = [];
    for (let i = 0; i < n; i++) {
      const s = new Sheet(this, i, n);
      s._k = i / Math.max(1, n - 1);
      this.sheets.push(s);
    }
    this.puffs = [];
  }

  /* ---------- 手动放置（仅体积云） ---------- */
  place(lon, lat, opt = {}) {
    if (this.mode !== 'volume' || !this.view.region) return null;
    const p = new Puff(this, lon, lat, Object.assign({
      height: this.params.height || 1,
      size: 0.075 + Math.random() * 0.065,   // 半径 ≈ 0.075~0.14 × 跨度：一团云就是一朵积云，不是一整片雾
      scale: 1.45 + Math.random() * 0.5
    }, opt));
    this.puffs.push(p);
    this.group.visible = this.enabled;
    this.applyParams();
    return p;
  }

  /** 在区域内随机撒 n 团（作为「放置」的起点，之后可继续手动加） */
  scatter(n = 4) {
    const r = this.view.region;
    if (!r || this.mode !== 'volume') return 0;
    const b = r.bbox, inside = this.view.maskSampler();
    let made = 0, tries = 0;
    while (made < n && tries < n * 50) {
      tries++;
      const lon = b.west + Math.random() * (b.east - b.west);
      const lat = b.south + Math.random() * (b.north - b.south);
      if (!inside(lon, lat)) continue;
      this.place(lon, lat);
      made++;
    }
    return made;
  }

  clear() {
    for (const p of this.puffs) { p.mesh.geometry.dispose(); p.mesh.material.dispose(); }
    for (const s of this.sheets) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
    this.puffs = [];
    this.sheets = [];
    this.group.clear();
    this.group.visible = false;
    this.syncShadow();
  }

  /** 区域 / 夸张变化后重排 */
  reflow() {
    for (const p of this.puffs) p.reflow();
    for (const s of this.sheets) s.reflow();
    this.applyParams();
  }

  /* ---------- 主题 / 参数 ---------- */
  setTheme(style) {
    const dark = !!style.dark;
    const paper = ['sketch', 'line', 'parchment', 'paper'].includes(style.key);
    this._paper = paper; this._dark = dark;
    for (const p of this.puffs) {
      const u = p.mesh.material.uniforms;
      u.uLit.value.set(dark ? '#e9f2fa' : '#ffffff');
      u.uShade.value.set(dark ? '#6d8296' : (paper ? '#efe9de' : '#9fb2c2'));
    }
    for (const s of this.sheets) {
      const u = s.mesh.material.uniforms;
      u.uLit.value.set(dark ? '#dbe7f3' : '#ffffff');
      u.uShade.value.set(dark ? '#5f7488' : (paper ? '#f0ebe0' : '#c3ced8'));
    }
    this.applyParams();
  }

  setParams(patch) {
    Object.assign(this.params, patch);
    this.applyParams();
  }

  setQuality(q) {
    this._quality = q;
    this.applyParams();
  }

  applyParams() {
    const p = this.params;
    const any = this.puffs.length || this.sheets.length;
    this.group.visible = !!this.enabled && !!any;
    const k = this._paper ? 0.6 : 1.0;
    const qK = this._quality === 'low' ? 0.40 : this._quality === 'mid' ? 0.72 : 1;
    // 体积云：基础 20 步（旧版 34）× 用户采样系数 × 画质系数
    const steps = Math.max(7, Math.round(20 * p.steps * qK));
    for (const puff of this.puffs) {
      const u = puff.mesh.material.uniforms;
      u.uCover.value = 0.36 + (0.5 - p.amount) * 0.16;
      u.uDensity.value = 1.5 + p.amount * 1.8;
      u.uOpacity.value = (0.60 + p.amount * 0.40) * k;
      u.uSteps.value = steps;
      if (puff._h !== p.height) { puff._h = p.height; puff.reflow(); }
    }
    for (const s of this.sheets) {
      const u = s.mesh.material.uniforms;
      u.uOpacity.value = (0.28 + p.amount * 0.42) * k;
      u.uCover.value = 0.46 - p.amount * 0.20;
    }
    this.syncShadow();
  }

  /** 把云团的「中心/半径/强度」推进地形着色器，云影才是真投影而不是一片固定斑点 */
  syncShadow() {
    const u = this.view.u;
    const on = this.enabled && (this.puffs.length || this.sheets.length) && this.params.shadow > 0.01;
    u.uCloudAmt.value = on ? this.params.shadow : 0;
    if (!on) { u.uCloudN.value = 0; return; }
    const src = this.mode === 'volume'
      ? this.puffs.map((p) => ({ pos: p.mesh.position, r: p.radius }))
      : this.sheets.map((s) => ({ pos: s.mesh.position, r: s.radius }));
    const list = src.slice().sort((a, b) => b.r - a.r).slice(0, 6);
    for (let i = 0; i < list.length; i++) {
      u.uCloudP.value[i].set(list[i].pos.x, list[i].pos.z, list[i].r * 0.92, 1);
    }
    u.uCloudN.value = list.length;
    u.uCloudBaseY.value = this.baseHeight();
  }

  setVisible(on) {
    this.enabled = !!on;
    if (this.enabled && !this.puffs.length && !this.sheets.length && this.view.region) {
      this._fillDefault();     // 打开但还没云 → 先给一批，否则用户以为「开了没反应」
    }
    this.applyParams();
  }

  update(dt, t) {
    if (!this.enabled) return;
    const sp = (this.params.speed || 1) * 0.055;
    const drift = (this.params.speed || 1) * 0.45;
    const r = this.view.region;
    const lim = r ? Math.max(r.spanX, r.spanY) * 1.25 : 0;

    for (const p of this.puffs) {
      const u = p.mesh.material.uniforms;
      u.uTime.value = t * sp;
      // 云团真的在飘（不只是噪声流动）：影子才会跟着走
      p.mesh.position.x += u.uSunDir.value.x * drift * dt;
      p.mesh.position.z += u.uSunDir.value.z * drift * dt;
      if (lim > 0) {
        const dx = p.mesh.position.x, dz = p.mesh.position.z;
        if (Math.abs(dx) > lim) p.mesh.position.x = -Math.sign(dx) * lim;
        if (Math.abs(dz) > lim) p.mesh.position.z = -Math.sign(dz) * lim;
      }
      p.syncBox();
    }
    for (const s of this.sheets) {
      const u = s.mesh.material.uniforms;
      u.uOffset.value.x += dt * 0.0045 * (this.params.speed || 1);
      u.uOffset.value.y += dt * 0.0022 * (this.params.speed || 1);
      s.mesh.position.x += dt * 0.5 * (this.params.speed || 1);
      if (lim > 0 && Math.abs(s.mesh.position.x) > lim) s.mesh.position.x = -lim;
    }

    this._shadowT = (this._shadowT || 0) + dt;
    if (this._shadowT > 0.25) { this._shadowT = 0; this.syncShadow(); }
  }
}

export { Puff };
