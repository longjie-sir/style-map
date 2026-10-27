/* ============================================================
   右侧参数面板
   ============================================================ */
import { rampCss } from '../scene/palettes.js';
import { FRAME_STYLES, FRAME_TONES, FRAME_CORNERS, FRAME_GRAT_STEP } from '../scene/frame.js';

const pct = (v) => (v * 100).toFixed(0) + '%';
const FMT = {
  sunAz: (v) => v + '°', sunEl: (v) => v + '°',
  exag: (v) => v.toFixed(1) + '×', shadow: pct, ao: pct,
  contourStep: (v) => v + 'm', contourW: (v) => v.toFixed(2),
  lineDensity: (v) => v.toFixed(2), paper: pct, fog: pct, glow: pct,
  depth: (v) => v.toFixed(1) + ' km', bands: (v) => v.toFixed(0), snow: pct, rim: (v) => v.toFixed(2),
  _speed: (v) => v.toFixed(2),
  flyH: (v) => (v * 100).toFixed(0) + '%', cloudAmt: pct, cloudShadow: pct,
  cloudHeight: (v) => v.toFixed(2) + '×', cloudSteps: pct,
  gratOpacity: pct, voxCols: (v) => Math.round(v) + ' 格',
  frameW: (v) => (v * 100).toFixed(1) + '%',
  framePad: (v) => (v * 100).toFixed(1) + '%',
  labelSpacing: (v) => v.toFixed(2) + 'em', labelOutlineW: (v) => v.toFixed(1) + 'px',
  labelLift: (v) => v.toFixed(2) + ' km', labelMax: (v) => Math.round(v) + ' 个',
  labelWeight: (v) => String(Math.round(v))
};

const SLIDERS = {
  sunAz: ['光源方位', 0, 360, 1],
  sunEl: ['光源高度', 3, 88, 1],
  shadow: ['阴影强度', 0, 1, 0.01],
  ao: ['环境光遮蔽', 0, 1, 0.01],
  exag: ['垂直夸张', 1, 15, 0.1],
  contourStep: ['等高距', 20, 800, 10],
  contourW: ['等高线粗细', 0.3, 2.4, 0.05],
  bands: ['分层数', 4, 40, 1],
  lineDensity: ['线条密度', 0.5, 2.2, 0.02],
  paper: ['纸纹颗粒', 0, 1, 0.01],
  fog: ['大气雾', 0, 1, 0.01],
  glow: ['辉光', 0, 1.4, 0.01],
  snow: ['雪线', 0.4, 1, 0.01],
  rim: ['边缘光', 0, 2, 0.05],
  depth: ['底座厚度', 0, 20, 0.2],
  voxCols: ['方块尺寸', 48, 240, 2],
  _speed: ['播放速度', 0.03, 0.6, 0.01]
};

export class Panel {
  constructor(root, { onChange, onPalette, onAction, onLayer, layers }) {
    this.root = root;
    this.onChange = onChange;
    this.onPalette = onPalette;
    this.onAction = onAction;
    this.onLayer = onLayer || (() => {});
    this.collapsed = new Set(['数据', '底板与输出', '动画与轨迹']);
    this.style = null;
    this.params = null;
    this.layers = layers || {};
    this.palIndex = 0;
    this.info = null;
  }

  setStyle(style, params, palIndex) {
    this.style = style;
    this.params = params;
    this.palIndex = palIndex;
    this.render();
  }

  setInfo(info) {
    this.info = info;
    const box = this.root.querySelector('#infoBox');
    if (box && info) box.innerHTML = info;
  }

  setWaterInfo(text) {
    const el = this.root.querySelector('#waterInfo');
    if (el && text) el.textContent = text;
    this._waterInfo = text;
  }

  /** 外部（快捷键 / 顶栏按钮）改了图层后，把面板控件同步过来 */
  syncLayer(k) {
    const el = this.root.querySelector(`input[data-layer="${k}"]`);
    if (!el) return;
    el.checked = !!this.layers[k];
    // 只有「分组标题栏里的那个总开关」才控制整组变灰；
    // 组内的子开关（描边、湖泊、显示轨迹线…）不该把整组 dim 掉
    const grp = el.closest('.lgrp');
    const isHead = grp && grp.querySelector('.lgrp-hd') && grp.querySelector('.lgrp-hd').contains(el);
    if (!isHead) return;
    const bd = grp.querySelector('.lgrp-bd');
    if (bd) bd.classList.toggle('dim', !this.layers[k]);
  }

