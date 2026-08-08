/**
 * my-agent Web 前端 — 跨平台「启动后自动打开默认浏览器」(WU-02d / B5)
 *
 * 来源：spec § 6.3 启动行为「自动打开浏览器」+ contract § 5 启动行为（仅开放浏览器部分）。
 *
 * 单一职责：用 `node:child_process.spawn` 调用平台原生命令打开 URL，
 * 不阻塞 web 服务进程、不抛异常（打开失败不能让 server 起不来）。
 *
 * 跨平台策略：
 *   - darwin：`open <url>` （macOS 自带，无需 fallback）
 *   - linux：`xdg-open <url>` 主路径；缺失时按序 fallback
 *     `gio open` → `firefox` → `google-chrome` → `chromium`；都失败 → ok=false
 *   - win32：`cmd /c start "" <url>` （空引号是必需的，避免 URL 被当 title）
 *   - 其他：返回 `{ ok: false, error: 'unsupported platform' }`
 *
 * 进程模型：
 *   - `detached: true` + `child.unref()` → 父进程退出不影响浏览器进程
 *   - `stdio: 'pipe'` → 把子进程 stdout/stderr 接到 logger.debug；无 logger 时静默
 *   - **不**抛异常：spawn 失败 (ENOENT / EACCES) → 返回 `ok:false, error`
 *
 * 范围：本 WU 只导出 `openBrowser(url, opts?)`，**不**接入 `bin/my-agent-web.ts`
 * （接线留给后续 GROUP-7 README/wiring 阶段）。
 */

import { spawn } from "node:child_process";

import type { Logger } from "../../shared/logger.js";

// ============================================================
// 公开类型
// ============================================================

/**
 * `openBrowser` 的可选参数。
 *
 * 字段都 optional，让调用方按需注入。
 */
export type OpenBrowserOptions = {
  /** 日志接入；缺省走 `nullLogger`（无 logger 时静默） */
  logger?: Logger;
};

/**
 * `openBrowser` 的返回结果。
 *
 * - `ok: true`  代表命令成功 spawn（不代表浏览器真打开；macOS 的 `open` /
 *   Linux 的 `xdg-open` 是异步分发的，本进程不会等浏览器窗口）。
 * - `ok: false` 代表**任一**fallback 失败或平台不支持；
 *   `error` 给出最后一次失败的 child_process 错误（spawn 抛错）。
 */
export type OpenBrowserResult = {
  ok: boolean;
  platform: NodeJS.Platform;
  /** 实际执行的命令字符串（用于排错；macOS/win32 不带 URL 之外的 args） */
  command?: string;
  /** 失败原因；ok=true 时不出现 */
  error?: string;
};

// ============================================================
// 兜底 logger（无依赖 / 无控制台噪音）
// ============================================================

/** 当 opts.logger 缺省时使用，所有方法都是 no-op。 */
const NULL_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => NULL_LOGGER,
};

// ============================================================
// Linux fallback 列表（按顺序尝试）
// ============================================================

type Fallback = {
  command: string;
  buildArgs: (url: string) => readonly string[];
};

/**
 * Linux / *nix 上打开 URL 的候选命令列表。
 *
 * 顺序固定（按 Linux 桌面惯例的可得性）：
 *   1. `xdg-open` — freedesktop 标准，几乎所有桌面环境都有
 *   2. `gio open`  — GNOME / GLib-based 环境（xfce / cinnamon / mate 也常常带）
 *   3. `firefox`   — Mozilla Firefox，参数 `--new-window` 让 URL 起新窗口
 *                    （避免开 tab 把现有个人浏览也吞进去）
 *   4. `google-chrome` — Chromium 系（Debian/Ubuntu 包名）
 *   5. `chromium`     — Chromium 系（Arch/部分发行版包名）
 *
 * 仅检测**主命令名**，而不检测某个 desktop entry；目的是「spawn 一下试试，
 * 失败就下一个」（失败要么 ENOENT 缺失，要么进程退出码非零 —— 但 detached 后
 * 我们不等退出码，所以只看 spawn 阶段是否抛 'error'）。
 */
const LINUX_FALLBACKS: ReadonlyArray<Fallback> = [
  { command: "xdg-open", buildArgs: (url) => [url] },
  { command: "gio", buildArgs: (url) => ["open", url] },
  { command: "firefox", buildArgs: (url) => ["--new-window", url] },
  { command: "google-chrome", buildArgs: (url) => [url] },
  { command: "chromium", buildArgs: (url) => [url] },
];

/** 判断 platform 是否属于 *nix 系（走 Linux fallback 链） */
function isNixLike(platform: NodeJS.Platform): boolean {
  return (
    platform === "linux" ||
    platform === "freebsd" ||
    platform === "openbsd" ||
    platform === "netbsd" ||
    platform === "sunos" ||
    platform === "aix"
  );
}

// ============================================================
// spawn helper
// ============================================================

/** spawn 的最小子集（让 mock 替换更轻） */
interface ChildLike {
  pid?: number;
  stdout?: { on(event: "data", cb: (chunk: Buffer) => void): void } | null;
  stderr?: { on(event: "data", cb: (chunk: Buffer) => void): void } | null;
  on(event: "error", cb: (err: Error) => void): void;
  unref(): void;
}

/**
 * 真正执行 spawn；统一收集错误 / 收集子进程输出打 logger。
 *
 * 设计要点：
 *   - 同步立刻返回 child；用 Promise 表达「spawn 是否成功启动」
 *     - `error` 事件（异步）—— 立刻失败（ENOENT / EACCES）→ resolve({ spawned:false, error })
 *     - 在 `error` 事件触发前不 resolve；用 microtask 让事件循环跑一帧
 *       再判定为「OK」（ENOENT 通常在 1 tick 内就触发）
 *   - 把 stdio 接到 logger.debug（无 logger 时打到 nullLogger，无副作用）
 *   - detached 进程退出码我们不等 —— 'exit' 不算失败
 */
