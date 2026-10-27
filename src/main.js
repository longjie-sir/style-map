/* ============================================================
   主程序
   ============================================================ */
import { TerrainView } from './scene/terrain.js';
import { Track } from './scene/track.js';
import { MiniMap } from './scene/minimap.js';
import { Panel } from './ui/panel.js';
import { RegionPicker } from './ui/regionPicker.js';
import { STYLES, STYLE_MAP } from './scene/palettes.js';
import { loadRegion, loadGeoJSON, LIMIT } from './geo/regions.js';
import { Labels } from './scene/labels.js';
import { Frame } from './scene/frame.js';
import * as THREE from 'three';
import { Backdrop } from './scene/backdrop.js';
import { Water } from './scene/water.js';
import { Clouds } from './scene/clouds.js';
import { loadDem } from './geo/dem.js';
import { childrenOf, levelOf } from './geo/admin.js';

const $ = (id) => document.getElementById(id);
const raf = () => new Promise((r) => requestAnimationFrame(() => r()));

const state = { styleKey: 'hypo', palIndex: 0, code: 330000, drawing: false, region: null, dem: null };
const curStyle = () => STYLE_MAP[state.styleKey];
const curPal = () => {
  const s = curStyle();
  state.palIndex = Math.min(state.palIndex, s.palettes.length - 1);
  return s.palettes[state.palIndex];
};

const view = new TerrainView($('stage'));
view.params._speed = 0.16;
const track = new Track(view);
track.speed = 0.16;

/* ---------------- 图层 ---------------- */
const labels = new Labels(view, $('labels'));
const frame = new Frame(view);
const backdrop = new Backdrop(view);
const water = new Water(view);
const clouds = new Clouds(view, view);
view.waterRef = water;      // 垂直夸张变化时由 terrain 通知水面同步 uniform
view.cloudRef = clouds;
view.frameRef = frame;      // 取景时把画框板一起算进包围盒

const layers = {
  labels: true, labelStyle: 'song', labelScale: 1, labelProv: true, labelCity: true, labelCounty: false,
  labelWeight: 700, labelSpacing: 0.16, labelColor: '#ffffff',
  labelOutline: 1, labelOutlineW: 3, labelOutlColor: '#101010', labelOutlAlpha: 0.92,
  labelLift: 0.4, labelFade: 1, labelMax: 26, labelAlign: 'center',
  // 画框：经纬网只能画在框里，所以两者绑在一组
  frameOn: true, frameStyle: 'mat', frameW: 0.06, framePad: 0.022,
  frameLW: 1, frameTone: 'auto', frameCorner: 'bracket', frameTitle: true,
  graticule: true, gratOpacity: 0.82, gratStep: 'auto',
  // 遥感底图：默认显示（地图以外那圈是离线烘焙的中国遥感影像）。
  // 「素色 / 关闭」页面背景下它会自动隐藏 —— 出图时不能有影像盖住底色。
  backdrop: true, backdropOpacity: 1,
  water: true, waterLakes: true, waterRivers: true,
  clouds: false, cloudMode: 'volume', cloudAmt: 0.5, cloudShadow: 0.55, cloudHeight: 1, cloudSteps: 0.62,
  // 页面背景（地图以外的底）
  bgMode: 'theme', bgColor: '#ffffff',
  // 远岛 / 飞地（三沙岛礁、沿海离岛）：没有 DEM，只画边界。
  // isletView 只影响取景：main = 按主体取景（本岛看得清），all = 连离岛一起框进来
  islets: true, isletView: 'main',
  quality: view.quality, showFps: 0,
  flyH: 0.1, showLine: true, loop: true
};
let waterBuilt = false, cloudsBuilt = false;

let minimap = null;
let panel = null;
let ready = false;

/* ---------------- 顶栏风格 tab ---------------- */
const tabsEl = $('styleTabs');
STYLES.forEach((s) => {
  const b = document.createElement('button');
  b.className = 'style-tab' + (s.key === state.styleKey ? ' on' : '');
  b.dataset.k = s.key;
  b.textContent = s.label;
  b.title = s.sub;
  b.addEventListener('click', () => switchStyle(s.key));
  tabsEl.appendChild(b);
});
function syncTabs() {
  tabsEl.querySelectorAll('.style-tab').forEach((el) => el.classList.toggle('on', el.dataset.k === state.styleKey));
}

