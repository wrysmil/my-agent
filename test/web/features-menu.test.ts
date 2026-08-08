/**
 * features/menu.js 测试 — F8 / WU-05b
 * ----------------------------------------------------------------------------
 * menu.js 是经典 <script defer> 加载（非 ES module），运行时挂到
 * window.MyAgent.menuFeature。这里用 node:vm 起一个干净全局上下文，
 * 注入最小 DOM mock + mock utils.el + mock icons.iconHtml + mock themeModule。
 *
 * 测试覆盖（≥ 12 用例）：
 *   1. 全局挂载 + 导出 installMainMenu / 常量 / 9 项 MENU_ITEMS
 *   2. 源码无 emoji + IIFE 模式
 *   3. installMainMenu 渲染 9 张卡片到容器
 *   4. 每张卡片属性：role=gridcell + tabindex=0 + aria-label + data-menu-id
 *   5. 每张卡片有 icon + digit + label + desc 子元素
 *   6. 网格：role=grid + aria-rowcount=3 + aria-colcount=3
 *   7. chat 点击 → onNavigate({ panel: 'chat' })
 *   8. sessions 点击 → onNavigate({ panel: 'sessions' })
 *   9. providers 点击 → onNavigate({ panel: 'providers' })
 *  10. agents 点击 → onNavigate({ panel: 'agents' }) + tab-change(agents)
 *  11. skills 点击 → onNavigate({ panel: 'agents' }) + tab-change(skills)
 *  12. settings 点击 → onNavigate({ panel: 'settings' })
 *  13. menu 点击 → onNavigate({ panel: 'home' })
 *  14. theme 点击 → themeModule.applyTheme 调 + setStoredTheme + my-agent-theme-change 派发
 *  15. compact 点击 → my-agent:compact-request 派发（不调 onNavigate）
 *  16. 键盘 Enter 触发 + Space 触发
 *  17. 监听 'my-agent:menu-action' 事件（HomePanel 集成）
 *  18. uninstall 清理 document 监听 + 摘除 DOM
 *  19. rerender 重渲染（i18n 切换后）
 *  20. 容器缺失 → 抛错
 *  21. theme 三态轮转 dark→light→system→dark
 *  22. i18n 缺键时走 INLINE_DICT fallback
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const MENU_PATH = fileURLToPath(
  new URL("../../web/js/features/menu.js", import.meta.url),
);
const MENU_SOURCE = readFileSync(MENU_PATH, "utf-8");

const UTILS_PATH = fileURLToPath(
  new URL("../../web/js/shared/utils.js", import.meta.url),
);
const UTILS_SOURCE = readFileSync(UTILS_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Fake DOM — 与 features-sessions.test.ts 同思路（最小 element 模拟）
// ---------------------------------------------------------------------------

interface FakeAttr {
  name: string;
  value: string;
}
interface FakeNode {
  nodeType: number;
  parentNode: FakeNode | null;
  children: FakeNode[];
  textContent: string;
  innerHTML: string;
  appendChild(c: FakeNode): FakeNode;
  removeChild(c: FakeNode): FakeNode;
}
interface FakeElement extends FakeNode {
  tagName: string;
  id: string;
  className: string;
  disabled: boolean;
  type: string;
  value: string;
  hidden: boolean;
  attributes: FakeAttr[];
  dataset: Record<string, string>;
  _listeners: Map<string, Array<{ cb: EventListener; opts?: unknown }>>;
  firstChild: FakeNode | null;
  lastChild: FakeNode | null;
  addEventListener(type: string, cb: EventListener, opts?: unknown): void;
  removeEventListener(type: string, cb: EventListener, opts?: unknown): void;
  dispatchEvent(evt: { type: string; target?: FakeElement; detail?: unknown; key?: string; bubbles?: boolean; cancelable?: boolean }): boolean;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  closest(sel: string): FakeElement | null;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
  focus(): void;
  click(): void;
}

function isElement(n: FakeNode | null): n is FakeElement {
  return n !== null && (n as FakeElement).tagName !== undefined;
}

function makeElement(tagName: string): FakeElement {
  const listeners = new Map<string, Array<{ cb: EventListener; opts?: unknown }>>();
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    id: "",
    className: "",
    disabled: false,
    type: "",
    value: "",
    hidden: false,
    attributes: [],
    dataset: {},
    _listeners: listeners,
    children: [],
    parentNode: null,
    textContent: "",
    innerHTML: "",
    get firstChild(): FakeNode | null {
      return el.children.length > 0 ? el.children[0]! : null;
    },
    get lastChild(): FakeNode | null {
      return el.children.length > 0 ? el.children[el.children.length - 1]! : null;
    },
    appendChild(c) {
      c.parentNode = el;
      el.children.push(c);
      // text node (nodeType === 3): 追加到 textContent
      if (!isElement(c) && (c as { nodeType?: number }).nodeType === 3) {
        el.textContent += (c as { textContent: string }).textContent;
      } else if (isElement(c)) {
        el.textContent += c.textContent;
      }
      return c;
    },
    removeChild(c) {
      const i = el.children.indexOf(c);
      if (i >= 0) {
        el.children.splice(i, 1);
        c.parentNode = null;
        if (isElement(c)) {
          el.textContent = "";
          for (const ch of el.children) {
            if (isElement(ch)) el.textContent += ch.textContent;
            else if ((ch as { nodeType?: number }).nodeType === 3)
              el.textContent += (ch as { textContent: string }).textContent;
          }
        }
      }
      return c;
    },
    setAttribute(name, value) {
      const lower = name.toLowerCase();
      const existing = el.attributes.find((a) => a.name.toLowerCase() === lower);
      if (existing) existing.value = String(value);
      else el.attributes.push({ name, value: String(value) });
      if (lower === "id") el.id = String(value);
      if (lower === "class") el.className = String(value);
      if (lower === "disabled") el.disabled = value === "" || value === "true";
      if (lower === "hidden") el.hidden = value === "" || value === "true";
      if (lower === "type") el.type = String(value);
      if (name.startsWith("data-")) {
        el.dataset[name.slice("data-".length)] = String(value);
      }
    },
    getAttribute(name) {
      const lower = name.toLowerCase();
      return (
        el.attributes.find((a) => a.name.toLowerCase() === lower)?.value ?? null
      );
    },
    removeAttribute(name) {
      const lower = name.toLowerCase();
      const i = el.attributes.findIndex(
        (a) => a.name.toLowerCase() === lower,
      );
      if (i >= 0) el.attributes.splice(i, 1);
    },
    addEventListener(type, cb, opts) {
      const list = listeners.get(type) || [];
      list.push({ cb, opts });
      listeners.set(type, list);
    },
    removeEventListener(type, cb, opts) {
      const list = listeners.get(type);
      if (!list) return;
      const idx = list.findIndex(
        (e) =>
          e.cb === cb &&
          JSON.stringify(e.opts || {}) === JSON.stringify(opts || {}),
      );
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = listeners.get(evt.type);
      // 模拟事件冒泡：除了自己，也向父级链派发（仅当 evt.bubbles !== false）
      const bubbles = evt.bubbles !== false;
      const targetEl = (evt.target as FakeElement) || el;
      // 先自己
      if (list) {
        for (const entry of list.slice()) {
          try {
            entry.cb({ ...evt, target: targetEl } as unknown as Event);
          } catch (_e) {
            /* ignore */
          }
        }
      }
      // 再向上冒泡（直到 body / document）
      if (bubbles) {
        let cur: FakeElement | null = el.parentNode && isElement(el.parentNode)
          ? (el.parentNode as FakeElement)
          : null;
        while (cur) {
          const parentList = cur._listeners.get(evt.type);
          if (parentList) {
            for (const entry of parentList.slice()) {
              try {
                entry.cb({ ...evt, target: targetEl, currentTarget: cur } as unknown as Event);
              } catch (_e) {
                /* ignore */
              }
            }
          }
          cur = cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
        }
      }
      return true;
    },
    closest(sel) {
      // 支持 [data-menu-id='xxx']、[data-menu-id] (属性存在)
      const valMatch = sel.match(/^\[data-menu-id=['"]([^'"]+)['"]\]$/);
      const presenceMatch = sel === "[data-menu-id]";
      if (valMatch || presenceMatch) {
        const wanted = valMatch ? valMatch[1]! : null;
        let cur: FakeElement | null = el;
        while (cur) {
          const v = cur.getAttribute("data-menu-id");
          if (v !== null && (wanted === null || v === wanted)) return cur;
          cur = cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
        }
        return null;
      }
      // 简易 class 选择器 .menu-card-label
      const classMatch = sel.match(/^\.([a-zA-Z0-9_-]+)$/);
      if (classMatch) {
        const cls = classMatch[1]!;
        let cur: FakeElement | null = el;
        while (cur) {
          if ((cur.className || "").split(/\s+/).includes(cls)) return cur;
          cur = cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
        }
        return null;
      }
      return null;
    },
    querySelector(sel) {
      // 仅支持 .menu-card-label / [data-menu-id='xxx']
      const classMatch = sel.match(/^\.([a-zA-Z0-9_-]+)$/);
      const wantClass = classMatch ? classMatch[1]! : null;
      const valMatch = sel.match(/^\[data-menu-id=['"]([^'"]+)['"]\]$/);
      const wantId = valMatch ? valMatch[1]! : null;
      function dfs(node: FakeNode | null): FakeElement | null {
        if (!node) return null;
        if (isElement(node)) {
          if (wantClass && (node.className || "").split(/\s+/).includes(wantClass))
            return node;
          if (wantId && node.getAttribute("data-menu-id") === wantId) return node;
        }
        for (const ch of node.children) {
          const r = dfs(ch);
          if (r) return r;
        }
        return null;
      }
      return dfs(el);
    },
    querySelectorAll(_sel) {
      return [];
    },
    focus() {},
    click() {
      // 单次派发 + 冒泡（由 dispatchEvent 自身模拟冒泡到父级链）
      el.dispatchEvent({ type: "click", target: el });
    },
  };
  // 同步 NATIVE_PROPS
  const NATIVE_PROPS = new Set([
    "id", "title", "lang", "dir", "tabIndex", "hidden", "type", "name", "value",
    "href", "src", "alt", "placeholder", "disabled", "checked", "selected",
    "readOnly", "required", "maxLength", "minLength", "min", "max", "step",
    "rows", "cols", "role", "style", "autofocus",
  ]);
  for (const p of NATIVE_PROPS) {
    let backing: any = undefined;
    Object.defineProperty(el, p, {
      get() {
        return backing;
      },
      set(v: any) {
        backing = v;
        const existing = el.attributes.find(
          (a) => a.name.toLowerCase() === p.toLowerCase(),
        );
        const str =
          v === true ? "" : v === false || v == null ? null : String(v);
        if (existing) {
          if (str === null) {
            const i = el.attributes.indexOf(existing);
            el.attributes.splice(i, 1);
          } else {
            existing.value = str;
          }
        } else if (str !== null) {
          el.attributes.push({ name: p, value: str });
        }
      },
      configurable: true,
      enumerable: true,
    });
  }
  return el;
}

