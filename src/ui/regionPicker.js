/* ============================================================
   区域选择器：省 / 市 / 县 三列联动
   ------------------------------------------------------------
   - 三列同时可见：左选省 → 中列出市 → 右列出县。想停在哪一级
     就在哪一级点，不用先「切进去」再往下降。
   - 点条目只记「将切换到哪里」，不动底图；底部「确定切换」才载入。
   - 双击条目 = 选中并立即确定（熟手路径）。
   - 缓存按父级 code 存，来回点不重复请求。
   ============================================================ */
import { childrenOf, levelOf } from '../geo/admin.js';
import { PROVINCES } from '../geo/regions.js';

const $ = (id) => document.getElementById(id);
const shortName = (n) => n.replace(/(省|市|自治区|特别行政区|壮族|回族|维吾尔|自治州|地区|盟)/g, '');

const COLS = [
  { id: 'rmProv', n: 'rmN1', lv: 1 },
  { id: 'rmCity', n: 'rmN2', lv: 2 },
  { id: 'rmCnty', n: 'rmN3', lv: 3 }
];

export class RegionPicker {
  constructor({ onPick }) {
    this.onPick = onPick;
    this.path = [];          // 已选链：[{code,name}, ...]，长度 = 选中层级
    this.current = null;     // 当前底图区域 code（用于标「当前」）
    this.cache = new Map();  // parentCode('root'|code) -> Promise<items>

    COLS.forEach((c) => {
      const el = $(c.id);
      el.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-code]');
        if (b) this.select(c.lv, { code: b.dataset.code, name: b.dataset.name });
      });
      el.addEventListener('dblclick', (e) => {
        const b = e.target.closest('button[data-code]');
        if (b) { this.select(c.lv, { code: b.dataset.code, name: b.dataset.name }); this.confirm(); }
      });
    });

    $('rmOk').addEventListener('click', () => this.confirm());
  }

  /* ---------- 数据 ---------- */
  load(parentCode) {
    const key = parentCode || 'root';
    if (!this.cache.has(key)) {
      this.cache.set(key, Promise.resolve(childrenOf(key === 'root' ? null : key)).catch(() => []));
    }
    return this.cache.get(key);
  }

  /* ---------- 渲染 ---------- */
  render() {
    // 省列：全量，随时可点
    this._fill(0, this.path[0]);
    this._fill(1, this.path[1]);
    this._fill(2, this.path[2]);
    this.renderConfirm();
  }

  async _fill(colIdx, sel) {
    const col = COLS[colIdx];
    const box = $(col.id);
    const cnt = $(col.n);
    const parent = colIdx === 0 ? null : (this.path[colIdx - 1] || {}).code;

    if (colIdx > 0 && !parent) {
      box.innerHTML = `<div class="rm-empty">先选${colIdx === 1 ? '省份' : '城市'}</div>`;
      cnt.textContent = '—';
      return;
    }

    const tk = (box._tk = (box._tk || 0) + 1);
    if (!box.children.length) box.innerHTML = '<div class="rm-empty">读取中…</div>';
    const list = await this.load(parent);
    if (tk !== box._tk) return;

    if (!list.length) {
      box.innerHTML = '<div class="rm-empty">该层级没有数据</div>';
      cnt.textContent = '0';
      return;
    }
    cnt.textContent = String(list.length);
    const selCode = sel ? String(sel.code) : '';

    let html = '';
    for (const it of list) {
      const code = String(it.code);
      const cls = code === selCode ? ' on' : (code === String(this.current) ? ' cur' : '');
      const nm = shortName(it.name) || it.name;
      html += `<button data-code="${code}" data-name="${it.name.replace(/"/g, '&quot;')}"`
        + ` title="${it.name} · ${code}" class="${cls.trim()}">${nm}</button>`;
    }
    box.innerHTML = html;

    // 选中的那项滚进视野
    const on = box.querySelector('button.on');
    if (on) {
      const top = on.offsetTop - box.clientHeight / 2 + on.offsetHeight / 2;
      box.scrollTop = Math.max(0, top);
    }
  }

  /** 底部「已选 → 确定」条 */
  renderConfirm() {
    const t = this.path[this.path.length - 1];
    const sel = $('rmSel'), ok = $('rmOk');
    if (!sel || !ok) return;
    if (!t) {
      sel.innerHTML = '<i>尚未选择 —— 点上面任一项，再点「确定切换」</i>';
      ok.disabled = true;
      return;
    }
    const chain = this.path.map((p) => p.name).join(' › ');
    const span = this.path.length === 1 ? '省级' : this.path.length === 2 ? '市级' : '县级';
    sel.innerHTML = `将切换到 <b>${chain}</b> <i>${t.code} · ${span}</i>`;
    ok.disabled = false;
  }

  /* ---------- 选中 / 确定 ---------- */
  select(lv, it) {
    this.path = this.path.slice(0, lv - 1);
    this.path[lv - 1] = { code: String(it.code), name: it.name };
    this.render();
  }

  confirm() {
    const t = this.path[this.path.length - 1];
    if (!t) return;
    $('regionMenu').classList.remove('open');
    this.onPick(t, this.path.length);
  }

  /** 底图区域变了：把选择链尽量对齐到当前区域（省/市/县都能对上） */
  async setCurrent(code, name) {
    this.current = code == null ? null : String(code);
    this.cache.clear();
    this.path = [];
    if (!code) { this.render(); return; }

    const c = String(code);
    const lv = levelOf(c) || 1;
    const provCode = c.slice(0, 2) + '0000';
    const prov = PROVINCES.find((p) => String(p.code) === provCode);
    if (prov) {
      this.path = [{ code: String(prov.code), name: prov.name }];
      if (lv >= 2) {
        const cities = await this.load(String(prov.code));
        const city = cities.find((x) => String(x.code) === c)
          || cities.find((x) => c.startsWith(String(x.code).slice(0, 4)));
        if (city) {
          this.path.push({ code: String(city.code), name: city.name });
          if (lv >= 3) {
            const cns = await this.load(String(city.code));
            const cn = cns.find((x) => String(x.code) === c);
            if (cn) this.path.push({ code: String(cn.code), name: cn.name });
          }
        }
      }
    } else {
      this.path = [{ code: c, name: name || c }];
    }
    this.render();
  }

  reset() {
    this.path = [];
    this.cache.clear();
    this.render();
  }
}