function spawnOnce(
  command: string,
  args: readonly string[],
  logger: Logger,
): Promise<{ spawned: boolean; error?: Error }> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: { spawned: boolean; error?: Error }): void => {
      if (settled) return;
      settled = true;
      resolve(v);
    };

    let child: ChildLike;
    try {
      child = spawn(command, [...args], {
        detached: true,
        stdio: "pipe",
      }) as unknown as ChildLike;
    } catch (err) {
      // spawn 同步抛错（罕见——通常走 'error' 事件）的兜底
      settle({
        spawned: false,
        error: err instanceof Error ? err : new Error(String(err)),
      });
      return;
    }

    // 父进程退出不影响浏览器
    try {
      child.unref();
    } catch {
      // unref 失败不应阻断主流程
    }

    // 把 stdout / stderr 打 logger.debug
    if (child.stdout) {
      child.stdout.on("data", (chunk: Buffer) => {
        logger.debug(
          `[open-browser] ${command} stdout:`,
          { output: chunk.toString().trimEnd() },
        );
      });
    }
    if (child.stderr) {
      child.stderr.on("data", (chunk: Buffer) => {
        logger.debug(
          `[open-browser] ${command} stderr:`,
          { output: chunk.toString().trimEnd() },
        );
      });
    }

    // 'error' = spawn 阶段就失败（ENOENT / EACCES）。
    // due to detached:true, 'exit' code 不算失败 —— 我们只在 error 时判失败。
    child.on("error", (err: Error) => {
      settle({ spawned: false, error: err });
    });

    // 等一帧 microtask：ENOENT 通常在这一帧内异步触发 'error'；
    // 没触发就当作「spawn 已成功」。setImmediate 在下一轮事件循环触发，
    // 早于本轮 I/O poll 的 'error' —— 我们用 queueMicrotask + setTimeout(_,0)
    // 组合更稳：直接用 setTimeout 让 'error' 有机会先发，再判定。
    setTimeout(() => {
      settle({ spawned: true });
    }, 0);
  });
}

// ============================================================
// 主入口
// ============================================================

/**
 * 在默认浏览器中打开 URL。
 *
 * 行为：
 *   - 返回 `{ ok: true }` 不代表浏览器已展示页面，只代表 spawn 没立刻失败。
 *   - Linux / *nix 走 fallback 链：依次 `xdg-open` → `gio open` → `firefox` →
 *     `google-chrome` → `chromium`，第一次成功 spawn 即返回。
 *   - 任何错误（platform 不支持 / 所有 fallback 都 spawn 失败 / EACCES / ENOENT）
 *     都不抛，而是返回 `{ ok: false, error }`。
 *   - 进程 detached + unref()，父进程退出不影响浏览器进程。
 *
 * 测试策略：单测通过 `vi.mock("node:child_process")` 替换 `spawn`，
 * 验证各平台调用了正确命令、检测 fallback 顺序、覆盖错误分支。
 *
 * @param url 待打开的 URL（http/https/file 等均可）
 * @param opts 可选 `{ logger }`，用于接收子进程输出
 */
export async function openBrowser(
  url: string,
  opts: OpenBrowserOptions = {},
): Promise<OpenBrowserResult> {
  const logger = opts.logger ?? NULL_LOGGER;
  const platform = process.platform;

  // 1) *nix 系 → fallback 链
  if (isNixLike(platform)) {
    let lastError: Error | undefined;
    for (const fb of LINUX_FALLBACKS) {
      const args = fb.buildArgs(url);
      const result = await spawnOnce(fb.command, args, logger);
      if (result.spawned) {
        return {
          ok: true,
          platform,
          command: `${fb.command} ${formatArgs(args)}`,
        };
      }
      if (result.error) lastError = result.error;
    }
    return {
      ok: false,
      platform,
      error:
        lastError?.message ?? `all fallback commands failed on ${platform}`,
    };
  }

  // 2) darwin / win32 → 单路径
  const single = pickSinglePlatformCommand(platform, url);
  if (!single) {
    return {
      ok: false,
      platform,
      error: "unsupported platform",
    };
  }
  const result = await spawnOnce(single.command, single.args, logger);
  if (result.spawned) {
    return {
      ok: true,
      platform,
      command: `${single.command} ${formatArgs(single.args)}`,
    };
  }
  return {
    ok: false,
    platform,
    error: result.error?.message ?? `failed to spawn ${single.command}`,
  };
}

// ============================================================
// 单平台命令（darwin / win32）
// ============================================================

function pickSinglePlatformCommand(
  platform: NodeJS.Platform,
  url: string,
): { command: string; args: readonly string[] } | null {
  switch (platform) {
    case "darwin":
      // macOS 自带 `open`；URL 作为第一参数，命令会按 URL scheme 路由到默认浏览器。
      return { command: "open", args: [url] };
    case "win32":
      // `cmd /c start "" <url>` —— 中间的 `""` 是必需的，
      // `start` 的首个引号参数会被当成窗口标题，URL 里若有空格会被截断。
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return null;
  }
}

/** 把 args 数组格式化成 shell-like 字符串（仅用于 command 字段展示） */
function formatArgs(args: readonly string[]): string {
  return args.map((a) => (a === "" || /\s/.test(a) ? `"${a}"` : a)).join(" ");
}
