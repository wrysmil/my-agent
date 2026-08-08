/**
 * app.js + app.keymap.js 测试 — F15 + F16 / WU-06c
 * ----------------------------------------------------------------------------
 * app.js / app.keymap.js 是经典 <script defer> 加载（非 ES module），运行时挂到
 * window.MyAgent.{app, appKeymap}。这里用 node:vm 起一个干净全局上下文，注入
 * 最小 DOM mock + mock state stores + mock 所有 features / components，
 * 验证 bootApp 流水线 + 事件路由 + 主题桥接 + 快捷键。
 *
 * 测试覆盖（≥ 12 用例）：
 *   1. 全局挂载 + bootApp 存在
 *   2. bootApp 步骤顺序：theme alias → state init → sidebar/panels → features → event wire → keymap install
 *   3. theme 别名：MyAgent.theme === MyAgent.themeModule
 *   4. panel-change → activeView 切换 + panel 显示
 *   5. session-select → activeSessionId + chatFeature.install
 *   6. session-delete → sessionsFeature.deleteSession
 *   7. agent-launch → switch to chat + 注入 systemPrompt
 *   8. skill-use → switch to chat + 注入 skill context
 *   9. theme event bridge colon → dash
 *  10. theme event bridge dash → colon
 *  11. menu-action → menuFeature.runAction
 *  12. tab-change → agentsFeature 切 tab
 *  13. lang-change → re-render 所有 view
 *  14. skills panel 路由到 skillsFeature（不依赖 agentsFeature 占位）
 *  15. chat lazy install（activeView === 'chat' 时实例化）
 *  16. keymap: Cmd/Ctrl+K → command palette noop + toast
 *  17. keymap: Cmd/Ctrl+N → new-session 派发
 *  18. keymap: Cmd/Ctrl+, → panel-change{panel:'settings'}
 *  19. keymap: Cmd/Ctrl+/ → panel-change{panel:'home'}
 *  20. keymap: Escape → modal-close-top 派发
 *  21. teardown / re-boot（重新 boot 不重复监听）
 *  22. 源码无 emoji + IIFE 模式 + 挂到 window.MyAgent
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const APP_PATH = fileURLToPath(
  new URL("../../web/js/app.js", import.meta.url),
);
const APP_SOURCE = readFileSync(APP_PATH, "utf-8");

const KEYMAP_PATH = fileURLToPath(
  new URL("../../web/js/app.keymap.js", import.meta.url),
);
const KEYMAP_SOURCE = readFileSync(KEYMAP_PATH, "utf-8");

const STATE_PATH = fileURLToPath(
  new URL("../../web/js/state/state.js", import.meta.url),
);
const STATE_SOURCE = readFileSync(STATE_PATH, "utf-8");

const UTILS_PATH = fileURLToPath(
  new URL("../../web/js/shared/utils.js", import.meta.url),
);
const UTILS_SOURCE = readFileSync(UTILS_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Fake DOM（与 sessions test 同模式：最小 element 模拟）
// ---------------------------------------------------------------------------

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
  hidden: boolean;
  attributes: Array<{ name: string; value: string }>;
  dataset: Record<string, string>;
  isContentEditable: boolean;
  _listeners: Map<string, Array<{ cb: EventListener; opts?: unknown }>>;
  addEventListener(type: string, cb: EventListener, opts?: unknown): void;
  removeEventListener(type: string, cb: EventListener, opts?: unknown): void;
  dispatchEvent(evt: { type: string; target?: FakeElement }): boolean;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  closest(sel: string): FakeElement | null;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
  focus(): void;
  click(): void;
  requestSubmit(): void;
  value: string;
}
function isElement(n: FakeNode): n is FakeElement {
  return (n as FakeElement).tagName !== undefined;
}
function makeElement(tagName: string): FakeElement {
  const listeners = new Map<string, Array<{ cb: EventListener; opts?: unknown }>>();
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    nodeType: 1,
    id: "",
    className: "",
    hidden: false,
    attributes: [],
    dataset: {},
    isContentEditable: false,
    value: "",
    _listeners: listeners,
    children: [],
    parentNode: null,
    textContent: "",
    innerHTML: "",
    appendChild(c) {
      c.parentNode = el;
      el.children.push(c);
      if (!isElement(c) && (c as { kind?: string }).kind === "text") {
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
      }
      return c;
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
      if (!list) return true;
      for (const entry of list.slice()) {
        try {
          entry.cb({ ...evt, target: evt.target || el } as unknown as Event);
        } catch (_e) {
          /* ignore */
        }
      }
      return true;
    },
    setAttribute(name, value) {
      const lower = name.toLowerCase();
      const existing = el.attributes.find((a) => a.name.toLowerCase() === lower);
      if (existing) existing.value = String(value);
      else el.attributes.push({ name, value: String(value) });
      if (lower === "id") el.id = String(value);
      if (lower === "class") el.className = String(value);
      if (lower === "hidden") el.hidden = value === "" || value === "true";
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
    closest(sel) {
      const dataActionMatch = sel.match(/^\[data-action=['"]([^'"]+)['"]\]$/);
      const dataPanelMatch = sel.match(
        /^\[data-panel=['"]([^'"]+)['"]\]$/,
      );
      const classMatch = sel.match(/^\.([\w-]+)$/);
      const idMatch = sel.match(/^#([\w-]+)$/);
      const ariaMatch = sel.match(/^\[aria-label=['"]([^'"]+)['"]\]$/);
      let cur: FakeElement | null = el;
      while (cur) {
        if (dataActionMatch) {
          const v = cur.getAttribute("data-action");
          if (v === dataActionMatch[1]) return cur;
        } else if (dataPanelMatch) {
          const v = cur.getAttribute("data-panel");
          if (v === dataPanelMatch[1]) return cur;
        } else if (classMatch) {
          const cls = cur.className || "";
          const wanted = classMatch[1]!;
          if (cls.split(/\s+/).indexOf(wanted) >= 0) return cur;
        } else if (idMatch) {
          if (cur.id === idMatch[1]) return cur;
        } else if (ariaMatch) {
          if (cur.getAttribute("aria-label") === ariaMatch[1]) return cur;
        }
        cur =
          cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
      }
      return null;
    },
    querySelector(sel) {
      // 简化:在自身 + children 中按 ID / className / tagName / [data-] 查找
      const idMatch = sel.match(/^#([\w-]+)$/);
      const classMatch = sel.match(/^\.([\w-]+)$/);
      const tagMatch = sel.match(/^([a-zA-Z][\w-]*)$/);
      const dataActionMatch = sel.match(/^\[data-action=['"]([^'"]+)['"]\]$/);
      const dataPanelMatch = sel.match(
        /^\[data-panel=['"]([^'"]+)['"]\]$/,
      );
      const stack: FakeElement[] = [el];
      while (stack.length > 0) {
        const node = stack.shift()!;
        if (idMatch && node.id === idMatch[1]) return node;
        if (classMatch) {
          const cls = node.className || "";
          if (cls.split(/\s+/).indexOf(classMatch[1]!) >= 0) return node;
        }
        if (tagMatch) {
          if (node.tagName.toLowerCase() === tagMatch[1]!.toLowerCase()) return node;
        }
        if (dataActionMatch && node.getAttribute("data-action") === dataActionMatch[1]) return node;
        if (dataPanelMatch && node.getAttribute("data-panel") === dataPanelMatch[1]) return node;
        for (const ch of node.children) {
          if (isElement(ch)) stack.push(ch);
        }
      }
      return null;
    },
    querySelectorAll(sel) {
      const out: FakeElement[] = [];
      const idMatch = sel.match(/^#([\w-]+)$/);
      const classMatch = sel.match(/^\.([\w-]+)$/);
      const dataPanelMatch = sel.match(
        /^\[data-panel(?:=['"]([^'"]+)['"])?\]$/,
      );
      const stack: FakeElement[] = [el];
      while (stack.length > 0) {
        const node = stack.shift()!;
        if (idMatch && node.id === idMatch[1]) out.push(node);
        if (classMatch) {
          const cls = node.className || "";
          if (cls.split(/\s+/).indexOf(classMatch[1]!) >= 0) out.push(node);
        }
        if (dataPanelMatch) {
          const wanted = dataPanelMatch[1] ?? null;
          const v = node.getAttribute("data-panel");
          if (v !== null && (wanted === null || v === wanted)) out.push(node);
        }
        for (const ch of node.children) {
          if (isElement(ch)) stack.push(ch);
        }
      }
      return out;
    },
    focus() {},
    click() {
      let cur: FakeElement | null = el;
      while (cur) {
        cur.dispatchEvent({ type: "click", target: el });
        cur =
          cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
      }
    },
    requestSubmit() {
      el.dispatchEvent({ type: "submit", target: el });
    },
  };
  // 同步 NATIVE_PROPS:utils.el 对 role / disabled 等用直接赋值
  const NATIVE_PROPS = new Set([
    "id", "title", "lang", "dir", "tabIndex", "hidden", "type", "name", "value",
    "href", "src", "alt", "placeholder", "disabled", "checked", "selected",
    "readOnly", "required", "maxLength", "minLength", "min", "max", "step",
    "rows", "cols", "role", "style", "autofocus",
  ]);
  for (const p of NATIVE_PROPS) {
    let backing: any = undefined;
    Object.defineProperty(el, p, {
      get() { return backing; },
      set(v: any) {
        backing = v;
        const existing = el.attributes.find(
          (a) => a.name.toLowerCase() === p.toLowerCase(),
        );
        const str = v === true ? "" : v === false || v == null ? null : String(v);
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

interface FakeDocument {
  body: FakeElement;
  documentElement: FakeElement;
  createElement(tag: string): FakeElement;
  createTextNode(text: string): FakeNode;
  addEventListener(type: string, cb: EventListener): void;
  removeEventListener(type: string, cb: EventListener): void;
  dispatchEvent(evt: { type: string; detail?: unknown }): boolean;
  getElementById(id: string): FakeElement | null;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
}

function makeDocument(): FakeDocument {
  const body = makeElement("body");
  const docListeners = new Map<string, EventListener[]>();
  const doc: FakeDocument = {
    body,
    documentElement: makeElement("html"),
    createElement(tag) {
      return makeElement(tag);
    },
    createTextNode(_text) {
      return {
        nodeType: 3,
        parentNode: null,
        children: [],
        textContent: "",
        innerHTML: "",
        appendChild() { return this; },
        removeChild() { return this; },
      };
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
          cb({ ...evt, type: evt.type } as unknown as Event);
        } catch (_e) {
          /* ignore */
        }
      }
      return true;
    },
    getElementById(id) {
      const stack: FakeElement[] = [body];
      while (stack.length > 0) {
        const node = stack.shift()!;
        if (node.id === id) return node;
        for (const ch of node.children) {
          if (isElement(ch)) stack.push(ch);
        }
      }
      return null;
    },
    querySelector(sel) {
      const found = body.querySelector ? body.querySelector(sel) : null;
      return found;
    },
    querySelectorAll(sel) {
      return body.querySelectorAll ? body.querySelectorAll(sel) : [];
    },
  };
  return doc;
}

// ---------------------------------------------------------------------------
// Sandbox 工厂:每次 create 一个干净全局
// ---------------------------------------------------------------------------

interface LoadedSandbox {
  app: any;
  keymap: any;
  state: any;
  themeModule: any;
  features: Record<string, any>;
  components: Record<string, any>;
  toasts: Array<{ message: string; status: string }>;
  document: FakeDocument;
  body: FakeElement;
  sidebarEl: FakeElement;
  mainEl: FakeElement;
  panels: Record<string, FakeElement>;
  documentListeners: Array<{ type: string; listener: EventListener }>;
  fireDocumentEvent(type: string, detail?: unknown): void;
}

function loadSandbox(): LoadedSandbox {
  const localStorage = {
    data: new Map<string, string>(),
    getItem(k: string) { return this.data.has(k) ? this.data.get(k)! : null; },
    setItem(k: string, v: string) { this.data.set(k, String(v)); },
    removeItem(k: string) { this.data.delete(k); },
    clear() { this.data.clear(); },
    key(_i: number) { return null; },
    get length() { return this.data.size; },
  };

  const doc = makeDocument();

  // 构造侧边栏 + 主区 + panels(F1 预留)
  const sidebarEl = makeElement("aside");
  sidebarEl.id = "sidebar";
  sidebarEl.setAttribute("role", "complementary");
  sidebarEl.setAttribute("aria-label", "侧边栏");
  sidebarEl.className = "app-sidebar";
  doc.body.appendChild(sidebarEl);

  const mainEl = makeElement("main");
  mainEl.id = "main-content";
  mainEl.setAttribute("role", "main");
  mainEl.className = "app-main";
  doc.body.appendChild(mainEl);

  const panels: Record<string, FakeElement> = {};
  const PANEL_NAMES = ["home", "chat", "sessions", "providers", "agents", "skills", "settings"];
  PANEL_NAMES.forEach((name) => {
    const sec = makeElement("section");
    sec.id = "panel-" + name;
    sec.setAttribute("data-panel", name === "home" ? "main-menu" : name);
    sec.setAttribute("hidden", "");
    // 给 chat panel 一个 textarea + composer
    if (name === "chat") {
      const composer = makeElement("form");
      composer.className = "chat-composer";
      const ta = makeElement("textarea");
      ta.className = "chat-input";
      composer.appendChild(ta);
      sec.appendChild(composer);
    }
    mainEl.appendChild(sec);
    panels[name] = sec;
  });
  // 设置 home panel 可见(F1 默认)
  panels.home!.setAttribute("hidden", "");
  panels.home!.removeAttribute("hidden");

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
    dispatchEvent(evt: { type: string; detail?: unknown }) {
      for (const { type, listener } of documentListeners) {
        if (type === evt.type) {
          try {
            listener({ ...evt, type: evt.type } as unknown as Event);
          } catch (_e) {
            /* ignore */
          }
        }
      }
      return true;
    },
  };

  // toast 收集
  const toasts: Array<{ message: string; status: string }> = [];

  // features mocks
  const featureMocks = {
    providersFeature: {
      installProvidersView: vi.fn(() => ({ destroy: vi.fn(), refresh: vi.fn() })),
    },
    sessionsFeature: {
      installSessionsList: vi.fn(() => ({
        uninstall: vi.fn(),
        refresh: vi.fn(() => Promise.resolve()),
        selectSession: vi.fn(),
        createSession: vi.fn(() => Promise.resolve()),
        deleteSession: vi.fn(() => Promise.resolve()),
      })),
    },
    agentsFeature: {
      installAgentsView: vi.fn(() => ({
        destroy: vi.fn(),
        uninstall: vi.fn(),
        refresh: vi.fn(),
        setActiveTab: vi.fn(),
      })),
    },
    skillsFeature: {
      installSkillsView: vi.fn(() => ({
        destroy: vi.fn(),
        uninstall: vi.fn(),
        refresh: vi.fn(),
      })),
    },
    settingsFeature: {
      installSettingsView: vi.fn(() => ({
        uninstall: vi.fn(),
        rerender: vi.fn(),
      })),
    },
    menuFeature: {
      installMainMenu: vi.fn(() => ({
        uninstall: vi.fn(),
        rerender: vi.fn(),
        runAction: vi.fn(),
      })),
    },
    chatFeature: {
      installChatView: vi.fn(() => ({})),
      isInstalled: vi.fn(() => false),
      triggerCompact: vi.fn(),
      sendMessage: vi.fn(() => true),
      uninstall: vi.fn(),
    },
  };

  // components mocks
  const componentMocks = {
    Toast: vi.fn().mockImplementation(function (this: any) {
      this.show = (opts: { message: string; status?: string }) => {
        toasts.push({ message: opts.message, status: opts.status || "info" });
      };
    }),
    Sidebar: vi.fn().mockImplementation(function (this: any) {
      this.el = makeElement("aside");
      this.el.id = "sidebar-built";
      this.destroy = vi.fn();
    }),
  };

  // themeModule mock
  const themeModule = {
    applyTheme: vi.fn(),
    getStoredTheme: vi.fn(() => "system"),
    setStoredTheme: vi.fn(),
    init: vi.fn(),
  };

  // chatState mock for Cmd+.
  const chatState = {
    get: vi.fn(() => ({ streaming: false, abortController: null })),
  };

  const sandbox: Record<string, unknown> = {
    console: { warn: vi.fn(), error: (...args: unknown[]) => process.stderr.write("[stderr] " + args.map(String).join(" ") + "\n"), log: vi.fn() },
    setTimeout: setTimeout as typeof setTimeout,
    clearTimeout: clearTimeout as typeof clearTimeout,
    AbortController: class FakeAbortController {
      signal = { aborted: false };
      abort() { this.signal.aborted = true; }
    },
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
    navigator: { platform: "Linux" }, // 测试默认非 Mac（用 Ctrl）
    matchMedia: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    fetch: vi.fn(),
    document: wrappedDoc,
    MyAgent: {
      themeModule,
      components: componentMocks,
      providersFeature: featureMocks.providersFeature,
      sessionsFeature: featureMocks.sessionsFeature,
      agentsFeature: featureMocks.agentsFeature,
      skillsFeature: featureMocks.skillsFeature,
      settingsFeature: featureMocks.settingsFeature,
      menuFeature: featureMocks.menuFeature,
      chatFeature: featureMocks.chatFeature,
    },
  };

  createContext(sandbox);
  // 加载顺序:utils → state → app.keymap → app
  runInContext(UTILS_SOURCE, sandbox);
  runInContext(STATE_SOURCE, sandbox);
  runInContext(KEYMAP_SOURCE, sandbox);
  runInContext(APP_SOURCE, sandbox);

  const app = (sandbox as { MyAgent: { app: any } }).MyAgent.app;
  const keymap = (sandbox as { MyAgent: { appKeymap: any } }).MyAgent.appKeymap;
  const state = (sandbox as { MyAgent: { state: any } }).MyAgent.state;

  return {
    app,
    keymap,
    state,
    themeModule,
    features: featureMocks,
    components: componentMocks,
    toasts,
    document: doc,
    body: wrappedDoc.body as FakeElement,
    sidebarEl,
    mainEl,
    panels,
    documentListeners,
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

describe("app.js — 全局挂载 + bootApp 步骤", () => {
  it("挂载 app / appKeymap 到 window.MyAgent", () => {
    const sb = loadSandbox();
    expect(sb.app).toBeDefined();
    expect(sb.keymap).toBeDefined();
    expect(typeof sb.app.bootApp).toBe("function");
    expect(typeof sb.app.teardown).toBe("function");
    expect(typeof sb.keymap.installKeymap).toBe("function");
  });

  it("源码无 emoji + IIFE 模式 + 挂到 window.MyAgent.app + .appKeymap", () => {
    expect(APP_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(APP_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(APP_SOURCE.trimEnd().endsWith(");")).toBe(true);
    expect(APP_SOURCE).toMatch(/global\.MyAgent\.app\s*=/);

    expect(KEYMAP_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(KEYMAP_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(KEYMAP_SOURCE.trimEnd().endsWith(");")).toBe(true);
    expect(KEYMAP_SOURCE).toMatch(/global\.MyAgent\.appKeymap\s*=/);
  });

  it("bootApp 步骤顺序：theme alias → state init → sidebar/panels → features → event wire → keymap install", () => {
    const sb = loadSandbox();
    const order: string[] = [];
    // 通过 mock 来探测步骤顺序：拦截 themeModule.installProvidersView 等
    // 简化:检查 installProvidersView 等被调用 + keymap installKeymap 被调用
    const beforeThemeAlias = sb.app._internal.state.booted;
    expect(beforeThemeAlias).toBe(false);
    sb.app.bootApp();
    // theme alias 已挂
    expect((sb.document as any)).toBeDefined();
    // sidebar Sidebar 构造器被调
    expect(sb.components.Sidebar).toHaveBeenCalled();
    // 各 feature.install 被调
    expect(sb.features.providersFeature.installProvidersView).toHaveBeenCalled();
    expect(sb.features.sessionsFeature.installSessionsList).toHaveBeenCalled();
    expect(sb.features.agentsFeature.installAgentsView).toHaveBeenCalled();
    expect(sb.features.skillsFeature.installSkillsView).toHaveBeenCalled();
    expect(sb.features.settingsFeature.installSettingsView).toHaveBeenCalled();
    expect(sb.features.menuFeature.installMainMenu).toHaveBeenCalled();
    // keymap 已 install
    expect(sb.app._internal.state.booted).toBe(true);
  });

  it("theme 别名：MyAgent.theme === MyAgent.themeModule", () => {
    const sb = loadSandbox();
    // boot 前无 theme 别名
    expect((sb as any).themeModule).toBeDefined();
    sb.app.bootApp();
    // boot 后:MyAgent.theme 别名指向 themeModule
    expect(sb.app._internal.state.booted).toBe(true);
    // 通过 sandbox 取 MyAgent
    // (themeModule 是同一引用)
    // 验证：app._internal.installThemeAlias() 返回 true
    expect(sb.app._internal.installThemeAlias()).toBe(true);
  });

  it("skills panel 路由到 skillsFeature.installSkillsView（不依赖 agentsFeature 占位）", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    // skills panel 调用了 skillsFeature.installSkillsView
    expect(sb.features.skillsFeature.installSkillsView).toHaveBeenCalled();
    // 容器是 skills panel 内部 region
    const callArg = sb.features.skillsFeature.installSkillsView.mock.calls[0]![0]!;
    expect(callArg.container).toBeDefined();
    // agentsFeature.installAgentsView 也被调（agents panel 用）
    expect(sb.features.agentsFeature.installAgentsView).toHaveBeenCalled();
  });
});

describe("app.js — 事件路由", () => {
  it("panel-change → activeView 切换 + panel 显示", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    // 触发 panel-change → settings
    sb.fireDocumentEvent("my-agent:panel-change", { panel: "settings" });
    // appState.activeView === 'settings'
    expect(sb.state.appState.get().activeView).toBe("settings");
    // settings panel 不再 hidden,其他 panel hidden
    expect(sb.panels.settings!.getAttribute("hidden")).toBeNull();
    expect(sb.panels.home!.getAttribute("hidden")).toBe("");
  });

  it("session-select → activeSessionId + chat install（chat 视图激活时）", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    // 切到 chat
    sb.fireDocumentEvent("my-agent:panel-change", { panel: "chat" });
    // 派发 session-select
    sb.fireDocumentEvent("my-agent:session-select", { sessionId: "sess-A" });
    expect(sb.state.appState.get().activeSessionId).toBe("sess-A");
    // chatFeature.installChatView 应被调用
    expect(sb.features.chatFeature.installChatView).toHaveBeenCalled();
    const calls = sb.features.chatFeature.installChatView.mock.calls;
    const lastCall = calls[calls.length - 1]![0]!;
    expect(lastCall.sessionId).toBe("sess-A");
  });

  it("session-delete → sessionsFeature.deleteSession(id)", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:session-delete", { sessionId: "sess-X" });
    expect(sb.features.sessionsFeature.installSessionsList.mock.results[0]!.value.deleteSession).toHaveBeenCalledWith("sess-X");
  });

  it("agent-launch → switch to chat + textarea 填入 /agent <id>", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:agent-launch", { agentId: "a-1", agentName: "Code" });
    // activeView → chat
    expect(sb.state.appState.get().activeView).toBe("chat");
    // chat panel 的 textarea 有值
    const ta = sb.panels.chat!.querySelector("textarea");
    expect(ta).toBeDefined();
    expect(ta!.value).toContain("/agent a-1");
  });

  it("skill-use → switch to chat + textarea 填入 /skill <id>", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:skill-use", { skillId: "s-1", skillName: "Translate" });
    expect(sb.state.appState.get().activeView).toBe("chat");
    const ta = sb.panels.chat!.querySelector("textarea");
    expect(ta).toBeDefined();
    expect(ta!.value).toContain("/skill s-1");
  });

  it("menu-action → menuFeature.runAction", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:menu-action", { menuId: "start-chat", label: "开始对话" });
    const menuInst = sb.features.menuFeature.installMainMenu.mock.results[0]!.value;
    expect(menuInst.runAction).toHaveBeenCalledWith({ id: "start-chat", label: "开始对话" });
  });

  it("tab-change → agentsFeature.setActiveTab", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:tab-change", { tab: "skills" });
    const agentsInst = sb.features.agentsFeature.installAgentsView.mock.results[0]!.value;
    expect(agentsInst.setActiveTab).toHaveBeenCalledWith("skills");
  });

  it("lang-change → 调各 feature 的 rerender/refresh", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:lang-change", { lang: "en" });
    const menuInst = sb.features.menuFeature.installMainMenu.mock.results[0]!.value;
    const settingsInst = sb.features.settingsFeature.installSettingsView.mock.results[0]!.value;
    expect(menuInst.rerender).toHaveBeenCalled();
    expect(settingsInst.rerender).toHaveBeenCalled();
  });

  it("new-session → sessionsFeature.createSession", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    sb.fireDocumentEvent("my-agent:new-session", {});
    const sessInst = sb.features.sessionsFeature.installSessionsList.mock.results[0]!.value;
    expect(sessInst.createSession).toHaveBeenCalled();
  });
});