  setLayers(layers) {
    this.layers = layers;
  }

  sync(params) {
    this.params = params;
    this.root.querySelectorAll('input[data-k]').forEach((el) => {
      const k = el.dataset.k;
      if (el.type === 'checkbox') el.checked = !!params[k];
      else { el.value = params[k]; el.style.setProperty('--p', ((params[k] - el.min) / (el.max - el.min) * 100) + '%'); }
      const v = this.root.querySelector(`[data-v="${k}"]`);
      if (v) v.textContent = (FMT[k] || ((x) => x))(params[k]);
    });
  }

  slider(k) {
    const [label, min, max, step] = SLIDERS[k];
    const val = this.params[k];
    const p = ((val - min) / (max - min) * 100).toFixed(1);
    return `<label class="row">
      <span class="row-lb">${label}</span>
      <input class="slider" type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${p}%">
      <span class="row-val" data-v="${k}">${(FMT[k] || ((x) => x))(val)}</span>
    </label>`;
  }

  /** 图层用的滑块（值存在 layers 里，不参与风格参数） */
  layerSlider(k, label, min, max, step, fmt) {
    const val = this.layers[k] ?? min;
    const p = ((val - min) / (max - min) * 100).toFixed(1);
    return `<label class="row">
      <span class="row-lb">${label}</span>
      <input class="slider" type="range" data-lnum="${k}" min="${min}" max="${max}" step="${step}" value="${val}" style="--p:${p}%">
      <span class="row-val" data-lv="${k}">${(fmt || FMT[k] || ((x) => x))(val)}</span>
    </label>`;
  }

  toggle(k, label) {
    return `<label class="row">
      <span class="row-lb w80">${label}</span>
      <span class="switch"><input type="checkbox" data-k="${k}" ${this.params[k] ? 'checked' : ''}><i></i></span>
    </label>`;
  }

  layerToggle(k, label, indent) {
    return `<label class="row${indent ? ' row-sub' : ''}">
      <span class="row-lb w80">${label}</span>
      <span class="switch"><input type="checkbox" data-layer="${k}" ${this.layers[k] ? 'checked' : ''}><i></i></span>
    </label>`;
  }

  chk(key, label) {
    return `<label class="chk"><input type="checkbox" data-layer="${key}" ${this.layers[key] ? 'checked' : ''}><i></i><span>${label}</span></label>`;
  }

  chip(k, glyph, title) {
    const on = this.layers.labelStyle === k;
    return `<button class="lchip${on ? ' on' : ''}" data-lchip="${k}" title="${title}"><b>${glyph}</b><span>${title.slice(0, 2)}</span></button>`;
  }

  /** 色块按钮组（取值存在 layers 里，如 labelColor / labelOutlColor） */
  swatches(k, label, colors) {
    const cur = (this.layers[k] || '').toLowerCase();
    return `<div class="row"><span class="row-lb w80">${label}</span>
      <span class="sw-row">${colors.map((c) => `
        <button class="sw${cur === c.toLowerCase() ? ' on' : ''}" data-swatch="${k}" data-c="${c}"
          style="background:${c}" title="${c}"></button>`).join('')}</span></div>`;
  }

  /** 分段按钮组（取值存在 layers 里） */
  seg(k, label, opts, wrap) {
    const cur = this.layers[k];
    return `<div class="row"><span class="row-lb w80">${label}</span>
      <span class="seg-row${wrap ? ' wrap' : ''}">${opts.map((o) => `
        <button class="seg${String(cur) === String(o[0]) ? ' on' : ''}" data-seg="${k}" data-v="${o[0]}">${o[1]}</button>`).join('')}</span></div>`;
  }

  section(title, body) {
    const col = this.collapsed.has(title) ? ' collapsed' : '';
    return `<section class="sec${col}" data-sec="${title}">
      <div class="sec-hd"><h3>${title}</h3>
        <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m6 9 6 6 6-6"/></svg>
      </div>
      <div class="sec-bd">${body}</div>
    </section>`;
  }

