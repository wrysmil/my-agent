/**
 * 前端日志工具 — 开发环境输出中文日志，生产环境静默（warn/error 始终输出）
 *
 * 使用方式：
 * ```ts
 * import { logger } from "@/lib/logger";
 * logger.info("📤 发送消息", { text: "你好" });
 * logger.debug("📥 流式响应完成", { durationMs: 1521 });
 * logger.error("❌ API 错误", { status: 500 });
 * ```
 */

const PREFIX = "[my-agent]";

const isDev = typeof import.meta !== "undefined" &&
  (import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV === true;

function formatTime(): string {
  return new Date().toISOString().slice(11, 23); // HH:MM:SS.sss
}

export const logger = {
  debug(msg: string, data?: Record<string, unknown>): void {
    if (isDev) {
      console.debug(`${PREFIX} [${formatTime()}] ${msg}`, data ?? "");
    }
  },

  info(msg: string, data?: Record<string, unknown>): void {
    if (isDev) {
      console.info(`${PREFIX} [${formatTime()}] ${msg}`, data ?? "");
    }
  },

  warn(msg: string, data?: Record<string, unknown>): void {
    console.warn(`${PREFIX} [${formatTime()}] ${msg}`, data ?? "");
  },

  error(msg: string, data?: Record<string, unknown>): void {
    console.error(`${PREFIX} [${formatTime()}] ${msg}`, data ?? "");
  },
};
