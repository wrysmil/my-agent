import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * features/settings.js 是经典 <script defer> 脚本(非 ES module),运行时挂全局。
 * 这里用 node:vm 起干净上下文加载它,贴近浏览器加载方式,无需 jsdom。
 *
 * 测试设计:
 *   - mock utils.el():返回 FakeElement,记录 attrs/children,支持 addEventListener
 *     / removeEventListener / dispatchEvent / appendChild / removeChild / querySelector。
 *   - mock window.MyAgent.theme.setTheme
 *   - mock window.MyAgent.i18n.setLang / t(返回 key 自身)
 *   - mock window.MyAgent.state(settingsState + providerState)用闭包变量模拟
 *   - mock window.MyAgent.components.Modal(可选;测清空数据走 modal 与 confirm() 两条路径)
 *   - mock localStorage(用 Map)+ document.dispatchEvent
 *
 * 测试目标:≥ 10 用例覆盖
 *   1) 全局挂载 + 源码约定(IIFE / 无依赖)
 *   2) 常量导出(STORAGE_KEY / CHANGE_EVENT / VALID_*)
 *   3) installSettingsView 渲染 3 个 fieldset + 1 个 danger section
 *   4) 主题 radio 切换 → setTheme + localStorage + CustomEvent
 *   5) 语言 radio 切换 → setLang + localStorage + CustomEvent
 *   6) 模型 select 切换 → settingsState 更新
 *   7) 清空数据点击 → modal 打开(走 components.Modal 路径)
 *   8) 清空数据点击 → confirm() 路径(modal 缺失时降级)
 *   9) confirm 后 → localStorage.clear + location.reload
 *   10) uninstall → 移除节点 + 解绑 listener(idempotent)
 *   11) a11y:fieldset / legend / label-for
 *   12) 暴露纯函数(readCurrentTheme / readCurrentLang / getActiveProviderModels)
 *   13) installSettingsView 缺失 container 抛错
 *   14) installSettingsView 缺失 utils.el 抛错
 */

const SETTINGS_PATH = fileURLToPath(
  new URL("../../web/js/features/settings.js", import.meta.url),
);
const SETTINGS_SOURCE = readFileSync(SETTINGS_PATH, "utf-8");

// ---------------------------------------------------------------------------
// 最小 FakeElement —— 记录 attrs/children,支持事件 / 增删 / querySelector
// ---------------------------------------------------------------------------

interface FakeListener {
  cb: EventListener;
  opts?: AddEventListenerOptions | boolean;
}

interface FakeTextNode {
  kind: "text";
  textContent: string;
  parentNode: FakeElement | null;
}

type FakeChild = FakeElement | FakeTextNode;

interface FakeElement {
  tagName: string;
  attrs: Record<string, string>;
  children: FakeChild[];
  parentNode: FakeElement | null;
  _listeners: Map<string, FakeListener[]>;
  _checked: boolean;
  _value: string;
  // input-only
  type: string;
  name: string;
  // select-only
  selectedIndex: number;
  // a11y
  id: string;
  className: string;
  hidden: boolean;
  disabled: boolean;

  addEventListener(type: string, cb: EventListener, opts?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, cb: EventListener, opts?: AddEventListenerOptions | boolean): void;
  dispatchEvent(evt: { type: string }): boolean;
  appendChild(c: FakeChild): FakeChild;
  removeChild(c: FakeChild): FakeChild;
  remove(): void;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
}

function makeFakeListener(): FakeListener {
  return { cb: (() => {}) as EventListener };
}

function makeFakeElement(tagName: string): FakeElement {
  const listeners = new Map<string, FakeListener[]>();
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    attrs: {},
    children: [],
    parentNode: null,
    _listeners: listeners,
    _checked: false,
    _value: "",
    type: "",
    name: "",
    selectedIndex: 0,
    id: "",
    className: "",
    hidden: false,
    disabled: false,

    addEventListener(type, cb, opts) {
      const arr = listeners.get(type) || [];
      arr.push({ cb, opts });
      listeners.set(type, arr);
    },
    removeEventListener(type, cb, opts) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.findIndex(
        (e) => e.cb === cb && sameOpts(e.opts, opts),
      );
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const arr = listeners.get(evt.type);
      if (!arr) return true;
      for (const entry of arr.slice()) {
        try {
          entry.cb(evt as unknown as Event);
        } catch (_e) {
          /* ignore */
        }
      }
      return true;
    },
    appendChild(c) {
      if (typeof c === "string") {
        this.children.push({
          kind: "text",
          textContent: c,
          parentNode: this,
        });
      } else {
        c.parentNode = this;
        this.children.push(c);
      }
      return c;
    },
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) {
        this.children.splice(i, 1);
        c.parentNode = null;
      }
      return c;
    },
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      const lower = name.toLowerCase();
      if (lower === "id") this.id = String(value);
      if (lower === "class") this.className = String(value);
      if (lower === "value") this._value = String(value);
      if (lower === "type") this.type = String(value);
      if (lower === "name") this.name = String(value);
      if (lower === "hidden") this.hidden = value === "" || value === "true";
      if (lower === "disabled") this.disabled = value === "" || value === "true";
      if (lower === "checked") this._checked = value === "" || value === "true" || value === "checked";
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name]! : null;
    },
    querySelector(sel) {
      return querySelectorInternal(this, sel);
    },
    querySelectorAll(sel) {
      const out: FakeElement[] = [];
      walkAll(this, sel, out);
      return out;
    },
  };

  // 暴露 HTMLInputElement 风格属性 getter/setter:
  // - radio.input.checked   ← DOM property
  // - select.value          ← DOM property
  Object.defineProperty(el, "checked", {
    get() { return el._checked; },
    set(v: boolean) { el._checked = !!v; el.attrs["checked"] = v ? "checked" : ""; },
    configurable: true,
    enumerable: true,
  });
  Object.defineProperty(el, "value", {
    get() { return el._value; },
    set(v: string) { el._value = String(v); el.attrs["value"] = String(v); },
    configurable: true,
    enumerable: true,
  });
  return el;
}