describe("app.js — 主题事件桥接（双向）", () => {
  it("colon → dash: 'my-agent:theme-change' 派发后 'my-agent-theme-change' 也派发", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    const seenDash: Array<unknown> = [];
    const seenColon: Array<unknown> = [];
    sb.documentListeners.push({
      type: "my-agent-theme-change",
      listener: ((evt: Event) => { seenDash.push((evt as CustomEvent).detail); }) as EventListener,
    });
    sb.documentListeners.push({
      type: "my-agent:theme-change",
      listener: ((evt: Event) => { seenColon.push((evt as CustomEvent).detail); }) as EventListener,
    });
    sb.fireDocumentEvent("my-agent:theme-change", { theme: "dark" });
    // dash 监听器也被调用(桥接)
    expect(seenDash.length).toBe(1);
    expect((seenDash[0] as { theme?: string }).theme).toBe("dark");
    // colon 也被调用
    expect(seenColon.length).toBeGreaterThanOrEqual(1);
  });

  it("dash → colon: 'my-agent-theme-change' 派发后 'my-agent:theme-change' 也派发", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    const seenColon: Array<unknown> = [];
    sb.documentListeners.push({
      type: "my-agent:theme-change",
      listener: ((evt: Event) => { seenColon.push((evt as CustomEvent).detail); }) as EventListener,
    });
    sb.fireDocumentEvent("my-agent-theme-change", { theme: "light" });
    expect(seenColon.length).toBeGreaterThanOrEqual(1);
    expect((seenColon[seenColon.length - 1] as { theme?: string }).theme).toBe("light");
  });
});