function makeTextNode(text: string): FakeNode {
  return {
    nodeType: 3,
    parentNode: null,
    children: [],
    textContent: text,
    innerHTML: text,
    appendChild(c) {
      this.children.push(c);
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
      return c;
    },
  };
}

interface FakeDocument {
  body: FakeElement;
  createElement(tag: string): FakeElement;
  createTextNode(text: string): FakeNode;
  addEventListener(type: string, cb: EventListener): void;
  removeEventListener(type: string, cb: EventListener): void;
  dispatchEvent(evt: { type: string; detail?: unknown; target?: FakeElement }): boolean;
  getElementById(id: string): FakeElement | null;
  documentElement: FakeElement;
}

function makeDocument(): FakeDocument {
  const body = makeElement("body");
  const docListeners = new Map<string, EventListener[]>();
  const documentElement = makeElement("html");
  const doc: FakeDocument = {
    body,
    documentElement,
    createElement(tag) {
      return makeElement(tag);
    },
    createTextNode(text) {
      return makeTextNode(text);
    },
    addEventListener(type, cb) {
      const list = docListeners.get(type) || [];
      list.push(cb);
      docListeners.set(type, list);
    },
    removeEventListener(type, cb) {
      const list = docListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(cb);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = docListeners.get(evt.type);
      if (!list) return true;
      for (const cb of list.slice()) {
        try {
          cb({ ...evt, type: evt.type, target: evt.target } as unknown as Event);
        } catch (_e) {
          /* ignore */
        }
      }
      return true;
    },
    getElementById(_id) {
      return null;
    },
  };
  return doc;
}

