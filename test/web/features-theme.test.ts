import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * features/theme.js 是经典 <script defer> 脚本（非 ES module），运行时挂到全局。
 * 这里用 node:vm 起一个干净的全局上下文来加载它 —— 既贴近浏览器的真实加载方式，
 * 又不需要 jsdom（本仓库未装 jsdom，且本 WU 不引入任何依赖）。
 *
 * 跟 shared-icons.test.ts 一样的加载思路：
 *   1. 准备一个 sandbox（localStorage / document / window.MyAgent 等）
 *   2. 用 node:vm.runInContext 执行源码
 *   3. 从 sandbox 取 window.MyAgent.themeFeature
 *   4. mock window.MyAgent.theme(setTheme / getTheme / getSystemTheme)
 *   5. mock appendOutput / clearOutput
 *   6. 通过 installThemeCommand 返回的 handler 模拟 slash 派发
 *   7. 断言 localStorage / CustomEvent / appendOutput 调用
 */

const THEME_PATH = fileURLToPath(
  new URL("../../web/js/features/theme.js", import.meta.url),
);
const THEME_SOURCE = readFileSync(THEME_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Sandbox 工厂：每次 create 一个干净全局,避免 localStorage / dispatch 跨用例污染
// ---------------------------------------------------------------------------
interface FakeStorage {
  data: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
  key: (i: number) => string | null;
  get length(): number;
}

function createFakeStorage(): FakeStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
    removeItem: (k) => {
      data.delete(k);
    },
    clear: () => {
      data.clear();
    },
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
}

interface ThemeApiMock {
  setTheme: ReturnType<typeof vi.fn>;
  getTheme: ReturnType<typeof vi.fn>;
  getSystemTheme: ReturnType<typeof vi.fn>;
}

interface LoadedSandbox {
  themeFeature: {
    installThemeCommand: (opts: {
      appendOutput: (...args: unknown[]) => void;
      clearOutput: (...args: unknown[]) => void;
    }) => (rawInput: string) => void;
    nextInCycle: (current: string) => string;
    normalizeArg: (rawInput: string) => string;
    getCurrentTheme: () => string;
    getSystemThemeResolved: () => string;
    buildStatusMessage: (theme: string, systemTheme: string) => string;
    STORAGE_KEY: string;
    CHANGE_EVENT: string;
    COMMAND_NAME: string;
    CYCLE_ORDER: readonly string[];
  };
  storage: FakeStorage;
  documentListeners: Array<{ type: string; listener: EventListener }>;
  setTheme: ReturnType<typeof vi.fn>;
  getTheme: ReturnType<typeof vi.fn>;
  getSystemTheme: ReturnType<typeof vi.fn>;
  appendOutput: ReturnType<typeof vi.fn>;
  clearOutput: ReturnType<typeof vi.fn>;
}

