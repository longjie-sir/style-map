/* ============================================================
   三维地形视图：网格 / 边界侧壁 / 遮罩 / 多风格材质 / 光照
   ============================================================ */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VERT, FRAG, WALL_VERT, WALL_FRAG } from './shaders.js';
import { PALETTE_RAMP } from './palettes.js';
import { buildMaskCanvas, buildShadowCanvas } from '../geo/regions.js';
import { buildVoxelGeometry, createVoxelMaterial } from './voxels.js';

const QS = new URLSearchParams(location.search);
export const LOWFX = QS.get('q') === 'low';
/** 画质档 → 网格细分 / 像素比 / 着色器步数系数 */
export const QUALITY = {
  // seg 是高度场网格的边长细分：三角形数按平方涨（640 → 82 万，512 → 52 万）。
  // DEM 本身没有那么细，640 多出来的三角形只是把同一份高程切得更碎，
  // 视觉几乎不变却让顶点/光栅化成本翻倍，所以收到 512。
  // dpr 同理：1.75 在 1080p 屏上等于渲染 3360×1890，是纯浪费。
  high: { seg: 512, dpr: 1.5, stepK: 1.0, shadow: 1 },
  mid: { seg: 384, dpr: 1.15, stepK: 0.62, shadow: 1 },
  low: { seg: 288, dpr: 1.0, stepK: 0.30, shadow: 0 }
};