function sameOpts(
  a?: AddEventListenerOptions | boolean,
  b?: AddEventListenerOptions | boolean,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "boolean" || typeof b === "boolean") return false;
  return (!!(a as AddEventListenerOptions).capture) === (!!(b as AddEventListenerOptions).capture);
}

function isFakeElement(c: FakeChild): c is FakeElement {
  return !("kind" in c);
}

/**
 * 解析 selector → { type: 'id'|'class'|'tag', value: string }
 * 简化实现:不支持组合选择器。
 */
function parseSelector(sel: string): { type: "id" | "class" | "tag"; value: string } {
  if (sel.startsWith("#")) return { type: "id", value: sel.slice(1) };
  if (sel.startsWith(".")) return { type: "class", value: sel.slice(1) };
  return { type: "tag", value: sel.toUpperCase() };
}

function matchSelector(el: FakeElement, parsed: { type: "id" | "class" | "tag"; value: string }): boolean {
  if (parsed.type === "id") return el.id === parsed.value;
  if (parsed.type === "class") return (el.className || "").split(/\s+/).indexOf(parsed.value) >= 0;
  return el.tagName === parsed.value;
}

function querySelectorInternal(root: FakeElement, sel: string): FakeElement | null {
  const parsed = parseSelector(sel);
  for (const c of root.children) {
    if (!isFakeElement(c)) continue;
    if (matchSelector(c, parsed)) return c;
    const sub = querySelectorInternal(c, sel);
    if (sub) return sub;
  }
  return null;
}

function walkAll(root: FakeElement, sel: string, out: FakeElement[]): void {
  const parsed = parseSelector(sel);
  for (const c of root.children) {
    if (!isFakeElement(c)) continue;
    if (matchSelector(c, parsed)) out.push(c);
    walkAll(c, sel, out);
  }
}

// ---------------------------------------------------------------------------
// utils.el 简化 mock —— 走真实 createElement + 处理 attrs/children/事件
// ---------------------------------------------------------------------------

function fakeUtilsEl(
  document: { createElement(tag: string): FakeElement },
  i18nT: (k: string) => string,
) {
  const u = {
    el(tag: string, attrs?: Record<string, unknown>, children?: unknown): FakeElement {
      const node = document.createElement(tag);
      if (attrs && typeof attrs === "object") {
        for (const [k, v] of Object.entries(attrs)) {
          if (v === undefined || v === null || v === false) continue;
          if (typeof k === "string" && k.length > 2 && k.slice(0, 2) === "on" && typeof v === "function") {
            const eventName = k.slice(2).toLowerCase();
            node.addEventListener(eventName, v as EventListener);
            continue;
          }
          if (k === "checked") {
            node._checked = !!v;
            node.attrs["checked"] = v ? "checked" : "";
            continue;
          }
          if (k === "value") {
            node._value = String(v);
            node.attrs["value"] = String(v);
            continue;
          }
          node.setAttribute(k, String(v));
        }
      }
      if (children !== undefined && children !== null) {
        appendChildren(node, children);
      }
      return node;
    },
    escapeHtml: (s: unknown) => String(s),
    on: (
      el: FakeElement,
      event: string,
      handler: EventListener,
      opts?: AddEventListenerOptions | boolean,
    ) => {
      el.addEventListener(event, handler, opts);
      return () => el.removeEventListener(event, handler, opts);
    },
    $: (sel: string, root?: FakeElement) => (root || document as unknown as FakeElement).querySelector(sel),
    $$: (sel: string, root?: FakeElement) => (root || document as unknown as FakeElement).querySelectorAll(sel),
    debounce: <F extends (...a: any[]) => void>(fn: F) => fn,
    formatTime: () => "",
    assert: (cond: unknown) => {
      if (!cond) throw new Error("assertion failed");
    },
  };

  function appendChildren(node: FakeElement, kids: unknown): void {
    if (Array.isArray(kids)) {
      kids.forEach((k) => appendChildren(node, k));
      return;
    }
    if (kids === null || kids === undefined || kids === false) return;
    if (typeof kids === "string" || typeof kids === "number") {
      node.appendChild({
        kind: "text",
        textContent: String(kids),
        parentNode: node,
      } as FakeTextNode);
      return;
    }
    const child = kids as FakeElement;
    node.appendChild(child);
  }

  // i18nT 暴露在 u 上以便调试(不影响测试)
  void i18nT;
  return u;
}

