/* ============================================================
   画框（装裱 / 图廓）+ 框内经纬网
   ------------------------------------------------------------
   做法：以「区划四至」为内边界，向外让出「留白 pad + 框带 width」，
   做成一块贴在模型底座高度的平板（Canvas 贴图，一个 draw call）。

   8 种框体（v2 重做）：
     thin     细线框    —— 内外两道细线，最轻
     double   双线框    —— 内粗外细，书刊感
     neat     图廓框    —— 经典地图图廓：内细 + 中细 + 外粗三道线
     checker  分格带    —— 黑白相间的经纬度分格带（USGS 图廓）
     mat      裱框      —— 卡纸底 + 内双线 + 金色卡纸线
     bevel    倒角框    —— 四边斜面，有受光方向
     plate    铭牌框    —— 下侧加宽，放区域名与范围说明
     wood     木框      —— 深色暖调 + 内金线

   参数：框宽 / 留白 / 线宽 / 框带色调 / 角饰 / 经纬网间隔 / 浓度 / 标题
   经纬网只画在框带或框板上，绝不贴山体。
   ============================================================ */
import * as THREE from 'three';

const STEPS = [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10];
const MAX = 2400;                    // 框贴图长边像素（框带很窄，要够细才不糊）

function pickStep(spanDeg, want) {
  if (want && want !== 'auto') {
    const n = Number(want);
    if (n > 0) return n;
  }
  for (const s of STEPS) if (spanDeg / s <= 8) return s;
  return 10;
}

export const FRAME_STYLES = [
  { key: 'thin', label: '细线' },
  { key: 'double', label: '双线' },
  { key: 'neat', label: '图廓' },
  { key: 'checker', label: '分格' },
  { key: 'mat', label: '裱框' },
  { key: 'bevel', label: '倒角' },
  { key: 'plate', label: '铭牌' },
  { key: 'wood', label: '木框' }
];

export const FRAME_TONES = [
  { key: 'auto', label: '跟风格' },
  { key: 'paper', label: '纸白' },
  { key: 'sand', label: '米黄' },
  { key: 'slate', label: '石灰' },
  { key: 'ink', label: '墨黑' },
  { key: 'navy', label: '藏青' }
];

export const FRAME_CORNERS = [
  { key: 'none', label: '无' },
  { key: 'bracket', label: 'L 角' },
  { key: 'block', label: '方块' },
  { key: 'dot', label: '圆点' }
];

export const FRAME_GRAT_STEP = [
  { key: 'auto', label: '自动' },
  { key: '2', label: '2°' },
  { key: '1', label: '1°' },
  { key: '0.5', label: '30′' },
  { key: '0.25', label: '15′' },
  { key: '0.1', label: '6′' }
];

/* 框带色调表：bg 主色 / hi 受光 / lo 背光 / ink 线色 / 是否深色 */
const TONES = {
  auto: null,
  // ⚠ 框板必须比页面底(#f3f3ee 一带)明显更暖更深，否则"框"根本看不出来
  paper: { bg: '#eee7d8', hi: '#f9f4ea', lo: '#dbd2bd', ink: '#2b3138', band: '#3a424b', dark: false },
  sand: { bg: '#dfcfad', hi: '#f0e3c8', lo: '#c4b08a', ink: '#3a3226', band: '#4a3f2c', dark: false },
  slate: { bg: '#4d5b65', hi: '#687885', lo: '#37424a', ink: '#f1f5f7', band: '#2c363d', dark: true },
  ink: { bg: '#1a1f25', hi: '#272e36', lo: '#101418', ink: '#dde5ee', band: '#0b0e11', dark: true },
  navy: { bg: '#182535', hi: '#263a4f', lo: '#0d1621', ink: '#d9e6f4', band: '#0a1119', dark: true }
};

/** 木框专用：深棕木料，跟纸张色调完全脱钩 */
const WOOD = { bg: '#5a452e', hi: '#7d6043', lo: '#37281a', ink: '#f0e6d3', band: '#3a2c1c', dark: true };

