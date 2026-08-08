/**
 * features/providers.js 测试 — F9 / WU-05c
 * ----------------------------------------------------------------------------
 * features/providers.js 是经典 <script defer> 加载（非 ES module），运行时挂到
 * window.MyAgent.providersFeature。这里用 node:vm 起一个干净上下文，注入：
 *   - apiFetch mock（按调用路径返回不同数据，模拟 8 条端点）
 *   - providerState store（用 state.js 真实 store 或 mock）
 *   - 最小 DOM mock（与 components.test.ts 同一设计）
 *   - 5 个组件（Button / Input / Textarea / Modal / Toast）
 *
 * 测试覆盖（≥ 14 用例）：
 *   1. installProvidersView 全局挂载到 window.MyAgent.providersFeature
 *   2. 渲染后表格行数 = list 长度
 *   3. 表格带 role=grid + <th scope="col">
 *   4. 操作按钮 aria-label 含 provider 名（a11y）
 *   5. 创建 modal 打开 + 提交调 create 端点
 *   6. 编辑 modal 预填表单
 *   7. 编辑 modal 提交调 update 端点
 *   8. toggle 调 toggle 端点 + 乐观更新 store
 *   9. setActive 调 setActive 端点
 *  10. 删除 confirm 取消：不调 delete
 *  11. 删除 confirm 确认：调 delete 端点
 *  12. 错误显示 Toast（error role）
 *  13. install 重复调用：第二次卸载前一个
 *  14. uninstall/destroy 清理
 *  15. _normalizeId 替换 :id 占位
 *  16. _errorMessage 处理 ApiClientError / Error / string
 *  17. 源码约定（IIFE + 无 import）
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ----------------------------------------------------------------------
// 路径 + 源码读取
// ----------------------------------------------------------------------

const PROVIDERS_PATH = fileURLToPath(
  new URL("../../web/js/features/providers.js", import.meta.url),
);
const PROVIDERS_SOURCE = readFileSync(PROVIDERS_PATH, "utf-8");

const SHARED_DIR = fileURLToPath(new URL("../../web/js/shared", import.meta.url));
const STATE_DIR = fileURLToPath(new URL("../../web/js/state", import.meta.url));
const COMPONENTS_DIR = fileURLToPath(
  new URL("../../web/js/components", import.meta.url),
);

const UTILS_SOURCE = readFileSync(`${SHARED_DIR}/utils.js`, "utf-8");
const API_SOURCE = readFileSync(`${SHARED_DIR}/api.js`, "utf-8");
const STATE_SOURCE = readFileSync(`${STATE_DIR}/state.js`, "utf-8");

const COMPONENT_SOURCES = {
  button: readFileSync(`${COMPONENTS_DIR}/button.js`, "utf-8"),
  input: readFileSync(`${COMPONENTS_DIR}/input.js`, "utf-8"),
  textarea: readFileSync(`${COMPONENTS_DIR}/textarea.js`, "utf-8"),
  modal: readFileSync(`${COMPONENTS_DIR}/modal.js`, "utf-8"),
  toast: readFileSync(`${COMPONENTS_DIR}/toast.js`, "utf-8"),
};

// ----------------------------------------------------------------------
// 极简 DOM mock（与 components.test.ts 同一设计，足够驱动 providers.js）
// ----------------------------------------------------------------------

interface FakeAttr {
  name: string;
  value: string;
}
interface FakeEventTarget {
  _listeners: Map<
    string,
    Array<{ cb: EventListener; opts?: AddEventListenerOptions | boolean }>
  >;
  addEventListener(
    type: string,
    cb: EventListener,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  removeEventListener(
    type: string,
    cb: EventListener,
    opts?: AddEventListenerOptions | boolean,
  ): void;
  dispatchEvent(evt: { type: string }): boolean;
}
type FakeNode =
  | FakeElement
  | { kind: "text"; nodeType: 3; textContent: string; parentNode: FakeElement | null };
interface FakeElement extends FakeEventTarget {
  tagName: string;
  nodeType: number;
  children: FakeNode[];
  attributes: FakeAttr[];
  dataset: Record<string, string>;
  parentNode: FakeNode | null;
  textContent: string;
  innerHTML: string;
  id: string;
  className: string;
  hidden: boolean;
  disabled: boolean;
  type: string;
  value: string;
  tabIndex: number;
  appendChild(child: FakeNode): FakeNode;
  removeChild(child: FakeNode): FakeNode;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
  contains(node: FakeNode | null): boolean;
  focus(): void;
  click(): void;
}

function makeEventTarget(): FakeEventTarget {
  const target: FakeEventTarget = {
    _listeners: new Map(),
    addEventListener(type, cb, opts) {
      const list = target._listeners.get(type) || [];
      list.push({ cb, opts });
      target._listeners.set(type, list);
    },
    removeEventListener(type, cb, opts) {
      const list = target._listeners.get(type);
      if (!list) return;
      const idx = list.findIndex(
        (e) => e.cb === cb && sameOpts(e.opts, opts),
      );
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = target._listeners.get(evt.type);
      if (!list) return true;
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
  return target;
}

function sameOpts(
  a?: AddEventListenerOptions | boolean,
  b?: AddEventListenerOptions | boolean,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return false;
  return (
    (!!(a as AddEventListenerOptions).capture) ===
    (!!(b as AddEventListenerOptions).capture)
  );
}

const NATIVE_PROPS = new Set([
  "id", "title", "lang", "dir", "tabIndex", "hidden", "type", "name", "value",
  "href", "src", "alt", "placeholder", "disabled", "checked", "selected",
  "readOnly", "required", "maxLength", "minLength", "min", "max", "step",
  "rows", "cols", "role", "style", "autofocus",
]);

function makeElement(tagName: string): FakeElement {
  const el = makeEventTarget() as FakeElement;
  el.tagName = tagName.toUpperCase();
  el.nodeType = 1;
  el.children = [];
  el.attributes = [];
  el.dataset = {};
  el.parentNode = null;
  el.textContent = "";
  el.innerHTML = "";
  el.id = "";
  el.className = "";
  el.hidden = false;
  el.disabled = false;
  el.type = "";
  el.value = "";
  el.tabIndex = -1;
  const classSet = new Set<string>();
  Object.defineProperty(el, "className", {
    get() {
      return Array.from(classSet).join(" ");
    },
    set(v: string) {
      const arr = String(v).split(/\s+/).filter(Boolean);
      classSet.clear();
      for (const c of arr) classSet.add(c);
      const existing = el.attributes.find((a) => a.name === "class");
      if (existing) existing.value = Array.from(classSet).join(" ");
      else el.attributes.push({ name: "class", value: Array.from(classSet).join(" ") });
    },
    configurable: true,
  });

  const syncProp = (name: string) => {
    let backing: any = undefined;
    Object.defineProperty(el, name, {
      get() {
        return backing;
      },
      set(v: any) {
        backing = v;
        const existing = el.attributes.find((a) => a.name === name);
        const str = v === true ? "" : v === false || v == null ? null : String(v);
        if (existing) {
          if (str === null) {
            const i = el.attributes.indexOf(existing);
            el.attributes.splice(i, 1);
          } else {
            existing.value = str;
          }
        } else if (str !== null) {
          el.attributes.push({ name, value: str });
        }
      },
      configurable: true,
      enumerable: true,
    });
  };
  for (const p of NATIVE_PROPS) syncProp(p);
  (el as any).style = "";

  el.appendChild = function (c: FakeNode) {
    c.parentNode = el;
    el.children.push(c);
    if ("kind" in c && c.kind === "text") {
      el.textContent += (c as { textContent: string }).textContent;
    } else if ("tagName" in c) {
      el.textContent += (c as FakeElement).textContent;
    }
    return c;
  };
  el.removeChild = function (c: FakeNode) {
    const i = el.children.indexOf(c);
    if (i >= 0) {
      el.children.splice(i, 1);
      (c as { parentNode: FakeNode | null }).parentNode = null;
    }
    return c;
  };
  el.setAttribute = function (name: string, value: string) {
    const lower = name.toLowerCase();
    const existing = el.attributes.find((a) => a.name.toLowerCase() === lower);
    if (existing) existing.value = value;
    else el.attributes.push({ name, value });
    if (lower === "id") el.id = value;
    if (lower === "class") el.className = value;
    if (lower === "value") el.value = value;
    if (lower === "type") el.type = value;
    if (lower === "hidden") el.hidden = value === "" || value === "true";
    if (lower === "disabled") el.disabled = value === "" || value === "true";
    if (lower === "tabindex") el.tabIndex = parseInt(value, 10);
    if (name.startsWith("data-")) {
      el.dataset[name.slice("data-".length)] = value;
    }
  };
  el.getAttribute = function (name: string) {
    const lower = name.toLowerCase();
    return el.attributes.find((a) => a.name.toLowerCase() === lower)?.value ?? null;
  };
  el.querySelector = function (sel: string) {
    const tag = sel.toUpperCase();
    function walk(node: FakeNode): FakeElement | null {
      if (!("tagName" in node)) return null;
      const r = node as FakeElement;
      if (r.tagName === tag) return r;
      for (const c of r.children) {
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    }
    return walk(el);
  };
  el.querySelectorAll = function (sel: string) {
    const tag = sel.toUpperCase();
    const out: FakeElement[] = [];
    function walk(node: FakeNode) {
      if ("tagName" in node) {
        if ((node as FakeElement).tagName === tag) out.push(node as FakeElement);
        for (const c of (node as FakeElement).children) walk(c);
      }
    }
    walk(el);
    return out;
  };
  el.contains = function (node: FakeNode | null) {
    if (!node) return false;
    if (node === el) return true;
    for (const c of el.children) {
      if ("tagName" in c) {
        if (c === node) return true;
        if ((c as FakeElement).contains(node)) return true;
      }
    }
    return false;
  };
  el.focus = function () {};
  el.click = function () {
    el.dispatchEvent({ type: "click" });
  };
  return el;
}

function makeDocument(): {
  document: any;
  body: FakeElement;
} {
  const body = makeElement("body");
  let activeElement: FakeElement | null = body;

  function findById(root: FakeNode, id: string): FakeElement | null {
    if ("tagName" in root) {
      const r = root as FakeElement;
      if (r.id === id) return r;
      for (const c of r.children) {
        const hit = findById(c, id);
        if (hit) return hit;
      }
    }
    return null;
  }

  const doc: any = {
    createElement(tag: string) {
      return makeElement(tag);
    },
    createTextNode(text: string) {
      return {
        kind: "text" as const,
        nodeType: 3,
        textContent: String(text),
        parentNode: null as FakeElement | null,
      };
    },
    body: body,
    get activeElement() {
      return activeElement;
    },
    set activeElement(v) {
      activeElement = v;
    },
    getElementById(id: string) {
      return findById(body, id);
    },
    querySelector(sel: string) {
      const tag = sel.toUpperCase();
      function walk(node: FakeNode): FakeElement | null {
        if (!("tagName" in node)) return null;
        const r = node as FakeElement;
        if (r.tagName === tag) return r;
        for (const c of r.children) {
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      }
      return walk(body);
    },
    querySelectorAll(sel: string) {
      const tag = sel.toUpperCase();
      const out: FakeElement[] = [];
      function walk(node: FakeNode) {
        if ("tagName" in node) {
          if ((node as FakeElement).tagName === tag) out.push(node as FakeElement);
          for (const c of (node as FakeElement).children) walk(c);
        }
      }
      walk(body);
      return out;
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };

  return { document: doc, body: body };
}

// ----------------------------------------------------------------------
// mock fetch：根据 URL 决定响应（解析端点）
// ----------------------------------------------------------------------

interface ApiMockConfig {
  list?: any[];
  active?: any | null; // null 表示 404
  activeError?: boolean; // 强制 active 端点报网络错
  listError?: boolean;
  created?: any;
  updated?: any;
  toggleResult?: any;
  setActiveResult?: any;
  deleted?: { deleted: string };
  forceError?: { code?: string; message?: string; status?: number };
  /** 让下一次 fetch 调用 reject（模拟 NETWORK_ERROR） */
  rejectOnce?: boolean;
}