// ---------------------------------------------------------------------------
// Mock themeModule
// ---------------------------------------------------------------------------

interface MockThemeModule {
  applyTheme: ReturnType<typeof vi.fn>;
  setStoredTheme: ReturnType<typeof vi.fn>;
  getStoredTheme: ReturnType<typeof vi.fn>;
  stored: string;
}

function makeMockThemeModule(initial: string = "system"): MockThemeModule {
  const mod: MockThemeModule = {
    applyTheme: vi.fn(),
    setStoredTheme: vi.fn(),
    getStoredTheme: vi.fn(),
    stored: initial,
  };
  mod.getStoredTheme.mockImplementation(() => mod.stored);
  mod.setStoredTheme.mockImplementation((v: string) => {
    mod.stored = v;
  });
  return mod;
}

// ---------------------------------------------------------------------------
// Sandbox 加载
// ---------------------------------------------------------------------------

interface LoadedSandbox {
  mf: {
    installMainMenu: (opts: any) => any;
    MENU_ITEMS: any[];
    MENU_ACTION_EVENT: string;
    THEME_CHANGE_EVENT: string;
    COMPACT_REQUEST_EVENT: string;
    TAB_CHANGE_EVENT: string;
    _nextTheme: (cur: string) => string;
    _currentTheme: () => string;
    _runAction: (p: any, nav: any) => void;
    _INLINE_DICT: any;
  };
  utils: { el: any };
  icons: { iconHtml: ReturnType<typeof vi.fn> };
  themeModule: MockThemeModule;
  document: FakeDocument;
  documentListeners: Array<{ type: string; listener: EventListener }>;
  fireDocumentEvent(type: string, detail: unknown): void;
  container: FakeElement;
}