  render() {
    const s = this.style, p = this.params;
    if (!s) return;
    const palRow = s.palettes.map((pal, i) => `
      <button class="pal ${i === this.palIndex ? 'on' : ''}" data-pal="${i}">
        <i style="background:${rampCss(pal.stops)}"></i>
        <span>${pal.name}</span>
      </button>`).join('');

    const light = [this.slider('sunAz'), this.slider('sunEl'), this.slider('shadow'), this.toggle('shadowOn', '投射阴影'), this.slider('ao')].join('');

    const geo = [this.slider('exag')];
    if (s.key === 'pixel') {
      geo.push(this.slider('voxCols'));
      geo.push('<div class="note">「方块尺寸」= 长边方向的格数。格数越多方块越小、细节越细，顶点数按平方增长；'
        + '低配机建议 60~90 格。配色在像素风格下同样生效（直接换整套色带）。</div>');
    }
    if (['hypo', 'paper', 'parchment'].includes(s.key)) geo.push(this.slider('bands'));
    if (['line', 'sketch', 'hypo', 'magma', 'parchment', 'realistic'].includes(s.key)) {
      geo.push(this.toggle('contourOn', '等高线') + this.slider('contourStep') + this.slider('contourW'));
    }
    if (['line', 'sketch'].includes(s.key)) geo.push(this.slider('lineDensity'), this.slider('paper'));
    if (s.key === 'realistic') geo.push(this.slider('snow'), this.slider('fog'));
    if (['mono', 'ice', 'magma', 'ink', 'plaster', 'hypo', 'parchment'].includes(s.key)) geo.push(this.slider('glow'));
    if (['ice', 'ink', 'magma'].includes(s.key)) geo.push(this.slider('rim'));

    const anim = `
      <div class="btn-row">
        <button class="btn" data-act="grow"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20h16M12 20V6m0 0-4 4m4-4 4 4"/></svg>地形生长</button>
        <button class="btn" data-act="resetview">复位视角</button>
      </div>
      <div class="btn-row">
        <button class="btn ${this._drawing ? 'on' : ''}" data-act="draw">绘制轨迹</button>
        <button class="btn" data-act="preset">示例轨迹</button>
        <button class="btn" data-act="clear">清空</button>
      </div>
      <div class="btn-row">
        <button class="btn primary" data-act="play">播放</button>
        <button class="btn ${this._follow ? 'on' : ''}" data-act="follow">沿线飞行</button>
      </div>
      ${this.slider('_speed')}
      ${this.layerSlider('flyH', '巡航高度', 0.012, 0.26, 0.004)}
      ${this.layerToggle('showLine', '显示轨迹线')}
      ${this.layerToggle('loop', '循环飞行')}
      <div class="note">航线走一条**统一高度**的水平线（不再逐点贴合地面起伏），拖动「巡航高度」即可整条升降。
        飞行中鼠标左键拖动可随时改视角、滚轮调远近，不被固定机位锁死。</div>`;

    // 底图只在「主题」背景下有效：素色 / 关闭 是出图模式，遥感影像会盖住页面底色
    const bgPlain = this.layers.bgMode !== 'theme';
    const bdOn = !!this.layers.backdrop && !bgPlain;

    // 远岛 / 飞地（三沙岛礁、沿海离岛）：面积小于一个 DEM 格子，没有地形，
    // 但边界要照常显示。数量由 main 在载入区域后写进 layers.isletCount
    const farN = this.layers.isletCount || 0;
    const isletBlock = farN ? `
      <div class="lgrp">
        <div class="lgrp-hd">
          <span class="lgrp-t">离岛与飞地</span>
          <span class="switch"><input type="checkbox" data-layer="islets" ${this.layers.islets ? 'checked' : ''}><i></i></span>
        </div>
        <div class="lgrp-bd${this.layers.islets ? '' : ' dim'}">
          ${this.seg('isletView', '取景', [['main', '主图'], ['all', '含离岛']])}
          <div class="note">本区域另有 <b>${farN}</b> 处远离主体的岛礁 / 飞地（如三沙）。
            面积小于一个 DEM 格子，取不出地形，但边界照常画在纸面上。
            「取景」切到「含离岛」可把它们一起框进画面。</div>
        </div>
      </div>` : '';

    const layers = `
      <div class="lgrp">
        <div class="lgrp-hd">
          <span class="lgrp-t">名称标注</span>
          <span class="switch"><input type="checkbox" data-layer="labels" ${this.layers.labels ? 'checked' : ''}><i></i></span>
        </div>
        <div class="lgrp-bd${this.layers.labels ? '' : ' dim'}">
          <div class="lchips">
            ${this.chip('song', '宋', '宋体描边')}
            ${this.chip('brush', '楷', '楷体书法')}
            ${this.chip('sans', '黑', '黑体细排')}
            ${this.chip('tag', '签', '标签牌')}
          </div>
          <div class="row row-sub"><span class="row-lb w80">层级</span>
            <span class="chk-row">${this.chk('labelProv', '省级')}${this.chk('labelCity', '市级')}${this.chk('labelCounty', '县级')}</span>
          </div>
          ${this.layerSlider('labelScale', '字号', 0.6, 2.4, 0.05, (v) => v.toFixed(2) + '×')}
          ${this.layerSlider('labelSpacing', '字距', 0, 0.6, 0.01)}
          ${this.layerSlider('labelWeight', '字重', 300, 900, 100)}
          ${this.seg('labelAlign', '对齐', [['center', '居中'], ['bottom', '贴地']])}
          ${this.swatches('labelColor', '文字色', ['#ffffff', '#fff6e0', '#e8f3ff', '#1d232a', '#3a2a12', '#0e2a3a'])}
          <div class="row row-sub"><span class="row-lb w80">描边</span>
            <span class="switch"><input type="checkbox" data-layer="labelOutline" ${this.layers.labelOutline ? 'checked' : ''}><i></i></span>
          </div>
          ${this.layerSlider('labelOutlineW', '描边粗细', 0.5, 8, 0.1)}
          ${this.swatches('labelOutlColor', '描边色', ['#101010', '#2a2118', '#0b1c2c', '#4a3a20', '#5b1f1f', '#ffffff'])}
          ${this.layerSlider('labelOutlAlpha', '描边浓度', 0, 1, 0.02, pct)}
          ${this.layerSlider('labelLift', '离地高度', 0, 3, 0.05)}
          ${this.layerSlider('labelMax', '最多显示', 4, 120, 1)}
          <div class="note">字号/字距/字重/描边/文字色全部实时生效；「最多显示」限制同屏标注数量（性能相关）</div>
        </div>
      </div>

      <div class="lgrp">
        <div class="lgrp-hd">
          <span class="lgrp-t">背景底图</span>
          <span class="switch"><input type="checkbox" data-layer="backdrop" ${bdOn ? 'checked' : ''}><i></i></span>
        </div>
        <div class="lgrp-bd${bdOn ? '' : ' dim'}">
          ${this.layerSlider('backdropOpacity', '底图浓度', 0, 1, 0.02, pct)}
          <div class="note">离线烘焙的中国遥感底图，随风格自动变色${bgPlain ? '；当前「素色 / 关闭」背景下已自动隐藏（出图用）' : ''}</div>
        </div>
      </div>

      <div class="lgrp">
        <div class="lgrp-hd">
          <span class="lgrp-t">水面（河湖）</span>
          <span class="switch"><input type="checkbox" data-layer="water" ${this.layers.water ? 'checked' : ''}><i></i></span>
        </div>
        <div class="lgrp-bd${this.layers.water ? '' : ' dim'}">
          <div class="row"><span class="row-lb w80">内置数据</span>
            <span class="chk-row">${this.chk('waterLakes', '湖泊')}${this.chk('waterRivers', '河流')}</span>
          </div>
          <div class="btn-row"><button class="btn" data-act="uploadWater">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 16V4m0 0 4 4m-4-4L8 8"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
            上传水面矢量</button></div>
          <div class="note" id="waterInfo">GeoJSON（WGS84）面＝水面 / 线＝河道</div>
          <div class="note">水面高度自动跟随「垂直夸张」，不必手动重调</div>
        </div>
      </div>

      <div class="lgrp">
        <div class="lgrp-hd">
          <span class="lgrp-t">云层</span>
          <span class="switch"><input type="checkbox" data-layer="clouds" ${this.layers.clouds ? 'checked' : ''}><i></i></span>
        </div>
        <div class="lgrp-bd${this.layers.clouds ? '' : ' dim'}">
          ${this.seg('cloudMode', '云方案', [['volume', '体积云'], ['plane', '平面云']])}
          ${this.layers.cloudMode === 'plane' ? `
            ${this.layerSlider('cloudAmt', '云量', 0, 1, 0.01)}
            ${this.layerSlider('cloudShadow', '云影', 0, 1, 0.01)}
            ${this.layerSlider('cloudHeight', '云层高度', 0.4, 2.4, 0.02)}
            <div class="note" id="cloudInfo">平面云 · 6 张云图平铺</div>
            <div class="note">平面云就是上一版的方案：几张半透明云图飘在天上，几乎不耗性能，代价是没有体积感。卡的时候切这一档。</div>` : `
            <div class="btn-row">
              <button class="btn ${this._placing ? 'on' : ''}" data-act="cloudPlace">放置云团</button>
              <button class="btn" data-act="cloudScatter">随机撒云</button>
              <button class="btn" data-act="cloudClear">清空</button>
            </div>
            ${this.layerSlider('cloudAmt', '云量', 0, 1, 0.01)}
            ${this.layerSlider('cloudShadow', '云影', 0, 1, 0.01)}
            ${this.layerSlider('cloudHeight', '云层高度', 0.4, 2.4, 0.02)}
            ${this.layerSlider('cloudSteps', '采样步数', 0.25, 1, 0.01)}
            <div class="note" id="cloudInfo">体积云 · 噪声已预烘焙</div>
            <div class="note">密度场改用预烘焙 3D 噪声（单步 1 次采样），比上一版轻一个量级。仍卡就降低「采样步数」或切「平面云」。</div>`}
        </div>
      </div>

      <div class="lgrp">
        <div class="lgrp-hd">
          <span class="lgrp-t">画框与经纬网</span>
          <span class="switch"><input type="checkbox" data-layer="frameOn" ${this.layers.frameOn ? 'checked' : ''}><i></i></span>
        </div>
        <div class="lgrp-bd${this.layers.frameOn ? '' : ' dim'}">
          ${this.seg('frameStyle', '框体', FRAME_STYLES.map((s) => [s.key, s.label]), true)}
          ${this.seg('frameTone', '框带色', FRAME_TONES.map((t) => [t.key, t.label]), true)}
          ${this.layerSlider('frameW', '框宽', 0.02, 0.14, 0.002)}
          ${this.layerSlider('framePad', '内留白', 0, 0.06, 0.002)}
          ${this.layerSlider('frameLW', '线宽', 0.5, 2.5, 0.1, (v) => v.toFixed(1) + '×')}
          ${this.seg('frameCorner', '角饰', FRAME_CORNERS.map((c) => [c.key, c.label]), true)}
          ${this.layers.frameStyle === 'plate' ? this.layerToggle('frameTitle', '标题铭牌') : ''}
          ${this.layerToggle('graticule', '框内经纬网')}
          ${this.seg('gratStep', '间隔', FRAME_GRAT_STEP.map((g) => [g.key, g.label]), true)}
          ${this.layerSlider('gratOpacity', '网格浓度', 0.15, 1, 0.01, pct)}
          <div class="note">「内留白」是地形与内框线之间的距离；「框带色」可脱离风格单独定色。
            「铭牌框」会自动把下侧加宽放区域名与范围（需开标题铭牌）。经纬网只画在框带/框板上。</div>
        </div>
      </div>

      ${isletBlock}`;

    /* 性能：画质档 + 帧率显示 */
    const perf = `
      ${this.seg('quality', '画质档', [['high', '高'], ['mid', '中'], ['low', '低']])}
      <div class="row"><span class="row-lb w80">显示帧率</span>
        <span class="switch"><input type="checkbox" data-layer="showFps" ${this.layers.showFps ? 'checked' : ''}><i></i></span>
      </div>
      <div class="note">画质档同时影响：地形细分、渲染分辨率、阴影步进、体积云采样、界面刷新率。
      机身发烫或风扇狂转时切「中」；仍卡顿切「低」（关闭自阴影与体积云步进）。</div>`;

    const out = [
      this.seg('bgMode', '页面背景', [['theme', '主题'], ['plain', '素色'], ['off', '关闭']]),
      this.layers.bgMode === 'plain'
        ? this.swatches('bgColor', '素色', ['#ffffff', '#f6f4ec', '#e9ebea', '#dfe3e6', '#14171c'])
        : '',
      this.slider('depth'),
      this.toggle('shadowPlane', '落地投影'),
      '<div class="note">「页面背景」＝地图以外那片底：主题＝跟风格渐变（可叠加遥感底图），素色＝单色出图（自动关掉底图），关闭＝透明。地图外不再铺海面。</div>'
    ].join('');

    const info = this.info || '<div class="note">—</div>';

    this.root.innerHTML = `
      <div class="sec"><div class="sec-hd" style="cursor:default">
        <h3 style="letter-spacing:.02em">${s.label}</h3>
        <span class="note" style="font-size:9.5px">${s.sub}</span>
      </div></div>
      ${this.section('配色', `<div class="pal-row">${palRow}</div>`)}
      ${this.section('光照与阴影', light)}
      ${this.section('地形与线条', geo)}
      ${this.section('性能', perf)}
      ${this.section('图层', layers)}
      ${this.section('动画与轨迹', anim)}
      ${this.section('底板与输出', out)}
      ${this.section('数据', `<div class="note" id="infoBox">${info}</div>`)}
    `;
    this.bind();
    this.sync(this.params);
  }