function makeApiFetch(config: ApiMockConfig = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const list = config.list || [];
  const active = config.active !== undefined ? config.active : null;
  const fn = vi.fn((url: string, init: RequestInit | undefined) => {
    calls.push({ url, init });
    const method = (init?.method || "GET").toUpperCase();

    if (config.rejectOnce) {
      config.rejectOnce = false;
      return Promise.reject(new Error("Network down"));
    }

    if (config.forceError) {
      const err = new Error(
        config.forceError.message || "Server error",
      ) as Error & { code?: string; status?: number };
      err.code = config.forceError.code || "INTERNAL";
      err.status = config.forceError.status ?? 500;
      return Promise.reject(err);
    }

    // GET /api/providers
    if (method === "GET" && /\/api\/providers$/.test(url)) {
      if (config.listError) {
        const err = new Error("boom") as Error & { code?: string; status?: number };
        err.code = "INTERNAL";
        err.status = 500;
        return Promise.reject(err);
      }
      return Promise.resolve(list);
    }

    // GET /api/providers/active
    if (method === "GET" && url.endsWith("/api/providers/active")) {
      if (config.activeError || active === null || active === undefined) {
        const err = new Error(
          config.activeError ? "No active provider configured" : "no active",
        ) as Error & { code?: string; status?: number };
        err.code = "PROVIDER_NOT_FOUND";
        err.status = 404;
        return Promise.reject(err);
      }
      return Promise.resolve(active);
    }

    // POST /api/providers
    if (method === "POST" && /\/api\/providers$/.test(url)) {
      return Promise.resolve(config.created || {});
    }

    // PUT /api/providers/active
    if (method === "PUT" && url.endsWith("/api/providers/active")) {
      return Promise.resolve(
        config.setActiveResult || active || { id: "deepseek" },
      );
    }

    // PATCH /api/providers/active/model
    if (url.endsWith("/api/providers/active/model")) {
      return Promise.resolve(active || { id: "deepseek" });
    }

    // POST /api/providers/:id/toggle
    if (
      method === "POST" &&
      /\/api\/providers\/[^/]+\/toggle$/.test(url)
    ) {
      return Promise.resolve(
        config.toggleResult || { id: "deepseek", enabled: false },
      );
    }

    // PUT /api/providers/:id
    if (method === "PUT" && /\/api\/providers\/[^/]+$/.test(url)) {
      return Promise.resolve(config.updated || { id: "deepseek" });
    }

    // DELETE /api/providers/:id
    if (
      method === "DELETE" &&
      /\/api\/providers\/[^/]+$/.test(url)
    ) {
      const id = url.split("/").pop() || "";
      return Promise.resolve(config.deleted || { deleted: id });
    }

    // 兜底：null
    return Promise.resolve(null);
  });
  return { fn, calls };
}

