/**
 * i18n.js 测试 — F3 / WU-04a
 *
 * i18n.js 是经典 <script defer> 加载（非 ES module），运行时挂到 window.MyAgent.i18n。
 * 这里用 node:vm 起一个干净的全局上下文，注入 localStorage / CustomEvent / document
 * —— 不引 jsdom。
 *
 * 测试覆盖：
 *   - 全局挂载
 *   - 字典键值（≥ 30 键，zh / en 双语对齐）
 *   - t() 取翻译
 *   - 占位符替换（命名 + 位置）
 *   - 缺键 fallback（current → zh → key 本身）
 *   - setLang / getLang 切换
 *   - localStorage 持久化
 *   - 自定义事件 'my-agent-lang-change'
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, vi } from "vitest";

const I18N_PATH = fileURLToPath(new URL("../../web/js/shared/i18n.js", import.meta.url));
const I18N_SOURCE = readFileSync(I18N_PATH, "utf-8");

// ----------------------------------------------------------------------
// localStorage + CustomEvent mock
// ----------------------------------------------------------------------

interface FakeLocalStorage {
  store: Map<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
  key(i: number): string | null;
  get length(): number;
}

function makeLocalStorage(): FakeLocalStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem(k) {
      return store.has(k) ? store.get(k)! : null;
    },
    setItem(k, v) {
      store.set(k, String(v));
    },
    removeItem(k) {
      store.delete(k);
    },
    clear() {
      store.clear();
    },
    key(i) {
      return Array.from(store.keys())[i] ?? null;
    },
    get length() {
      return store.size;
    },
  };
}

interface FakeDocument {
  _listeners: Map<string, Array<{ cb: EventListener }>>;
  addEventListener(type: string, cb: EventListener): void;
  removeEventListener(type: string, cb: EventListener): void;
  dispatchEvent(evt: { type: string; detail?: any }): boolean;
}

function makeDocument(): FakeDocument {
  const doc: FakeDocument = {
    _listeners: new Map(),
    addEventListener(type, cb) {
      const list = doc._listeners.get(type) || [];
      list.push({ cb });
      doc._listeners.set(type, list);
    },
    removeEventListener(type, cb) {
      const list = doc._listeners.get(type);
      if (!list) return;
      const idx = list.findIndex((e) => e.cb === cb);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = doc._listeners.get(evt.type) || [];
      for (const entry of list.slice()) {
        try {
          entry.cb(evt as unknown as Event);
        } catch (_e) {
          /* ignore */
        }
      }
      return true;
    },
  };
  return doc;
}

// ----------------------------------------------------------------------
// i18n.js 加载 + 测试工具
// ----------------------------------------------------------------------

interface I18nApi {
  I18N: { zh: Record<string, string>; en: Record<string, string> };
  setLang(lang: string): string;
  getLang(): string;
  t(key: string, ...args: any[]): string;
  SUPPORTED_LANGS: string[];
  STORAGE_KEY: string;
  DEFAULT_LANG: string;
}

interface I18nGlobal {
  MyAgent: { i18n: I18nApi };
  localStorage: FakeLocalStorage;
  document: FakeDocument;
  CustomEvent: new (type: string, init?: { detail?: any }) => any;
  console: { error?: ReturnType<typeof vi.fn>; warn?: ReturnType<typeof vi.fn> };
}

interface LoadResult {
  g: I18nGlobal;
  localStorage: FakeLocalStorage;
  document: FakeDocument;
}

function loadI18n(opts: { storedLang?: string | null } = {}): LoadResult {
  const ls = makeLocalStorage();
  if (opts.storedLang !== null && opts.storedLang !== undefined) {
    ls.setItem("my-agent.lang", opts.storedLang);
  }
  const doc = makeDocument();

  const sandbox: Record<string, unknown> = {
    console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
    localStorage: ls,
    document: doc,
    CustomEvent: function (this: any, type: string, init?: { detail?: any }) {
      this.type = type;
      this.detail = init?.detail;
    } as unknown as new (type: string, init?: { detail?: any }) => any,
  };
  createContext(sandbox);
  runInContext(I18N_SOURCE, sandbox);
  return {
    g: sandbox as unknown as I18nGlobal,
    localStorage: ls,
    document: doc,
  };
}