  /** 云团计数等运行期状态（由外部写入） */
  setCloudInfo(text) {
    this._cloudInfo = text;
    const el = this.root.querySelector('#cloudInfo');
    if (el && text) el.textContent = text;
  }

  setState({ drawing, follow, speed, placing }) {
    if (drawing !== undefined) this._drawing = drawing;
    if (follow !== undefined) this._follow = follow;
    if (speed !== undefined) this._speed = speed;
    if (placing !== undefined) this._placing = placing;
  }

  bind() {
    const root = this.root;
    root.querySelectorAll('.sec-hd').forEach((hd) => {
      hd.addEventListener('click', () => {
        const sec = hd.parentElement;
        if (hd.style.cursor === 'default') return;
        const title = sec.dataset.sec;
        sec.classList.toggle('collapsed');
        if (sec.classList.contains('collapsed')) this.collapsed.add(title);
        else this.collapsed.delete(title);
      });
    });
    root.querySelectorAll('input.slider').forEach((el) => {
      el.addEventListener('input', () => {
        const k = el.dataset.k;
        const lk = el.dataset.lnum;
        const v = parseFloat(el.value);
        el.style.setProperty('--p', ((v - el.min) / (el.max - el.min) * 100) + '%');
        if (lk) {
          const out = root.querySelector(`[data-lv="${lk}"]`);
          if (out) out.textContent = (FMT[lk] || ((x) => x))(v);
          this.layers[lk] = v;
          this.onLayer(lk, v);
          return;
        }
        const out = root.querySelector(`[data-v="${k}"]`);
        if (out) out.textContent = (FMT[k] || ((x) => x))(v);
        if (k === '_speed') { this._speed = v; this.onChange('speed', v); return; }
        this.params[k] = v;
        this.onChange(k, v);
      });
    });
    root.querySelectorAll('input[type=checkbox][data-k]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.k;
        this.params[k] = el.checked ? 1 : 0;
        this.onChange(k, this.params[k]);
      });
    });
    root.querySelectorAll('input[type=checkbox][data-layer]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.layer;
        this.layers[k] = el.checked;
        this.syncLayer(k);
        this.onLayer(k, el.checked);
      });
    });
    root.querySelectorAll('select[data-lsel]').forEach((el) => {
      el.addEventListener('change', () => {
        const k = el.dataset.lsel;
        this.layers[k] = el.value;
        this.onLayer(k, el.value);
      });
    });
    root.querySelectorAll('[data-lchip]').forEach((el) => {
      el.addEventListener('click', () => {
        const k = el.dataset.lchip;
        this.layers.labelStyle = k;
        root.querySelectorAll('[data-lchip]').forEach((b) => b.classList.toggle('on', b.dataset.lchip === k));
        this.onLayer('labelStyle', k);
      });
    });
    root.querySelectorAll('[data-swatch]').forEach((el) => {
      el.addEventListener('click', () => {
        const k = el.dataset.swatch, c = el.dataset.c;
        this.layers[k] = c;
        root.querySelectorAll(`[data-swatch="${k}"]`).forEach((b) => b.classList.toggle('on', b.dataset.c === c));
        this.onLayer(k, c);
      });
    });
    root.querySelectorAll('[data-seg]').forEach((el) => {
      el.addEventListener('click', () => {
        const k = el.dataset.seg;
        const raw = el.dataset.v;
        const v = /^-?\d+(\.\d+)?$/.test(raw) ? parseFloat(raw) : raw;
        this.layers[k] = v;
        root.querySelectorAll(`[data-seg="${k}"]`).forEach((b) => b.classList.toggle('on', b.dataset.v === raw));
        this.onLayer(k, v);
      });
    });
    root.querySelectorAll('[data-lalign]').forEach((el) => {
      el.addEventListener('click', () => {
        this._lalign = el.dataset.lalign;
        root.querySelectorAll('[data-lalign]').forEach((b) => b.classList.toggle('on', b === el));
        this.onLayer('labelAlign', el.dataset.lalign);
      });
    });
    root.querySelectorAll('.pal').forEach((el) => {
      el.addEventListener('click', () => this.onPalette(parseInt(el.dataset.pal, 10)));
    });
    root.querySelectorAll('[data-act]').forEach((el) => {
      el.addEventListener('click', () => this.onAction(el.dataset.act));
    });
  }
}