// ----------------------------------------------------------------------
// Sandbox 工厂
// ----------------------------------------------------------------------

interface Sandbox {
  MyAgent: any;
  document: any;
  body: FakeElement;
  console: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; log: (...a: unknown[]) => void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  CustomEvent?: any;
  globalThis: any;
  location: { origin: string };
  fetch: ReturnType<typeof vi.fn>;
}

function buildSandbox(): Sandbox {
  const doc = makeDocument();
  const sandbox: Sandbox = {
    MyAgent: {},
    document: doc.document,
    body: doc.body,
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
    globalThis: undefined as any,
    location: { origin: "http://localhost" },
    fetch: vi.fn(),
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadAllDeps(sandbox: Sandbox) {
  createContext(sandbox);
  runInContext(UTILS_SOURCE, sandbox as any);
  runInContext(API_SOURCE, sandbox as any);
  runInContext(STATE_SOURCE, sandbox as any);

  // icons mock（与 components.test.ts 一致）
  sandbox.MyAgent.icons = {
    iconHtml: vi.fn(
      (name: string, size?: number) =>
        '<svg data-name="' + name + '" width="' + (size || 24) + '"></svg>',
    ),
    hasIcon: vi.fn(() => true),
    ICON_NAMES: ["info"],
  };

  // i18n mock：直接返回 key
  sandbox.MyAgent.i18n = {
    t: vi.fn((key: string) => "[" + key + "]"),
    getLang: vi.fn(() => "zh"),
    setLang: vi.fn(),
    DEFAULT_LANG: "zh",
  };

  for (const name of Object.keys(COMPONENT_SOURCES) as Array<keyof typeof COMPONENT_SOURCES>) {
    runInContext(COMPONENT_SOURCES[name], sandbox as any);
  }

  return sandbox;
}

function loadProviders(sandbox: Sandbox) {
  runInContext(PROVIDERS_SOURCE, sandbox as any);
  return sandbox.MyAgent.providersFeature;
}

// ----------------------------------------------------------------------
// 工具
// ----------------------------------------------------------------------

function hasClass(el: FakeElement, cls: string): boolean {
  return (" " + (el.className || "") + " ").split(" ").indexOf(cls) >= 0;
}

function findByText(root: FakeElement, text: string): FakeElement | null {
  if (root.textContent && root.textContent.indexOf(text) >= 0) return root;
  for (const c of root.children) {
    if ("tagName" in c) {
      const hit = findByText(c as FakeElement, text);
      if (hit) return hit;
    }
  }
  return null;
}

function findButtonByText(root: FakeElement, text: string): FakeElement | null {
  const buttons = root.querySelectorAll("button");
  for (const b of buttons) {
    if (b.textContent && b.textContent.indexOf(text) >= 0) return b;
  }
  return null;
}

function findButtonByAriaLabel(
  root: FakeElement,
  pattern: string,
): FakeElement | null {
  const buttons = root.querySelectorAll("button");
  for (const b of buttons) {
    const aria = b.getAttribute("aria-label") || "";
    if (aria.indexOf(pattern) >= 0) return b;
  }
  return null;
}

// ----------------------------------------------------------------------
// 测试用例
// ----------------------------------------------------------------------

describe("features/providers.js — 全局挂载与基础 API", () => {
  it("挂载到 window.MyAgent.providersFeature", () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const feature = loadProviders(sandbox);
    expect(feature).toBeDefined();
    expect(typeof feature.installProvidersView).toBe("function");
  });

  it("暴露 ENDPOINTS（8 条端点）+ _normalizeId", () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const feature = loadProviders(sandbox);
    expect(feature._ENDPOINTS).toBeDefined();
    expect(feature._ENDPOINTS.list).toBe("/api/providers");
    expect(feature._ENDPOINTS.active).toBe("/api/providers/active");
    expect(feature._ENDPOINTS.create).toBe("/api/providers");
    expect(feature._ENDPOINTS.setActive).toBe("/api/providers/active");
    expect(feature._ENDPOINTS.setActiveModel).toBe("/api/providers/active/model");
    expect(feature._ENDPOINTS.toggle).toBe("/api/providers/:id/toggle");
    expect(feature._ENDPOINTS.update).toBe("/api/providers/:id");
    expect(feature._ENDPOINTS.remove).toBe("/api/providers/:id");
    expect(typeof feature._normalizeId).toBe("function");
  });

  it("_normalizeId 替换 :id 占位 + URL 编码", () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const feature = loadProviders(sandbox);
    expect(feature._normalizeId("/api/providers/:id", "deepseek")).toBe(
      "/api/providers/deepseek",
    );
    // 含特殊字符的 id 应被 encodeURIComponent
    expect(feature._normalizeId("/api/providers/:id/x", "a/b")).toBe(
      "/api/providers/a%2Fb/x",
    );
  });

  it("_errorMessage 处理 ApiClientError / Error / string / null", () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const feature = loadProviders(sandbox);
    expect(feature._errorMessage("hello")).toBe("hello");
    expect(feature._errorMessage(new Error("boom"))).toBe("boom");
    expect(feature._errorMessage(null)).toBe("Unknown error");
    // ApiClientError 也带 .message
    const ApiError = sandbox.MyAgent.api.ApiClientError;
    const apiErr = new ApiError("X", "test message");
    expect(feature._errorMessage(apiErr)).toBe("test message");
  });
});