function loadMenu(opts: {
  lang?: "zh" | "en";
  initialTheme?: string;
} = {}): LoadedSandbox {
  const lang = opts.lang ?? "zh";
  const initialTheme = opts.initialTheme ?? "system";
  const mockTheme = makeMockThemeModule(initialTheme);

  const doc = makeDocument();
  const documentListeners: Array<{ type: string; listener: EventListener }> = [];
  const wrappedDoc = {
    ...doc,
    addEventListener(type: string, listener: EventListener) {
      documentListeners.push({ type, listener });
    },
    removeEventListener(type: string, listener: EventListener) {
      const i = documentListeners.findIndex(
        (e) => e.type === type && e.listener === listener,
      );
      if (i >= 0) documentListeners.splice(i, 1);
    },
    dispatchEvent(evt: { type: string; detail?: unknown; target?: FakeElement }) {
      for (const { type, listener } of documentListeners) {
        if (type === evt.type) {
          try {
            listener({
              ...evt,
              type: evt.type,
              target: evt.target,
            } as unknown as Event);
          } catch (_e) {
            /* ignore */
          }
        }
      }
      return true;
    },
  };

  // mock utils.el —— 走真 utils.js，但确保 removeChild 等正确运作
  // 由于 utils.js 在我们的 fake DOM 上行为基本可用，这里直接复用真源码
  const localStorage = {
    data: new Map<string, string>(),
    getItem(k: string) {
      return this.data.has(k) ? this.data.get(k)! : null;
    },
    setItem(k: string, v: string) {
      this.data.set(k, String(v));
    },
    removeItem(k: string) {
      this.data.delete(k);
    },
    clear() {
      this.data.clear();
    },
    key(i: number) {
      return Array.from(this.data.keys())[i] ?? null;
    },
    get length() {
      return this.data.size;
    },
  };
  // 预设语言
  localStorage.setItem("my-agent.lang", lang);

  const iconHtmlMock = vi.fn((name: string, size: number) => {
    return `<svg data-icon="${name}" width="${size}" height="${size}"></svg>`;
  });
  const iconsMock = { iconHtml: iconHtmlMock, hasIcon: vi.fn(() => true) };

  const sandbox: Record<string, unknown> = {
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
    setTimeout: setTimeout as typeof setTimeout,
    clearTimeout: clearTimeout as typeof clearTimeout,
    CustomEvent: class FakeCustomEvent<T = unknown> {
      type: string;
      detail: T;
      bubbles: boolean;
      cancelable: boolean;
      constructor(
        type: string,
        init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {},
      ) {
        this.type = type;
        this.detail = init.detail as T;
        this.bubbles = !!init.bubbles;
        this.cancelable = !!init.cancelable;
      }
    },
    location: { origin: "http://localhost" },
    localStorage,
    document: wrappedDoc,
    MyAgent: {
      themeModule: mockTheme,
      icons: iconsMock,
    },
  };

  createContext(sandbox);
  // 加载 utils → menu
  runInContext(UTILS_SOURCE, sandbox);
  runInContext(MENU_SOURCE, sandbox);

  const mf = (sandbox as { MyAgent: { menuFeature: any } }).MyAgent.menuFeature;
  const utils = (sandbox as { MyAgent: { utils: any } }).MyAgent.utils;

  const container = makeElement("div");
  container.id = "menu-host";
  wrappedDoc.body.appendChild(container);

  return {
    mf,
    utils,
    icons: iconsMock,
    themeModule: mockTheme,
    document: wrappedDoc as unknown as FakeDocument,
    documentListeners,
    container,
    fireDocumentEvent(type, detail) {
      for (const { type: t, listener } of documentListeners) {
        if (t === type) {
          try {
            listener({ type, detail } as unknown as Event);
          } catch (_e) {
            /* ignore */
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("features/menu.js — 全局挂载 & 静态导出", () => {
  it("挂载到 window.MyAgent.menuFeature", () => {
    const sb = loadMenu();
    expect(sb.mf).toBeDefined();
    expect(typeof sb.mf.installMainMenu).toBe("function");
  });

  it("导出 4 个事件名常量", () => {
    const sb = loadMenu();
    expect(sb.mf.MENU_ACTION_EVENT).toBe("my-agent:menu-action");
    expect(sb.mf.THEME_CHANGE_EVENT).toBe("my-agent-theme-change");
    expect(sb.mf.COMPACT_REQUEST_EVENT).toBe("my-agent:compact-request");
    expect(sb.mf.TAB_CHANGE_EVENT).toBe("my-agent:tab-change");
  });

  it("MENU_ITEMS 恰好 9 项 + id 唯一", () => {
    const sb = loadMenu();
    expect(sb.mf.MENU_ITEMS).toBeDefined();
    expect(sb.mf.MENU_ITEMS.length).toBe(9);
    const ids = sb.mf.MENU_ITEMS.map((m: any) => m.id);
    expect(new Set(ids).size).toBe(9);
    // spec § 5.1 必含
    const required = ["chat", "sessions", "providers", "agents", "skills", "menu", "theme", "compact", "settings"];
    for (const r of required) {
      expect(ids).toContain(r);
    }
  });

  it("源码无 emoji + IIFE 模式 + 挂到 window.MyAgent.menuFeature", () => {
    expect(MENU_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(MENU_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(MENU_SOURCE.trimEnd().endsWith(");")).toBe(true);
    expect(MENU_SOURCE).toMatch(/global\.MyAgent\.menuFeature\s*=/);
  });
});

describe("installMainMenu — 渲染 9 项 Bento Grid", () => {
  it("渲染 9 张卡片到 container（grid 子节点数 = 9）", () => {
    const sb = loadMenu();
    const handle = sb.mf.installMainMenu({
      container: sb.container,
      onNavigate: vi.fn(),
    });
    expect(handle).toBeDefined();
    expect(typeof handle.uninstall).toBe("function");
    // container 的第一个 child 是 grid；grid 的 children = 9 张卡片
    const grid = sb.container.children[0] as FakeElement;
    expect(grid).toBeDefined();
    expect(grid.tagName).toBe("DIV");
    const cards = grid.children.filter(isElement);
    expect(cards.length).toBe(9);
    handle.uninstall();
  });

  it("grid 容器属性：role=grid + aria-rowcount=3 + aria-colcount=3", () => {
    const sb = loadMenu();
    const handle = sb.mf.installMainMenu({
      container: sb.container,
      onNavigate: vi.fn(),
    });
    const grid = sb.container.children[0] as FakeElement;
    expect(grid.getAttribute("role")).toBe("grid");
    expect(grid.getAttribute("aria-rowcount")).toBe("3");
    expect(grid.getAttribute("aria-colcount")).toBe("3");
    expect(grid.getAttribute("aria-label")).toBeTruthy();
    handle.uninstall();
  });

  it("每张卡片：role=gridcell + tabindex=0 + aria-label + data-menu-id + aria-rowindex/colindex", () => {
    const sb = loadMenu();
    const handle = sb.mf.installMainMenu({
      container: sb.container,
      onNavigate: vi.fn(),
    });
    const grid = sb.container.children[0] as FakeElement;
    const cards = grid.children.filter(isElement) as FakeElement[];
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i]!;
      expect(card.getAttribute("role")).toBe("gridcell");
      expect(card.getAttribute("tabindex")).toBe("0");
      expect(card.getAttribute("aria-label")).toBeTruthy();
      expect(card.getAttribute("data-menu-id")).toBeTruthy();
      // 3x3 grid 的行列号
      expect(card.getAttribute("aria-rowindex")).toBe(String(Math.floor(i / 3) + 1));
      expect(card.getAttribute("aria-colindex")).toBe(String((i % 3) + 1));
    }
    handle.uninstall();
  });

  it("每张卡片包含 icon(digit) + label + desc 子元素", () => {
    const sb = loadMenu();
    const handle = sb.mf.installMainMenu({
      container: sb.container,
      onNavigate: vi.fn(),
    });
    const grid = sb.container.children[0] as FakeElement;
    const cards = grid.children.filter(isElement) as FakeElement[];
    for (const card of cards) {
      const digit = card.querySelector(".menu-card-digit");
      const label = card.querySelector(".menu-card-label");
      const desc = card.querySelector(".menu-card-desc");
      expect(digit).toBeTruthy();
      expect(label).toBeTruthy();
      expect(desc).toBeTruthy();
      expect(label!.textContent.length).toBeGreaterThan(0);
      expect(desc!.textContent.length).toBeGreaterThan(0);
    }
    handle.uninstall();
  });

  it("容器缺失 → 抛错", () => {
    const sb = loadMenu();
    expect(() =>
      sb.mf.installMainMenu({ container: null as any, onNavigate: vi.fn() }),
    ).toThrow(/container/);
  });

  it("utils.el 缺失 → 抛错", () => {
    const sb = loadMenu();
    // MyAgent.utils.el 临时摘掉（getUtils() 内部读 MyAgent.utils.el）
    const savedEl = sb.utils.el;
    (sb.utils as any).el = undefined;
    try {
      expect(() =>
        sb.mf.installMainMenu({
          container: sb.container,
          onNavigate: vi.fn(),
        }),
      ).toThrow(/utils\.el/);
    } finally {
      // 还原避免影响后续测试
      (sb.utils as any).el = savedEl;
    }
  });
});

describe("installMainMenu — 路由分发（onNavigate）", () => {
  it("chat 点击 → onNavigate({ panel: 'chat' })", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const grid = sb.container.children[0] as FakeElement;
    const card = grid.querySelector("[data-menu-id='chat']") as FakeElement;
    expect(card).toBeTruthy();
    card.click();
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith({ panel: "chat" });
    handle.uninstall();
  });

  it("sessions 点击 → onNavigate({ panel: 'sessions' })", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='sessions']",
    ) as FakeElement;
    card.click();
    expect(nav).toHaveBeenCalledWith({ panel: "sessions" });
    handle.uninstall();
  });

  it("providers 点击 → onNavigate({ panel: 'providers' })", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='providers']",
    ) as FakeElement;
    card.click();
    expect(nav).toHaveBeenCalledWith({ panel: "providers" });
    handle.uninstall();
  });

  it("agents 点击 → onNavigate({ panel: 'agents' }) + 派发 tab-change(agents)", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const tabHandler = vi.fn();
    sb.document.addEventListener("my-agent:tab-change", tabHandler as any);
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='agents']",
    ) as FakeElement;
    card.click();
    expect(nav).toHaveBeenCalledWith({ panel: "agents" });
    expect(tabHandler).toHaveBeenCalledTimes(1);
    const arg = (tabHandler.mock.calls[0]![0] as any).detail;
    expect(arg).toEqual({ tab: "agents" });
    handle.uninstall();
  });

  it("skills 点击 → onNavigate({ panel: 'agents' }) + 派发 tab-change(skills)", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const tabHandler = vi.fn();
    sb.document.addEventListener("my-agent:tab-change", tabHandler as any);
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='skills']",
    ) as FakeElement;
    card.click();
    expect(nav).toHaveBeenCalledWith({ panel: "agents" });
    expect(tabHandler).toHaveBeenCalledTimes(1);
    const arg = (tabHandler.mock.calls[0]![0] as any).detail;
    expect(arg).toEqual({ tab: "skills" });
    handle.uninstall();
  });

  it("settings 点击 → onNavigate({ panel: 'settings' })", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='settings']",
    ) as FakeElement;
    card.click();
    expect(nav).toHaveBeenCalledWith({ panel: "settings" });
    handle.uninstall();
  });

  it("menu 点击 → onNavigate({ panel: 'home' })", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='menu']",
    ) as FakeElement;
    card.click();
    expect(nav).toHaveBeenCalledWith({ panel: "home" });
    handle.uninstall();
  });
});