export class TerrainView {
  constructor(el) {
    this.el = el;
    this.region = null;
    this.params = {
      exag: 6, sunAz: 315, sunEl: 34, shadow: 0.9, shadowOn: LOWFX ? 0 : 1, ao: 0.5,
      contourOn: 1, contourStep: 200, contourW: 0.8, lineDensity: 1,
      paper: 0.3, fog: 0.4, glow: 0.4, bands: 10, snow: 0.8, snowAuto: 1, rim: 1,
      depth: 8, border: 1, outline: 1, sea: 0, shadowPlane: 1,
      voxCols: 104, voxLevels: 12
    };
    this.style = null;
    this.palette = null;
    // 页面背景（地图以外的那片底）：theme=跟风格渐变 / plain=素色 / off=不画
    this.bgMode = 'theme';
    this.bgColor = '#ffffff';
    // 像素方块风格：不走高度场网格，另建一套「柱体」几何
    this.pixelMode = false;
    this.following = false;     // 沿线飞行中：跳过 target 的范围内钳制
    this.showIslets = true;     // 远岛/飞地边界是否显示
    this.isletGroup = null;
    this.voxMat = null;
    this.voxMesh = null;
    this.voxStepM = 0;
    this.voxLoH = 0;
    this.voxLevels = 12;
    /** 云：体积云层（可手动放置） */
    this.cloudPuffs = null;
    this.clock = new THREE.Clock();
    this.growth = 1;
    this.growthTarget = 1;

    this.quality = LOWFX ? 'low' : 'high';
    const q0 = QUALITY[this.quality];

    const r = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, q0.dpr));
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.domElement.style.display = 'block';
    el.appendChild(r.domElement);
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.4, 32000);
    this.camera.position.set(0, 500, 700);

    const controls = new OrbitControls(this.camera, r.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.075;
    controls.rotateSpeed = 0.62;
    controls.zoomSpeed = 0.9;
    controls.panSpeed = 0.7;
    controls.maxPolarAngle = Math.PI * 0.492;
    controls.minPolarAngle = 0.02;
    controls.screenSpacePanning = false;
    this.controls = controls;

    this.world = new THREE.Group();
    this.scene.add(this.world);

    this.u = {
      uHeight: { value: null },
      uMask: { value: null },
      uRamp: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uSpan: { value: new THREE.Vector2(100, 100) },
      // 距离 1 处一个屏幕像素覆盖的世界尺寸：与焦距/视口高度有关，
      // 排线用它把「线宽」换算到像素，保证细线不会因为亚像素而被采样成麻点
      uPix: { value: 0.002 },
      uPx: { value: 0.5 },
      uHeightScale: { value: this.params.exag / 1000 },
      uMinH: { value: 0 }, uMaxH: { value: 1000 },
      uTime: { value: 0 }, uGrowth: { value: 1 },
      uSunDir: { value: new THREE.Vector3(-0.5, 0.5, -0.7).normalize() },
      uPaper: { value: new THREE.Color('#f4f2ec') },
      uInk: { value: new THREE.Color('#1a1c20') },
      uAccent: { value: new THREE.Color('#ffffff') },
      uSeaCol: { value: new THREE.Color('#3f7a90') },
      uFogColor: { value: new THREE.Color('#dfe3dd') },
      uStyle: { value: 0 },
      uShadowOn: { value: 1 }, uShadowStr: { value: 0.9 }, uShadowLen: { value: 40 },
      uAOAmt: { value: 0.5 }, uContourOn: { value: 1 }, uContourStep: { value: 200 },
      uContourW: { value: 0.8 }, uLineDensity: { value: 1 }, uPaperAmt: { value: 0.3 },
      uFog: { value: 0.4 }, uGlow: { value: 0.4 }, uBands: { value: 10 },
      uSnowLine: { value: 0.8 }, uRim: { value: 1 },
      uCloudAmt: { value: 0 },
      uCloudN: { value: 0 },
      uCloudP: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
      uCloudBaseY: { value: 0 },
      uSkyAmb: { value: new THREE.Color('#3c5580') },
      uStepK: { value: q0.stepK }
    };

    this.mat = new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: true, side: THREE.FrontSide
    });

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /* ---------- 尺寸 ---------- */
  resize() {
    const w = this.el.clientWidth || window.innerWidth;
    const h = this.el.clientHeight || window.innerHeight;
    // ⚠ 第三个参数必须让 three 写画布样式（默认 true）。
    // 传 false 时 canvas 只有 width/height 属性（= w*devicePixelRatio），
    // CSS 尺寸会退化成属性尺寸 —— 在 Retina（dpr=1.5/2）屏上画布被放大 1.5~2 倍显示，
    // 画面只露出左上角一块、主体看着"没居中"；而 HTML 标注层仍按 CSS 尺寸投影，
    // 于是文字整体缩到左上角、与地块完全对不上。头号「标注错位」根因。
    this.renderer.setSize(w, h);
    const cvs = this.renderer.domElement;
    cvs.style.width = w + 'px';
    cvs.style.height = h + 'px';
    this._w = w; this._h = h;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    // 每像素对应的世界尺寸（距离 1 时）：2*tan(fov/2)/视口高
    this.u.uPix.value = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(h, 1);
  }

  /* 渲染倍率：交互（拖拽/飞行）时降分辨率，停下后恢复。
     地形是纯 fill-bound —— 每像素都要跑完整着色器（自阴影 + 云影 + 排线 + 纸纹），
     像素数是唯一能线性砍掉的成本，而且降的是「运动中的清晰度」，眼睛看不出来。 */
  setRenderScale(k) {
    const want = Math.max(0.4, Math.min(1, k));
    if (Math.abs(want - (this._rs ?? 1)) < 0.01) return;
    this._rs = want;
    const cfg = QUALITY[this.quality] || QUALITY.mid;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dpr) * want);
    // setPixelRatio 内部会 setSize(w,h,false)（不写 CSS 样式），这里补回 CSS 尺寸，
    // 否则画布会被浏览器按属性尺寸放大，画面「跳一下」。
    const cvs = this.renderer.domElement;
    if (this._w) { cvs.style.width = this._w + 'px'; cvs.style.height = this._h + 'px'; }
  }

  /** 画质档：换档要重建网格（细分写进了几何），阴影步数/像素比走 uniform */
  setQuality(q) {
    if (!QUALITY[q]) return;
    this.quality = q;
    const cfg = QUALITY[q];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cfg.dpr));
    this._rs = 1;                 // 换档会重置像素比，动态倍率的状态要跟着归位
    this.u.uStepK.value = cfg.stepK;
    if (this.voxMat && this.voxMat.uniforms.uStepK) this.voxMat.uniforms.uStepK.value = cfg.stepK;
    if (this.cloudRef) this.cloudRef.setQuality(q);
    this.resize();
    if (this.region) {
      this.rebuildMesh();
      if (this.pixelMode) this.rebuildVoxels();
    }
    // 阴影开关是「用户开关 × 画质档」，换档后必须重算（低档直接关自阴影）
    this.applyParams();
  }

  /** 只重建高度场网格，其余内容保留 */  rebuildMesh() {
    if (!this.region) return;
    const spanX = this.region.spanX, spanY = this.region.spanY;
    const seg = QUALITY[this.quality].seg;
    if (this.mesh) { this.world.remove(this.mesh); this.mesh.geometry.dispose(); }
    const geo = new THREE.PlaneGeometry(spanX, spanY, seg, seg);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.world.add(this.mesh);
    this.applyPixelVisibility();
  }

  /* ---------- 载入区域 ---------- */
  setRegion(region, dem) {
    this.disposeContent();
    this.region = region;
    this.dem = dem;

    const spanX = region.spanX, spanY = region.spanY;
    this.u.uSpan.value.set(spanX, spanY);
    this.u.uTexel.value.set(1 / dem.N, 1 / dem.N);
    this.u.uMinH.value = Math.min(dem.p02, dem.max);
    // 上限必须做鲁棒封顶：Terrarium 瓦片里偶尔有孤立尖峰像元，
    // 一个尖峰就能把 max 顶到离谱的高度（杭州实测 3571m，真实最高 1787m）。
    // 上限一虚高，整幅图的 hn 全部挤到色带最低档 —— 分层设色/像素方块都会变成一片深色。
    const span98 = Math.max(150, (dem.p98 - dem.p02) * 0.45);
    const softTop = Math.min(
      dem.p98 + Math.max(0, dem.max - dem.p98) * 0.55,
      dem.p98 + span98
    );
    this.u.uMaxH.value = Math.max(softTop, this.u.uMinH.value + 50);
    this.u.uShadowLen.value = THREE.MathUtils.clamp((this.u.uMaxH.value / 1000) * 8 + 10, 12, 110);

    // 雪线按绝对海拔推算：3800m 以上才起雪，低海拔省份自然没有「盐粒」
    const loH = this.u.uMinH.value, hiH = this.u.uMaxH.value;
    this._autoSnow = THREE.MathUtils.clamp((3800 - loH) / Math.max(1, hiH - loH), 0, 1);
    if (this.params.snowAuto) this.params.snow = this._autoSnow;

    // 高程纹理
    const tex = new THREE.DataTexture(dem.data, dem.N, dem.N, THREE.RedFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.u.uHeight.value = tex;
    this.heightTex = tex;

    // 遮罩 + 投影
    const maskCv = buildMaskCanvas(region, 2048);
    this.maskCv = maskCv;                 // 方块生成时要用它做 O(1) 的「在区域内」判定
    this._maskData = null;
    const maskTex = new THREE.CanvasTexture(maskCv);
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.wrapS = maskTex.wrapT = THREE.ClampToEdgeWrapping;
    this.u.uMask.value = maskTex;
    this.maskTex = maskTex;

    // 地形网格
    this.rebuildMesh();

    // 地表投影
    const shCv = buildShadowCanvas(maskCv, 720, 13);
    const shTex = new THREE.CanvasTexture(shCv);
    this.shadowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(spanX * 1.06, spanY * 1.06).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: shTex, transparent: true, opacity: 0.42, depthWrite: false, color: 0x14161a })
    );
    this.shadowPlane.renderOrder = 1;
    this.shadowPlane.frustumCulled = false;
    this.world.add(this.shadowPlane);

    // ⚠ 这里原本有一块 3.2 倍跨度的「海面」平面（#2a4a54→#3f7a90 的渐变 shader）。
    // 它在斜视角下会铺满画面大部分，看着就是"一块不明所以的蓝色"，
    // 而且盖住了「页面背景」设置。已彻底移除 —— 地图以外保持干净的页面底色。
    this.sea = null;

    // 行政界线
    this.borderGroup = new THREE.Group();
    this.world.add(this.borderGroup);
    this.buildBorders();

    // 远岛 / 飞地（无 DEM，只画边界）
    this.buildIslets();

    // 侧壁 + 外轮廓
    this.buildWall();
    this.applyParams();
    // 换了区域，方块几何必须按新的 DEM / 跨度重建
    if (this.pixelMode) this.rebuildVoxels();
    this.frameCamera(true);
    this.startGrowth();
  }

  /* ---------- 高程采样 ---------- */
  heightAt(lon, lat) {
    const b = this.region.bbox, dem = this.dem, N = dem.N;
    const fx = (lon - b.west) / (b.east - b.west) * (N - 1);
    const fy = (lat - b.south) / (b.north - b.south) * (N - 1);
    const x = Math.min(N - 2, Math.max(0, Math.floor(fx)));
    const y = Math.min(N - 2, Math.max(0, Math.floor(fy)));
    const tx = Math.min(1, Math.max(0, fx - x)), ty = Math.min(1, Math.max(0, fy - y));
    const i = y * N + x, d = dem.data;
    const v = (d[i] * (1 - tx) + d[i + 1] * tx) * (1 - ty) + (d[i + N] * (1 - tx) + d[i + N + 1] * tx) * ty;
    return isFinite(v) ? v : 0;
  }
  lonLatToWorld(lon, lat) {
    const b = this.region.bbox;
    return {
      x: (lon - (b.west + b.east) / 2) * this.region.world.kmLon,
      z: ((b.south + b.north) / 2 - lat) * this.region.world.kmLat
    };
  }
  worldToLonLat(x, z) {
    const b = this.region.bbox;
    return {
      lon: x / this.region.world.kmLon + (b.west + b.east) / 2,
      lat: (b.south + b.north) / 2 - z / this.region.world.kmLat
    };
  }
  /** 世界坐标处地表高度（km） */
  surfaceY(x, z) {
    const ll = this.worldToLonLat(x, z);
    return this.quantHeight(ll.lon, ll.lat) * this.u.uHeightScale.value;
  }
  /** 顶点着色器里的生长系数：由中心向外的波，逐点延迟 */
  growthAt(lon, lat) {
    if (this.growth >= 1) return 1;
    const b = this.region.bbox;
    const u = (lon - b.west) / (b.east - b.west);
    const v = (lat - b.south) / (b.north - b.south);
    const delay = Math.hypot(u - 0.5, v - 0.5) * 0.95;
    let g = (this.growth * 1.55 - delay) / 0.75;
    g = Math.min(1, Math.max(0, g));
    return g * g * (3 - 2 * g);
  }
  /** 实际画在屏幕上的地表高度（km）—— 标注必须用这个，否则生长期文字会浮在半空 */
  surfaceYVisual(lon, lat) {
    return this.quantHeight(lon, lat) * this.u.uHeightScale.value * this.growthAt(lon, lat);
  }
  /** 像素方块风格下地表是台阶：高度必须先对齐到台阶顶面，否则标注会悬空 */
  quantHeight(lon, lat) {
    const h = this.heightAt(lon, lat);
    if (!this.pixelMode || !this.voxStepM) return h;
    const hl = Math.max(0, h);
    const lv = Math.min(this.voxLevels, Math.max(0, Math.round((hl - this.voxLoH) / this.voxStepM)));
    return this.voxLoH + lv * this.voxStepM;
  }

  /* ---------- 像素方块 ---------- */
  /**
   * 区域内外判定（快速版）：把遮罩画布读成位图，O(1) 查表。
   * inRegion() 是逐顶点射线法，单个点要扫上万顶点；方块生成要判十几万次，
   * 用它会直接把主线程卡死（表现为截图超时 / 页面假死）。
   */
  maskSampler() {
    const cv = this.maskCv, b = this.region && this.region.bbox;
    if (!cv || !b) return (lon, lat) => this.inRegion(lon, lat);
    if (!this._maskData) {
      const g = cv.getContext('2d', { willReadFrequently: true });
      const d = g.getImageData(0, 0, cv.width, cv.height).data;
      const out = new Uint8Array(cv.width * cv.height);
      for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j];
      this._maskData = out;
      this._maskW = cv.width;
    }
    const md = this._maskData, N = this._maskW;
    const dLon = b.east - b.west, dLat = b.north - b.south;
    return (lon, lat) => {
      const x = Math.floor((lon - b.west) / dLon * N);
      const y = Math.floor((b.north - lat) / dLat * N);
      if (x < 0 || y < 0 || x >= N || y >= N) return false;
      return md[y * N + x] > 127;
    };
  }
  rebuildVoxels() {
    if (this.voxMesh) {
      this.world.remove(this.voxMesh);
      this.voxMesh.geometry.dispose();
      this.voxMesh = null;
    }
    if (!this.pixelMode || !this.region) return;
    if (!this.voxMat) this.voxMat = createVoxelMaterial(this);
    this.voxMat.uniforms.uGrowth.value = this.growth;
    // 方块边长由滑块给的「格数」决定：格数越多块越小、细节越细，顶点数按平方涨
    const cols = Math.round(this.params.voxCols || 104);
    const g = buildVoxelGeometry(this, { cols, levels: this.voxLevels });
    if (!g) return;
    this.voxStepM = g.userData.stepM;
    this.voxLoH = g.userData.loH;
    this.voxMesh = new THREE.Mesh(g, this.voxMat);
    this.voxMesh.frustumCulled = false;
    this.voxMesh.renderOrder = 0;
    this.world.add(this.voxMesh);
    this.applyPixelVisibility();
  }
  /** 像素风格下高度场网格/侧壁/界线会与方块打架，全部让位 */
  applyPixelVisibility() {
    const on = !!this.pixelMode;
    const show = (o, v) => { if (o) o.visible = v; };
    show(this.mesh, !on);
    show(this.wall, !on);
    show(this.outlineGroup, !on);
    show(this.borderGroup, !on);
    // 远岛在像素模式下也留着：那里本来就没有方块（不在遮罩内），
    // 关掉的话三沙会整个消失。
    show(this.isletGroup, this.showIslets !== false);
    // 地图以外不再铺任何东西：那块 3.2 倍跨度的海面平面已移除，
    // 背景只由「页面背景」（CSS）和「背景底图」（遥感影像，可选）负责。
    show(this.shadowPlane, !on && !!this.params.shadowPlane);
    show(this.voxMesh, on);
  }

  insideMask(lon, lat) {
    const b = this.region.bbox;
    if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return false;
    return true;
  }

  /* ---------- 行政界线 ---------- */
  /**
   * 界线/轮廓在画面上的高度：
   * - 落在主体 bbox 之内 → 贴地表（Negative 高程是海底，压回 0，否则线会沉到地块下面消失）
   * - 落在 bbox 之外（三沙这类无 DEM 的飞地）→ 统一抬到 y≈0 的「纸面」上
   */
  lineY(lon, lat) {
    const b = this.region.bbox;
    if (lon < b.west || lon > b.east || lat < b.south || lat > b.north) return 0.06;
    const h = this.heightAt(lon, lat);
    return Math.max(0, h) * this.u.uHeightScale.value + 0.05;
  }

  buildBorders() {
    if (!this.borderGroup) return;
    this.borderGroup.clear();
    const region = this.region;
    if (!region.borders || !region.borders.length) return;
    const pts = [];
    for (const ring of region.borders) {
      for (let i = 0; i < ring.length - 1; i++) {
        for (const p of [ring[i], ring[i + 1]]) {
          const w = this.lonLatToWorld(p[0], p[1]);
          pts.push(w.x, this.lineY(p[0], p[1]), w.z);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.borderMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false });
    this.borderLines = new THREE.LineSegments(g, this.borderMat);
    this.borderLines.renderOrder = 3;
    this.borderGroup.add(this.borderLines);
  }

  /* ---------- 远岛 / 飞地（无 DEM，只有边界） ---------- */
  /**
   * 三沙岛礁、沿海离岛这类面：面积远小于一个 DEM 格子，取不出地形，
   * 但它们是行政区的一部分 —— 必须画出来。
   * 做法：贴地填一层薄色块 + 闭合轮廓线，全部合并成 2 个 draw call。
   * 它们不参与取景，所以不会把本岛挤成一个小点（需要看全时用「取景含离岛」）。
   */
  buildIslets() {
    if (this.isletGroup) {
      this.world.remove(this.isletGroup);
      this.isletGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      this.isletGroup = null;
    }
    const region = this.region;
    this.isletGroup = new THREE.Group();
    this.world.add(this.isletGroup);

    const far = region && region.farRings;
    this.isletCount = far ? far.length : 0;
    if (!far || !far.length) return;

    const Y = 0.02;                 // 贴纸面（背景底图之上、地块之下）
    const tris = [];                // 三角化后的填充
    const lp = [];                  // 轮廓线段
    const v2 = THREE.Vector2;

    for (const item of far) {
      const outer = item.outer;
      const n = outer.length;
      if (n < 3) continue;
      const wp = outer.map((p) => this.lonLatToWorld(p[0], p[1]));

      // 轮廓（闭合）
      for (let i = 0; i < n; i++) {
        const a = wp[i], b = wp[(i + 1) % n];
        lp.push(a.x, Y + 0.01, a.z, b.x, Y + 0.01, b.z);
      }

      // 填充面：ShapeUtils 直接给索引三元组
      const contour = wp.map((p) => new v2(p.x, p.z));
      const holes = (item.holes || []).map((h) => h.map((p) => {
        const w = this.lonLatToWorld(p[0], p[1]);
        return new v2(w.x, w.z);
      }));
      let faces = [];
      try { faces = THREE.ShapeUtils.triangulateShape(contour, holes); } catch (e) { faces = []; }
      if (faces.length) {
        const all = contour.concat(...holes);
        for (const f of faces) {
          for (const k of f) {
            const p = all[k];
            tris.push(p.x, Y, p.y);
          }
        }
      }
    }

    if (tris.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
      this.isletFillMat = new THREE.MeshBasicMaterial({
        color: 0xa8c49a, transparent: false,
        depthWrite: false, side: THREE.DoubleSide
      });
      const m = new THREE.Mesh(g, this.isletFillMat);
      m.renderOrder = 2;
      m.frustumCulled = false;
      this.isletGroup.add(m);
    }
    if (lp.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      this.isletLineMat = new THREE.LineBasicMaterial({
        color: 0x20242a, transparent: true, opacity: 0.55, depthWrite: false
      });
      const l = new THREE.LineSegments(g, this.isletLineMat);
      l.renderOrder = 4;
      l.frustumCulled = false;
      this.isletGroup.add(l);
    }
    this.applyIsletStyle();
  }

  /** 远岛配色跟随风格：相当于「零高程地块」的顶面 */
  applyIsletStyle() {
    if (this.isletFillMat && this.palette && this._rampCanvas) {
      // 用比地表略高一点的色阶：远岛只有几个像素，「低地色」会被轮廓线吃掉
      const c = this.sampleRamp(0.16);
      const dark = !!(this.style && this.style.dark);
      this.isletFillMat.color.copy(c).lerp(new THREE.Color(dark ? '#2a3230' : '#ffffff'), dark ? 0.35 : 0.12);
    }
    if (this.isletLineMat) {
      const dark = !!(this.style && this.style.dark);
      this.isletLineMat.color.set(dark ? 0xdfe6ea : 0x20242a);
      this.isletLineMat.opacity = dark ? 0.5 : 0.55;
    }
  }

  /** 显示/隐藏远岛（图层开关） */
  setShowIslets(v) {
    this.showIslets = !!v;
    if (this.isletGroup) this.isletGroup.visible = this.showIslets;
  }

  /* ---------- 侧壁与轮廓 ---------- */
  buildWall() {
    if (this.wall) { this.world.remove(this.wall); this.wall.geometry.dispose(); this.wall.material.dispose(); }
    if (this.outlineGroup) {
      this.world.remove(this.outlineGroup);
      this.outlineGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    const region = this.region;
    const hs = this.u.uHeightScale.value;
    const depth = this.params.depth;
    const pos = [], aT = [], nor = [];
    // 轮廓线段先攒起来，出循环后合并成**一个** LineSegments。
    // 以前每个环建一个 LineLoop（浙江有 156 个环）→ 每帧 156 次 draw call，
    // 与像素方块风格的 5 次相比，光这一项就是几十毫秒的 CPU 开销。
    const olp = [];

    for (const ring of region.rings) {
      const n = ring.length;
      if (n < 3) continue;
      const P = ring.map((p) => {
        const w = this.lonLatToWorld(p[0], p[1]);
        return { x: w.x, z: w.z, h: this.heightAt(p[0], p[1]) * hs };
      });
      // 顶面高度做一次平滑，避免出现锯齿状“城墙”
      const HS = P.map((p) => p.h);
      const sm = HS.map((_, i) => {
        let a = 0, c = 0;
        for (let k = -3; k <= 3; k++) { a += HS[(i + k + n) % n]; c++; }
        return a / c;
      });
      for (let i = 0; i < n; i++) P[i].h = sm[i];

      // 侧壁厚度按该环自身尺寸收缩，避免小岛出现细长“纸片”
      let cx0 = 0, cz0 = 0;
      for (const p of P) { cx0 += p.x; cz0 += p.z; }
      cx0 /= n; cz0 /= n;
      let diag = 0;
      for (const p of P) diag = Math.max(diag, Math.hypot(p.x - cx0, p.z - cz0));
      const ringDepth = depth * THREE.MathUtils.clamp(diag / 130, 0.05, 1);

      // 逐点外法线（窗口取大一些，否则锯齿边界会让侧壁出现竖向条纹）
      const wi = (k) => ((k % n) + n) % n;
      const N = P.map((p, i) => {
        const a = P[wi(i - 6)], b = P[wi(i + 6)];
        const tx = b.x - a.x, tz = b.z - a.z;
        const l = Math.hypot(tx, tz) || 1;
        return [tz / l, 0, -tx / l];
      });

      const bot = -ringDepth;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a = P[i], b = P[j], na = N[i], nb = N[j];
        // 两个三角形：aTop, aBot, bBot / aTop, bBot, bTop
        pos.push(a.x, a.h - 0.06, a.z, a.x, bot, a.z, b.x, bot, b.z);
        nor.push(...na, ...na, ...nb);
        aT.push(0, 1, 1);
        pos.push(a.x, a.h - 0.06, a.z, b.x, bot, b.z, b.x, b.h - 0.06, b.z);
        nor.push(...na, ...nb, ...nb);
        aT.push(0, 1, 0);
      }
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n];
        olp.push(a.x, a.h + 0.03, a.z, b.x, b.h + 0.03, b.z);
      }
    }

    this.outlineGroup = new THREE.Group();
    if (olp.length) {
      const og = new THREE.BufferGeometry();
      og.setAttribute('position', new THREE.Float32BufferAttribute(olp, 3));
      this.outlineMat = new THREE.LineBasicMaterial({
        color: 0x20242a, transparent: true, opacity: 0.9, depthWrite: false
      });
      const ol = new THREE.LineSegments(og, this.outlineMat);
      ol.renderOrder = 4;
      this.outlineGroup.add(ol);          // 1 次 draw call 画完全部岛屿轮廓
    }
    this.world.add(this.outlineGroup);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('aT', new THREE.Float32BufferAttribute(aT, 1));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('aH', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));

    this.wallMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color('#e8e2d2') },
        uBot: { value: new THREE.Color('#b9b2a2') },
        uSunDir: { value: this.u.uSunDir.value },
        uRim: { value: 1 },
        uFade: { value: 1 }
      },
      vertexShader: WALL_VERT, fragmentShader: WALL_FRAG,
      transparent: true, depthWrite: true, side: THREE.DoubleSide
    });
    this.wall = new THREE.Mesh(g, this.wallMat);
    this.wall.renderOrder = 1;
    this.wall.frustumCulled = false;
    this.world.add(this.wall);
    this.applyWallColor();
  }

  applyWallColor() {
    if (!this.wallMat || !this.palette) return;
    const t = (x) => this.sampleRamp(x);
    const dark = !!(this.style && this.style.dark);
    // 顶面贴近地表色，底部明显压暗，形成「厚切地块」的实体感
    const top = t(0.06).clone().lerp(new THREE.Color('#ffffff'), dark ? 0.04 : 0.12);
    const bot = t(0.02).clone().multiplyScalar(dark ? 0.34 : 0.42);
    this.wallMat.uniforms.uTop.value.copy(top);
    this.wallMat.uniforms.uBot.value.copy(bot);
  }

  sampleRamp(t) {
    if (!this._rampCtx) {
      this._rampCtx = this._rampCanvas.getContext('2d', { willReadFrequently: true });
    }
    const x = Math.round(Math.min(1, Math.max(0, t)) * (this._rampCanvas.width - 1));
    const d = this._rampCtx.getImageData(x, 0, 1, 1).data;
    return new THREE.Color().setRGB(d[0] / 255, d[1] / 255, d[2] / 255, THREE.SRGBColorSpace);
  }

  /* ---------- 视角 ---------- */
  /** 取景用的采样点：边界点 + 内部网格点，凹形区域也不会把包围盒撑大 */
  _framePoints(includeFar) {
    const hs = this.u.uHeightScale.value;
    const depth = this.params.depth;
    const out = [];
    const rings = this.region.rings.filter(r => r.length > 6).sort((a, b) => b.length - a.length);
    for (const r of rings.slice(0, 10)) {
      const step = Math.max(1, Math.floor(r.length / 90));
      const top = [];
      for (let i = 0; i < r.length; i += step) {
        const w = this.lonLatToWorld(r[i][0], r[i][1]);
        top.push(new THREE.Vector3(w.x, this.heightAt(r[i][0], r[i][1]) * hs, w.z));
      }
      out.push(...top);
      // 侧壁（裙边）必须一起参与取景：块体是有厚度的，只按顶面算包围盒，
      // 前缘竖墙会掉出画外 —— 窄视口下「南半省被裁掉一截」就是这么来的。
      // 底深的算法与 buildWall 必须一致，否则取景和实物对不上。
      let cx0 = 0, cz0 = 0;
      for (const p of top) { cx0 += p.x; cz0 += p.z; }
      cx0 /= top.length; cz0 /= top.length;
      let diag = 0;
      for (const p of top) diag = Math.max(diag, Math.hypot(p.x - cx0, p.z - cz0));
      const bot = -depth * THREE.MathUtils.clamp(diag / 130, 0.05, 1);
      for (const p of top) out.push(new THREE.Vector3(p.x, bot, p.z));
    }
    // 画框：框板比四至大一圈，取景必须把它一起算进去，
    // 否则近侧的框带会被视口裁掉，看着像"页面上铺了张桌子"
    const f = this.frameRef;
    if (f && f.enabled && f._g && f._g.outer) {
      const o = f._g.outer;
      const y = f.mesh ? f.mesh.position.y : -this.params.depth;
      const cx = (o.west + o.east) / 2, cy2 = (o.south + o.north) / 2;
      const pts2 = [
        [o.west, o.north], [o.east, o.north], [o.west, o.south], [o.east, o.south],
        [cx, o.north], [cx, o.south], [o.west, cy2], [o.east, cy2]
      ];
      for (const [lon, lat] of pts2) {
        const w = this.lonLatToWorld(lon, lat);
        out.push(new THREE.Vector3(w.x, y, w.z));
      }
    }
    // 主体多边形内部补一些点，防止极端凹形只按外轮廓取景
    const main = this.region.polys && this.region.polys[0];
    if (main) {
      const bb = main.bbox;
      for (let j = 1; j < 6; j++) {
        for (let i = 1; i < 6; i++) {
          const lon = bb.w + (bb.e - bb.w) * (i / 6);
          const lat = bb.s + (bb.n - bb.s) * (j / 6);
          if (!this._inPoly(main, lon, lat)) continue;
          const w = this.lonLatToWorld(lon, lat);
          out.push(new THREE.Vector3(w.x, this.heightAt(lon, lat) * hs, w.z));
        }
      }
    }
    // 「取景含离岛」：把远岛也算进包围盒（每个岛只取四个极值点，省得几百个点拖慢迭代）
    if (includeFar && this.region.farRings) {
      for (const it of this.region.farRings) {
        const o = it.outer;
        let w = 1e9, e = -1e9, s = 1e9, n = -1e9;
        for (const p of o) {
          if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0];
          if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1];
        }
        for (const [lon, lat] of [[w, s], [e, s], [w, n], [e, n]]) {
          const q = this.lonLatToWorld(lon, lat);
          out.push(new THREE.Vector3(q.x, 0, q.z));
        }
      }
    }
    return out;
  }
  _inPoly(poly, lon, lat) {
    const r = poly.outer;
    let inside = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  /** 经纬度是否落在区域内（含挖洞判断） */
  inRegion(lon, lat) {
    if (!this.region) return false;
    const test = (p) => {
      if (!this._inPoly(p, lon, lat)) return false;
      for (const h of (p.holes || [])) {
        if (this._inPoly({ outer: h }, lon, lat)) return false;
      }
      return true;
    };
    for (const p of this.region.polys) if (test(p)) return true;
    // 远岛也是区域的一部分（三沙、沿海离岛）
    for (const p of (this.region.farPolys || [])) if (test(p)) return true;
    return false;
  }

  /**
   * 「含离岛」全图取景：正俯视。
   * 不能沿用斜俯视那套迭代 —— 跨度 1800km 时，按 60° 俯角相机 z 会落到
   * 最南岛礁的北侧，南端直接被甩到相机背后；而且近大远小会把礁盘挤成一团。
   * 正俯视没有这两个问题，也最接近「全图」该有的样子。
   */
  frameAll(pts) {
    const cam = this.camera, c = this.controls;
    let mnx = 9e9, mxx = -9e9, mnz = 9e9, mxz = -9e9;
    for (const p of pts) {
      if (p.x < mnx) mnx = p.x; if (p.x > mxx) mxx = p.x;
      if (p.z < mnz) mnz = p.z; if (p.z > mxz) mxz = p.z;
    }
    const cx = (mnx + mxx) / 2, cz = (mnz + mxz) / 2;
    const w = Math.max(1, mxx - mnx), h = Math.max(1, mxz - mnz);

    const W = this.el.clientWidth || 1280, H = this.el.clientHeight || 800;
    const pel = document.getElementById('panel');
    const panelW = (pel && !pel.classList.contains('hide') && W > 900)
      ? pel.getBoundingClientRect().width + 24 : 12;
    const limL = -0.975;
    const limR = Math.max(limL + 0.5, 1 - 2 * panelW / W) * 0.99;
    const limT = 1 - 2 * 56 / H;
    const limB = -1 + 2 * 42 / H;
    const wantCx = (limL + limR) / 2, wantCy = (limB + limT) / 2;
    const availW = Math.max(0.3, limR - limL), availH = Math.max(0.3, limT - limB);

    const th = Math.tan(cam.fov * Math.PI / 360);      // 半视高的正切
    const aspect = cam.aspect || (W / H);
    // NDC 高度 = h / (d·tanθ)，宽度 = w / (d·tanθ·aspect)
    const d = Math.max(
      h / (availH * 0.96 * th),
      w / (availW * 0.96 * th * aspect)
    );

    // 让内容中心正好落在「可用区」中心（面板占掉右侧，不能按画面正中摆）
    const camX = cx - wantCx * d * th * aspect;
    const camZ = cz + wantCy * d * th;

    c.target.set(camX, 0, camZ);
    cam.position.set(camX, d, camZ + d * 0.004);       // 略偏一点，避免 up 与视线平行
    cam.near = Math.max(0.5, d * 0.002);
    cam.far = d * 6;
    cam.updateProjectionMatrix();
    c.minDistance = d * 0.06;
    c.maxDistance = d * 3.2;
    cam.lookAt(c.target);
    c.update();
    this._camDist = d;
    this._camDir = new THREE.Vector3(0, 1, 0);
    this._frameM = { cx: wantCx, cy: wantCy, w: availW, h: availH };
    this._frameTy = 0;
    // 全图视图里 target 要落到南海中部，远超主图范围，钳制范围一起放宽
    const reach = Math.max(Math.abs(camX), Math.abs(camZ)) + Math.max(w, h);
    this._clampX = this._clampZ = reach;
  }

  frameCamera(includeFar) {
    if (!this.region) return;
    const pts = this._framePoints(includeFar);
    if (!pts.length) return;
    if (includeFar) return this.frameAll(pts);
    const cam = this.camera, c = this.controls;
    const span = Math.max(this.region.spanX, this.region.spanY);
    const dir = new THREE.Vector3(-0.45, 0.50, 0.66).normalize();

    const view = dir.clone().negate();
    const rightV = new THREE.Vector3().crossVectors(view, new THREE.Vector3(0, 1, 0)).normalize();
    const upCam = new THREE.Vector3().crossVectors(rightV, view).normalize();

    // 可用区域：扣掉右侧面板、顶栏、底栏
    const W = this.el.clientWidth || 1280, H = this.el.clientHeight || 800;
    const pel = document.getElementById('panel');
    const panelW = (pel && !pel.classList.contains('hide') && W > 900) ? pel.getBoundingClientRect().width + 24 : 12;
    const limL = -0.975;
    const limR = Math.max(limL + 0.5, 1 - 2 * panelW / W) * 0.99;
    const limT = 1 - 2 * 56 / H;
    const limB = -1 + 2 * 42 / H;
    const wantCx = (limL + limR) / 2, wantCy = (limB + limT) / 2;
    const availW = Math.max(0.4, limR - limL), availH = Math.max(0.4, limT - limB);

    // 初始中心：采样点的中位数（比质心更抗离群点）
    const xs = pts.map(p => p.x).sort((a, b) => a - b);
    const zs = pts.map(p => p.z).sort((a, b) => a - b);
    const target = new THREE.Vector3(xs[xs.length >> 1], (this.u.uMaxH.value || 1000) * this.u.uHeightScale.value * 0.3, zs[zs.length >> 1]);

    const place = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
    };
    const measure = () => {
      let mnx = 9, mxx = -9, mny = 9, mxy = -9;
      const v = new THREE.Vector3(), cs = new THREE.Vector3();
      cam.updateMatrixWorld();
      for (const p of pts) {
        // 落在相机背后（或近裁面以内）的点，project() 得到的是翻转后的假值，
        // 会把包围盒撑到一个跟画面无关的大小 —— 「含离岛」拉到 1800km 时，
        // 最南的岛礁正好跑到相机后面，取景于是缩成画面中央一小团。
        cs.copy(p).applyMatrix4(cam.matrixWorldInverse);
        if (cs.z > -cam.near * 4) continue;
        v.copy(p).project(cam);
        if (!isFinite(v.x) || !isFinite(v.y)) continue;
        if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x;
        if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y;
      }
      if (mnx > mxx) return { cx: 0, cy: 0, w: 1e-3, h: 1e-3 };
      return { cx: (mnx + mxx) / 2, cy: (mny + mxy) / 2, w: mxx - mnx, h: mxy - mny };
    };

    let d = span * 1.7;
    const vScreen = () => {
      const vh = 2 * d * Math.tan(cam.fov * Math.PI / 360);
      return { vh, vw: vh * cam.aspect };
    };
    // ① 缩放到刚好填满可用区
    const fitScale = () => {
      for (let it = 0; it < 9; it++) {
        place(d);
        const m = measure();
        const s = Math.max(m.w / availW, m.h / availH) / 0.94;
        if (Math.abs(s - 1) < 0.012) break;
        d = THREE.MathUtils.clamp(d * s, span * 0.35, span * 9);
      }
    };
    // ② 纯平移居中。地形是有厚度的三维体，各处深度不同，
    //    按「距离 d 线性换算」会系统性欠校正，所以用探针实测平移增益后反解。
    const recenter = () => {
      for (let it = 0; it < 5; it++) {
        const m = measure();
        const ex = m.cx - wantCx, ey = m.cy - wantCy;
        if (Math.abs(ex) < 0.004 && Math.abs(ey) < 0.004) break;
        const { vh, vw } = vScreen();
        const save = target.clone();
        const ax = vw * 0.06, ay = vh * 0.06;
        target.copy(save).addScaledVector(rightV, ax); place(d);
        const gx = (measure().cx - m.cx) / ax;
        target.copy(save).addScaledVector(upCam, ay); place(d);
        const gy = (measure().cy - m.cy) / ay;
        target.copy(save);
        target.addScaledVector(rightV, Math.abs(gx) > 1e-6 ? -ex / gx : -ex * vw * 0.5);
        target.addScaledVector(upCam, Math.abs(gy) > 1e-6 ? -ey / gy : -ey * vh * 0.5);
        place(d);
      }
    };
    // 交替两轮：居中会改变各点的景深，进而改变包围盒，二者必须收敛到一起
    for (let pass = 0; pass < 3; pass++) { fitScale(); recenter(); }
    place(d);
    this._frameM = measure();       // 调试用：当前取景的 NDC 包围盒
    // 记下取景确定的轨道中心高度，update() 的上下限要用它（见那边的注释）
    this._frameTy = target.y;
    c.target.copy(target);
    cam.position.copy(target).addScaledVector(dir, d);
    c.minDistance = span * 0.14;
    c.maxDistance = span * 3.4;
    cam.near = Math.max(0.15, span * 0.0016);
    cam.far = span * 24;
    cam.updateProjectionMatrix();
    cam.lookAt(target);
    c.update();
    this._camDist = d;
    this._camDir = dir;
    this._clampX = this.region.spanX * 0.62;
    this._clampZ = this.region.spanY * 0.62;
  }

  setViewPreset(kind) {
    if (!this.region) return;
    const span = Math.max(this.region.spanX, this.region.spanY);
    const t = this.controls.target;
    const set = (x, y, z) => { this.camera.position.set(t.x + x, t.y + y, t.z + z); this.controls.update(); };
    if (kind === 'top') set(0.001, span * 1.15, 0.001);
    else if (kind === 'low') set(-span * 0.42, span * 0.20, span * 0.78);
    else if (kind === 'south') set(0, span * 0.28, span * 1.02);
    else set(-span * 0.47, span * 0.50, span * 0.65);
  }

  /* ---------- 参数 ---------- */
  setParam(k, v) {
    this.params[k] = v;
    if (k === 'exag') this._exagTouched = true;   // 用户手动调过就不再自动取值
    this.applyParams(k);
    // 方块几何把高度/基座烘进了顶点，改夸张或厚度必须重建（其余参数不影响）
    if (this.pixelMode && (k === 'exag' || k === 'depth' || k === 'voxCols')) this._voxDirty = true;
    // 垂直夸张：水面高度靠 uniform 跟随，不必重建
    if (k === 'exag' && this.waterRef) this.waterRef.syncExag();
  }

  applyParams(changed) {
    const p = this.params, u = this.u;
    const az = p.sunAz * Math.PI / 180, el = p.sunEl * Math.PI / 180;
    u.uSunDir.value.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
    u.uHeightScale.value = p.exag / 1000;
    // 低画质档直接关掉自阴影步进（满屏 20 次纹理采样是每帧最贵的开销）
    u.uShadowOn.value = (p.shadowOn && QUALITY[this.quality].shadow) ? 1 : 0;
    u.uShadowStr.value = p.shadow;
    u.uAOAmt.value = p.ao;
    u.uContourOn.value = p.contourOn ? 1 : 0;
    u.uContourStep.value = p.contourStep;
    u.uContourW.value = p.contourW;
    u.uLineDensity.value = p.lineDensity;
    u.uPaperAmt.value = p.paper;
    u.uFog.value = p.fog;
    u.uGlow.value = p.glow;
    u.uBands.value = p.bands;
    u.uSnowLine.value = p.snow;
    u.uRim.value = p.rim;

    if (this.borderLines) {
      this.borderLines.visible = !!p.border;
      if (this.style) {
        this.borderMat.color.set(this.style.dark ? '#ffffff' : '#25303a');
        this.borderMat.opacity = this.style.dark ? 0.18 : 0.28;
      }
    }
    if (this.outlineGroup) {
      this.outlineGroup.visible = !!p.outline;
      if (this.style) {
        const oc = this.style.dark ? this.style.outlineDark || '#d8e6ee' : this.style.outlineLight || '#20242a';
        this.outlineGroup.children.forEach(l => l.material.color.set(oc));
      }
    }
    if (this.shadowPlane) {
      this.shadowPlane.visible = !!p.shadowPlane;
      const off = Math.min(6, Math.max(0, p.depth) * 0.12);
      const dx = -u.uSunDir.value.x * off, dz = -u.uSunDir.value.z * off;
      this.shadowPlane.position.set(dx, -0.35 - p.depth * 0.02, dz);
      this.shadowPlane.material.opacity = this.style && (this.style.key === 'ink' || this.style.key === 'magma') ? 0.28 : 0.13;
    }
    // 高度比例、深度变化需要重建几何
    if (changed === 'exag' || changed === 'depth') {
      if (this.region) { this.buildWall(); this.buildBorders(); }
    }
    // 垂直夸张变化：水面高度靠 uniform 跟随；云团基准高度要重算
    if (changed === 'exag') {
      if (this.waterRef) this.waterRef.syncExag();
      if (this.cloudRef) this.cloudRef.reflow();
    }
    // 轮廓线随高度变化
    if (changed === 'exag' && this.region) { /* 已在 buildWall 内重建 */ }
  }

  /* ---------- 风格 ---------- */
  setStyle(style, palette, applyDefaults = true) {
    // 换配色也必须重建方块：顶点色在生成时就烘进了 aColor 属性，
    // 不重建的话「配色」在像素风格里完全无效（这正是上一版的问题）。
    const palChanged = this.palette !== palette;
    this.style = style;
    this.palette = palette;
    const u = this.u;
    u.uStyle.value = style.index;
    if (this.rampTex) this.rampTex.dispose();
    const cv = PALETTE_RAMP(palette);
    this._rampCanvas = cv;
    this._rampCtx = null;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    this.rampTex = tex;
    u.uRamp.value = tex;

    const col = (hex, fallback) => new THREE.Color(hex || fallback);
    u.uInk.value = col(palette.ink, style.dark ? '#05060a' : '#191b1f');
    u.uPaper.value = col(palette.paper, style.dark ? '#232830' : '#f4f2ec');
    u.uAccent.value = col(palette.accent, style.accent || '#ffffff');
    u.uFogColor.value = col(style.fogColor, style.dark ? '#141821' : '#dfe3dd');

    if (this.wallMat) {
      const wallTop = style.wallTop || (style.dark ? '#1e242c' : '#f3f0e8');
      const wallBot = style.wallBot || (style.dark ? '#080a0e' : '#c6c0b2');
      this.wallMat.uniforms.uTop.value.set(wallTop);
      this.wallMat.uniforms.uBot.value.set(wallBot);
    }
    // 海面：纸本风格压成纸灰，深色风格压深，其余给一点水色 —— 与 sea 平面同源
    const paperish = ['sketch', 'line', 'parchment', 'paper'].includes(style.key);
    const seaHex = style.sea || (paperish
      ? (style.dark ? '#2b3036' : '#e3e5dd')
      : (style.dark ? '#16303c' : '#3f7a90'));
    u.uSeaCol.value.set(seaHex);

    // 垂直夸张按跨度自动取值：小区域 6× 会像刀山，大区域太扁又看不出山
    if (!this._exagTouched && this.region) {
      const sp = Math.max(this.region.spanX, this.region.spanY);
      this.params.exag = Math.round(THREE.MathUtils.clamp(5.5 * Math.sqrt(sp / 470), 2.2, 9) * 10) / 10;
    }

    // 默认参数覆盖（仅换风格时生效，换配色不重置用户调好的光照）
    if (applyDefaults) {
      const base = { sea: 0, ...style.params };
      Object.assign(this.params, base);
      // 换风格时雪线回到自动判断（3800m 以上才起雪）
      this.params.snowAuto = 1;
      if (this._autoSnow != null) this.params.snow = this._autoSnow;
    }
    this.applyParams();
    if (this.region) { this.buildWall(); this.buildBorders(); this.applyParams(); }
    this.applyWallColor();
    this.applyIsletStyle();
    this.applyTheme(style);

    // 像素方块风格：换掉整套几何（高度场网格 → 柱体方块）
    const wantPixel = style.key === 'pixel';
    const changedMode = wantPixel !== this.pixelMode;
    this.pixelMode = wantPixel;
    if (this.voxMat) {
      this.voxMat.uniforms.uFog.value = (style.params.fog ?? 0.1) * 0.8;
      this.voxMat.uniforms.uSkyAmb.value.set(style.skyAmb || (style.dark ? '#3a4a66' : '#8ea9c8'));
      this.voxMat.uniforms.uGroundAmb.value.set(style.groundAmb || (style.dark ? '#2a2620' : '#b9a684'));
    }
    if (wantPixel && (!this.voxMesh || changedMode || palChanged)) this.rebuildVoxels();
    else this.applyPixelVisibility();
  }

  applyTheme(style) {
    document.body.classList.toggle('dark-ui', !!style.dark);
    // 页面背景三态：跟风格渐变 / 素色 / 关闭（留着画布自己的透明底）
    document.body.style.background = this.bgMode === 'off'
      ? 'transparent'
      : this.bgMode === 'plain'
        ? this.bgColor
        : `linear-gradient(180deg, ${style.bg[0]} 0%, ${style.bg[1]} 100%)`;
    const grain = document.getElementById('grain');
    if (grain) grain.style.opacity = (style.params.paper || 0) * 0.5;
    const hint = document.getElementById('hint');
    if (hint) hint.classList.toggle('ink', !!style.dark);
  }

  /** 页面背景：'theme' | 'plain' | 'off' + 素色色值 */
  setPageBg(mode, color) {
    if (mode) this.bgMode = mode;
    if (color) this.bgColor = color;
    if (this.style) this.applyTheme(this.style);
  }

  /* ---------- 生长动画 ---------- */
  startGrowth() { this.growth = 0; this.growthTarget = 1; }

  /* ---------- 拾取 ---------- */
  pick(ndcX, ndcY) {
    if (!this.region) return null;
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const span = Math.max(this.region.spanX, this.region.spanY);
    let t = 0, prev = 0;
    const maxT = span * 8;
    let hit = null;
    for (let i = 0; i < 900; i++) {
      t += span * 0.006;
      if (t > maxT) break;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y < this.surfaceY(x, z)) { hit = [prev, t]; break; }
      prev = t;
    }
    if (!hit) return null;
    let a = hit[0], b = hit[1];
    for (let i = 0; i < 24; i++) {
      const m = (a + b) / 2;
      const x = o.x + d.x * m, y = o.y + d.y * m, z = o.z + d.z * m;
      if (y < this.surfaceY(x, z)) b = m; else a = m;
    }
    const t2 = (a + b) / 2;
    const x = o.x + d.x * t2, z = o.z + d.z * t2;
    const ll = this.worldToLonLat(x, z);
    const b2 = this.region.bbox;
    if (ll.lon < b2.west || ll.lon > b2.east || ll.lat < b2.south || ll.lat > b2.north) return null;
    return { x, z, y: this.surfaceY(x, z), lon: ll.lon, lat: ll.lat, h: this.heightAt(ll.lon, ll.lat) };
  }

  /* ---------- 帧 ---------- */
  update(dt) {
    const u = this.u;
    u.uTime.value += dt;
    // 排线笔距自适应用的像素尺度：取「相机到目标点」的距离，全帧同一个值。
    // 不能用逐像素景深来计算，否则远近不同处频率不同，排线相位会被撕成碎点。
    u.uPx.value = Math.max(this.camera.position.distanceTo(this.controls.target) * u.uPix.value, 1e-4);
    // 方块风格：生长进度与脏标记在这里统一处理，避免拖滑块时每帧重建
    if (this.pixelMode && this.voxMat) {
      this.voxMat.uniforms.uGrowth.value = this.growth;
      if (this._voxDirty && performance.now() - (this._voxT || 0) > 240) {
        this._voxDirty = false; this._voxT = performance.now(); this.rebuildVoxels();
      }
    }
    if (this.growth < this.growthTarget) {
      this.growth = Math.min(1, this.growth + dt / 1.25);
      const g = this.growth;
      u.uGrowth.value = g < 0.999 ? g : 1;
      if (this.wallMat) this.wallMat.uniforms.uFade.value = Math.max(0, (g - 0.72) / 0.28);
      if (this.outlineGroup) this.outlineGroup.children.forEach(l => { l.material.opacity = 0.9 * Math.max(0, (g - 0.8) / 0.2); });
      if (g >= 1 && this.wallMat) this.wallMat.transparent = false;
    } else if (this.wallMat && this.wallMat.transparent && this.wallMat.uniforms.uFade.value >= 1) {
      // 生长结束：侧壁不再需要 alpha 混合（uFade 恒为 1）。走不透明队列能省掉
      // 逐帧透明排序与混合 —— 侧壁在斜视角下铺满屏幕下方，这一层混合并不便宜。
      this.wallMat.transparent = false;
      this.wallMat.needsUpdate = true;
    }
    this.controls.update();
    // 目标点限制在区域内（沿线飞行时跳过：相机跟着飞行器走，钳制会把视角推走）
    // 范围取「当前取景范围」而不是主图 —— 含离岛的全图视图 target 要移到南海中部，
    // 死按主图钳制会把它拽回海南岛附近，整个全图取景就偏到一边去了。
    if (this.region && !this.following) {
      const tx = this._clampX || this.region.spanX * 0.62;
      const tz = this._clampZ || this.region.spanY * 0.62;
      const t = this.controls.target;
      const cx = THREE.MathUtils.clamp(t.x, -tx, tx);
      const cz = THREE.MathUtils.clamp(t.z, -tz, tz);
      if (cx !== t.x || cz !== t.z) {
        const dx = cx - t.x, dz = cz - t.z;
        t.x = cx; t.z = cz;
        this.camera.position.x += dx; this.camera.position.z += dz;
      }
      // 轨道中心的下限不能写死 0：地块有厚裙边，俯视时轮廓重心比脚面低，
      // 正确取景需要把中心压到地面以下。写死 0 的话，frameCamera 算完的下一帧
      // 就被这里推回去 —— 表现是「初次加载模型偏下、南边被裁掉一截」。
      // 下限跟着取景值走，用户手动拖动时仍然有边界。
      const yLo = Math.min(0, (this._frameTy ?? 0) - 2);
      t.y = THREE.MathUtils.clamp(t.y, yLo, this.region.spanX * 0.1);
      if (this.camera.position.y < 0.6) this.camera.position.y = 0.6;
    }
  }

  render() { this.renderer.render(this.scene, this.camera); }

  disposeContent() {
    const rm = (o) => { if (!o) return; this.world.remove(o); };
    if (this.mesh) { rm(this.mesh); this.mesh.geometry.dispose(); }
    if (this.wall) { rm(this.wall); this.wall.geometry.dispose(); this.wall.material.dispose(); }
    if (this.outlineGroup) rm(this.outlineGroup);
    if (this.borderGroup) rm(this.borderGroup);
    if (this.shadowPlane) { rm(this.shadowPlane); this.shadowPlane.geometry.dispose(); this.shadowPlane.material.dispose(); }
    if (this.heightTex) this.heightTex.dispose();
    if (this.maskTex) this.maskTex.dispose();
    this.mesh = this.wall = this.outlineGroup = this.borderGroup = this.shadowPlane = this.sea = null;
  }
}
