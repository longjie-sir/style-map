/* ============================================================
   网络层：可选的本地缓存代理
   ------------------------------------------------------------
   默认直接请求远端（DataV / Terrarium）。
   地址栏加 ?proxy=1 时，所有远端请求改走 scripts/serve.py 的 /proxy，
   由本地磁盘缓存兜底，方便断网/弱网下反复调试与截图。
   ============================================================ */
const QS = new URLSearchParams(location.search);
export const USE_PROXY = QS.get('proxy') === '1';

export const netUrl = (url) => (USE_PROXY ? '/proxy?u=' + encodeURIComponent(url) : url);

export async function netFetch(url, opts) {
  return fetch(netUrl(url), opts);
}