// ======================================================================
// 测试
// ======================================================================

beforeEach(() => {
  // 每个测试用例起新 sandbox → 不需要 reset
});

describe("i18n.js — 全局挂载", () => {
  it("挂载到 window.MyAgent.i18n", () => {
    const { g } = loadI18n();
    expect(g.MyAgent).toBeDefined();
    expect(g.MyAgent.i18n).toBeDefined();
  });

  it("导出 t / setLang / getLang / I18N / SUPPORTED_LANGS", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(typeof i.t).toBe("function");
    expect(typeof i.setLang).toBe("function");
    expect(typeof i.getLang).toBe("function");
    expect(typeof i.I18N).toBe("object");
    expect(Array.isArray(i.SUPPORTED_LANGS)).toBe(true);
    expect(i.SUPPORTED_LANGS).toContain("zh");
    expect(i.SUPPORTED_LANGS).toContain("en");
    expect(i.STORAGE_KEY).toBe("my-agent.lang");
    expect(i.DEFAULT_LANG).toBe("zh");
  });

  it("源码无 emoji 且无 import / require", () => {
    expect(I18N_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(I18N_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(I18N_SOURCE).not.toMatch(/\brequire\s*\(/);
  });
});

describe("字典 — 中英双语对齐", () => {
  it("I18N.zh / I18N.en 都是 object 且非空", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(typeof i.I18N.zh).toBe("object");
    expect(typeof i.I18N.en).toBe("object");
    expect(Object.keys(i.I18N.zh).length).toBeGreaterThan(0);
    expect(Object.keys(i.I18N.en).length).toBeGreaterThan(0);
  });

  it("zh / en 至少 30 个键（spec 要求）", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(Object.keys(i.I18N.zh).length).toBeGreaterThanOrEqual(30);
    expect(Object.keys(i.I18N.en).length).toBeGreaterThanOrEqual(30);
  });

  it("zh 与 en 键集合完全一致（无遗漏翻译）", () => {
    const i = loadI18n().g.MyAgent.i18n;
    const zhKeys = Object.keys(i.I18N.zh).sort();
    const enKeys = Object.keys(i.I18N.en).sort();
    expect(enKeys).toEqual(zhKeys);
  });

  it("关键键存在（按钮 / 菜单 / 错误 / 占位符 4 类各 ≥ 1）", () => {
    const i = loadI18n().g.MyAgent.i18n;
    const keys = Object.keys(i.I18N.zh);
    // 按钮 / 菜单 / 错误 / 占位符 —— 每个分组至少 1 个键
    expect(keys.some((k) => k.startsWith("common."))).toBe(true);
    expect(keys.some((k) => k.startsWith("menu."))).toBe(true);
    expect(keys.some((k) => k.startsWith("error."))).toBe(true);
    expect(keys.some((k) => k.startsWith("placeholder."))).toBe(true);
  });
});

describe("t() — 基础翻译", () => {
  it("默认 zh：common.confirm → 确认", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.t("common.confirm")).toBe("确认");
  });

  it("en：menu.title → Main Menu", () => {
    const i = loadI18n({ storedLang: "en" }).g.MyAgent.i18n;
    expect(i.t("menu.title")).toBe("Main Menu");
  });

  it("zh → en：切换后立即生效", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.t("menu.title")).toBe("主菜单");
    i.setLang("en");
    expect(i.t("menu.title")).toBe("Main Menu");
    i.setLang("zh");
    expect(i.t("menu.title")).toBe("主菜单");
  });

  it("缺键 → 回退到 zh（fallback）", () => {
    // 用语言切换 + 不存在的键验证 fallback 路径
    const { g } = loadI18n();
    const i = g.MyAgent.i18n;
    // 模拟 en 中不存在某键（注入空 en）
    g.MyAgent.i18n.I18N.en = {};
    i.setLang("en");
    expect(i.t("common.confirm")).toBe("确认"); // fallback zh
  });

  it("缺键（zh 也没有） → 返回 key 本身", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.t("nonexistent.key")).toBe("nonexistent.key");
  });

  it("非字符串 key → 返回空字符串", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.t(undefined as unknown as string)).toBe("");
    expect(i.t(null as unknown as string)).toBe("");
  });
});

