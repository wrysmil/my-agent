#!/bin/bash
# my-agent 服务管理脚本
# 用法: sh manage.sh {start|stop|restart|status}

set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$PROJECT_DIR/.server.pid"
LOG_FILE="$PROJECT_DIR/.server.log"
PORT=4321

# ── 工具函数 ──

get_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE"
  else
    echo ""
  fi
}

is_running() {
  local pid
  pid=$(get_pid)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  # 兜底：通过端口检查
  if lsof -ti:"$PORT" >/dev/null 2>&1; then
    return 0
  fi
  return 1
}

# ── 子命令 ──

start() {
  if is_running; then
    echo "❌ 服务已在运行（端口 $PORT 被占用）"
    exit 1
  fi

  echo "🚀 启动后端服务..."
  cd "$PROJECT_DIR"
  nohup npm run web > "$LOG_FILE" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 2

  if is_running; then
    echo "✅ 后端已启动: http://127.0.0.1:$PORT"
    echo "   PID: $(get_pid)"
    echo "   日志: $LOG_FILE"
  else
    echo "❌ 启动失败，查看日志: $LOG_FILE"
    exit 1
  fi
}

stop() {
  if ! is_running; then
    echo "⚠️  服务未运行"
    rm -f "$PID_FILE"
    return
  fi

  echo "🛑 停止服务..."

  # 先尝试用 PID 文件杀
  local pid
  pid=$(get_pid)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null
    sleep 1
  fi

  # 兜底：按端口强杀
  local port_pid
  port_pid=$(lsof -ti:"$PORT" 2>/dev/null)
  if [ -n "$port_pid" ]; then
    kill -9 "$port_pid" 2>/dev/null
  fi

  rm -f "$PID_FILE"
  echo "✅ 服务已停止"
}

restart() {
  echo "🔄 重启服务..."
  stop
  sleep 1
  start
}

status() {
  if is_running; then
    local pid
    pid=$(lsof -ti:"$PORT" 2>/dev/null)
    echo "✅ 服务运行中"
    echo "   端口: $PORT"
    echo "   PID:  ${pid:-"未知"}"
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

# ── 入口 ──

case "${1:-}" in
  start)   start ;;
  stop)    stop ;;
  restart) restart ;;
  status)  status ;;
  logs)    logs ;;
  *)
    echo "用法: sh manage.sh {start|stop|restart|status|logs}"
    echo ""
    echo "  start   — 启动后端服务"
    echo "  stop    — 停止后端服务"
    echo "  restart — 重启后端服务"
    echo "  status  — 查看服务状态"
    echo "  logs    — 查看实时日志"
    exit 1
    ;;
esac