// ---------------------------------------------------------------------------
// 加载器:mock 一切 + 加载源码 + 返回 sandbox 引用
// ---------------------------------------------------------------------------

interface FakeStorage {
  data: Map<string, string>;
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
  clear(): void;
  get length(): number;
}

function createFakeStorage(): FakeStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
    clear: () => { data.clear(); },
    get length() { return data.size; },
  };
}

interface LoadedSandbox {
  settingsFeature: any;
  storage: FakeStorage;
  container: FakeElement;
  document: any;
  setTheme: ReturnType<typeof vi.fn>;
  setLang: ReturnType<typeof vi.fn>;
  getLang: ReturnType<typeof vi.fn>;
  t: ReturnType<typeof vi.fn>;
  settingsState: {
    get(): { theme: string; lang: string; model: string | null };
    set(v: any): void;
    update(fn: (old: any) => any): void;
    _listeners: Array<(newValue: any, oldValue: any) => void>;
  };
  providerState: {
    get(): { providers: any[]; activeProviderId: string | null; loading: boolean };
    set(v: any): void;
  };
  modalInstances: any[];
  confirmSpy: ReturnType<typeof vi.fn>;
  reloadSpy: ReturnType<typeof vi.fn>;
  dispatchEvents: Array<{ type: string; detail: unknown }>;
  documentListeners: Array<{ type: string; listener: EventListener }>;
}

interface LoadOptions {
  activeProviderModels?: string[] | null;
  defaultModel?: string | null;
  initialTheme?: string;
  initialLang?: string;
  initialModel?: string | null;
  withModal?: boolean;
  withConfirm?: boolean;
}

function loadSettings(opts: LoadOptions = {}): LoadedSandbox {
  const withModal = opts.withModal !== false; // 默认 true
  const withConfirm = opts.withConfirm !== false; // 默认 true

  // ── localStorage ──
  const storage = createFakeStorage();
  if (opts.initialTheme) storage.setItem("my-agent.theme", opts.initialTheme);
  if (opts.initialLang) storage.setItem("my-agent.lang", opts.initialLang);

  // ── settingsState (闭包) ──
  let settingsValue = {
    theme: opts.initialTheme || "system",
    lang: opts.initialLang || "zh",
    model: opts.initialModel != null ? opts.initialModel : null,
  };
  const settingsListeners: Array<(n: any, o: any) => void> = [];
  const settingsState = {
    get: () => settingsValue,
    set: (next: any) => {
      const old = settingsValue;
      settingsValue = next;
      settingsListeners.slice().forEach((cb) => {
        try { cb(settingsValue, old); } catch (_e) { /* */ }
      });
    },
    update: (fn: (old: any) => any) => {
      settingsState.set(fn(settingsValue));
    },
    _listeners: settingsListeners,
  };

  // ── providerState ──
  const providerStateValue = {
    providers: [
      {
        id: "p1",
        name: "OpenAI",
        models: opts.activeProviderModels !== undefined
          ? opts.activeProviderModels
          : ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo"],
        defaultModel: opts.defaultModel !== undefined
          ? opts.defaultModel
          : "gpt-4o-mini",
      },
    ],
    activeProviderId: "p1",
    loading: false,
  };
  const providerState = {
    get: () => providerStateValue,
    set: (v: any) => { /* not used by tests */ },
  };

  // ── theme / i18n / components mocks ──
  const setTheme = vi.fn();
  const setLang = vi.fn((lang: string) => lang);
  const getLang = vi.fn(() => opts.initialLang || "zh");
  const t = vi.fn((k: string) => k);

  // ── Modal mock ──
  const modalInstances: any[] = [];
  const Modal = withModal
    ? vi.fn((cfg: any) => {
        const m = {
          el: {
            appendChild: () => {},
            querySelector: (sel: string) => {
              // 模拟 .modal-dialog / .modal-footer 的查找
              return null;
            },
          },
          open: vi.fn(),
          close: vi.fn(),
          destroy: vi.fn(),
          config: cfg,
        };
        modalInstances.push(m);
        return m;
      })
    : undefined;

  // ── confirm / reload ──
  const confirmSpy = withConfirm ? vi.fn(() => true) : undefined;
  const reloadSpy = vi.fn();

  // ── document mock ──
  const documentListeners: Array<{ type: string; listener: EventListener }> = [];
  const dispatchEvents: Array<{ type: string; detail: unknown }> = [];
  const fakeDocument: any = {
    createElement(tag: string) {
      return makeFakeElement(tag);
    },
    createTextNode(text: string): FakeTextNode {
      return { kind: "text", textContent: String(text), parentNode: null };
    },
    addEventListener(type: string, listener: EventListener) {
      documentListeners.push({ type, listener });
    },
    removeEventListener() {},
    dispatchEvent(evt: any) {
      dispatchEvents.push({ type: evt.type, detail: evt.detail });
      for (const { type, listener } of documentListeners.slice()) {
        if (type === evt.type) {
          try { listener(evt); } catch (_e) { /* */ }
        }
      }
      return true;
    },
    body: makeFakeElement("body"),
    get activeElement() {
      return null;
    },
  };
  const container = fakeDocument.createElement("div");
  container.id = "settings-region";
  fakeDocument.body.appendChild(container);

  // ── sandbox ──
  const sandbox: Record<string, unknown> = {
    localStorage: storage,
    document: fakeDocument,
    console: { warn: () => {}, error: () => {}, log: () => {} },
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
    location: { reload: reloadSpy },
    confirm: confirmSpy || (() => true),
    MyAgent: {
      theme: { setTheme, getTheme: () => "system", getSystemTheme: () => "light" },
      i18n: { setLang, getLang, t, DEFAULT_LANG: "zh" },
      state: { settingsState, providerState },
      components: withModal ? { Modal } : {},
    },
  };

  createContext(sandbox);
  runInContext(SETTINGS_SOURCE, sandbox);

  // 安装 utils.el mock(必须在源码加载之后,install 之前注入)
  const u = fakeUtilsEl(fakeDocument, t);
  (sandbox as any).MyAgent.utils = u;

  const settingsFeature = (sandbox as { MyAgent: { settingsFeature: any } }).MyAgent.settingsFeature;

  return {
    settingsFeature,
    storage,
    container,
    document: fakeDocument,
    setTheme,
    setLang,
    getLang,
    t,
    settingsState: settingsState as any,
    providerState: providerState as any,
    modalInstances,
    confirmSpy: confirmSpy as any,
    reloadSpy,
    dispatchEvents,
    documentListeners,
  };
}