describe("installMainMenu — theme / compact 特殊路由", () => {
  it("theme 点击 → themeModule.applyTheme + setStoredTheme + 派发 theme-change", () => {
    const sb = loadMenu({ initialTheme: "dark" });
    const nav = vi.fn();
    const themeHandler = vi.fn();
    sb.document.addEventListener("my-agent-theme-change", themeHandler as any);
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='theme']",
    ) as FakeElement;
    card.click();
    // setStoredTheme 应该被调（写入下一个值）
    expect(sb.themeModule.setStoredTheme).toHaveBeenCalledTimes(1);
    expect(sb.themeModule.setStoredTheme).toHaveBeenCalledWith("light");
    // applyTheme 应被调
    expect(sb.themeModule.applyTheme).toHaveBeenCalledTimes(1);
    expect(sb.themeModule.applyTheme).toHaveBeenCalledWith("light");
    // 派发 my-agent-theme-change（detail.theme = 'light'）
    expect(themeHandler).toHaveBeenCalledTimes(1);
    const detail = (themeHandler.mock.calls[0]![0] as any).detail;
    expect(detail).toEqual({ theme: "light", prev: "dark" });
    // theme 路由走完会顺手调 onNavigate({ panel: 'settings' })
    expect(nav).toHaveBeenCalledWith({ panel: "settings" });
    handle.uninstall();
  });

  it("compact 点击 → 派发 compact-request（不调 onNavigate）", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const compactHandler = vi.fn();
    sb.document.addEventListener("my-agent:compact-request", compactHandler as any);
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='compact']",
    ) as FakeElement;
    card.click();
    expect(compactHandler).toHaveBeenCalledTimes(1);
    const detail = (compactHandler.mock.calls[0]![0] as any).detail;
    expect(detail.menuId).toBe("compact");
    expect(nav).not.toHaveBeenCalled();
    handle.uninstall();
  });
});

