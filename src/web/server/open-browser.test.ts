/**
 * my-agent Web 前端 — open-browser 单元测试（WU-02d / B5）
 *
 * 用例设计要点：
 *   - mock `node:child_process`（具体到 `spawn`），强控制**每次调用**的返回
 *     —— 这样能精确断言「darwin 走 `open`」「linux 走 `xdg-open`」
 *     「linux xdg-open 不存在 → fallback 到 `gio`」「全失败 → ok=false」。
 *   - mock 时不能让真浏览器真打开 —— 每个 fakeChild 返回 no-op stdout/stderr
 *     + 主动触发（或不触发）'error' 事件。
 *   - `process.platform` 在 Node 18+ 是只读，用 `Object.defineProperty`
 *     临时切到不同平台；每个用例的 beforeEach/afterEach 还原。
 *
 * 覆盖表（≥ 7 用例）：
 *   1) darwin  → `open <url>` 并 detached + unref
 *   2) linux   → 主路径 `xdg-open <url>`
 *   3) win32   → `cmd /c start "" <url>`
 *   4) linux xdg-open 抛 ENOENT → fallback 到 `gio open`
 *   5) linux 全部 fallback 抛 ENOENT → ok=false
 *   6) 不支持的 platform (aix/irix 等) → ok=false + error: "unsupported platform"
 *   7) spawn 同步抛 EACCES → 捕获为 ok=false，不向上抛
 *   (bonus)
 *   8) 无 logger → spawn 后 stdout/stderr 静默（不抛）
 *   9) 有 logger → 触发 error 事件时不写 stderr，但正常 spawn 时 stdout 数据会被 log
 *  10) linux 第一项成功后，**不再**调用后续 fallback
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as childProcess from "node:child_process";

// ============================================================
// Mock node:child_process
// ============================================================

type SpawnMock = ReturnType<typeof vi.fn>;

vi.mock("node:child_process", async (importOriginal) => {
  const real = (await importOriginal()) as typeof childProcess;
  return {
    ...real,
    spawn: vi.fn(),
  };
});

const spawnMock = childProcess.spawn as unknown as SpawnMock;

// ============================================================
// fakeChild 工厂
// ============================================================

type FakeChild = {
  pid: number;
  stdout: { on: ReturnType<typeof vi.fn> };
  stderr: { on: ReturnType<typeof vi.fn> };
  on: ReturnType<typeof vi.fn>;
  unref: ReturnType<typeof vi.fn>;
};

/**
 * 建一个最小 fake child，模拟「spawn 成功」的默认形态：
 *   - unref() 是 spy（不被 unref 真调）
 *   - stdout/stderr.on() 注册到 fake stream 的 listeners
 *   - 不触发 'error'
 */
function makeFakeSuccessChild(): FakeChild {
  const child: FakeChild = {
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    unref: vi.fn(),
  };
  return child;
}

/**
 * 建一个 fake child，模拟「spawn 阶段就失败」：
 *   - 在调用 .on('error', cb) 后立刻异步触发 cb(err)
 *   - unref() 仍是 spy
 */
function makeFakeErrorChild(err: Error): {
  child: FakeChild;
  triggerError: () => void;
} {
  const child: FakeChild = {
    pid: 12345,
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, cb: (e: Error) => void) => {
      if (event === "error") {
        // setImmediate 让监听器先注册再触发，符合真实 'error' 事件时机
        setImmediate(() => cb(err));
      }
    }),
    unref: vi.fn(),
  };
  return { child, triggerError: () => {} };
}

// ============================================================
// platform 切换工具
// ============================================================

const ORIGINAL_PLATFORM = process.platform;

function stubPlatform(value: NodeJS.Platform): () => void {
  Object.defineProperty(process, "platform", {
    value,
    configurable: true,
    writable: true,
  });
  return (): void => {
    Object.defineProperty(process, "platform", {
      value: ORIGINAL_PLATFORM,
      configurable: true,
      writable: true,
    });
  };
}

// ============================================================
// 测试主体
// ============================================================

afterEach(() => {
  spawnMock.mockReset();
});

