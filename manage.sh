#!/bin/bash
# my-agent 服务管理脚本
# 用法: sh manage.sh {start|stop|restart|status|logs}
#
# 策略：
#   - 启动时让 npm/node 脱离当前 shell（Linux: setsid；macOS: nohup+disown）
#   - 以端口为唯一真实运行状态源
#   - stop 时杀进程组 + 端口监听进程 + 兜底 pkill
#   - restart 必须彻底杀死再启动

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
# PID 文件放 /tmp，避免被误提交；LOG 文件留在项目目录便于调试（已在 .gitignore）
PID_FILE="/tmp/my-agent.pid"
LOG_FILE="$PROJECT_DIR/.server.log"
PORT=4321

# 超时（秒）
STOP_TIMEOUT=10
START_TIMEOUT=15

# 用于匹配相关进程的 pattern（pgrep -f）
APP_PATTERN="npm.*run.*web|node.*serve|tsx.*src/web"

# ── 工具函数 ──

# 以端口为准判断是否在运行
is_running() {
  lsof -ti:"$PORT" >/dev/null 2>&1
}

# 查找所有相关进程的 PID（去重）
find_all_pids() {
  {
    lsof -ti:"$PORT" 2>/dev/null || true
    pgrep -f "npm run web" 2>/dev/null || true
    pgrep -f "serve.ts" 2>/dev/null || true
    pgrep -f "src/web/server" 2>/dev/null || true
  } | sort -u | grep -v "^$" || true
}

# 在后台启动命令并彻底脱离当前 shell，返回子进程 PID。
#   Linux: setsid 创建新会话/进程组，便于 kill_hard 整体清除
#   macOS (setsid 不存在): nohup 免疫 SIGHUP，&+disown 脱离 shell 作业表；
#                          kill_hard 已用 pgrep 模式兜底清理，不依赖进程组
launch_detached() {
  local cmd="$1"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "$cmd" </dev/null >/dev/null 2>&1 &
  else
    nohup bash -c "$cmd" </dev/null >/dev/null 2>&1 &
    disown 2>/dev/null || true
  fi
  echo $!
}