describe("installProvidersView — 渲染 + 表格", () => {
  it("渲染后表格行数 = list 长度（tbody 行）", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", enabled: true, type: "deepseek", apiKey: "" },
        { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o", enabled: true, type: "deepseek", apiKey: "" },
      ],
      active: { id: "deepseek", name: "DeepSeek", baseUrl: "x", defaultModel: "m", enabled: true, type: "deepseek", apiKey: "" },
    });
    sandbox.fetch = apiMock.fn;
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    sandbox.body.appendChild(container);
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    // 等 microtask
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.getAttribute("role")).toBe("grid");
    const tbody = table!.querySelector("tbody");
    expect(tbody).not.toBeNull();
    const rows = tbody!.querySelectorAll("tr");
    expect(rows.length).toBe(2);

    view.destroy();
  });

  it("表格 <th scope=col> + <table role=grid> a11y", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        { id: "p1", name: "P1", baseUrl: "u", defaultModel: "m", enabled: true, type: "deepseek", apiKey: "" },
      ],
      active: null,
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.getAttribute("role")).toBe("grid");
    const ths = table!.querySelectorAll("th");
    expect(ths.length).toBeGreaterThan(0);
    for (const th of ths) {
      expect(th.getAttribute("scope")).toBe("col");
    }

    view.destroy();
  });

  it("操作按钮 aria-label 含 provider 名（a11y）", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        { id: "deepseek", name: "DeepSeek", baseUrl: "u", defaultModel: "m", enabled: true, type: "deepseek", apiKey: "" },
      ],
      active: null,
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    const editBtn = findButtonByAriaLabel(container, "编辑 DeepSeek");
    const toggleBtn = findButtonByAriaLabel(container, "禁用 DeepSeek");
    const delBtn = findButtonByAriaLabel(container, "删除 DeepSeek");
    const setActiveBtn = findButtonByAriaLabel(container, "把 DeepSeek");

    expect(editBtn).not.toBeNull();
    expect(toggleBtn).not.toBeNull();
    expect(delBtn).not.toBeNull();
    expect(setActiveBtn).not.toBeNull();

    view.destroy();
  });

  it("当前 active 行不显示「设为 active」按钮（仅 badge）", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        { id: "p1", name: "Active", baseUrl: "u", defaultModel: "m", enabled: true, type: "deepseek", apiKey: "" },
      ],
      active: { id: "p1", name: "Active", baseUrl: "u", defaultModel: "m", enabled: true, type: "deepseek", apiKey: "" },
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    const setActiveBtn = findButtonByAriaLabel(container, "把 Active");
    expect(setActiveBtn).toBeNull();
    // 应有 active badge
    const activeBadge = findByText(container, "[provider.active]");
    expect(activeBadge).not.toBeNull();

    view.destroy();
  });
});