describe("openBrowser — 平台行为", () => {
  // ----------------------------------------------------------------
  // 1) darwin → open <url>
  // ----------------------------------------------------------------
  it("darwin 调用 `open <url>` 并 detached + unref()", async () => {
    const restore = stubPlatform("darwin");
    const fakeChild = makeFakeSuccessChild();
    spawnMock.mockReturnValue(fakeChild);

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://127.0.0.1:4321/");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "open",
      ["http://127.0.0.1:4321/"],
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
    expect(fakeChild.unref).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      ok: true,
      platform: "darwin",
      command: "open http://127.0.0.1:4321/",
    });
    restore();
  });

  // ----------------------------------------------------------------
  // 2) linux → xdg-open <url>（主路径）
  // ----------------------------------------------------------------
  it("linux 优先用 xdg-open，主路径 spawn 成功即返回", async () => {
    const restore = stubPlatform("linux");
    const fakeChild = makeFakeSuccessChild();
    spawnMock.mockReturnValue(fakeChild);

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://localhost:4321/");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "xdg-open",
      ["http://localhost:4321/"],
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
    expect(result).toMatchObject({
      ok: true,
      platform: "linux",
      command: "xdg-open http://localhost:4321/",
    });
    restore();
  });

  // ----------------------------------------------------------------
  // 3) win32 → cmd /c start "" <url>
  // ----------------------------------------------------------------
  it("win32 调用 `cmd /c start \"\" <url>`，空 title 参数保留 URL 完整", async () => {
    const restore = stubPlatform("win32");
    const fakeChild = makeFakeSuccessChild();
    spawnMock.mockReturnValue(fakeChild);

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://127.0.0.1:4321/");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(
      "cmd",
      ["/c", "start", "", "http://127.0.0.1:4321/"],
      expect.objectContaining({ detached: true, stdio: "pipe" }),
    );
    expect(fakeChild.unref).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.platform).toBe("win32");
    // 空 title 参数被显式显示为 `""`；URL 无空格所以裸出即可
    expect(result.command).toBe('cmd /c start "" http://127.0.0.1:4321/');
    restore();
  });

  // ----------------------------------------------------------------
  // 4) linux xdg-open 缺失 → fallback 到 gio
  // ----------------------------------------------------------------
  it("linux xdg-open 抛 ENOENT 时回退到 `gio open`", async () => {
    const restore = stubPlatform("linux");
    // 每次 spawn 都建一个 fresh fake；第一次失败、第二次成功
    const enoent = Object.assign(new Error("spawn xdg-open ENOENT"), {
      code: "ENOENT",
    });

    // 用一个序列：第 1 次返回「会触发 error」的 child，之后返回成功 child
    let callIndex = 0;
    spawnMock.mockImplementation(() => {
      callIndex++;
      if (callIndex === 1) {
        return makeFakeErrorChild(enoent).child;
      }
      return makeFakeSuccessChild();
    });

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://localhost:4321/");

    // 总共两次：xdg-open 失败、gio open 成功
    expect(spawnMock).toHaveBeenCalledTimes(2);
    expect(spawnMock.mock.calls[0][0]).toBe("xdg-open");
    expect(spawnMock.mock.calls[1][0]).toBe("gio");
    expect(spawnMock.mock.calls[1][1]).toEqual(["open", "http://localhost:4321/"]);
    expect(result).toMatchObject({
      ok: true,
      platform: "linux",
      command: "gio open http://localhost:4321/",
    });
    restore();
  });

  // ----------------------------------------------------------------
  // 5) linux 所有 fallback 都失败 → ok=false
  // ----------------------------------------------------------------
  it("linux 全部 fallback 抛 ENOENT → ok=false 并带回最后错误", async () => {
    const restore = stubPlatform("linux");
    const enoent = Object.assign(new Error("not found ENOENT"), {
      code: "ENOENT",
    });
    // 5 个 fallback 全部失败
    spawnMock.mockImplementation(() => makeFakeErrorChild(enoent).child);

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://localhost:4321/");

    // 5 个 fallback 全部尝试
    expect(spawnMock).toHaveBeenCalledTimes(5);
    expect(spawnMock.mock.calls.map((c) => c[0])).toEqual([
      "xdg-open",
      "gio",
      "firefox",
      "google-chrome",
      "chromium",
    ]);
    expect(result.ok).toBe(false);
    expect(result.platform).toBe("linux");
    expect(result.error).toContain("ENOENT");
    restore();
  });

  // ----------------------------------------------------------------
  // 6) 不支持的 platform → ok=false + "unsupported platform"
  // ----------------------------------------------------------------
  it("不识别的 platform（aix/android/win32 之外）→ ok=false，error: 'unsupported platform'", async () => {
    // 'haiku' 在 NodeJS.Platform 联合类型里存在，但 open-browser 没处理它
    const restore = stubPlatform("haiku");

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://localhost:4321/");

    expect(spawnMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      platform: "haiku",
      error: "unsupported platform",
    });
    restore();
  });

  // ----------------------------------------------------------------
  // 7) spawn 抛错 → 返回 ok=false，不向上抛
  // ----------------------------------------------------------------
  it("spawn 同步抛 EACCES → 返回 ok=false，不抛异常", async () => {
    const restore = stubPlatform("darwin");
    const eacces = Object.assign(new Error("spawn open EACCES"), {
      code: "EACCES",
    });
    // 让 spawn 直接同步抛错 —— 用 mockImplementation 而非 mockReturnValue
    spawnMock.mockImplementation(() => {
      throw eacces;
    });

    const { openBrowser } = await import("./open-browser.js");

    // 关键断言：「不会向上抛」
    let thrown: unknown;
    let result: Awaited<ReturnType<typeof import("./open-browser.js").openBrowser>> | undefined;
    try {
      result = await openBrowser("http://localhost:4321/");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(result?.ok).toBe(false);
    expect(result?.platform).toBe("darwin");
    expect(result?.error).toContain("EACCES");
    restore();
  });
});