/* ---------------- 图层快捷开关（左侧竖排） ---------------- */
const RAIL = [
  { k: 'labels', t: '行政区名称', svg: '<path d="M4 18 8.6 6l4.6 12"/><path d="M5.7 14.2h5.8"/><path d="M16 18V9.4h2.6a2.3 2.3 0 0 1 0 4.6H16"/>' },
  { k: 'water', t: '水面（河湖）', svg: '<path d="M2.5 8.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/><path d="M2.5 13c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/><path d="M2.5 17.5c2 0 2-1.6 4-1.6s2 1.6 4 1.6 2-1.6 4-1.6 2 1.6 4 1.6"/>' },
  { k: 'clouds', t: '云层', svg: '<path d="M7 18h9.5a3.5 3.5 0 0 0 .3-6.98A5 5 0 0 0 7.2 9.6 4.2 4.2 0 0 0 7 18z"/>' },
  { k: 'frameOn', t: '画框与经纬网', svg: '<rect x="3" y="3.5" width="18" height="17" rx="1"/><rect x="6.6" y="7" width="10.8" height="10"/><path d="M12 3.5v3.5M3 12h3.6M17.4 12H21M12 17v3.5"/>' },
  { k: 'backdrop', t: '背景底图', svg: '<path d="m3 7 6-2 6 2 6-2v12l-6 2-6-2-6 2z"/><path d="M9 5v12M15 7v12"/>' }
];
const railEl = $('layRail');
RAIL.forEach((it) => {
  const b = document.createElement('button');
  b.className = 'rail-btn' + (layers[it.k] ? ' on' : '');
  b.dataset.rail = it.k;
  b.title = `${layers[it.k] ? '隐藏' : '显示'}${it.t}`;
  b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${it.svg}</svg>`;
  b.addEventListener('click', () => {
    layers[it.k] = !layers[it.k];
    applyLayer(it.k, layers[it.k]);
  });
  railEl.appendChild(b);
});
function syncRail(k) {
  const b = railEl.querySelector(`[data-rail="${k}"]`);
  if (!b) return;
  b.classList.toggle('on', !!layers[k]);
  const it = RAIL.find((r) => r.k === k);
  if (it) b.title = `${layers[k] ? '隐藏' : '显示'}${it.t}`;
  if (panel) panel.syncLayer(k);
}

/* ---------------- 面板 ---------------- */
panel = new Panel($('panel'), {
  layers,                       // 必须在构造时就给，否则首屏滑块会落到 min 值
  onChange: (k, v) => {
    if (k === 'speed') { track.speed = v; return; }
    if (k === 'snow') view.params.snowAuto = 0;   // 手动动过雪线就不再自动判断
    view.setParam(k, v);
    if (k === 'depth') frame.apply({});            // 底座厚度变了，画框板要跟着落到新的底面
  },
  onPalette: (i) => {
    state.palIndex = i;
    view.setStyle(curStyle(), curPal(), false);
    panel.setStyle(curStyle(), view.params, state.palIndex);
    panel.setState({ drawing: state.drawing, follow: track.follow, speed: track.speed });
  },
  onAction: (act) => {
    if (act === 'grow') { view.startGrowth(); toast('地形生长'); }
    else if (act === 'resetview') view.frameCamera();
    else if (act === 'preset') { track.preset(); if (track.pts.length > 1) { track.play(); toast('示例轨迹播放中'); } }
    else if (act === 'clear') { track.clear(); setDrawing(false); }
    else if (act === 'draw') { setDrawing(!state.drawing); }
    else if (act === 'play') { if (!track.play()) toast('请先绘制至少两个轨迹节点，或使用「示例轨迹」'); }
    else if (act === 'follow') setFollow(!track.follow);
    else if (act === 'uploadWater') $('waterInput').click();
    else if (act === 'cloudPlace') setPlaceCloud(!layers.cloudPlace);
    else if (act === 'cloudScatter') {
      if (!layers.clouds) { layers.clouds = true; panel.setLayers(layers); applyLayer('clouds', true); }
      const n = clouds.scatter(5);
      clouds.setTheme(curStyle());
      clouds.setParams({ amount: layers.cloudAmt, shadow: layers.cloudShadow, height: layers.cloudHeight, steps: layers.cloudSteps });
      syncCloudInfo();
      toast(`已撒 ${n} 团云`);
    }
    else if (act === 'cloudClear') { clouds.clear(); syncCloudInfo(); toast('已清空云团'); }
  },
  onLayer: (k, v) => {
    layers[k] = v;
    applyLayer(k, v);
  }
});

/* 沿线飞行：进入时不禁用轨道控制 —— 相机跟着飞行器走，但鼠标仍可绕它旋转视角。
   代价是必须禁掉平移（否则 target 会被推走、跟随即失效），并把距离范围收窄。 */
function setFollow(on) {
  const c = view.controls;
  track.follow = on;
  track._camInit = false;
  view.following = on;                    // terrain.update 里跳过 target 的范围内钳制
  if (on) {
    if (track.pts.length < 2) track.preset();
    if (view.region) {
      const span = Math.max(view.region.spanX, view.region.spanY);
      c.minDistance = Math.max(2, span * 0.02);
      c.maxDistance = span * 0.95;
    }
    c.enablePan = false;
    track.play();
    track.initFollowCam();
    toast('沿线飞行：左键拖动换视角 · 滚轮调远近');
  } else {
    if (view.region) {
      const span = Math.max(view.region.spanX, view.region.spanY);
      c.minDistance = span * 0.14;
      c.maxDistance = span * 3.4;
    }
    c.enablePan = true;
    toast('已退出飞行');
  }
  c.enabled = true;
  panel.setState({ follow: on });
  panel.render();
}

function switchStyle(key) {  state.styleKey = key;
  state.palIndex = 0;
  const s = curStyle();
  view.setStyle(s, curPal(), true);
  panel.setStyle(s, view.params, 0);
  panel.setState({ drawing: state.drawing, follow: track.follow, speed: track.speed });
  panel.setLayers(layers);
  syncTabs();
  themeLayers(s);
  setTimeout(() => {
    if (minimap) minimap.update(view, true);
  }, 60);
}

/* ---------------- 图层 ---------------- */
function themeLayers(style) {
  water.setTheme(style);
  clouds.setTheme(style);
  if (layers.backdrop) backdrop.setTheme(style);
  applyFrame();               // 画框与经纬网的颜色跟着风格走
  view.applyWallColor();
}
async function rebuildWater() {
  if (!view.region) return;
  try {
    await water.build(view.region, { builtin: true });
    waterBuilt = true;
    water.setVisible(layers.water);
    water.setLayers({ showLakes: layers.waterLakes, showRivers: layers.waterRivers });
    water.setTheme(curStyle());
    const s = water.stats || {};
    const uu = (s.userLake || 0) + (s.userRiver || 0);
    const txt = `湖泊 ${s.lakeFeat || 0} · 河流 ${s.riverFeat || 0}` + (uu ? ` · 自定义 ${uu}` : '');
    panel.setWaterInfo(txt);
  } catch (e) {
    console.warn(e);
    panel.setWaterInfo('内置水数据加载失败，可直接上传 GeoJSON');
  }
}

function applyLayer(k, v) {
  switch (k) {
    case 'labels': case 'labelStyle': case 'labelProv': case 'labelCity': case 'labelCounty':
    case 'labelScale': case 'labelWeight': case 'labelSpacing': case 'labelColor':
    case 'labelOutline': case 'labelOutlineW': case 'labelOutlColor': case 'labelOutlAlpha':
    case 'labelLift': case 'labelFade': case 'labelMax':
      labels.setOptions({
        on: layers.labels, style: layers.labelStyle, scale: layers.labelScale,
        prov: layers.labelProv, city: layers.labelCity, county: layers.labelCounty,
        weight: layers.labelWeight, spacing: layers.labelSpacing, color: layers.labelColor,
        outline: layers.labelOutline, outlineW: layers.labelOutlineW,
        outlColor: layers.labelOutlColor, outlAlpha: layers.labelOutlAlpha,
        lift: layers.labelLift, fade: layers.labelFade, maxCount: layers.labelMax,
        align: layers.labelAlign
      });
      if (layers.labels && layers.labelCounty) loadCountyLabels();
      $('btnLabels').classList.toggle('on', layers.labels);
      break;
    case 'graticule':
      // 经纬网只存在于画框里：没有框就先立一个框，再显示网格
      if (v && !layers.frameOn) {
        layers.frameOn = true;
        if (panel) panel.syncLayer('frameOn');
        toast('经纬网需要画框承载，已自动启用画框');
      }
      applyFrame();
      break;
    case 'frameOn':
      applyFrame();
      break;
    case 'frameStyle':
      layers.frameStyle = v;
      if (!layers.frameOn) { layers.frameOn = true; if (panel) panel.syncLayer('frameOn'); }
      applyFrame();
      // 「铭牌框」才有标题开关，切框体要重绘面板
      if (panel) panel.render();
      break;
    case 'frameW':
    case 'framePad':
    case 'frameLW':
    case 'frameTone':
    case 'frameCorner':
    case 'frameTitle':
    case 'gratStep':
    case 'gratOpacity':
      if (!layers.frameOn && k !== 'frameTitle') {
        layers.frameOn = true;
        if (panel) panel.syncLayer('frameOn');
      }
      applyFrame();
      break;
    case 'bgMode':
      // 「素色 / 关闭」是出图用的：必须把遥感底图一起关掉，
      // 否则画布上那层半透明影像盖住页面底色，看起来像"改了没反应"
      view.setPageBg(v, layers.bgColor);
      applyBackdrop();
      panel.render();
      break;
    case 'bgColor':
      view.setPageBg(layers.bgMode, v);
      break;
    case 'backdrop':
      // 「素色 / 关闭」背景下底图会被强制隐藏，此时点开关等于没反应 ——
      // 直接把背景切回「主题」，并说清楚为什么
      if (v && layers.bgMode !== 'theme') {
        layers.bgMode = 'theme';
        view.setPageBg('theme', layers.bgColor);
        applyBackdrop();
        if (panel) panel.render();
        toast('已切回「主题」背景，遥感底图才能显示');
        break;
      }
      applyBackdrop();
      break;
    case 'backdropOpacity':
      backdrop.setOpacity(v);
      break;
    case 'islets':
      view.setShowIslets(v);
      break;
    case 'isletView':
      // 取景范围：主图 / 含离岛。只改相机，不动地形
      layers.isletView = v;
      view.frameCamera(v === 'all');
      break;
    case 'water':
      water.setVisible(v);
      if (v && !waterBuilt) rebuildWater();
      break;
    case 'waterLakes': case 'waterRivers':
      water.setLayers({ showLakes: layers.waterLakes, showRivers: layers.waterRivers });
      break;
    case 'clouds':
      if (v && !cloudsBuilt) {
        clouds.setMode(layers.cloudMode);
        clouds.setTheme(curStyle());
        clouds.setParams({ amount: layers.cloudAmt, shadow: layers.cloudShadow, height: layers.cloudHeight, steps: layers.cloudSteps });
        cloudsBuilt = true;
      }
      clouds.setVisible(v);
      syncCloudInfo();
      break;
    case 'cloudMode':
      clouds.setMode(v);
      clouds.setTheme(curStyle());
      clouds.setParams({ amount: layers.cloudAmt, shadow: layers.cloudShadow, height: layers.cloudHeight, steps: layers.cloudSteps });
      clouds.setVisible(layers.clouds);
      panel.render();
      syncCloudInfo();
      break;
    case 'cloudAmt': clouds.setParams({ amount: v }); break;
    case 'cloudShadow': clouds.setParams({ shadow: v }); break;
    case 'cloudHeight': clouds.setParams({ height: v }); break;
    case 'cloudSteps': clouds.setParams({ steps: v }); break;
    case 'cloudPlace':
      setPlaceCloud(!!v);
      break;
    case 'cloudClear':
      clouds.clear(); toast('已清空云团'); syncCloudInfo();
      break;
    case 'quality':
      view.setQuality(v);
      clouds.setQuality(v);
      // 低画质档把体积云自动降成平面云：raymarch 是排在填色之后的第二大逐像素开销，
      // 弱机上留着它，飞行一定卡。想要体积云可以手动切回去。
      if (v === 'low' && layers.cloudMode === 'volume') {
        layers.cloudMode = 'plane';
        clouds.setMode('plane');
        clouds.setTheme(curStyle());
        clouds.setParams({ amount: layers.cloudAmt, shadow: layers.cloudShadow, height: layers.cloudHeight, steps: layers.cloudSteps });
        clouds.setVisible(layers.clouds);
        if (panel) panel.render();
      }
      toast(`画质档：${{ high: '高', mid: '中', low: '低' }[v] || v}`);
      break;
    case 'showFps':
      $('fps').classList.toggle('show', !!v);
      break;
    case 'labelOutline':
      labels.setOptions({ outline: v });
      break;
    case 'labelAlign':
      labels.setOptions({ align: v });
      break;
    case 'quality':
      break;    // 已在上面处理
    case 'flyH': track.setFlyHeight(v); break;
    case 'showLine': track.setShowLine(v); break;
    case 'loop': track.loop = v; break;
  }
  if (['labels', 'water', 'clouds', 'graticule', 'frameOn', 'backdrop'].includes(k)) syncRail(k);
}

/** 背景底图：只有「主题」背景才允许出现遥感影像 */
function applyBackdrop() {
  const on = !!layers.backdrop && layers.bgMode === 'theme';
  backdrop.setVisible(on);
  if (on && !backdrop.mesh && view.region) backdrop.build(view.region, curStyle());
  syncRail('backdrop');
}

/** 画框 / 经纬网统一入口（样式、框宽、浓度、主题任一变化都走这里） */
function applyFrame() {
  const on = !!layers.frameOn;
  if (on && !frame.mesh && view.region) frame.build(view.region);
  frame.apply({
    on,
    style: layers.frameStyle,
    width: layers.frameW,
    pad: layers.framePad,
    lw: layers.frameLW,
    tone: layers.frameTone,
    corner: layers.frameCorner,
    title: layers.frameTitle,
    step: layers.gratStep,
    grat: !!layers.graticule && on,
    alpha: layers.gratOpacity,
    theme: curStyle()
  });
  syncRail('frameOn');
}

/** 省级视图补齐县级名称：只拉一次，重复调用直接返回 */
let countyLoading = false;
function loadCountyLabels() {
  const r = view.region;
  if (!r || !layers.labels || !layers.labelCounty) return;
  if (levelOf(r.id) !== 1 || !(r.children || []).length) return;
  if (countyLoading || r._countyLoaded) return;
  countyLoading = true;
  const self = r;
  Promise.all(r.children.map((c) => childrenOf(c.code)))
    .then((groups) => {
      countyLoading = false;
      if (view.region !== self) return;           // 期间已切换区域，丢弃
      const all = groups.reduce((a, b) => a.concat(b), []);
      self._countyLoaded = true;
      labels.appendBelow(all);
      if (all.length) toast(`已补充 ${all.length} 个县级名称`);
    })
    .catch(() => { countyLoading = false; });
}

function rebuildLayers() {
  const r = view.region;
  if (!r) return;
  labels.setRegion(r);
  labels.setOptions(labelOpts());
  loadCountyLabels();

  // 画框：换区域 = 四至变了，整块重建
  frame.dispose();
  if (layers.frameOn) frame.build(r);
  applyFrame();

  if (layers.backdrop) backdrop.build(r, curStyle());
  backdrop.setOpacity(layers.backdropOpacity);
  applyBackdrop();

  waterBuilt = false;
  water.dispose();
  water.setVisible(layers.water);
  if (layers.water) rebuildWater();

  // 云：清掉旧云团（旧云按上一区域的跨度算过尺寸），若开着就重新撒
  clouds.clear();
  cloudsBuilt = false;
  clouds.setMode(layers.cloudMode);
  clouds.setTheme(curStyle());
  clouds.setParams({ amount: layers.cloudAmt, shadow: layers.cloudShadow, height: layers.cloudHeight, steps: layers.cloudSteps });
  clouds.setQuality(layers.quality);
  clouds.setVisible(layers.clouds);
  cloudsBuilt = true;
  syncCloudInfo();

  track.setShowLine(layers.showLine);
  track.loop = layers.loop;
  track.setFlyHeight(layers.flyH);
}

/** 标注参数打包（多处复用，避免漏项） */
function labelOpts() {
  return {
    on: layers.labels, style: layers.labelStyle, scale: layers.labelScale,
    prov: layers.labelProv, city: layers.labelCity, county: layers.labelCounty,
    weight: layers.labelWeight, spacing: layers.labelSpacing, color: layers.labelColor,
    outline: layers.labelOutline, outlineW: layers.labelOutlineW,
    outlColor: layers.labelOutlColor, outlAlpha: layers.labelOutlAlpha,
    lift: layers.labelLift, fade: layers.labelFade, maxCount: layers.labelMax,
    align: layers.labelAlign
  };
}

function syncCloudInfo() {
  const txt = clouds.mode === 'plane'
    ? `平面云 · ${clouds.sheets.length} 张云图`
    : `已放置 ${clouds.puffs.length} 团 · 体积云 raymarch`;
  panel.setCloudInfo(txt);
}

/** 「放置云」模式：在地形上点一下落一团云 */
function setPlaceCloud(on) {
  layers.cloudPlace = on;
  panel.setState({ placing: on });
  const hint = $('hint');
  hint.textContent = on
    ? '在地形上单击放置云团 · 再次点击「放置云团」结束'
    : '拖拽旋转 · 滚轮缩放 · 右键平移 · 双击聚焦';
  hint.classList.remove('fade');
  view.renderer.domElement.style.cursor = on ? 'crosshair' : 'grab';
  if (on && !layers.clouds) { layers.clouds = true; panel.setLayers(layers); applyLayer('clouds', true); }
  panel.render();
  panel.setState({ placing: on, drawing: state.drawing, follow: track.follow, speed: track.speed });
}

function setDrawing(on) {
  state.drawing = on;
  panel.setState({ drawing: on });
  const hint = $('hint');
  hint.textContent = on ? '在地形上单击添加轨迹节点 · 再次点击「绘制轨迹」结束' : '拖拽旋转 · 滚轮缩放 · 右键平移 · 双击聚焦';
  hint.classList.remove('fade');
  view.renderer.domElement.style.cursor = on ? 'crosshair' : 'grab';
  panel.render();
  panel.setState({ drawing: on, follow: track.follow, speed: track.speed });
}

/* ---------------- 区域选择 ---------------- */
const picker = new RegionPicker({
  onPick: (it, lv) => {
    $('regionMenu').classList.remove('open');
    load(it.code, it.name);
  }
});
picker.render();

$('regionBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('regionMenu').classList.toggle('open');
  if ($('regionMenu').classList.contains('open')) picker.render();
});
document.addEventListener('click', (e) => {
  // 菜单内部点选会触发列表重绘，被点的按钮在事件冒泡到这里时已经脱离 DOM，
  // 此时 contains() 判定为 false 会把菜单误关掉（之前「点了就收起」的根因之一）
  if (!e.target.isConnected) return;
  if (!$('regionMenu').contains(e.target) && !$('regionBtn').contains(e.target)) $('regionMenu').classList.remove('open');
});

$('btnUpload').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  $('regionMenu').classList.remove('open');
  try {
    const text = await f.text();
    const json = JSON.parse(text);
    const name = f.name.replace(/\.(geojson|json)$/i, '');
    await mount(() => loadGeoJSON(json, name), name);
  } catch (err) {
    toast('边界文件解析失败：' + err.message);
  }
  e.target.value = '';
});

$('btnFull').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});

/* 水面矢量上传（WGS84 GeoJSON：面=水面，线=河道） */
$('waterInput').addEventListener('change', async (e) => {
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    water.setUserData(json);
    layers.water = true;
    panel.setLayers(layers);
    panel.render();
    await rebuildWater();
    toast('水面矢量已叠加');
  } catch (err) {
    toast('水面文件解析失败：' + err.message);
  }
  e.target.value = '';
});
$('btnReset').addEventListener('click', () => view.frameCamera());
$('viewPreset').addEventListener('change', (e) => view.setViewPreset(e.target.value));
$('btnPanel').addEventListener('click', () => {
  $('panel').classList.toggle('hide');
  $('btnPanel').classList.toggle('on');
});
$('btnLabels').addEventListener('click', () => {
  layers.labels = !layers.labels;
  $('btnLabels').classList.toggle('on', layers.labels);
  panel.syncLayer('labels');
  applyLayer('labels', layers.labels);
  toast(layers.labels ? '名称标注已显示' : '名称标注已隐藏');
});
$('btnCoffee').addEventListener('click', () => toast(curStyle().sub));
document.addEventListener('fullscreenchange', () => setTimeout(() => view.resize(), 120));

/* ---------------- 载入流程 ---------------- */
function setStage(text, p) {
  $('loaderStage').textContent = text;
  $('loaderBar').style.width = Math.round(p * 100) + '%';
}
function showLoader() {
  $('loader').classList.remove('done');
  setStage('读取行政区划边界…', 0.04);
}
function hideLoader() {
  $('loader').classList.add('done');
}

/** 等生长动画基本完成（最多等 cap 毫秒，避免掉帧环境下卡住流程） */
function waitGrowth(min = 0.985, cap = 2200) {
  return new Promise((res) => {
    const t0 = performance.now();
    const tick = () => {
      if (view.growth >= min || performance.now() - t0 > cap) return res();
      requestAnimationFrame(tick);
    };
    tick();
  });
}

async function mount(makeRegion, label) {
  showLoader();
  ready = false;
  try {
    const region = await makeRegion();
    setStage('获取 90m DEM 高程瓦片…', 0.12);
    await raf();
    const dem = await loadDem(region, {
      onProgress: (d, t) => setStage(`拼接 DEM 瓦片 ${d}/${t}`, 0.12 + 0.6 * (d / t))
    });
    setStage('构建地形网格与侧壁…', 0.78);
    await raf();
    view.setRegion(region, dem);
    // 远岛数量交给面板决定「离岛与飞地」分组是否出现；切换区域后取景回到「主图」
    layers.isletCount = view.isletCount || 0;
    layers.isletView = 'main';
    view.setShowIslets(layers.islets);
    view.setStyle(curStyle(), curPal(), true);
    panel.setStyle(curStyle(), view.params, state.palIndex);
    panel.setLayers(layers);
    panel.setState({ drawing: state.drawing, follow: track.follow, speed: track.speed });
    panel.setInfo(infoHtml(region, dem));
    track.clear();
    rebuildLayers();
    if (minimap) minimap.setRegion(region);
    $('regionName').textContent = region.name;
    picker.setCurrent(region.id, region.name);
    state.region = region; state.dem = dem;
    $('sbRange').textContent = `范围 ${(region.spanX).toFixed(0)}×${(region.spanY).toFixed(0)} km · 面积 ${(region.area / 10000).toFixed(1)} 万 km²`;
    // 等地形长满再撤遮罩：否则第一眼看到的是「压扁的地形 + 浮在半空的标注」，
    // 会被当成「没居中 / 标注对不上」，这正是之前反馈的问题根源
    setStage('地形生长…', 0.96);
    await waitGrowth();
    view.frameCamera();          // 长满后按最终高程复核一次取景（幂等）
    setStage('完成', 1);
    await raf();
    // 有离岛时主动提一句：这些岛礁落在主图取景之外，不说的话用户会以为"没加载出来"
    setTimeout(() => {
      hideLoader();
      if (layers.isletCount > 0) {
        toast(`另有 ${layers.isletCount} 处离岛 / 飞地，已按边界显示 · 面板「图层 → 离岛与飞地」可切「含离岛」全景`);
      }
    }, 200);
    ready = true;
    setTimeout(() => $('hint').classList.add('fade'), 7000);
  } catch (err) {
    hideLoader();
    toast(err.code === 'OUT_OF_RANGE' ? err.message : '载入失败：' + err.message);
    console.error(err);
  }
}

function infoHtml(region, dem) {
  return `<div style="display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-family:var(--mono);font-size:9.5px;color:var(--ink-2)">
    <span style="color:var(--ink-3)">名称</span><span>${region.name}</span>
    <span style="color:var(--ink-3)">面积</span><span>${(region.area / 10000).toFixed(2)} 万 km²</span>
    <span style="color:var(--ink-3)">跨度</span><span>${region.spanX.toFixed(0)} × ${region.spanY.toFixed(0)} km</span>
    <span style="color:var(--ink-3)">DEM</span><span>z${dem.zoom} · 约 ${dem.elevRes.toFixed(0)} m/px</span>
    <span style="color:var(--ink-3)">高程</span><span>${dem.min.toFixed(0)} ~ ${dem.max.toFixed(0)} m</span>
    <span style="color:var(--ink-3)">网格</span><span>${dem.N}² 高度场 / 512² 地形</span>
  </div>
  <div style="margin-top:8px" class="note">边界：阿里云 DataV（GCJ-02）· 高程：Terrarium 90m 级 · 已做 GCJ→WGS84 偏移校正</div>`;
}

function load(code, name) {
  state.code = code;
  state.palIndex = 0;
  mount(() => loadRegion(code, name));
}

/* ---------------- 小地图 ---------------- */
minimap = new MiniMap($('minimap'), {
  onPick: (lat, lng) => {
    if (!view.region) return;
    const w = view.lonLatToWorld(lng, lat);
    const t = view.controls.target;
    const dx = w.x - t.x, dz = w.z - t.z;
    t.x = w.x; t.z = w.z;
    view.camera.position.x += dx; view.camera.position.z += dz;
    view.controls.update();
  }
});

/* ---------------- 交互 ---------------- */
const dom = view.renderer.domElement;
let down = null;
dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
dom.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 5 || !ready) return;
  const r = dom.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hit = view.pick(nx, ny);
  if (!hit) return;
  if (layers.cloudPlace) {
    clouds.place(hit.lon, hit.lat);
    clouds.setTheme(curStyle());
    clouds.setParams({ amount: layers.cloudAmt, shadow: layers.cloudShadow, height: layers.cloudHeight, steps: layers.cloudSteps });
    syncCloudInfo();
    toast(`已放置云团 ${clouds.puffs.length}`);
    return;
  }
  if (state.drawing) {
    track.add(hit.lon, hit.lat);
    if (track.pts.length === 2) track.play();
    toast(`已添加节点 ${track.pts.length}`);
  }
});
dom.addEventListener('dblclick', (e) => {
  if (!ready) return;
  const r = dom.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hit = view.pick(nx, ny);
  if (!hit) return;
  const t = view.controls.target;
  const dx = hit.x - t.x, dz = hit.z - t.z;
  t.x = hit.x; t.z = hit.z;
  view.camera.position.x += dx; view.camera.position.z += dz;
  view.controls.update();
});

let lastMove = 0;
dom.addEventListener('pointermove', (e) => {
  if (!ready) return;
  const now = performance.now();
  if (now - lastMove < 70) return;
  lastMove = now;
  const r = dom.getBoundingClientRect();
  const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
  const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
  const hit = view.pick(nx, ny);
  if (hit) {
    $('sbLonLat').textContent = `${hit.lon.toFixed(4)}°E  ${hit.lat.toFixed(4)}°N`;
    $('sbElev').textContent = `高程 ${hit.h.toFixed(0)} m`;
  } else {
    $('sbLonLat').textContent = '—';
    $('sbElev').textContent = '—';
  }
});
dom.style.cursor = 'grab';

/* ---------------- 指北针 ---------------- */
const roseEl = $('compassRose');
let northAnim = null;
function faceNorth() {
  const cam = view.camera, t = view.controls.target;
  const off = cam.position.clone().sub(t);
  const dist = Math.hypot(off.x, off.z) || 1;
  const from = Math.atan2(off.x, off.z);
  let to = 0;
  // 走最短一圈
  if (from > Math.PI) to = Math.PI * 2;
  if (from < -Math.PI) to = -Math.PI * 2;
  const h = off.y;
  const t0 = performance.now(), dur = 640;
  if (northAnim) cancelAnimationFrame(northAnim);
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    const a = from + (to - from) * e;
    cam.position.set(t.x + Math.sin(a) * dist, t.y + h, t.z + Math.cos(a) * dist);
    cam.lookAt(t);
    view.controls.update();
    if (k < 1) northAnim = requestAnimationFrame(step);
    else northAnim = null;
  };
  step();
}
$('compass').addEventListener('click', faceNorth);

function updateCompass() {
  if (!roseEl) return;
  const cam = view.camera, t = view.controls.target;
  const dx = t.x - cam.position.x, dz = t.z - cam.position.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) return;
  const heading = Math.atan2(dx, -dz) * 180 / Math.PI;   // 顺时针，正北为 0
  roseEl.style.transform = `rotate(${(-heading).toFixed(1)}deg)`;
}

/* ---------------- 界面显隐 ---------------- */
let uiCamSave = null;
function setUIHidden(on) {
  document.body.classList.toggle('ui-hidden', on);
  $('btnHideUI').classList.toggle('on', on);
  // 隐藏界面后可用区变大（不再扣面板宽度），重新取景才不会留一大块空白 —— 出图用。
  // 恢复时把进「出图模式」前的机位还原，免得手调好的视角被吃掉。
  if (on) {
    uiCamSave = { p: view.camera.position.clone(), t: view.controls.target.clone() };
    setTimeout(() => { if (ready && state.region) view.frameCamera(); }, 300);
  } else if (uiCamSave) {
    view.camera.position.copy(uiCamSave.p);
    view.controls.target.copy(uiCamSave.t);
    view.controls.update();
    uiCamSave = null;
  }
  toast(on ? '已隐藏界面 · 按 H 恢复' : '界面已恢复');
  // 恢复按钮闲置 2.4s 后彻底淡出，保证截图里连按钮都不剩
  const btn = $('uiRestore');
  btn.classList.remove('idle');
  clearTimeout(restoreIdle);
  if (on) restoreIdle = setTimeout(() => btn.classList.add('idle'), 2400);
}
let restoreIdle = 0;
document.addEventListener('mousemove', () => {
  if (!document.body.classList.contains('ui-hidden')) return;
  const btn = $('uiRestore');
  btn.classList.remove('idle');
  clearTimeout(restoreIdle);
  restoreIdle = setTimeout(() => btn.classList.add('idle'), 2400);
});
$('btnHideUI').addEventListener('click', () => setUIHidden(true));
$('uiRestore').addEventListener('click', () => setUIHidden(false));

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input,textarea,select')) return;
  if (e.key === 'h' || e.key === 'H') setUIHidden(!document.body.classList.contains('ui-hidden'));
  if (e.key === 'n' || e.key === 'N') faceNorth();
});

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1900);
}

/* ---------------- 主循环 ---------------- */
const clock = { last: performance.now() };
let fpsN = 0, fpsT0 = performance.now();

/* 动态渲染倍率：相机在动（拖拽/飞行/聚焦）时降到 0.68×，停手 260ms 后回到满倍率。
   地形是 fill-bound，像素数和帧时间几乎成正比；运动中的清晰度下降没人看得见，
   停下来的一瞬间恢复满分辨率 —— 这是「拖起来顺、松手清晰」的常规做法。 */
const dynCam = new THREE.Vector3(1e9, 0, 0);
let dynLastMove = 0, dynSwitch = 0;
function updateRenderScale(now) {
  const cam = view.camera;
  const span = view.region ? Math.max(view.region.spanX, view.region.spanY) : 400;
  if (cam.position.distanceTo(dynCam) > span * 0.0006) {
    dynCam.copy(cam.position);
    dynLastMove = now;
  }
  // 只有「相机真的在动」才降分辨率：轨迹自己游走时相机是静止的，不该跟着降
  const busy = (now - dynLastMove < 260) || (track.follow && track.playing);
  const want = busy ? 0.68 : 1;
  if (now - dynSwitch > 320) {
    const cur = view._rs ?? 1;
    if (Math.abs(want - cur) > 0.01) {
      view.setRenderScale(want);
      dynSwitch = now;
    }
  }
}

function loop() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - clock.last) / 1000);
  clock.last = now;
  view.update(dt);
  track.update(dt, view.u.uTime.value);
  updateRenderScale(now);
  view.render();

  /* 下面这些是「界面层」的逐帧开销，按各自需要限流：
     - 标注投影要跟手，但 30Hz 足够（人眼看不出 60Hz 与 30Hz 的文字位移差）
     - 小地图 11Hz、水面/浮云 uniform 直接跟着帧走（只是写 uniform，很便宜）
     - 指北针 20Hz
     低配机把这些频率再砍一半，省下的是每帧 DOM 与三角函数开销。 */
  const lowQ = layers.quality === 'low';
  if (now - lastLabels > (lowQ ? 66 : 33)) { lastLabels = now; labels.update(); }
  clouds.update(dt, view.u.uTime.value);
  water.update(view.u.uTime.value);
  if (minimap) minimap.update(view);
  if (now - lastCompass > (lowQ ? 80 : 50)) { lastCompass = now; updateCompass(); }

  if (layers.showFps) {
    // 用固定间隔计帧：不能用累加的 dt（它被上限截断过，会把帧率算成固定值）
    fpsN++;
    if (now - fpsT0 > 500) {
      const f = Math.round(fpsN * 1000 / (now - fpsT0));
      $('fps').textContent = `${f} FPS · ${view.renderer.info.render.calls} 绘制`;
      fpsN = 0; fpsT0 = now;
    }
  }
  requestAnimationFrame(loop);
}
let lastLabels = 0, lastCompass = 0;
requestAnimationFrame(loop);
window.addEventListener('resize', () => {
  view.resize();
  if (minimap && minimap.map) minimap.map.invalidateSize();
});

/* ---------------- 启动 ---------------- */
setDrawing(false);
load(330000);

window.__app = {
  view, track, state, panel, layers,
  labels, frame, backdrop, water, clouds,
  pick: (code, name) => load(code, name),
  style: (k) => switchStyle(k),
  ui: (hidden) => setUIHidden(hidden),
  layer: (k, v) => { layers[k] = v; applyLayer(k, v); },
  north: () => faceNorth(),
  quality: (q) => { layers.quality = q; applyLayer('quality', q); },
  place: (lon, lat) => { clouds.place(lon, lat); syncCloudInfo(); },
  cloudN: () => clouds.puffs.length
};