describe("t() — 占位符替换", () => {
  it("命名占位符 {name} + {count}", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.t("placeholder.userMessage", { name: "Alice", count: 3 })).toBe(
      "用户 Alice 发送了 3 条消息",
    );
  });

  it("英文命名占位符", () => {
    const i = loadI18n({ storedLang: "en" }).g.MyAgent.i18n;
    expect(
      i.t("placeholder.userMessage", { name: "Bob", count: 5 }),
    ).toBe("User Bob sent 5 messages");
  });

  it("占位符缺值 → 保留原 {key}", () => {
    const i = loadI18n().g.MyAgent.i18n;
    // 仅提供 name，count 缺 → {count} 保留
    const result = i.t("placeholder.userMessage", { name: "Alice" });
    expect(result).toBe("用户 Alice 发送了 {count} 条消息");
  });

  it("无占位符 + 额外参数 → 忽略多余参数", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.t("common.confirm", { x: 1 }, "extra")).toBe("确认");
  });
});

describe("setLang / getLang / 持久化", () => {
  it("默认 lang = zh", () => {
    const i = loadI18n().g.MyAgent.i18n;
    expect(i.getLang()).toBe("zh");
  });

  it("setLang('en') → 切换 + 写 localStorage", () => {
    const { g, localStorage } = loadI18n();
    const i = g.MyAgent.i18n;
    i.setLang("en");
    expect(i.getLang()).toBe("en");
    expect(localStorage.getItem("my-agent.lang")).toBe("en");
  });

  it("setLang 非法 lang → 兜底为 DEFAULT_LANG", () => {
    const { g, localStorage } = loadI18n();
    const i = g.MyAgent.i18n;
    i.setLang("fr"); // 不支持
    expect(i.getLang()).toBe("zh");
    expect(localStorage.getItem("my-agent.lang")).toBe("zh");
  });

  it("启动时从 localStorage 读 storedLang", () => {
    const i = loadI18n({ storedLang: "en" }).g.MyAgent.i18n;
    expect(i.getLang()).toBe("en");
  });

  it("启动时 storedLang 非法 → 回退到 zh", () => {
    const i = loadI18n({ storedLang: "fr" }).g.MyAgent.i18n;
    expect(i.getLang()).toBe("zh");
  });

  it("setLang 触发 my-agent-lang-change 事件", () => {
    const { g, document } = loadI18n();
    const cb = vi.fn();
    document.addEventListener("my-agent-lang-change", cb);
    g.MyAgent.i18n.setLang("en");
    expect(cb).toHaveBeenCalledTimes(1);
    const evt = cb.mock.calls[0]![0] as any;
    expect(evt.detail).toEqual({ lang: "en" });
  });
});

describe("localStorage 禁用兜底", () => {
  it("localStorage 抛错时 getLang / setLang 不抛", () => {
    // 模拟 localStorage 抛 SecurityError
    const broken: any = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    const sandbox: Record<string, unknown> = {
      console: { error: vi.fn(), warn: vi.fn(), log: vi.fn() },
      localStorage: broken,
      document: makeDocument(),
      CustomEvent: function (this: any, type: string, init?: { detail?: any }) {
        this.type = type;
        this.detail = init?.detail;
      },
    };
    createContext(sandbox);
    runInContext(I18N_SOURCE, sandbox);
    const i = (sandbox as unknown as I18nGlobal).MyAgent.i18n;
    expect(() => i.setLang("en")).not.toThrow();
    expect(i.getLang()).toBe("en");
  });
});