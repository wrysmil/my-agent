/**
 * my-agent Web 前端 — 优雅关闭（WU-01 / B1）。
 *
 * 来源：spec § 6.3 + done criteria #7。
 *
 * 流程（按 done criteria）：
 *   1. SIGINT / SIGTERM 触发（默认监听两者）
 *   2. **停止 accept**（http.Server 在调用 .close() 后立即停止接受新连接）
 *   3. **关闭 keep-alive 空闲 socket**（`server.closeIdleConnections()`，
 *      避免 keep-alive 长连接阻塞 .close() 完成）
 *   4. `server.close()` 等待在途请求结束
 *   5. 关闭所有 session 句柄（`sessionStore.closeAll()`）
 *   6. **5 秒强退**：超时后无论 .close() 是否完成都强制 exit
 *
 * 幂等性：同一信号重复触发只跑一次关闭流程，避免「双击 Ctrl-C
 * 导致 onExit 被调两次」。
 */

import type { Logger } from "../../shared/logger.js";

// ============================================================
// 类型
// ============================================================

/**
 * 关闭时需要释放的句柄。
 *
 * 字段都 optional，让调用方按需注入（测试可只给 server）。
 */
export type ShutdownTarget = {
  /** 必填：要关闭的 WebServer 句柄（含 close()） */
  server: { close(): Promise<void> };
  /** 可选：SessionStore.closeAll() 用于释放文件锁 */
  sessionStore?: { closeAll(): void };
  /** 可选：用于日志输出；缺省走 console.*  */
  logger?: Logger;
};

export type InstallShutdownHandlersOptions = ShutdownTarget & {
  /** 监听哪些信号，默认 `["SIGINT", "SIGTERM"]` */
  signals?: NodeJS.Signals[];
  /** 强退超时（ms），默认 5_000（done criteria #7） */
  forceExitMs?: number;
  /** 进程退出回调，默认 `process.exit(code)`；测试可注入 spy 避免真退出 */
  onExit?: (code: number) => void;
};

// ============================================================
// 实现
// ============================================================

/**
 * 注册 SIGINT / SIGTERM handler。
 *
 * @returns 反注册函数（测试用，避免监听器泄漏到其他用例）
 *
 * 注意：handler 是**异步**触发——内部 `setTimeout` 启动后立刻返回，
 * `process.on(sig, wrapped)` 注册的是同步包装。Node 在 SIGINT 时的
 * 默认行为（默认退出码）是「最后机会」级别，install 后会覆盖。
 */
export function installShutdownHandlers(
  opts: InstallShutdownHandlersOptions,
): () => void {
  const signals = opts.signals ?? (["SIGINT", "SIGTERM"] as NodeJS.Signals[]);
  const forceExitMs = opts.forceExitMs ?? 5_000;
  const onExit =
    opts.onExit ?? ((code: number): never => process.exit(code) as never);

  // 兜底 logger：注入时用注入的，否则降级到 console.*（不引入新依赖）
  const log = opts.logger ?? {
    debug: () => {},
    info: (msg: string, ...args: unknown[]): void =>
      console.log(msg, ...args),
    warn: (msg: string, ...args: unknown[]): void =>
      console.warn(msg, ...args),
    error: (msg: string, ...args: unknown[]): void =>
      console.error(msg, ...args),
  };

  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    // 5s 强退定时器（独立于 .close() 完成）
    const forceTimer = setTimeout(() => {
      log.warn(
        `⚠️ 优雅关闭超时 (${forceExitMs}ms)，强制退出`,
      );
      onExit(1);
    }, forceExitMs);
    // 不阻塞 Node 自然退出
    forceTimer.unref?.();

    try {
      // 1) 关闭 server（http.Server.close 内部已停止 accept）
      await opts.server.close();
      // 2) 释放 SessionStore 文件锁
      opts.sessionStore?.closeAll();
      // 3) 清理强退定时器
      clearTimeout(forceTimer);
      log.info("👋 再见！");
      onExit(0);
    } catch (err) {
      clearTimeout(forceTimer);
      log.error("❌ 关闭服务器失败", { error: err instanceof Error ? err.message : String(err) });
      onExit(1);
    }
  };

  // process.on 的回调必须是同步返回；这里套一层 void wrapper
  const wrapped = (): void => {
    void shutdown();
  };

  for (const sig of signals) {
    process.on(sig, wrapped);
  }

  return () => {
    for (const sig of signals) {
      process.removeListener(sig, wrapped);
    }
  };
}