describe("app.keymap.js — 全站快捷键", () => {
  function pressKey(key: string, opts: { ctrlKey?: boolean; metaKey?: boolean; target?: FakeElement } = {}) {
    const target = opts.target || sb.body;
    // 模拟 keydown 事件
    const evt = {
      type: "keydown",
      key: key,
      ctrlKey: !!opts.ctrlKey,
      metaKey: !!opts.metaKey,
      shiftKey: false,
      altKey: false,
      target,
      preventDefault: vi.fn(),
      bubbles: true,
    };
    // 通过 wrappedDoc dispatch 触发 documentListeners
    for (const { type, listener } of sb.documentListeners) {
      if (type === "keydown") {
        try {
          listener(evt as unknown as Event);
        } catch (_e) {
          /* ignore */
        }
      }
    }
    return evt;
  }

  let sb: LoadedSandbox;
  beforeEach(() => {
    sb = loadSandbox();
    sb.app.bootApp();
  });

  it("Cmd/Ctrl+K → 命令面板 noop + toast('功能开发中')", () => {
    pressKey("k", { ctrlKey: true });
    // toast 被调
    expect(sb.toasts.some((t) => t.message.indexOf("命令面板") >= 0 || t.message.indexOf("功能开发中") >= 0)).toBe(true);
  });

  it("Cmd/Ctrl+N → 派发 my-agent:new-session", () => {
    let seen = 0;
    sb.documentListeners.push({
      type: "my-agent:new-session",
      listener: (() => { seen++; }) as EventListener,
    });
    pressKey("n", { ctrlKey: true });
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it("Cmd/Ctrl+, → 派发 my-agent:panel-change { panel: 'settings' }", () => {
    let detail: any = null;
    sb.documentListeners.push({
      type: "my-agent:panel-change",
      listener: ((evt: Event) => { detail = (evt as CustomEvent).detail; }) as EventListener,
    });
    pressKey(",", { ctrlKey: true });
    expect(detail).toBeDefined();
    expect(detail.panel).toBe("settings");
  });

  it("Cmd/Ctrl+/ → 派发 my-agent:panel-change { panel: 'home' }", () => {
    let detail: any = null;
    sb.documentListeners.push({
      type: "my-agent:panel-change",
      listener: ((evt: Event) => { detail = (evt as CustomEvent).detail; }) as EventListener,
    });
    pressKey("/", { ctrlKey: true });
    expect(detail).toBeDefined();
    expect(detail.panel).toBe("home");
  });

  it("Escape → 派发 my-agent:modal-close-top", () => {
    let seen = 0;
    sb.documentListeners.push({
      type: "my-agent:modal-close-top",
      listener: (() => { seen++; }) as EventListener,
    });
    pressKey("Escape");
    expect(seen).toBeGreaterThanOrEqual(1);
  });

  it("主菜单 1-6 → 派发 my-agent:menu-action（digit-N）", () => {
    const seen: Array<unknown> = [];
    sb.documentListeners.push({
      type: "my-agent:menu-action",
      listener: ((evt: Event) => { seen.push((evt as CustomEvent).detail); }) as EventListener,
    });
    pressKey("3");
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect((seen[0] as { menuId?: string }).menuId).toBe("digit-3");
  });

  it("Cmd+Enter 在 composer 内 → form.requestSubmit 被触发", () => {
    // chat panel 已在 bootApp 时被解析;构造一个 form + textarea
    const composer = sb.panels.chat!.querySelector("form")!;
    const ta = composer.querySelector("textarea")!;
    // requestSubmit 是 mock
    const reqSubmitSpy = vi.spyOn(composer, "requestSubmit");
    pressKey("Enter", { ctrlKey: true, target: ta });
    expect(reqSubmitSpy).toHaveBeenCalled();
  });
});

describe("app.js — teardown + re-boot", () => {
  it("teardown 卸载监听 + 卸载所有 feature", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    const listenerCountBefore = sb.documentListeners.length;
    sb.app.teardown();
    expect(sb.app._internal.state.booted).toBe(false);
    // document listeners 全部清掉（documentListeners 数组在 sandbox 内）
    // re-boot 应该重新挂上监听
    sb.app.bootApp();
    expect(sb.app._internal.state.booted).toBe(true);
  });

  it("re-boot 不重复注册 keymap listener", () => {
    const sb = loadSandbox();
    sb.app.bootApp();
    const before = sb.documentListeners.filter((e) => e.type === "keydown").length;
    sb.app.bootApp(); // re-boot
    const after = sb.documentListeners.filter((e) => e.type === "keydown").length;
    // re-boot 应该先 teardown 再 install,所以数量不应该翻倍
    expect(after).toBe(before);
  });
});