describe("installMainMenu — 键盘 + 事件接入", () => {
  it("键盘 Enter 触发对应菜单", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='chat']",
    ) as FakeElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute("data-menu-id")).toBe("chat");
    card.dispatchEvent({ type: "keydown", key: "Enter", target: card, bubbles: true });
    expect(nav).toHaveBeenCalledWith({ panel: "chat" });
    handle.uninstall();
  });

  it("键盘 Space 触发对应菜单", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    const card = (sb.container.children[0] as FakeElement).querySelector(
      "[data-menu-id='providers']",
    ) as FakeElement;
    expect(card).toBeTruthy();
    card.dispatchEvent({ type: "keydown", key: " ", target: card, bubbles: true });
    expect(nav).toHaveBeenCalledWith({ panel: "providers" });
    handle.uninstall();
  });

  it("监听 'my-agent:menu-action' 事件（HomePanel 集成）", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    // HomePanel 派发的事件
    sb.fireDocumentEvent("my-agent:menu-action", { menuId: "agents", label: "子Agent" });
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith({ panel: "agents" });
    handle.uninstall();
  });

  it("监听 menu-action: skills 走 panel=agents + tab=skills", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const tabHandler = vi.fn();
    sb.document.addEventListener("my-agent:tab-change", tabHandler as any);
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    sb.fireDocumentEvent("my-agent:menu-action", { menuId: "skills", label: "技能" });
    expect(nav).toHaveBeenCalledWith({ panel: "agents" });
    expect(tabHandler).toHaveBeenCalledTimes(1);
    expect((tabHandler.mock.calls[0]![0] as any).detail).toEqual({ tab: "skills" });
    handle.uninstall();
  });
});