function loadTheme(opts: {
  currentTheme?: string;
  systemTheme?: string;
} = {}): LoadedSandbox {
  const initial = opts.currentTheme ?? "system";
  const sys = opts.systemTheme ?? "light";

  const storage = createFakeStorage();
  storage.setItem("my-agent.theme", initial);

  // 让 setTheme/getTheme 反映真实 API 行为:setTheme 写入 dataset 后,
  // getTheme 应当返回最新值。这里用 closure 变量模拟 state。
  let currentState = initial;
  const setTheme = vi.fn((t: string) => {
    currentState = t;
    storage.setItem("my-agent.theme", t);
  });
  const getTheme = vi.fn(() => currentState);
  const getSystemTheme = vi.fn(() => sys);

  const documentListeners: Array<{ type: string; listener: EventListener }> = [];

  // Fake document(只实现本测试用到的方法)
  const fakeDocument = {
    addEventListener: (type: string, listener: EventListener) => {
      documentListeners.push({ type, listener });
    },
    removeEventListener: () => {},
    dispatchEvent: (evt: Event) => {
      for (const { type, listener } of documentListeners) {
        if (type === evt.type) {
          try {
            listener(evt);
          } catch (_e) {
            // ignore
          }
        }
      }
      return true;
    },
  };

  // sandbox:window-like 对象
  const sandbox: Record<string, unknown> = {
    localStorage: storage,
    document: fakeDocument,
    console: { warn: () => {} },
    CustomEvent: class FakeCustomEvent<T = unknown> {
      type: string;
      detail: T;
      bubbles: boolean;
      cancelable: boolean;
      constructor(type: string, init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {}) {
        this.type = type;
        this.detail = init.detail as T;
        this.bubbles = !!init.bubbles;
        this.cancelable = !!init.cancelable;
      }
    },
    MyAgent: {
      theme: {
        setTheme,
        getTheme,
        getSystemTheme,
      },
    },
  };

  createContext(sandbox);
  runInContext(THEME_SOURCE, sandbox);

  const themeFeature = (sandbox as { MyAgent: { themeFeature: LoadedSandbox["themeFeature"] } })
    .MyAgent.themeFeature;

  return {
    themeFeature,
    storage,
    documentListeners,
    setTheme,
    getTheme,
    getSystemTheme,
    appendOutput: vi.fn(),
    clearOutput: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// 测试用例(> 8 个)
// ---------------------------------------------------------------------------

describe("features/theme.js — 全局导出", () => {
  it("挂载 themeFeature 到 window.MyAgent", () => {
    const sb = loadTheme();
    expect(sb.themeFeature).toBeDefined();
    expect(typeof sb.themeFeature.installThemeCommand).toBe("function");
  });

  it("暴露常量 STORAGE_KEY / CHANGE_EVENT / COMMAND_NAME / CYCLE_ORDER", () => {
    const sb = loadTheme();
    expect(sb.themeFeature.STORAGE_KEY).toBe("my-agent.theme");
    expect(sb.themeFeature.CHANGE_EVENT).toBe("my-agent:theme-change");
    expect(sb.themeFeature.COMMAND_NAME).toBe("/theme");
    expect(sb.themeFeature.CYCLE_ORDER).toEqual(["dark", "light", "system"]);
  });

  it("暴露 nextInCycle / normalizeArg / buildStatusMessage 等纯函数", () => {
    const sb = loadTheme();
    expect(typeof sb.themeFeature.nextInCycle).toBe("function");
    expect(typeof sb.themeFeature.normalizeArg).toBe("function");
    expect(typeof sb.themeFeature.buildStatusMessage).toBe("function");
  });
});

describe("installThemeCommand — 返回 handler", () => {
  it("返回的 handler 是函数", () => {
    const sb = loadTheme();
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    expect(typeof handler).toBe("function");
  });

  it("未传 appendOutput/clearOutput 也不会抛错（降级 noop）", () => {
    const sb = loadTheme();
    const handler = sb.themeFeature.installThemeCommand({} as never);
    expect(() => handler("/theme")).not.toThrow();
    expect(() => handler("/theme dark")).not.toThrow();
  });
});

describe("/theme 命令 — 直接设值(dark / light / system)", () => {
  it("/theme dark 写入 dark + 派发事件 + 输出消息", () => {
    const sb = loadTheme({ currentTheme: "light" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    handler("/theme dark");

    expect(sb.setTheme).toHaveBeenCalledTimes(1);
    expect(sb.setTheme).toHaveBeenCalledWith("dark");
    expect(sb.storage.getItem("my-agent.theme")).toBe("dark");
    expect(sb.appendOutput).toHaveBeenCalledTimes(1);
    const arg = sb.appendOutput.mock.calls[0]?.[0] as { role: string; content: string };
    expect(arg.role).toBe("system");
    expect(arg.content).toContain("当前主题: dark");
    expect(arg.content).toContain("跟随系统: light");
  });

  it("/theme light 写入 light", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/theme light");
    expect(sb.setTheme).toHaveBeenCalledWith("light");
    expect(sb.storage.getItem("my-agent.theme")).toBe("light");
  });

  it("/theme system 写入 system + systemTheme 跟随 mock 返回值", () => {
    const sb = loadTheme({ currentTheme: "dark", systemTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/theme system");

    expect(sb.setTheme).toHaveBeenCalledWith("system");
    expect(sb.storage.getItem("my-agent.theme")).toBe("system");
    const arg = sb.appendOutput.mock.calls[0]?.[0] as { content: string };
    expect(arg.content).toContain("当前主题: system");
    expect(arg.content).toContain("跟随系统: dark");
  });
});

describe("/theme 命令 — 无参循环(dark → light → system → dark)", () => {
  it("起始 dark → 一次 /theme 进入 light", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/theme");
    expect(sb.setTheme).toHaveBeenCalledWith("light");
  });

  it("起始 light → 一次 /theme 进入 system", () => {
    const sb = loadTheme({ currentTheme: "light" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/theme");
    expect(sb.setTheme).toHaveBeenCalledWith("system");
  });

  it("起始 system → 一次 /theme 回到 dark", () => {
    const sb = loadTheme({ currentTheme: "system" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/theme");
    expect(sb.setTheme).toHaveBeenCalledWith("dark");
  });

  it("连续三次无参从 dark 一路循环到 dark（dark → light → system → dark）", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    handler("/theme");
    handler("/theme");
    handler("/theme");

    expect(sb.setTheme.mock.calls.map((c) => c[0])).toEqual([
      "light",
      "system",
      "dark",
    ]);
  });
});

describe("/theme 命令 — 大小写不敏感", () => {
  it("/Theme Dark 生效", () => {
    const sb = loadTheme({ currentTheme: "light" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/Theme Dark");
    expect(sb.setTheme).toHaveBeenCalledWith("dark");
    expect(sb.storage.getItem("my-agent.theme")).toBe("dark");
  });

  it("/  THEME   LIGHT  (含多余空白) 生效", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/  THEME   LIGHT  ");
    expect(sb.setTheme).toHaveBeenCalledWith("light");
  });

  it("无前导斜杠也能解析（'theme System'）", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("theme System");
    expect(sb.setTheme).toHaveBeenCalledWith("system");
  });
});

describe("/theme 命令 — 错误处理", () => {
  it("未知主题值输出错误提示,不写 localStorage,不调 setTheme", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    handler("/theme bogus");

    expect(sb.setTheme).not.toHaveBeenCalled();
    expect(sb.storage.getItem("my-agent.theme")).toBe("dark"); // 未变
    expect(sb.appendOutput).toHaveBeenCalledTimes(1);
    const arg = sb.appendOutput.mock.calls[0]?.[0] as { content: string };
    expect(arg.content).toContain("未知主题值");
    expect(arg.content).toContain("dark | light | system");
  });
});

describe("/theme reset — 清空 transcript", () => {
  it("/theme reset 触发 clearOutput + 一行 system 提示", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    handler("/theme reset");

    expect(sb.clearOutput).toHaveBeenCalledTimes(1);
    expect(sb.setTheme).not.toHaveBeenCalled(); // reset 不改主题
    expect(sb.appendOutput).toHaveBeenCalledTimes(1);
    const arg = sb.appendOutput.mock.calls[0]?.[0] as { role: string; content: string };
    expect(arg.role).toBe("system");
    expect(arg.content).toContain("清空");
  });

  it("/Theme RESET (大写) 同样触发", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    handler("/Theme RESET");
    expect(sb.clearOutput).toHaveBeenCalledTimes(1);
  });
});

describe("CustomEvent 'my-agent:theme-change' 派发", () => {
  it("派发的事件 type 与 detail 内容正确", () => {
    const sb = loadTheme({ currentTheme: "light", systemTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    const seen: Array<{ type: string; detail: unknown }> = [];
    // 临时挂一个监听器抓事件
    sb.documentListeners.push({
      type: "my-agent:theme-change",
      listener: ((evt: Event) => {
        seen.push({
          type: evt.type,
          detail: (evt as CustomEvent).detail,
        });
      }) as EventListener,
    });

    handler("/theme dark");

    expect(seen).toHaveLength(1);
    expect(seen[0]!.type).toBe("my-agent:theme-change");
    const detail = seen[0]!.detail as { theme: string; systemTheme: string };
    expect(detail.theme).toBe("dark");
    expect(detail.systemTheme).toBe("dark");
  });

  it("循环无参时每次都派发一次", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    const seen: string[] = [];
    sb.documentListeners.push({
      type: "my-agent:theme-change",
      listener: ((evt: Event) => {
        seen.push((evt as CustomEvent).detail.theme);
      }) as EventListener,
    });

    handler("/theme");
    handler("/theme");
    handler("/theme");

    expect(seen).toEqual(["light", "system", "dark"]);
  });
});

describe("localStorage 持久化", () => {
  it("每次成功命令都写入 localStorage['my-agent.theme']", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });

    handler("/theme light");
    expect(sb.storage.getItem("my-agent.theme")).toBe("light");

    handler("/theme");
    expect(sb.storage.getItem("my-agent.theme")).toBe("system");

    handler("/theme");
    expect(sb.storage.getItem("my-agent.theme")).toBe("dark");
  });

  it("localStorage 抛出(隐私模式)时,不阻塞命令(降级静默)", () => {
    const sb = loadTheme({ currentTheme: "dark" });
    // 模拟 setItem 抛错
    sb.storage.setItem = vi.fn(() => {
      throw new Error("SecurityError: localStorage disabled");
    });
    const handler = sb.themeFeature.installThemeCommand({
      appendOutput: sb.appendOutput,
      clearOutput: sb.clearOutput,
    });
    expect(() => handler("/theme light")).not.toThrow();
    expect(sb.setTheme).toHaveBeenCalledWith("light"); // setTheme 仍照常调
    expect(sb.appendOutput).toHaveBeenCalledTimes(1);
  });
});

describe("降级路径 — window.MyAgent.theme 不存在", () => {
  it("getThemeApi 缺失时仍能基于 localStorage 循环", () => {
    // 不挂 MyAgent.theme,只准备 storage
    const storage = createFakeStorage();
    storage.setItem("my-agent.theme", "dark");

    const fakeDocument = {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };

    const sandbox: Record<string, unknown> = {
      localStorage: storage,
      document: fakeDocument,
      console: { warn: () => {} },
      CustomEvent: class {
        type: string;
        detail: unknown;
        constructor(type: string, init: { detail?: unknown } = {}) {
          this.type = type;
          this.detail = init.detail;
        }
      },
      MyAgent: {}, // 注意：故意没有 theme
    };

    createContext(sandbox);
    runInContext(THEME_SOURCE, sandbox);

    const tf = (sandbox as { MyAgent: { themeFeature: { nextInCycle: (c: string) => string; getCurrentTheme: () => string } } })
      .MyAgent.themeFeature;

    expect(tf.getCurrentTheme()).toBe("dark");
    expect(tf.nextInCycle("dark")).toBe("light");
  });
});

describe("辅助函数(nextInCycle / buildStatusMessage / normalizeArg)", () => {
  it("nextInCycle: 未知值回到 dark", () => {
    const sb = loadTheme();
    expect(sb.themeFeature.nextInCycle("nope")).toBe("dark");
    expect(sb.themeFeature.nextInCycle("")).toBe("dark");
  });

  it("nextInCycle: system 后回到 dark(完整循环)", () => {
    const sb = loadTheme();
    expect(sb.themeFeature.nextInCycle("dark")).toBe("light");
    expect(sb.themeFeature.nextInCycle("light")).toBe("system");
    expect(sb.themeFeature.nextInCycle("system")).toBe("dark");
  });

  it("buildStatusMessage 格式: 当前主题: <t> (跟随系统: <s>)", () => {
    const sb = loadTheme();
    expect(sb.themeFeature.buildStatusMessage("dark", "light")).toBe(
      "当前主题: dark (跟随系统: light)",
    );
    expect(sb.themeFeature.buildStatusMessage("system", "dark")).toBe(
      "当前主题: system (跟随系统: dark)",
    );
  });

  it("normalizeArg 处理前导 /theme + 多余空白 + 大小写", () => {
    const sb = loadTheme();
    expect(sb.themeFeature.normalizeArg("/theme")).toBe("");
    expect(sb.themeFeature.normalizeArg("/theme dark")).toBe("dark");
    expect(sb.themeFeature.normalizeArg("/Theme Dark")).toBe("dark");
    expect(sb.themeFeature.normalizeArg("  /THEME   LIGHT  ")).toBe("light");
    expect(sb.themeFeature.normalizeArg("theme System")).toBe("system");
  });
});

describe("源码约定", () => {
  it("不引入任何依赖(无 import / require)", () => {
    expect(THEME_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(THEME_SOURCE).not.toMatch(/\brequire\s*\(/);
  });

  it("使用 IIFE 模式(spec § 4.4.6)而不暴露局部变量", () => {
    // 顶部 (function (global) { ... })(...) 包裹 —— 注释之后
    expect(THEME_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(THEME_SOURCE.trimEnd().endsWith(");")).toBe(true);
  });

  it("挂载到 window.MyAgent.themeFeature", () => {
    expect(THEME_SOURCE).toMatch(/global\.MyAgent\s*=\s*global\.MyAgent\s*\|\|\s*\{\}/);
    expect(THEME_SOURCE).toMatch(/global\.MyAgent\.themeFeature\s*=/);
  });
});