// ============================================================
// 鲁棒性扩展
// ============================================================

describe("openBrowser — 鲁棒性", () => {
  // ----------------------------------------------------------------
  // 8) linux 第一次成功 → 不再尝试后续 fallback
  // ----------------------------------------------------------------
  it("linux 首次 fallback 成功后立刻返回，不再调后续命令", async () => {
    const restore = stubPlatform("linux");
    spawnMock.mockReturnValue(makeFakeSuccessChild());

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://localhost:4321/");

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0][0]).toBe("xdg-open");
    expect(result.ok).toBe(true);
    restore();
  });

  // ----------------------------------------------------------------
  // 9) 有 logger → 正常路径 stdout/stderr.on 被注册（监听输出但不抛）
  // ----------------------------------------------------------------
  it("有 logger 时 stdout/stderr.on 被注册用于收集子进程输出", async () => {
    const restore = stubPlatform("darwin");
    const fakeChild = makeFakeSuccessChild();
    spawnMock.mockReturnValue(fakeChild);

    const debugSpy = vi.fn();
    const logger = {
      debug: debugSpy,
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const { openBrowser } = await import("./open-browser.js");
    await openBrowser("http://localhost:4321/", { logger });

    // fakeChild.stdout.on / stderr.on 被各调一次（注册 data 监听）
    expect(fakeChild.stdout.on).toHaveBeenCalledWith("data", expect.any(Function));
    expect(fakeChild.stderr.on).toHaveBeenCalledWith("data", expect.any(Function));
    expect(debugSpy).not.toHaveBeenCalled(); // 没数据进来就不会 log
    restore();
  });

  // ----------------------------------------------------------------
  // 10) 无 logger → spawn 仍正常完成（不抛）
  // ----------------------------------------------------------------
  it("无 logger 时 spawn 仍正常完成，不抛", async () => {
    const restore = stubPlatform("darwin");
    const fakeChild = makeFakeSuccessChild();
    spawnMock.mockReturnValue(fakeChild);

    const { openBrowser } = await import("./open-browser.js");
    const result = await openBrowser("http://localhost:4321/");
    expect(result.ok).toBe(true);
    // 无 logger 路径不会因 stdout 数据到来而抛
    expect(() => fakeChild.stdout.on.mock.calls[0][1](Buffer.from("hi"))).not.toThrow();
    restore();
  });

  // ----------------------------------------------------------------
  // 11) stderr 数据到来时用 logger.debug 输出（非 trimEnd 语义保护）
  // ----------------------------------------------------------------
  it("子进程 stderr 输出会被打到 logger.debug", async () => {
    const restore = stubPlatform("darwin");
    const fakeChild = makeFakeSuccessChild();
    spawnMock.mockReturnValue(fakeChild);

    const debugSpy = vi.fn();
    const logger = {
      debug: debugSpy,
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    const { openBrowser } = await import("./open-browser.js");
    await openBrowser("http://localhost:4321/", { logger });

    // 触发一次 stderr data 回调
    const onStderr = fakeChild.stderr.on.mock.calls[0][1] as (b: Buffer) => void;
    onStderr(Buffer.from("warning: missing font\n"));
    expect(debugSpy).toHaveBeenCalledWith(
      "[open-browser] open stderr:",
      "warning: missing font",
    );
    restore();
  });
});

beforeEach(() => {
  // 每个用例独立的模块级 mock 状态：spawn mock 已经 mockReset 过
  // 这里不需要额外动作，留 hook 保证语义清晰
});