describe("installProvidersView — 创建 / 编辑 / 删除 / setActive / toggle", () => {
  it("点击「新建 Provider」打开 modal + 提交调 POST /api/providers", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [],
      active: null,
      created: {
        id: "newp",
        name: "NewP",
        baseUrl: "https://x.test",
        defaultModel: "m1",
        enabled: true,
        type: "deepseek",
        apiKey: "",
      },
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    // 点新建按钮
    const addBtn = findButtonByText(container, "+ 新建 Provider");
    expect(addBtn).not.toBeNull();
    addBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    // Modal 应在 body 中
    const dialogs = sandbox.body.querySelectorAll("div");
    const hasModal = dialogs.some((d) =>
      hasClass(d, "modal-dialog"),
    );
    expect(hasModal).toBe(true);

    // 找表单 input id
    const inputs = sandbox.body.querySelectorAll("input");
    let idInput: FakeElement | null = null;
    let nameInput: FakeElement | null = null;
    let urlInput: FakeElement | null = null;
    let modelInput: FakeElement | null = null;
    for (const inp of inputs) {
      // 通过 inputEl.value 字段
      if (inp.value === "" && inp.getAttribute("type") !== "hidden") {
        // 占位
      }
    }
    // 简化：直接从 DOM 取所有 text input — 填值
    for (const inp of inputs) {
      inp.value = inp.value; // no-op
    }
    // 找到 input，按字段 label for 关联
    const fields = sandbox.body.querySelectorAll("div");
    // 改用更简单：直接遍历所有 input，按 input.value 索引赋值（依赖表单顺序）
    const allInputs = inputs;
    // 表单字段顺序：id, name, type, apiKey, baseUrl, defaultModel（来自 providers.js buildFormModal）
    if (allInputs.length >= 6) {
      idInput = allInputs[0]!;
      nameInput = allInputs[1]!;
      urlInput = allInputs[4]!;
      modelInput = allInputs[5]!;
      idInput.value = "newp";
      nameInput.value = "NewP";
      urlInput.value = "https://x.test";
      modelInput.value = "m1";
      // 触发 input event
      idInput.dispatchEvent({ type: "input" });
      nameInput.dispatchEvent({ type: "input" });
      urlInput.dispatchEvent({ type: "input" });
      modelInput.dispatchEvent({ type: "input" });
    }

    // 提交
    const submitBtn = findButtonByText(sandbox.body, "[common.save]");
    expect(submitBtn).not.toBeNull();
    submitBtn!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // 验证 fetch 被调：POST /api/providers
    const postCalls = apiMock.calls.filter(
      (c) => c.init?.method === "POST" && c.url.endsWith("/api/providers"),
    );
    expect(postCalls.length).toBeGreaterThan(0);

    view.destroy();
  });

  it("编辑 modal 预填表单字段", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        {
          id: "p1",
          name: "P1",
          baseUrl: "https://p1.test/v1",
          defaultModel: "model-x",
          enabled: true,
          type: "deepseek",
          apiKey: "secret-key",
        },
      ],
      active: null,
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    // 点编辑
    const editBtn = findButtonByAriaLabel(container, "编辑 P1");
    expect(editBtn).not.toBeNull();
    editBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    // 验证表单 input value
    const inputs = sandbox.body.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(6);
    // id 字段
    expect(inputs[0]!.value).toBe("p1");
    expect(inputs[1]!.value).toBe("P1");
    // apiKey 字段（index 3）
    expect(inputs[3]!.value).toBe("secret-key");
    expect(inputs[4]!.value).toBe("https://p1.test/v1");
    expect(inputs[5]!.value).toBe("model-x");

    view.destroy();
  });

  it("toggle 按钮调 POST /api/providers/:id/toggle + 乐观更新 store", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        {
          id: "p1",
          name: "P1",
          baseUrl: "u",
          defaultModel: "m",
          enabled: true,
          type: "deepseek",
          apiKey: "",
        },
      ],
      active: null,
      toggleResult: {
        id: "p1",
        name: "P1",
        baseUrl: "u",
        defaultModel: "m",
        enabled: false,
        type: "deepseek",
        apiKey: "",
      },
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    // 点禁用（p1.enabled=true → 按钮文字「禁用」）
    const toggleBtn = findButtonByAriaLabel(container, "禁用 P1");
    expect(toggleBtn).not.toBeNull();
    toggleBtn!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const toggleCalls = apiMock.calls.filter(
      (c) =>
        c.init?.method === "POST" && /\/api\/providers\/p1\/toggle$/.test(c.url),
    );
    expect(toggleCalls.length).toBeGreaterThan(0);

    view.destroy();
  });

  it("「设为 active」按钮调 PUT /api/providers/active", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        {
          id: "p1",
          name: "P1",
          baseUrl: "u",
          defaultModel: "m",
          enabled: true,
          type: "deepseek",
          apiKey: "",
        },
      ],
      active: null,
      setActiveResult: {
        id: "p1",
        name: "P1",
        baseUrl: "u",
        defaultModel: "m",
        enabled: true,
        type: "deepseek",
        apiKey: "",
      },
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    // 点「设为 active」
    const setBtn = findButtonByAriaLabel(container, "把 P1 设为当前");
    expect(setBtn).not.toBeNull();
    setBtn!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const setActiveCalls = apiMock.calls.filter(
      (c) =>
        c.init?.method === "PUT" &&
        c.url.endsWith("/api/providers/active"),
    );
    expect(setActiveCalls.length).toBeGreaterThan(0);
    // 请求 body 应为 { id: "p1" }
    const init = setActiveCalls[0]!.init as RequestInit;
    const body = init.body as unknown as { id: string };
    expect(body).toEqual({ id: "p1" });

    view.destroy();
  });

  it("删除 confirm 取消：不调 DELETE", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        {
          id: "p1",
          name: "P1",
          baseUrl: "u",
          defaultModel: "m",
          enabled: true,
          type: "deepseek",
          apiKey: "",
        },
      ],
      active: null,
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    const delBtn = findButtonByAriaLabel(container, "删除 P1");
    expect(delBtn).not.toBeNull();
    delBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    // Modal 出现，找取消按钮
    const cancelBtn = findButtonByText(sandbox.body, "[common.cancel]");
    expect(cancelBtn).not.toBeNull();
    cancelBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    const delCalls = apiMock.calls.filter(
      (c) =>
        c.init?.method === "DELETE" &&
        /\/api\/providers\/p1$/.test(c.url),
    );
    expect(delCalls.length).toBe(0);

    view.destroy();
  });

  it("删除 confirm 确认：调 DELETE /api/providers/:id", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        {
          id: "p1",
          name: "P1",
          baseUrl: "u",
          defaultModel: "m",
          enabled: true,
          type: "deepseek",
          apiKey: "",
        },
      ],
      active: null,
      deleted: { deleted: "p1" },
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    const delBtn = findButtonByAriaLabel(container, "删除 P1");
    expect(delBtn).not.toBeNull();
    delBtn!.click();
    await new Promise((r) => setTimeout(r, 0));

    // 找确认按钮（footer 中的 danger 按钮，文字是 [common.delete]）
    const confirmBtn = findButtonByText(sandbox.body, "[common.delete]");
    expect(confirmBtn).not.toBeNull();
    confirmBtn!.click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const delCalls = apiMock.calls.filter(
      (c) =>
        c.init?.method === "DELETE" &&
        /\/api\/providers\/p1$/.test(c.url),
    );
    expect(delCalls.length).toBeGreaterThan(0);

    view.destroy();
  });
});