// ---------------------------------------------------------------------------
// 测试
// ---------------------------------------------------------------------------

describe("features/settings.js — 全局导出 & 源码约定", () => {
  it("挂载 settingsFeature 到 window.MyAgent", () => {
    const sb = loadSettings();
    expect(sb.settingsFeature).toBeDefined();
    expect(typeof sb.settingsFeature.installSettingsView).toBe("function");
    expect(typeof sb.settingsFeature.uninstall).toBe("function");
  });

  it("暴露常量 THEME_STORAGE_KEY / LANG_STORAGE_KEY / CHANGE_EVENT / VALID_*", () => {
    const sb = loadSettings();
    expect(sb.settingsFeature.THEME_STORAGE_KEY).toBe("my-agent.theme");
    expect(sb.settingsFeature.LANG_STORAGE_KEY).toBe("my-agent.lang");
    expect(sb.settingsFeature.THEME_CHANGE_EVENT).toBe("my-agent:theme-change");
    expect(sb.settingsFeature.LANG_CHANGE_EVENT).toBe("my-agent:lang-change");
    expect(sb.settingsFeature.VALID_THEMES).toEqual(["dark", "light", "system"]);
    expect(sb.settingsFeature.VALID_LANGS).toEqual(["zh", "en"]);
    expect(sb.settingsFeature.PLACEHOLDER_MODEL_VALUE).toBe("__default__");
  });

  it("暴露纯函数 applyTheme / applyLang / applyModel / getActiveProviderModels", () => {
    const sb = loadSettings();
    expect(typeof sb.settingsFeature.applyTheme).toBe("function");
    expect(typeof sb.settingsFeature.applyLang).toBe("function");
    expect(typeof sb.settingsFeature.applyModel).toBe("function");
    expect(typeof sb.settingsFeature.getActiveProviderModels).toBe("function");
    expect(typeof sb.settingsFeature.readCurrentTheme).toBe("function");
    expect(typeof sb.settingsFeature.readCurrentLang).toBe("function");
    expect(typeof sb.settingsFeature.readCurrentModel).toBe("function");
    expect(typeof sb.settingsFeature.performClearData).toBe("function");
  });

  it("源码：IIFE 模式 + 无依赖(import / require) + 无 emoji", () => {
    expect(SETTINGS_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(SETTINGS_SOURCE.trimEnd().endsWith(");")).toBe(true);
    expect(SETTINGS_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(SETTINGS_SOURCE).not.toMatch(/\brequire\s*\(/);
    expect(SETTINGS_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe("installSettingsView — 输入校验", () => {
  it("缺失 container 抛错", () => {
    const sb = loadSettings();
    expect(() => sb.settingsFeature.installSettingsView({} as any)).toThrow(/container/);
    expect(() => sb.settingsFeature.installSettingsView({ container: null } as any)).toThrow(/container/);
  });

  it("window.MyAgent.utils.el 不可用时抛错", () => {
    // 直接构造一个无 utils 的 sandbox
    const storage = createFakeStorage();
    const fakeDoc = {
      createElement: () => makeFakeElement("div"),
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
      body: makeFakeElement("body"),
    };
    const sandbox: Record<string, unknown> = {
      localStorage: storage,
      document: fakeDoc,
      console: { warn: () => {}, error: () => {} },
      CustomEvent: class { type: string; detail: unknown; constructor(t: string, i: any = {}) { this.type = t; this.detail = i.detail; } },
      MyAgent: { theme: { setTheme: () => {} }, i18n: { setLang: () => {}, getLang: () => "zh", t: (k: string) => k }, state: { settingsState: { get: () => ({ theme: "system", lang: "zh", model: null }), update: () => {}, set: () => {} }, providerState: { get: () => ({ providers: [], activeProviderId: null, loading: false }) } }, components: {} },
    };
    createContext(sandbox);
    runInContext(SETTINGS_SOURCE, sandbox);
    const sf = (sandbox as any).MyAgent.settingsFeature;
    expect(() => sf.installSettingsView({ container: makeFakeElement("div") })).toThrow(/utils\.el/);
  });
});

describe("installSettingsView — 渲染结构", () => {
  let sb: LoadedSandbox;
  let root: FakeElement;
  beforeEach(() => {
    sb = loadSettings({ initialTheme: "dark", initialLang: "zh" });
    root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
  });

  it("返回 form 根,挂到 container,container 第一个子就是 form", () => {
    expect(root.tagName).toBe("FORM");
    expect(root.getAttribute("id")).toBe("settings-form");
    expect((root.parentNode as any)?.id).toBe("settings-region");
    expect(sb.container.children[0]).toBe(root);
  });

  it("渲染 4 个 fieldsets(theme / lang / model / danger)+ form submit 不会刷新", () => {
    const fieldsets = root.querySelectorAll("fieldset");
    expect(fieldsets.length).toBe(4);
    const ids = fieldsets.map((f) => f.id);
    expect(ids).toContain("settings-fieldset-theme");
    expect(ids).toContain("settings-fieldset-lang");
    expect(ids).toContain("settings-fieldset-model");
    expect(ids).toContain("settings-fieldset-danger");

    const submitEvt = { type: "submit", preventDefault: vi.fn() };
    root.dispatchEvent(submitEvt as any);
    expect(submitEvt.preventDefault).toHaveBeenCalled();
  });

  it("每个 fieldset 含一个 legend(标题)+ 关联子控件", () => {
    const fieldsets = root.querySelectorAll("fieldset");
    fieldsets.forEach((fs) => {
      const legend = fs.querySelector("legend");
      expect(legend).not.toBeNull();
    });
  });

  it("主题 fieldset：3 个 radio(name=settings-theme),当前 dark checked", () => {
    const fs = root.querySelector("#settings-fieldset-theme")!;
    const radios = fs.querySelectorAll("input");
    expect(radios.length).toBe(3);
    const values = radios.map((r) => r.getAttribute("value"));
    expect(values).toEqual(["dark", "light", "system"]);
    expect(radios[0]._checked).toBe(true);
    expect(radios[1]._checked).toBe(false);
    expect(radios[2]._checked).toBe(false);
    // 每个 radio 有 label-for 关联
    radios.forEach((r) => {
      expect(r.getAttribute("id")).toBeTruthy();
      const label = fs.querySelector("label");
      // label 在每个 radio-row 里 — 找 for=id
      const id = r.getAttribute("id")!;
      const match = walkForLabel(fs, id);
      expect(match).toBeTruthy();
    });
  });

  it("语言 fieldset：2 个 radio(name=settings-lang),当前 zh checked", () => {
    const fs = root.querySelector("#settings-fieldset-lang")!;
    const radios = fs.querySelectorAll("input");
    expect(radios.length).toBe(2);
    const values = radios.map((r) => r.getAttribute("value"));
    expect(values).toEqual(["zh", "en"]);
    expect(radios[0]._checked).toBe(true);
  });

  it("模型 fieldset：select 含 placeholder + active provider 的模型", () => {
    const fs = root.querySelector("#settings-fieldset-model")!;
    const select = fs.querySelector("select")!;
    expect(select).not.toBeNull();
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(1 /* placeholder */ + 3 /* provider models */);
    expect(options[0].getAttribute("value")).toBe("__default__");
    expect(options[1].getAttribute("value")).toBe("gpt-4o-mini");
    expect(options[2].getAttribute("value")).toBe("gpt-4o");
    expect(options[3].getAttribute("value")).toBe("gpt-3.5-turbo");
  });

  it("清空数据：含 danger button (id=settings-btn-clear-data)", () => {
    const fs = root.querySelector("#settings-fieldset-danger")!;
    const btn = fs.querySelector("#settings-btn-clear-data")!;
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("type")).toBe("button");
  });
});

// ---------------------------------------------------------------------------
// walkForLabel — 找匹配 for=id 的 label 节点
// ---------------------------------------------------------------------------
function walkForLabel(root: FakeElement, id: string): FakeElement | null {
  for (const c of root.children) {
    if (!isFakeElement(c)) continue;
    if (c.tagName === "LABEL" && c.getAttribute("for") === id) return c;
    const sub = walkForLabel(c, id);
    if (sub) return sub;
  }
  return null;
}

describe("installSettingsView — 主题切换交互", () => {
  it("点击 light radio → setTheme('light') + localStorage['my-agent.theme']=light + CustomEvent + settingsState 更新", () => {
    const sb = loadSettings({ initialTheme: "dark" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const themeFs = root.querySelector("#settings-fieldset-theme")!;
    const radios = themeFs.querySelectorAll("input");
    const lightRadio = radios.find((r: FakeElement) => r.getAttribute("value") === "light")!;

    lightRadio._checked = true;
    lightRadio.dispatchEvent({ type: "change" });

    expect(sb.setTheme).toHaveBeenCalledTimes(1);
    expect(sb.setTheme).toHaveBeenCalledWith("light");
    expect(sb.storage.getItem("my-agent.theme")).toBe("light");
    const evt = sb.dispatchEvents.find((e) => e.type === "my-agent:theme-change");
    expect(evt).toBeTruthy();
    expect((evt!.detail as any).theme).toBe("light");
    expect(sb.settingsState.get().theme).toBe("light");
  });

  it("点击 system radio → setTheme('system')", () => {
    const sb = loadSettings({ initialTheme: "dark" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const radios = root.querySelector("#settings-fieldset-theme")!.querySelectorAll("input");
    const sysRadio = radios.find((r: FakeElement) => r.getAttribute("value") === "system")!;

    sysRadio._checked = true;
    sysRadio.dispatchEvent({ type: "change" });

    expect(sb.setTheme).toHaveBeenCalledWith("system");
    expect(sb.storage.getItem("my-agent.theme")).toBe("system");
  });

  it("未选中的 radio(change 时 checked=false)不触发 applyTheme", () => {
    const sb = loadSettings({ initialTheme: "dark" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const radios = root.querySelector("#settings-fieldset-theme")!.querySelectorAll("input");
    const lightRadio = radios.find((r: FakeElement) => r.getAttribute("value") === "light")!;
    // light 未 checked → dispatch change(模拟用户点取消 — 浏览器其实不会触发,但代码应防御)
    lightRadio._checked = false;
    lightRadio.dispatchEvent({ type: "change" });
    expect(sb.setTheme).not.toHaveBeenCalled();
  });

  it("localStorage.setItem 抛错(隐私模式)时不阻塞 UI", () => {
    const sb = loadSettings({ initialTheme: "dark" });
    sb.storage.setItem = vi.fn(() => { throw new Error("SecurityError"); });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const radios = root.querySelector("#settings-fieldset-theme")!.querySelectorAll("input");
    const lightRadio = radios.find((r: FakeElement) => r.getAttribute("value") === "light")!;
    lightRadio._checked = true;
    expect(() => lightRadio.dispatchEvent({ type: "change" })).not.toThrow();
    expect(sb.setTheme).toHaveBeenCalledWith("light");
  });
});

describe("installSettingsView — 语言切换交互", () => {
  it("点击 en radio → setLang('en') + localStorage['my-agent.lang']=en + CustomEvent + settingsState 更新", () => {
    const sb = loadSettings({ initialLang: "zh" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const radios = root.querySelector("#settings-fieldset-lang")!.querySelectorAll("input");
    const enRadio = radios.find((r: FakeElement) => r.getAttribute("value") === "en")!;

    enRadio._checked = true;
    enRadio.dispatchEvent({ type: "change" });

    expect(sb.setLang).toHaveBeenCalledTimes(1);
    expect(sb.setLang).toHaveBeenCalledWith("en");
    expect(sb.storage.getItem("my-agent.lang")).toBe("en");
    const evt = sb.dispatchEvents.find((e) => e.type === "my-agent:lang-change");
    expect(evt).toBeTruthy();
    expect((evt!.detail as any).lang).toBe("en");
    expect(sb.settingsState.get().lang).toBe("en");
  });

  it("点击 zh radio → setLang('zh')", () => {
    const sb = loadSettings({ initialLang: "en" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const radios = root.querySelector("#settings-fieldset-lang")!.querySelectorAll("input");
    const zhRadio = radios.find((r: FakeElement) => r.getAttribute("value") === "zh")!;
    zhRadio._checked = true;
    zhRadio.dispatchEvent({ type: "change" });
    expect(sb.setLang).toHaveBeenCalledWith("zh");
  });
});

describe("installSettingsView — 模型选择", () => {
  it("select change → settingsState.model 更新为所选值", () => {
    const sb = loadSettings({ initialModel: null });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const select = root.querySelector("#settings-fieldset-model")!.querySelector("select")!;

    select._value = "gpt-4o";
    select.dispatchEvent({ type: "change" });

    expect(sb.settingsState.get().model).toBe("gpt-4o");
  });

  it("选择 placeholder(使用 Provider 默认) → settingsState.model = null", () => {
    const sb = loadSettings({ initialModel: "gpt-4o" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const select = root.querySelector("#settings-fieldset-model")!.querySelector("select")!;

    select._value = "__default__";
    select.dispatchEvent({ type: "change" });

    expect(sb.settingsState.get().model).toBeNull();
  });

  it("active provider 无 models 且无 defaultModel → 只剩 placeholder option", () => {
    const sb = loadSettings({
      activeProviderModels: null,
      defaultModel: null,
    });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const select = root.querySelector("#settings-fieldset-model")!.querySelector("select")!;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(1);
    expect(options[0].getAttribute("value")).toBe("__default__");
  });

  it("active provider 无 models 但有 defaultModel → 显示 defaultModel 作为单 option", () => {
    const sb = loadSettings({
      activeProviderModels: [],
      defaultModel: "gpt-4o-mini",
    });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const select = root.querySelector("#settings-fieldset-model")!.querySelector("select")!;
    const options = select.querySelectorAll("option");
    expect(options.length).toBe(2);
    expect(options[1].getAttribute("value")).toBe("gpt-4o-mini");
  });

  it("无 active provider → 只剩 placeholder", () => {
    const sb = loadSettings();
    // 覆盖 providerState
    (sb.providerState as any).get = () => ({ providers: [], activeProviderId: null, loading: false });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const select = root.querySelector("#settings-fieldset-model")!.querySelector("select")!;
    expect(select.querySelectorAll("option").length).toBe(1);
  });

  it("settingsState.model 不在当前 provider models 列表中 → 多一个 '(旧)' option 回显", () => {
    const sb = loadSettings({ initialModel: "old-model-xyz" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const select = root.querySelector("#settings-fieldset-model")!.querySelector("select")!;
    const options = select.querySelectorAll("option");
    // 1 placeholder + 3 provider + 1 (旧)
    expect(options.length).toBe(5);
    expect(options[4].getAttribute("value")).toBe("old-model-xyz");
  });
});

describe("installSettingsView — 清空数据", () => {
  it("点击清空按钮 → components.Modal 被调用(打开 confirm)", () => {
    const sb = loadSettings();
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const btn = root.querySelector("#settings-btn-clear-data")!;
    btn.dispatchEvent({ type: "click" });
    expect(sb.modalInstances.length).toBe(1);
    expect(sb.modalInstances[0].open).toHaveBeenCalled();
  });

  it("components.Modal 缺失 → 降级走 confirm()", () => {
    const sb = loadSettings({ withModal: false });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const btn = root.querySelector("#settings-btn-clear-data")!;
    btn.dispatchEvent({ type: "click" });
    expect(sb.confirmSpy).toHaveBeenCalled();
  });

  it("confirm() 返回 true → performClearData → localStorage.clear + location.reload", () => {
    // 走 confirm() 降级路径(modal 缺失)
    const sb = loadSettings({ withModal: false, initialTheme: "dark", initialLang: "zh" });
    sb.storage.setItem("foo", "bar"); // 先放点东西确认会被清
    expect(sb.storage.data.size).toBeGreaterThan(0);

    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const btn = root.querySelector("#settings-btn-clear-data")!;
    btn.dispatchEvent({ type: "click" });

    expect(sb.confirmSpy).toHaveBeenCalled();
    expect(sb.storage.data.size).toBe(0); // localStorage.clear
    expect(sb.reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("confirm() 返回 false → 不清空、不刷新", () => {
    const sb = loadSettings({ withModal: false });
    sb.confirmSpy = vi.fn(() => false);
    (sb as any).confirmSpy = sb.confirmSpy;
    // 重新构造,因为 confirmSpy 是闭包变量
    const sb2 = loadSettings({ withModal: false, withConfirm: true });
    sb2.confirmSpy.mockReturnValue(false);

    const root = sb2.settingsFeature.installSettingsView({ container: sb2.container }).root;
    const btn = root.querySelector("#settings-btn-clear-data")!;
    sb2.storage.setItem("my-agent.theme", "dark");
    btn.dispatchEvent({ type: "click" });

    expect(sb2.confirmSpy).toHaveBeenCalled();
    expect(sb2.storage.getItem("my-agent.theme")).toBe("dark"); // 仍在
    expect(sb2.reloadSpy).not.toHaveBeenCalled();
  });

  it("performClearData 直接调 → localStorage.clear + reload", () => {
    const sb = loadSettings();
    sb.storage.setItem("x", "y");
    sb.settingsFeature.performClearData();
    expect(sb.storage.data.size).toBe(0);
    expect(sb.reloadSpy).toHaveBeenCalled();
  });
});

describe("uninstall — 清理", () => {
  it("uninstall() 移除 form 节点 + 再次调用安全无副作用", () => {
    const sb = loadSettings();
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    expect(sb.container.children).toContain(root);

    expect(sb.settingsFeature.uninstall()).toBe(true);
    expect(sb.container.children).not.toContain(root);
    expect(root.parentNode).toBeNull();

    // idempotent
    expect(sb.settingsFeature.uninstall()).toBe(false);
    expect(() => sb.settingsFeature.uninstall()).not.toThrow();
  });

  it("uninstall 后再调 change 不触发 setTheme / setLang", () => {
    const sb = loadSettings({ initialTheme: "dark" });
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const lightRadio = root.querySelector("#settings-fieldset-theme")!.querySelectorAll("input").find(
      (r: FakeElement) => r.getAttribute("value") === "light",
    )!;

    sb.settingsFeature.uninstall();
    lightRadio.dispatchEvent({ type: "change" });
    expect(sb.setTheme).not.toHaveBeenCalled();
  });

  it("install 第二次会自动卸载旧的(单例语义)", () => {
    const sb = loadSettings();
    const root1 = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    const root2 = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    expect(root1).not.toBe(root2);
    expect(sb.container.children).toContain(root2);
    expect(sb.container.children).not.toContain(root1);
  });
});

describe("纯函数 — getActiveProviderModels / readCurrent*", () => {
  it("getActiveProviderModels 返回 active provider 的 models", () => {
    const sb = loadSettings({ activeProviderModels: ["m1", "m2"] });
    expect(sb.settingsFeature.getActiveProviderModels()).toEqual(["m1", "m2"]);
  });

  it("无 active provider → 返回 []", () => {
    const sb = loadSettings();
    (sb.providerState as any).get = () => ({ providers: [], activeProviderId: null, loading: false });
    expect(sb.settingsFeature.getActiveProviderModels()).toEqual([]);
  });

  it("readCurrentTheme / readCurrentLang 优先 settingsState,localStorage 兜底", () => {
    const sb = loadSettings({ initialTheme: "light", initialLang: "en" });
    expect(sb.settingsFeature.readCurrentTheme()).toBe("light");
    expect(sb.settingsFeature.readCurrentLang()).toBe("en");
  });

  it("applyTheme / applyLang 也能直接调(无 install 时仍生效)", () => {
    const sb = loadSettings({ initialTheme: "system" });
    sb.settingsFeature.applyTheme("dark");
    expect(sb.setTheme).toHaveBeenCalledWith("dark");
    expect(sb.storage.getItem("my-agent.theme")).toBe("dark");
    expect(sb.settingsState.get().theme).toBe("dark");

    sb.settingsFeature.applyLang("en");
    expect(sb.setLang).toHaveBeenCalledWith("en");
    expect(sb.storage.getItem("my-agent.lang")).toBe("en");
    expect(sb.settingsState.get().lang).toBe("en");
  });

  it("非法 theme/lang 值被 normalize 拒绝(无副作用)", () => {
    const sb = loadSettings({ initialTheme: "dark" });
    sb.settingsFeature.applyTheme("bogus");
    expect(sb.setTheme).not.toHaveBeenCalled();
    expect(sb.storage.getItem("my-agent.theme")).toBe("dark"); // 不变
    expect(sb.settingsState.get().theme).toBe("dark"); // 不变
  });
});

describe("a11y — 表单结构", () => {
  it("每个 radio 都有对应 label-for 关联", () => {
    const sb = loadSettings();
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;

    const themeRadios = root.querySelector("#settings-fieldset-theme")!.querySelectorAll("input");
    themeRadios.forEach((r: FakeElement) => {
      const id = r.getAttribute("id")!;
      const lbl = walkForLabel(root, id);
      expect(lbl, `theme radio ${id} 无 label-for 关联`).toBeTruthy();
    });

    const langRadios = root.querySelector("#settings-fieldset-lang")!.querySelectorAll("input");
    langRadios.forEach((r: FakeElement) => {
      const id = r.getAttribute("id")!;
      const lbl = walkForLabel(root, id);
      expect(lbl, `lang radio ${id} 无 label-for 关联`).toBeTruthy();
    });
  });

  it("form 有 aria-label,fieldset 都有 legend", () => {
    const sb = loadSettings();
    const root = sb.settingsFeature.installSettingsView({ container: sb.container }).root;
    expect(root.getAttribute("aria-label")).toBeTruthy();
    root.querySelectorAll("fieldset").forEach((fs: FakeElement) => {
      expect(fs.querySelector("legend"), `fieldset ${fs.id} 无 legend`).toBeTruthy();
    });
  });
});
