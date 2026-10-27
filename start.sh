#!/usr/bin/env bash
# 3D 地形制图工作室 · 一键启动（macOS / Linux）
# 用法: ./start.sh [端口]   默认 8901
set -e
cd "$(dirname "$0")"
PORT="${1:-8901}"

PY="$(command -v python3 || command -v python || true)"
if [ -z "$PY" ]; then
  echo "[!] 未找到 Python 3，请先安装：https://www.python.org/downloads/"
  exit 1
fi

# 端口已占用就不重复启动
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[i] 端口 $PORT 已有服务在跑"
else
  echo "[*] 启动本地服务 http://127.0.0.1:$PORT"
  "$PY" scripts/serve.py "$PORT" &
  SRV=$!
  trap 'kill $SRV 2>/dev/null || true' EXIT INT TERM
  sleep 1
fi

URL="http://127.0.0.1:$PORT/?proxy=1"
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
else echo "[*] 请手动在浏览器打开：$URL"; fi

# 前台等待服务（Ctrl+C 结束）
[ -n "${SRV:-}" ] && wait "$SRV"