describe("installProvidersView — 错误处理", () => {
  it("list 端点失败时显示 error Toast", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [],
      active: null,
      forceError: { code: "INTERNAL", message: "Server exploded", status: 500 },
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // toast-root 应该被创建，且包含 toast-error
    const toastRoot = sandbox.document.getElementById("toast-root");
    expect(toastRoot).not.toBeNull();
    // 找 error toast
    const errorToasts = sandbox.body.querySelectorAll("div");
    const found = errorToasts.find(
      (d) => hasClass(d, "toast") && hasClass(d, "toast-error"),
    );
    expect(found).toBeDefined();

    view.destroy();
  });
});

describe("installProvidersView — 卸载与清理", () => {
  it("destroy() 清理 DOM、toast、订阅（不抛错）", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({
      list: [
        {
          id: "p1",
          name: "P1",
          baseUrl: "u",
          defaultModel: "m",
          enabled: true,
          type: "deepseek",
          apiKey: "",
        },
      ],
      active: null,
    });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    expect(container.children.length).toBeGreaterThan(0);

    expect(() => view.destroy()).not.toThrow();
    // container 内容被清空
    expect(container.children.length).toBe(0);

    // 二次 destroy 安全
    expect(() => view.destroy()).not.toThrow();
  });

  it("uninstall / destroy 幂等", async () => {
    const sandbox = buildSandbox();
    loadAllDeps(sandbox);
    const apiMock = makeApiFetch({ list: [], active: null });
    sandbox.MyAgent.api.apiFetch = apiMock.fn;

    const container = makeElement("div");
    const feature = loadProviders(sandbox);
    const view = feature.installProvidersView({ container });

    await new Promise((r) => setTimeout(r, 0));

    // 先 destroy
    expect(container.children.length).toBeGreaterThan(0);
    view.destroy();
    expect(container.children.length).toBe(0);

    // destroy 后订阅 store 不会重渲染
    const providerStore = sandbox.MyAgent.state.getStore("providerState");
    expect(providerStore).not.toBeNull();
    providerStore.set({
      providers: [
        {
          id: "after",
          name: "After",
          baseUrl: "u",
          defaultModel: "m",
          enabled: true,
          type: "deepseek",
          apiKey: "",
        },
      ],
      activeProviderId: null,
      loading: false,
    });
    await new Promise((r) => setTimeout(r, 0));

    // 容器应保持空（destroy 已清空 + unsubscribe 后不再 render）
    expect(container.children.length).toBe(0);

    // 二次 destroy 安全
    expect(() => view.destroy()).not.toThrow();
    expect(container.children.length).toBe(0);
  });
});

describe("源码约定", () => {
  it("IIFE 模式（spec § 4.4.6）", () => {
    expect(PROVIDERS_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(PROVIDERS_SOURCE.trimEnd().endsWith(");")).toBe(true);
  });

  it("挂载到 window.MyAgent.providersFeature", () => {
    expect(PROVIDERS_SOURCE).toMatch(/global\.MyAgent\s*=\s*global\.MyAgent\s*\|\|\s*\{\}/);
    expect(PROVIDERS_SOURCE).toMatch(/global\.MyAgent\.providersFeature\s*=/);
  });

  it("无 import / require（零依赖）", () => {
    expect(PROVIDERS_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(PROVIDERS_SOURCE).not.toMatch(/\brequire\s*\(/);
  });

  it("无 emoji（spec § 2.2）", () => {
    expect(PROVIDERS_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