# 等待端口释放
wait_port_free() {
  local waited=0
  while is_running; do
    if [ "$waited" -ge "$STOP_TIMEOUT" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

# 等待进程全部消失
wait_no_pids() {
  local waited=0
  while [ -n "$(find_all_pids)" ]; do
    if [ "$waited" -ge "$STOP_TIMEOUT" ]; then
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 0
}

# 彻底杀死：进程组 → 端口监听 → 模式匹配（SIGTERM → SIGKILL）
kill_hard() {
  local pids
  pids=$(find_all_pids)
  [ -z "$pids" ] && return 0

  # 1) 先 SIGTERM
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  # 2) 等 3 秒优雅退出
  local waited=0
  while [ "$waited" -lt 3 ] && [ -n "$(find_all_pids)" ]; do
    sleep 1
    waited=$((waited + 1))
  done

  # 3) 还在就 SIGKILL
  pids=$(find_all_pids)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 1
  fi
}

# ── 前端构建保证 ──
# 后端 serve 的是 web/dist 下的静态资源；如果只改 web/src 不 build，
# 浏览器拿到的就是旧代码。每次 start/restart 之前先确保 dist 已是最新。

ensure_frontend_built() {
  local web_dir="$PROJECT_DIR/web"
  local dist_html="$web_dir/dist/index.html"

  # 0) web 子项目依赖缺失 → 先装
  if [ ! -d "$web_dir/node_modules" ]; then
    echo "📦 首次启动，安装 web 依赖..."
    (cd "$web_dir" && npm install) || {
      echo "❌ web 依赖安装失败"
      return 1
    }
  fi

  # 1) dist 缺失 → 必 build
  if [ ! -f "$dist_html" ]; then
    echo "📦 dist 缺失，构建前端..."
    (cd "$web_dir" && npm run build) || {
      echo "❌ 前端构建失败"
      return 1
    }
    echo "✅ 前端构建完成"
    return 0
  fi

  # 2) src 比 dist 新 → rebuild
  if [ -n "$(find "$web_dir/src" -type f -newer "$dist_html" 2>/dev/null | head -1)" ]; then
    echo "📦 前端源码比 dist 新，重新构建..."
    (cd "$web_dir" && npm run build) || {
      echo "❌ 前端构建失败"
      return 1
    }
    echo "✅ 前端构建完成"
  fi
}

# ── 子命令 ──

start() {
  if is_running; then
    echo "❌ 服务已在运行（端口 $PORT 被占用）"
    echo "   如需重启请用: sh manage.sh restart"
    exit 1
  fi

  # 兜底清理：端口是空的，但可能残留的 npm/node 僵尸进程还在
  local stale
  stale=$(find_all_pids)
  if [ -n "$stale" ]; then
    echo "🧹 清理残留进程: $stale"
    kill_hard
  fi

  # 启动前确保前端 dist 是最新的
  ensure_frontend_built || exit 1

  echo "🚀 启动后端服务..."
  cd "$PROJECT_DIR"
  rm -f "$PID_FILE"

  # 脱离当前 shell 启动 npm（Linux: setsid；macOS: nohup+disown，详见 launch_detached）
  local pgid
  pgid=$(launch_detached "npm run web > '$LOG_FILE' 2>&1")
  echo "$pgid" > "$PID_FILE"

  # 轮询等待端口就绪
  local waited=0
  while ! is_running; do
    if [ "$waited" -ge "$START_TIMEOUT" ]; then
      echo "❌ 启动失败（${START_TIMEOUT}s 超时），查看日志: $LOG_FILE"
      echo "   最后 20 行日志:"
      tail -20 "$LOG_FILE" 2>/dev/null || true
      kill_hard
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  # 端口就绪后，更新 PID 文件为真实监听进程
  local real_pid
  real_pid=$(lsof -ti:"$PORT" 2>/dev/null | head -1 || echo "")
  [ -n "$real_pid" ] && echo "$real_pid" > "$PID_FILE"

  echo "✅ 后端已启动: http://127.0.0.1:$PORT"
  echo "   PID: ${real_pid:-"未知"}"
  echo "   日志: $LOG_FILE"
}

stop() {
  if ! is_running && [ -z "$(find_all_pids)" ]; then
    echo "⚠️  服务未运行"
    rm -f "$PID_FILE"
    return
  fi

  echo "🛑 停止服务..."
  kill_hard

  # 验证端口释放
  if is_running; then
    echo "❌ 端口 $PORT 仍被占用，停止失败"
    exit 1
  fi

  # 验证残留进程
  if [ -n "$(find_all_pids)" ]; then
    echo "⚠️  仍有残留进程未清理:"
    find_all_pids | sed 's/^/   /'
    exit 1
  fi

  rm -f "$PID_FILE"
  echo "✅ 服务已停止"
}

restart() {
  echo "🔄 重启服务..."

  # 1) 先彻底杀（不等 stop 的友好提示）
  if is_running || [ -n "$(find_all_pids)" ]; then
    echo "   1) 杀死旧进程..."
    kill_hard
    # 强制等待端口释放
    if ! wait_port_free; then
      echo "❌ 端口 $PORT 释放超时，放弃重启"
      exit 1
    fi
  else
    echo "   1) 无残留进程"
  fi

  # 2) 额外缓冲，避免 TIME_WAIT 等内核态延迟
  sleep 1

  # 3) 启动新进程
  echo "   2) 启动新进程..."
  # 复用 start 但去掉前期的「服务已在运行」检查（restart 已保证端口空闲）
  if is_running; then
    echo "❌ 端口 $PORT 仍被占用，启动失败"
    exit 1
  fi

  # 启动前确保前端 dist 是最新的
  ensure_frontend_built || exit 1

  cd "$PROJECT_DIR"
  rm -f "$PID_FILE"
  local pgid
  pgid=$(launch_detached "npm run web > '$LOG_FILE' 2>&1")
  echo "$pgid" > "$PID_FILE"

  local waited=0
  while ! is_running; do
    if [ "$waited" -ge "$START_TIMEOUT" ]; then
      echo "❌ 启动失败（${START_TIMEOUT}s 超时），查看日志: $LOG_FILE"
      echo "   最后 20 行日志:"
      tail -20 "$LOG_FILE" 2>/dev/null || true
      kill_hard
      rm -f "$PID_FILE"
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  local real_pid
  real_pid=$(lsof -ti:"$PORT" 2>/dev/null | head -1 || echo "")
  [ -n "$real_pid" ] && echo "$real_pid" > "$PID_FILE"

  echo "✅ 重启完成: http://127.0.0.1:$PORT (PID: ${real_pid:-"未知"})"
}

status() {
  if is_running; then
    local pid
    pid=$(lsof -ti:"$PORT" 2>/dev/null | head -1)
    echo "✅ 服务运行中"
    echo "   端口: $PORT"
    echo "   PID:  ${pid:-"未知"}"
    echo "   日志: $LOG_FILE"
  else
    echo "⚠️  服务未运行"
  fi
}

logs() {
  if [ -f "$LOG_FILE" ]; then
    tail -f "$LOG_FILE"
  else
    echo "暂无日志文件"
  fi
}

# ── 前端 Vite dev server 管理 ──
# 用法: dev-start | dev-stop | dev-restart | dev-status | dev-logs

WEB_DIR="$PROJECT_DIR/web"
DEV_PORT=5173
DEV_LOG="/tmp/vite-dev.log"

is_dev_running() {
  lsof -ti:"$DEV_PORT" >/dev/null 2>&1
}

find_dev_pids() {
  lsof -ti:"$DEV_PORT" 2>/dev/null | sort -u || true
}

dev_start() {
  if is_dev_running; then
    echo "❌ 前端 dev server 已在运行（端口 $DEV_PORT 被占用）"
    exit 1
  fi
  echo "🚀 启动前端 Vite dev server..."
  cd "$WEB_DIR"
  launch_detached "npm run dev > '$DEV_LOG' 2>&1" >/dev/null

  local waited=0
  while ! is_dev_running; do
    if [ "$waited" -ge 15 ]; then
      echo "❌ 前端启动失败（15s 超时），查看日志: $DEV_LOG"
      tail -20 "$DEV_LOG" 2>/dev/null || true
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "✅ 前端已启动: http://localhost:$DEV_PORT"
}

dev_stop() {
  if ! is_dev_running; then
    echo "⚠️  前端 dev server 未运行"
    return
  fi
  echo "🛑 停止前端 dev server..."
  local pids
  pids=$(find_dev_pids)
  if [ -n "$pids" ]; then
    for pid in $pids; do
      kill -TERM "$pid" 2>/dev/null || true
    done
    sleep 1
    pids=$(find_dev_pids)
    if [ -n "$pids" ]; then
      for pid in $pids; do
        kill -KILL "$pid" 2>/dev/null || true
      done
    fi
  fi
  echo "✅ 前端已停止"
}

dev_restart() {
  echo "🔄 重启前端 dev server..."
  if is_dev_running; then dev_stop; fi
  sleep 1
  dev_start
}

dev_status() {
  if is_dev_running; then
    local pid
    pid=$(lsof -ti:"$DEV_PORT" 2>/dev/null | head -1)
    echo "✅ 前端运行中"
    echo "   端口: $DEV_PORT"
    echo "   PID:  ${pid:-"未知"}"
    echo "   URL:  http://localhost:$DEV_PORT"
  else
    echo "⚠️  前端未运行"
  fi
}

dev_logs() {
  if [ -f "$DEV_LOG" ]; then
    tail -f "$DEV_LOG"
  else
    echo "暂无日志文件"
  fi
}

# ── 入口 ──

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  logs)    logs ;;
  dev-start)   dev_start ;;
  dev-stop)    dev_stop ;;
  dev-restart) dev_restart ;;
  dev-status)  dev_status ;;
  dev-logs)    dev_logs ;;
  *)
    echo "用法: sh manage.sh {start|stop|restart|status|logs|dev-start|dev-stop|dev-restart|dev-status|dev-logs}"
    echo ""
    echo "后端 (端口 $PORT):"
    echo "  start   — 启动后端服务"
    echo "  stop    — 停止后端服务"
    echo "  restart — 彻底杀死旧进程后启动新进程"
    echo "  status  — 查看后端状态"
    echo "  logs    — 查看后端实时日志"
    echo ""
    echo "前端 (端口 $DEV_PORT):"
    echo "  dev-start   — 启动前端 Vite dev server"
    echo "  dev-stop    — 停止前端 Vite dev server"
    echo "  dev-restart — 重启前端 Vite dev server"
    echo "  dev-status  — 查看前端状态"
    echo "  dev-logs    — 查看前端实时日志"
    exit 1
    ;;
esac