describe("installMainMenu — 生命周期", () => {
  it("uninstall 清理 document 监听 + 摘除 DOM", () => {
    const sb = loadMenu();
    const nav = vi.fn();
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: nav });
    expect(sb.container.children.length).toBeGreaterThan(0);
    expect(sb.documentListeners.length).toBeGreaterThan(0);
    handle.uninstall();
    expect(sb.container.children.length).toBe(0);
    // 派发 menu-action 应该无人响应（监听器已摘）
    const callsBefore = nav.mock.calls.length;
    sb.fireDocumentEvent("my-agent:menu-action", { menuId: "chat", label: "" });
    expect(nav.mock.calls.length).toBe(callsBefore);
  });

  it("rerender 重渲染（i18n.setLang 后）", () => {
    const sb = loadMenu({ lang: "zh" });
    const handle = sb.mf.installMainMenu({ container: sb.container, onNavigate: vi.fn() });
    const grid = sb.container.children[0] as FakeElement;
    const before = (grid.querySelector(".menu-card-label") as FakeElement).textContent;
    expect(before.length).toBeGreaterThan(0);
    handle.rerender();
    const after = (grid.querySelector(".menu-card-label") as FakeElement).textContent;
    expect(after.length).toBeGreaterThan(0);
    expect(grid.children.length).toBe(9);
    handle.uninstall();
  });
});

describe("theme 三态轮转 + i18n fallback", () => {
  it("_nextTheme: dark→light→system→dark", () => {
    const sb = loadMenu();
    expect(sb.mf._nextTheme("dark")).toBe("light");
    expect(sb.mf._nextTheme("light")).toBe("system");
    expect(sb.mf._nextTheme("system")).toBe("dark");
    // 非法值回到 'dark'
    expect(sb.mf._nextTheme("invalid")).toBe("dark");
    expect(sb.mf._nextTheme("")).toBe("dark");
  });

  it("i18n 缺 menu.theme 键 → 走 INLINE_DICT.zh fallback", () => {
    const sb = loadMenu({ lang: "zh" });
    // i18n.js 的 DICT.zh 没有 menu.theme；INLINE_DICT.zh = '切换主题'
    const label = sb.mf.MENU_ITEMS.find((m: any) => m.id === "theme").fallbackZh;
    expect(label).toBe("切换主题");
    // INLINE_DICT 暴露
    expect(sb.mf._INLINE_DICT.zh["menu.theme"]).toBe("切换主题");
    expect(sb.mf._INLINE_DICT.en["menu.theme"]).toBe("Theme");
  });
});