export class Frame {
  constructor(view) {
    this.view = view;
    this.group = new THREE.Group();
    view.world.add(this.group);
    this.group.visible = false;

    this.styleKey = 'mat';
    this.width = 0.06;       // 框带宽 / 长边跨度
    this.pad = 0.022;        // 地形与内框线的留白
    this.lw = 1;             // 线宽倍数
    this.tone = 'auto';      // 框带色调
    this.corner = 'bracket'; // 角饰
    this.title = false;      // 标题铭牌
    this.step = 'auto';      // 网格间隔

    this.grat = false;
    this.gratAlpha = 0.72;
    this.enabled = false;
    this.theme = null;
    this.region = null;
    this.mesh = null;
    this.tex = null;
    this.canvas = null;
    this._g = null;
  }

  /* ---------- 构建 / 释放 ---------- */
  build(region) {
    this.dispose();
    this.region = region;
    if (!region) return;
    this._build();
  }

  _build() {
    const region = this.region;
    if (!region) return;
    const b = region.bbox;
    const kmLon = region.world.kmLon, kmLat = region.world.kmLat;
    const span = Math.max(region.spanX, region.spanY);

    const padKm = Math.max(span * this.pad, span * 0.004);
    const wKm = Math.max(span * this.width, span * 0.012);
    const outKm = padKm + wKm;

    // 铭牌框：上下各留一条「天头/地脚」放标题。
    // ⚠ 必须上下对称：平面是以自身中心对齐的，单边加宽会让贴图整体错位
    // （之前铭牌标题被推到地形底下就是这个原因）。
    const extraS = this.styleKey === 'plate' ? Math.max(span * this.width * 1.5, span * 0.04) : 0;

    const dLonO = outKm / kmLon, dLatO = (outKm + extraS) / kmLat;
    const dLonI = padKm / kmLon, dLatI = padKm / kmLat;
    const dLatS = dLatO;

    const outer = {
      west: b.west - dLonO, east: b.east + dLonO,
      south: b.south - dLatS, north: b.north + dLatO
    };
    const inner = {
      west: b.west - dLonI, east: b.east + dLonI,
      south: b.south - dLatI, north: b.north + dLatI
    };
    const W = region.spanX + dLonO * 2;
    const D = region.spanY + dLatO * 2;

    const ar = W / D;
    const cw = ar >= 1 ? MAX : Math.max(320, Math.round(MAX * ar));
    const ch = ar >= 1 ? Math.max(320, Math.round(MAX / ar)) : MAX;

    this.canvas = document.createElement('canvas');
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.anisotropy = 4;

    this.mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide
    });
    this.geo = new THREE.PlaneGeometry(W, D).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    // ⚠ 平面以自身中心对齐：铭牌框的下边距和上边距不等，外框中心不是四至中心，
    // 必须用经纬度反算世界坐标来定位。之前用 (dLatS-dLatO)/2 当世界偏移（纬度差当米用），
    // 偏移量错了二十公里，铭牌标题被推到地形底下看不见。
    const cLon = (outer.west + outer.east) / 2;
    const cLat = (outer.south + outer.north) / 2;
    const wc = this.view.lonLatToWorld ? this.view.lonLatToWorld(cLon, cLat) : { x: 0, z: 0 };
    this.mesh.position.set(wc.x, this._y(), wc.z);
    this.mesh.renderOrder = 3;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    this._g = { outer, inner, W, D, cw, ch, mKm: outKm };
    this._needRebuild = false;
    this.draw();
    this.group.visible = this.enabled;
  }

  /** 框板高度：贴在模型侧壁的底部（与 buildWall 的底深算法保持一致） */
  _y() {
    const depth = this.view.params.depth || 8;
    const span = this.region ? Math.max(this.region.spanX, this.region.spanY) : 200;
    const bot = -depth * Math.min(1, Math.max(0.05, (span * 0.5) / 130));
    return bot - Math.max(0.15, depth * 0.02);
  }

  /* ---------- 对外统一入口 ---------- */
  apply(o = {}) {
    if (o.style !== undefined && o.style !== this.styleKey) {
      this.styleKey = o.style;
      this._needRebuild = true;          // plate 的下边距跟着框体走
    }
    const widthChanged = (o.width !== undefined && Math.abs(o.width - this.width) > 1e-4)
      || (o.pad !== undefined && Math.abs(o.pad - this.pad) > 1e-4);

    if (o.width !== undefined) this.width = o.width;
    if (o.pad !== undefined) this.pad = o.pad;
    if (o.lw !== undefined) this.lw = o.lw;
    if (o.tone !== undefined) this.tone = o.tone;
    if (o.corner !== undefined) this.corner = o.corner;
    if (o.title !== undefined) this.title = !!o.title;
    if (o.step !== undefined) this.step = o.step;
    if (o.grat !== undefined) this.grat = !!o.grat;
    if (o.alpha !== undefined) this.gratAlpha = o.alpha;
    if (o.theme !== undefined) this.theme = o.theme;
    if (o.on !== undefined) this.enabled = !!o.on;

    if (this.mesh) {
      this.mesh.position.y = this._y();
      if (widthChanged || this._needRebuild) {
        this._needRebuild = false;
        this.dispose();
        this._build();
      } else {
        this.draw();
      }
      this.group.visible = this.enabled;
    }
  }

  /* ---------- 配色 ---------- */
  _pal() {
    const s = this.theme || {};
    let t = TONES[this.tone];
    if (this.styleKey === 'wood' && !t) t = WOOD;      // 木框默认用木料色
    if (!t) {
      // 跟风格：纸本类走沙纸，深色类走墨黑，其余纸白
      const paper = ['sketch', 'line', 'parchment', 'paper'].includes(s.key);
      if (s.dark) t = TONES.ink;
      else if (paper) t = TONES.sand;
      else t = TONES.paper;
    }
    const dark = !!t.dark;
    const rgb = (hex) => {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const r = rgb(t.ink);
    return {
      dark,
      bg: t.bg, hi: t.hi, lo: t.lo,
      band: t.band,
      rule: `rgba(${r[0]},${r[1]},${r[2]},0.78)`,
      ruleSoft: `rgba(${r[0]},${r[1]},${r[2]},0.40)`,
      ruleFaint: `rgba(${r[0]},${r[1]},${r[2]},0.16)`,
      grid: `rgba(${r[0]},${r[1]},${r[2]},`,
      text: `rgba(${r[0]},${r[1]},${r[2]},0.90)`,
      textInv: dark ? 'rgba(28,32,38,0.92)' : 'rgba(250,250,248,0.94)',
      // 金色卡纸线：浅色底上用暖褐，深色底上用真金
      fillet: dark ? 'rgba(198,164,102,0.85)' : 'rgba(164,132,78,0.55)'
    };
  }

  /* ---------- 绘制 ---------- */
  draw() {
    const cv = this.canvas, g = this._g;
    if (!cv || !g) return;
    const ctx = cv.getContext('2d');
    const S = cv.width, T = cv.height;
    const o = g.outer, i = g.inner;
    const X = (lon) => (lon - o.west) / (o.east - o.west) * S;
    const Y = (lat) => (o.north - lat) / (o.north - o.south) * T;

    const ix0 = X(i.west), ix1 = X(i.east);
    const iy0 = Y(i.north), iy1 = Y(i.south);
    // 框带宽度（四条边可能不同：铭牌框下侧更宽）
    const bL = ix0, bR = S - ix1, bT = iy0, bB = T - iy1;
    const bMin = Math.min(bL, bR, bT, bB);

    ctx.clearRect(0, 0, S, T);
    const P = this._pal();
    const sk = this.styleKey;
    const lwUnit = Math.max(1, S / 1500) * Math.max(0.5, this.lw);
    const thin = Math.max(1, lwUnit * 0.9);
    const thick = Math.max(1.4, lwUnit * 2.6);

    /* ===== ① 框带底色 ===== */
    const fills = {
      mat: P.bg, bevel: null, plate: P.bg, wood: P.band, checker: null, neat: null, thin: null, double: null
    };
    if (sk === 'bevel') {
      // 四边分别给渐变，做出斜面受光
      const gt = ctx.createLinearGradient(0, 0, 0, bT);
      gt.addColorStop(0, P.lo); gt.addColorStop(1, P.hi);
      ctx.fillStyle = gt; ctx.fillRect(0, 0, S, bT);

      const gb = ctx.createLinearGradient(0, iy1, 0, T);
      gb.addColorStop(0, P.hi); gb.addColorStop(1, P.lo);
      ctx.fillStyle = gb; ctx.fillRect(0, iy1, S, T - iy1);

      const gl = ctx.createLinearGradient(0, 0, bL, 0);
      gl.addColorStop(0, P.lo); gl.addColorStop(1, P.hi);
      ctx.fillStyle = gl; ctx.fillRect(0, iy0, bL, iy1 - iy0);

      const gr = ctx.createLinearGradient(ix1, 0, S, 0);
      gr.addColorStop(0, P.hi); gr.addColorStop(1, P.lo);
      ctx.fillStyle = gr; ctx.fillRect(ix1, iy0, bR, iy1 - iy0);
    } else if (sk === 'wood') {
      // 木框：外圈木料 + 内圈卡纸，木纹只在木料上
      const gw = ctx.createLinearGradient(0, 0, S, T);
      gw.addColorStop(0, P.hi); gw.addColorStop(0.5, P.bg); gw.addColorStop(1, P.lo);
      ctx.fillStyle = gw;
      ctx.beginPath();
      ctx.rect(0, 0, S, T);
      ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      ctx.fill('evenodd');

      // 木纹：clip 到框带环，避免细线爬到卡纸上
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, S, T);
      ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      ctx.clip('evenodd');
      ctx.globalAlpha = 0.13;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = Math.max(1, S / 700);
      for (let x = 0; x < S; x += S / 110) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + S * 0.004, T); ctx.stroke();
      }
      ctx.restore();

      // 内圈卡纸（暖白，比纯白柔和）
      ctx.fillStyle = P.dark ? '#f2ead9' : '#f8f4e9';
      ctx.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
    } else if (fills[sk]) {
      ctx.fillStyle = fills[sk];
      ctx.beginPath();
      ctx.rect(0, 0, S, T);
      ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      ctx.fill('evenodd');
    }

    // 框板厚度：四边压一道内阴影，让板子看起来有厚、从页面上浮起来
    if (sk === 'mat' || sk === 'plate' || sk === 'bevel' || sk === 'wood') {
      // ⚠ 必须跟着框带宽走：按画布尺寸算的话，窄框带会被阴影整条盖成灰色
      const edge = Math.max(6, bMin * 0.92);
      const dk = sk === 'wood' ? 'rgba(0,0,0,0.34)' : (P.dark ? 'rgba(0,0,0,0.34)' : 'rgba(96,78,50,0.20)');
      const mk = (x0, y0, x1, y1) => {
        const g2 = ctx.createLinearGradient(x0, y0, x1, y1);
        g2.addColorStop(0, dk); g2.addColorStop(1, 'rgba(0,0,0,0)');
        return g2;
      };
      ctx.save();
      ctx.fillStyle = mk(0, 0, 0, edge); ctx.fillRect(0, 0, S, edge);
      ctx.fillStyle = mk(0, T, 0, T - edge); ctx.fillRect(0, T - edge, S, edge);
      ctx.fillStyle = mk(0, 0, edge, 0); ctx.fillRect(0, 0, edge, T);
      ctx.fillStyle = mk(S, 0, S - edge, 0); ctx.fillRect(S - edge, 0, edge, T);
      ctx.restore();
    }

    /* ===== ② 经纬网 ===== */
    const step = pickStep(Math.max(i.east - i.west, i.north - i.south), this.step);
    const lonTicks = [];
    const latTicks = [];
    for (let lon = Math.ceil(i.west / step) * step; lon <= i.east + 1e-9; lon += step) lonTicks.push(+lon.toFixed(6));
    for (let lat = Math.ceil(i.south / step) * step; lat <= i.north + 1e-9; lat += step) latTicks.push(+lat.toFixed(6));

    // 分格带：先铺棋盘格（在网格线之下）
    if (sk === 'checker') {
      const lb = [...lonTicks], ab = [...latTicks];
      // 补上两端，让格子铺满整条框带
      if (lb[0] > i.west + 1e-9) lb.unshift(i.west);
      if (lb[lb.length - 1] < i.east - 1e-9) lb.push(i.east);
      if (ab[0] > i.south + 1e-9) ab.unshift(i.south);
      if (ab[ab.length - 1] < i.north + 1e-9) ab.push(i.north);
      const darkC = P.dark ? 'rgba(0,0,0,0.42)' : 'rgba(42,48,56,0.80)';
      const lightC = P.dark ? 'rgba(255,255,255,0.10)' : 'rgba(252,251,246,0.96)';
      // 格子只占框带「靠外」的 58%，靠内那段留白放经纬度数字 ——
      // 满框带铺黑白格太重，会跟地形抢视线。
      const OUTB = 0.58;
      const topH = iy0 * OUTB, botH = (T - iy1) * OUTB;
      const leftW = ix0 * OUTB, rightW = (S - ix1) * OUTB;
      for (let k = 0; k < lb.length - 1; k++) {
        // 只铺内框线之间，否则第一格/最后一格会横穿到左右框带上，看着像贴歪了
        const x0 = Math.max(X(lb[k]), ix0), x1 = Math.min(X(lb[k + 1]), ix1);
        if (x1 - x0 < 0.5) continue;
        ctx.fillStyle = k % 2 ? darkC : lightC;
        ctx.fillRect(x0, 0, x1 - x0, topH);
        ctx.fillRect(x0, T - botH, x1 - x0, botH);
      }
      for (let k = 0; k < ab.length - 1; k++) {
        const y0 = Math.max(Y(ab[k + 1]), iy0), y1 = Math.min(Y(ab[k]), iy1);
        if (y1 - y0 < 0.5) continue;
        ctx.fillStyle = k % 2 ? lightC : darkC;
        ctx.fillRect(0, y0, leftW, y1 - y0);
        ctx.fillRect(S - rightW, y0, rightW, y1 - y0);
      }
    }

    if (this.grat) {
      const a = 0.30 + 0.5 * this.gratAlpha;
      const full = ['mat', 'plate', 'bevel', 'wood'].includes(sk);   // 有底板 → 网格铺满板
      ctx.strokeStyle = P.grid + a.toFixed(3) + ')';
      ctx.lineWidth = Math.max(1, thin * 0.85);
      ctx.beginPath();
      for (const lon of lonTicks) {
        const x = X(lon);
        if (full) { ctx.moveTo(x, 0); ctx.lineTo(x, T); }
        else {
          ctx.moveTo(x, 0); ctx.lineTo(x, iy0);
          ctx.moveTo(x, iy1); ctx.lineTo(x, T);
        }
      }
      for (const lat of latTicks) {
        const y = Y(lat);
        if (full) { ctx.moveTo(0, y); ctx.lineTo(S, y); }
        else {
          ctx.moveTo(0, y); ctx.lineTo(ix0, y);
          ctx.moveTo(ix1, y); ctx.lineTo(S, y);
        }
      }
      ctx.stroke();
    }

    /* ===== ③ 刻度与经纬度数字 ===== */
    const fs = Math.min(bMin * 0.40, S * 0.030);
    const tick = Math.min(bMin * 0.20, fs * 0.8);
    const dec = step < 1 ? (step < 0.25 ? 2 : 1) : 0;
    const fmt = (v, neg, pos) => `${Math.abs(v).toFixed(dec)}°${v >= 0 ? pos : neg}`;
    const showNum = fs >= 9;
    const mono = `500 ${fs.toFixed(1)}px "JetBrains Mono",Consolas,"Roboto Mono",monospace`;

    // 刻度线（在所有框体上都画，是"图廓"的骨架）
    ctx.strokeStyle = P.ruleSoft;
    ctx.lineWidth = Math.max(1, thin * 0.9);
    ctx.beginPath();
    for (const lon of lonTicks) {
      const x = X(lon);
      ctx.moveTo(x, iy1); ctx.lineTo(x, iy1 + tick);
      ctx.moveTo(x, iy0); ctx.lineTo(x, iy0 - tick);
    }
    for (const lat of latTicks) {
      const y = Y(lat);
      ctx.moveTo(ix0, y); ctx.lineTo(ix0 - tick, y);
      ctx.moveTo(ix1, y); ctx.lineTo(ix1 + tick, y);
    }
    ctx.stroke();

    if (showNum) {
      ctx.font = mono;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // 先描一圈底，再填字：压在分格带/木框的深色格上也能读
      const halo = P.dark ? 'rgba(0,0,0,0.62)' : 'rgba(255,255,255,0.92)';
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, fs * 0.30);
      ctx.strokeStyle = halo;
      ctx.fillStyle = P.text;
      const put = (t, x, y) => { ctx.strokeText(t, x, y); ctx.fillText(t, x, y); };

      // 经度：下框带；纬度：左框带竖排
      // 分格带的格子占了框带外侧 58%，数字必须挪到内侧留白里，否则压在格子上
      let cyB = iy1 + bB * 0.55;
      let cxL = ix0 - bL * 0.52;
      if (sk === 'checker') { cyB = iy1 + bB * 0.21; cxL = ix0 * 0.79; }
      if (sk === 'plate') { cyB = iy1 + bB * 0.20; }
      for (const lon of lonTicks) put(fmt(lon, 'W', 'E'), X(lon), cyB);
      for (const lat of latTicks) {
        ctx.save();
        ctx.translate(cxL, Y(lat));
        ctx.rotate(-Math.PI / 2);
        put(fmt(lat, 'S', 'N'), 0, 0);
        ctx.restore();
      }
    }

    /* ===== ④ 框线（各框体不同） ===== */
    const strokeRect = (x, y, w, h, color, wd) => {
      ctx.strokeStyle = color; ctx.lineWidth = wd;
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.stroke();
    };

    if (sk === 'thin') {
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.rule, thin);
      strokeRect(thin * 0.5, thin * 0.5, S - thin, T - thin, P.ruleSoft, thin * 0.8);
    } else if (sk === 'double') {
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.rule, thick * 0.8);
      const off = Math.max(3, bMin * 0.26);
      strokeRect(ix0 - off, iy0 - off, ix1 - ix0 + off * 2, iy1 - iy0 + off * 2, P.rule, thin);
      strokeRect(thin * 0.5, thin * 0.5, S - thin, T - thin, P.ruleSoft, thin * 0.7);
    } else if (sk === 'neat') {
      // 经典图廓：内细 → 中细（框带中线）→ 外粗
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.rule, thin);
      const mx = bL * 0.5, my = bT * 0.5;
      strokeRect(mx, my, S - mx * 2, T - my * 2, P.ruleSoft, thin * 0.8);
      strokeRect(thick * 0.7, thick * 0.7, S - thick * 1.4, T - thick * 1.4, P.rule, thick);
    } else if (sk === 'checker') {
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.rule, thin);
      strokeRect(thin * 0.5, thin * 0.5, S - thin, T - thin, P.rule, thin);
    } else if (sk === 'mat' || sk === 'plate') {
      // 卡纸：内框线 + 紧贴一道细线 + 卡纸中线（金色）+ 外框线
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.rule, thin);
      const off = Math.max(3, bMin * 0.14);
      strokeRect(ix0 - off, iy0 - off, ix1 - ix0 + off * 2, iy1 - iy0 + off * 2, P.ruleFaint, thin * 0.85);
      const mx = Math.max(4, bMin * 0.50);
      strokeRect(mx, mx, S - mx * 2, T - mx * 2, P.fillet, thin * 0.9);
      strokeRect(thin * 0.5, thin * 0.5, S - thin, T - thin, P.ruleSoft, thin * 0.8);
      // 内框里侧压一道浅影，做出"纸凹下去"的感觉
      ctx.save();
      ctx.beginPath();
      ctx.rect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      ctx.lineWidth = Math.max(2, bMin * 0.10) * 2;
      ctx.strokeStyle = P.dark ? 'rgba(0,0,0,0.30)' : 'rgba(90,86,74,0.10)';
      ctx.stroke();
      ctx.restore();
    } else if (sk === 'bevel') {
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.rule, thin);
      strokeRect(thin * 0.5, thin * 0.5, S - thin, T - thin, P.rule, thin * 1.2);
    } else if (sk === 'wood') {
      strokeRect(ix0, iy0, ix1 - ix0, iy1 - iy0, P.fillet, thin * 1.3);   // 内金线
      const off = Math.max(3, bMin * 0.16);
      strokeRect(ix0 - off, iy0 - off, ix1 - ix0 + off * 2, iy1 - iy0 + off * 2, P.ruleFaint, thin * 0.8);
      strokeRect(thin * 0.6, thin * 0.6, S - thin * 1.2, T - thin * 1.2, P.ruleSoft, thin * 1.4);
      // 外沿高光
      ctx.save();
      ctx.strokeStyle = P.dark ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = thin * 0.8;
      ctx.beginPath();
      ctx.moveTo(thin, T - thin); ctx.lineTo(thin, thin); ctx.lineTo(S - thin, thin);
      ctx.stroke();
      ctx.restore();
    }

    /* ===== ⑤ 角饰 ===== */
    if (this.corner !== 'none') {
      const L = Math.min(Math.max(bMin * 0.95, 12), 96);
      const corners = [
        [ix0, iy0, 1, 1], [ix1, iy0, -1, 1],
        [ix0, iy1, 1, -1], [ix1, iy1, -1, -1]
      ];
      ctx.strokeStyle = P.rule;
      ctx.fillStyle = P.rule;
      ctx.lineWidth = Math.max(1.6, thin * 2.0);
      for (const [cx, cy, sx, sy] of corners) {
        if (this.corner === 'bracket') {
          ctx.beginPath();
          ctx.moveTo(cx + sx * L, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + sy * L);
          ctx.stroke();
        } else if (this.corner === 'block') {
          const s = L * 0.34;
          ctx.fillRect(cx - (sx > 0 ? 0 : s), cy - (sy > 0 ? 0 : s), s, s);
        } else if (this.corner === 'dot') {
          ctx.beginPath();
          ctx.arc(cx, cy, Math.max(2.5, L * 0.13), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    /* ===== ⑥ 铭牌（仅 plate） ===== */
    if (sk === 'plate' && this.title) {
      const name = (this.region && this.region.name) || '';
      const r0 = this.region ? this.region : null;
      const range = r0
        ? `${r0.bbox.west.toFixed(1)}°–${r0.bbox.east.toFixed(1)}°E   ${r0.bbox.south.toFixed(1)}°–${r0.bbox.north.toFixed(1)}°N`
        : '';
      const cy = iy1 + (T - iy1) * 0.64;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const f1 = Math.min((T - iy1) * 0.30, S * 0.036);
      const f2 = Math.max(8, f1 * 0.40);
      ctx.fillStyle = P.text;
      ctx.font = `600 ${f1.toFixed(1)}px "Source Han Serif SC","Songti SC",serif`;
      ctx.fillText(name, S / 2, cy - (range ? f1 * 0.34 : 0));
      if (range) {
        ctx.fillStyle = P.ruleSoft;
        ctx.font = `400 ${f2.toFixed(1)}px ${'"JetBrains Mono",Consolas,monospace'}`;
        ctx.fillText(range, S / 2, cy + f1 * 0.62);
      }
    }

    this.tex.needsUpdate = true;
  }

  setTheme(style) { this.apply({ theme: style }); }
  setVisible(on) {
    this.enabled = !!on;
    this.group.visible = this.enabled && !!this.mesh;
  }

  dispose() {
    this.group.clear();
    if (this.geo) this.geo.dispose();
    if (this.mat) this.mat.dispose();
    if (this.tex) this.tex.dispose();
    this.mesh = null; this.geo = null; this.mat = null; this.tex = null;
    this.canvas = null; this._g = null;
  }
}
