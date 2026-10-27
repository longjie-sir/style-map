/* ============================================================
   行政区划名称标注（HTML 投影层）
   - 位置：本级用「多边形内最远点」（pole of inaccessibility），
     下级用 DataV 提供的 center，并做「点是否在区域内」校验
   - 三套字样：宋体描边 / 书法刻痕 / 淡描白字
   - 会做简单的重叠避让
   ============================================================ */
const LEVEL_OF = (code) => {
  const c = String(code);
  if (c.endsWith('0000')) return 1;
  if (c.endsWith('00')) return 2;
  return 3;
};

/** #rrggbb → "r g b"（给 CSS 的 rgba(<triple> / <alpha>) 用） */
function hexToRgbTriple(hex) {
  const h = String(hex || '#000').replace('#', '');
  const s = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(s, 16);
  if (!isFinite(n)) return '0 0 0';
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function inPoly(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 多边形内「离边界最远」的点，标签放这里最不容易压到边界 */
function poleOfInaccessibility(poly) {
  const r = poly.outer;
  if (!r || r.length < 4) return null;
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const p of r) {
    if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0];
    if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1];
  }
  // 边界点抽样（控制计算量）
  const step = Math.max(1, Math.floor(r.length / 260));
  const bp = [];
  for (let i = 0; i < r.length; i += step) bp.push(r[i]);

  let best = null, bestD = -1;
  const G = 28;
  for (let j = 1; j < G; j++) {
    for (let i = 1; i < G; i++) {
      const lon = w + (e - w) * (i / G), lat = s + (n - s) * (j / G);
      if (!inPoly(r, lon, lat)) continue;
      let d = Infinity;
      for (const b of bp) {
        const dx = b[0] - lon, dy = b[1] - lat;
        const dd = dx * dx + dy * dy;
        if (dd < d) d = dd;
        if (d <= bestD) break;
      }
      if (d > bestD) { bestD = d; best = [lon, lat]; }
    }
  }
  return best;
}

export class Labels {
  constructor(view, root) {
    this.view = view;
    this.root = root;
    this.items = [];
    this.opts = {
      prov: true, city: true, county: true, style: 'song', on: true,
      scale: 1, weight: 700, spacing: 0.16, color: '#ffffff',
      outline: 1, outlineW: 3, outlColor: '#101010', outlAlpha: 0.92,
      lift: 0.4, fade: 1, maxCount: 26, align: 'center'
    };
  }

  setOptions(patch) {
    Object.assign(this.opts, patch);
    const o = this.opts;
    const r = this.root.style;
    r.setProperty('--lscale', o.scale);
    r.setProperty('--lweight', o.weight);
    r.setProperty('--lspacing', o.spacing + 'em');
    r.setProperty('--lcolor', o.color);
    r.setProperty('--loutlw', o.outlineW + 'px');
    // 注意：CSS 里用的是 rgba(<rgb> / <alpha>) 这种现代写法，
    // 第一段必须是「空格分隔的 RGB 三元组」，写成 #101010 会让整条 text-shadow
    // 变成非法声明而被丢弃 —— 表现是「描边开关看着有用，但屏幕上没描边」。
    r.setProperty('--loutlc', hexToRgbTriple(o.outlColor));
    r.setProperty('--loutla', o.outlAlpha);
    this.root.className = `labels s-${o.style}`
      + (o.on ? '' : ' off')
      + (o.outline ? '' : ' no-ol')
      + (o.align === 'bottom' ? ' align-bottom' : '');
    this.applyVisibility();
  }

  /** 是否显示某一层级（兼顾 force：当前区域「直接下级」永远显示） */
  _vis(it) {
    const o = this.opts;
    if (!o.on) return false;
    if (it.force) return true;
    return (it.level === 1 && o.prov) || (it.level === 2 && o.city) || (it.level === 3 && o.county);
  }

  applyVisibility() {
    for (const it of this.items) {
      const show = this._vis(it);
      it.enabled = show;
      if (!show) it.el.style.display = 'none';
    }
  }

  clear() {
    this.root.innerHTML = '';
    this.items = [];
  }

  /** 追加一批标注（用于省级视图下补充县级名） */
  appendBelow(list) {
    for (const c of list) {
      if (!c.center) continue;
      if (!this.view.inRegion(c.center[0], c.center[1])) continue;
      if (this.items.some((it) => it.text === c.name && Math.abs(it.lon - c.center[0]) < 1e-6)) continue;
      this.add(c.name, c.center[0], c.center[1], 3, 'child');
    }
    this.applyVisibility();
  }

  add(text, lon, lat, level, kind) {
    const el = document.createElement('div');
    el.className = `lb lb-l${level} ${kind === 'self' ? 'lb-self' : ''}`;
    el.textContent = text;
    el.dataset.t = text;              // 供描边光晕层复用
    this.root.appendChild(el);
    const it = { el, lon, lat, level, text, kind: kind || 'child', enabled: true, force: false, x: 0, y: 0, w: 0, h: 0 };
    this.items.push(it);
    return it;
  }

  setRegion(region) {
    this.clear();
    if (!region) return;
    const add = (text, lon, lat, level, kind) => this.add(text, lon, lat, level, kind);

    // 本级名称：放在多边形内最远点
    const main = (region.polys && region.polys[0]) || null;
    let self = null;
    if (main) self = poleOfInaccessibility(main);
    if (!self) self = [region.center.lon, region.center.lat];
    add(region.name, self[0], self[1], LEVEL_OF(region.id), 'self');

    // 下级名称
    const selfLevel = LEVEL_OF(region.id);
    for (const c of (region.children || [])) {
      if (!c.center) continue;
      const [lon, lat] = c.center;
      if (!this.view.inRegion(lon, lat)) continue;
      const it = add(c.name, lon, lat, LEVEL_OF(c.code), 'child');
      // 非省级视图：直接下级就是这一层的主标注
      if (selfLevel >= 2) { it.force = true; it.el.classList.add('lb-force'); }
    }
    this.applyVisibility();
  }

  /** 每帧投影；带重叠避让 */
  update() {
    const o = this.opts;
    if (!o.on) return;
    const view = this.view, cam = view.camera;
    const W = view.el.clientWidth, H = view.el.clientHeight;
    const hs = view.u.uHeightScale.value;
    const placed = [];
    const v = { x: 0, y: 0, z: 0 };
    const lift = o.lift || 0;

    const list = this.items.filter((it) => it.enabled);
    // 排序 = 避让优先级：本级 > 行政级别高 > 距离相机近。
    // 之前只按 level 排，同级的会「先到先得」，于是在斜视角下
    // 常常是画面边缘那个抢到了位置。按距离排更符合直觉。
    const camPos = cam.position;
    for (const it of list) {
      const w = view.lonLatToWorld(it.lon, it.lat);
      it._d2 = (w.x - camPos.x) ** 2 + (w.z - camPos.z) ** 2;
    }
    list.sort((a, b) => {
      // 优先级：本级名称(-1) → force 标注(-0.5) → 其余按层级、再按离相机远近
      const rank = (it) => (it.kind === 'self' ? -1 : it.force ? -0.5 : it.level);
      return (rank(a) - rank(b)) || (a._d2 - b._d2);
    });

    // 数量上限：低配机或区域很大时，几十上百个 DOM 元素的布局开销很可观
    let shown = 0;
    const cap = Math.max(4, o.maxCount || 26);

    for (const it of list) {
      if (shown >= cap) { it.el.style.display = 'none'; continue; }
      const w = view.lonLatToWorld(it.lon, it.lat);
      // 必须用「当前生长进度下的」地表高度：生长期地形还是压扁的，
      // 若按最终高程放标注，文字会浮在半空，看起来完全对不上地点。
      const surf = view.surfaceYVisual ? view.surfaceYVisual(it.lon, it.lat) : view.heightAt(it.lon, it.lat) * hs;
      v.x = w.x; v.y = surf + lift; v.z = w.z;
      const p = new cam.position.constructor(v.x, v.y, v.z).project(cam);
      const behind = p.z > 1 || p.z < -1;
      if (behind || !isFinite(p.x) || !isFinite(p.y)) { it.el.style.display = 'none'; continue; }
      const sx = (p.x * 0.5 + 0.5) * W;
      const sy = (-p.y * 0.5 + 0.5) * H;
      if (sx < -80 || sx > W + 80 || sy < -40 || sy > H + 40) { it.el.style.display = 'none'; continue; }

      // 重叠避让：先到先得（排序已把重要的放前面）
      const wApprox = it.el.offsetWidth || it.el.textContent.length * 13 + 10;
      const hApprox = it.el.offsetHeight || 20;
      let hit = false;
      for (const r of placed) {
        if (Math.abs(r.x - sx) < (r.w + wApprox) * 0.46 && Math.abs(r.y - sy) < (r.h + hApprox) * 0.52) { hit = true; break; }
      }
      // 本级名称与 force 标注不参与避让（被它们盖住的可以让开）
      if (hit && it.level > 1 && !it.force) { it.el.style.display = 'none'; continue; }
      placed.push({ x: sx, y: sy, w: wApprox, h: hApprox });

      it.el.style.display = '';
      // 居中对齐：文字中心压在标点上；贴地对齐：文字下沿压在标点上（标点就是那个小圆点）
      const tf = o.align === 'bottom'
        ? `translate(-50%,-100%) translateY(-6px) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`
        : `translate(-50%,-50%) translate(${sx.toFixed(1)}px,${sy.toFixed(1)}px)`;
      it.el.style.transform = tf;
      shown++;
    }
  }
}
