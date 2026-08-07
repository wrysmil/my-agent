/**
 * features-agents.test.ts — F12 / WU-05e 单测（≥ 10 用例）
 *
 * 测试模式与 features-theme.test.ts 一致：用 node:vm 起干净沙箱，注入最小 DOM
 * mock + 真实 utils.js / i18n.js / state.js 源码 + mock fetch + mock components。
 *
 * 覆盖：
 *   - 全局挂载：window.MyAgent.agentsFeature.installAgentsView
 *   - installAgentsView({container}) 渲染 Tabs + Agent 列表
 *   - Agent 列表行展示 name / scope badge / description
 *   - 点击 list 项 → 打开 detail modal（含 systemPrompt / tools / 启动按钮）
 *   - 「启动对话」按钮 → 派发 CustomEvent('my-agent:agent-launch', {agentId, agentName})
 *   - 启动按钮同时调 options.onLaunch（若传入）
 *   - a11y：Tabs role=tablist + Agent 列表 role=listbox + 行 role=option
 *   - 卸载：uninstall() / destroy() 摘除节点 + 取消未完成请求
 *   - 错误：fetchAgentsList 失败 → Toast + 错误占位
 *   - 缓存：先显示缓存，再异步刷新
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const AGENTS_PATH = fileURLToPath(
  new URL("../../web/js/features/agents.js", import.meta.url),
);
const AGENTS_SOURCE = readFileSync(AGENTS_PATH, "utf-8");

const UTILS_SOURCE = readFileSync(
  fileURLToPath(new URL("../../web/js/shared/utils.js", import.meta.url)),
  "utf-8",
);
const API_SOURCE = readFileSync(
  fileURLToPath(new URL("../../web/js/shared/api.js", import.meta.url)),
  "utf-8",
);
const I18N_SOURCE = readFileSync(
  fileURLToPath(new URL("../../web/js/shared/i18n.js", import.meta.url)),
  "utf-8",
);
const STATE_SOURCE = readFileSync(
  fileURLToPath(new URL("../../web/js/state/state.js", import.meta.url)),
  "utf-8",
);

// ----------------------------------------------------------------------
// 最小 DOM mock —— 与 components.test.ts 同样的形态
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
  classList: {
    add(c: string): void;
    remove(c: string): void;
    contains(c: string): boolean;
  };
  style: string;
  hidden: boolean;
  disabled: boolean;
  type: string;
  value: string;
  tabIndex: number;
  appendChild(child: FakeNode): FakeNode;
  removeChild(child: FakeNode): FakeNode;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
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
    !!(a as AddEventListenerOptions).capture === !!(b as AddEventListenerOptions).capture
  );
}

const NATIVE_PROPS = new Set([
  "id",
  "title",
  "lang",
  "dir",
  "tabIndex",
  "hidden",
  "type",
  "name",
  "value",
  "href",
  "src",
  "alt",
  "placeholder",
  "disabled",
  "checked",
  "selected",
  "readOnly",
  "required",
  "maxLength",
  "minLength",
  "min",
  "max",
  "step",
  "rows",
  "cols",
  "role",
  "style",
  "autofocus",
]);

/**
 * 极简 CSS 选择器编译 —— 仅支持本测试需要的形态：
 *   - 标签名        DIV / LI / BUTTON ...
 *   - [attr]         属性存在
 *   - [attr="v"]     属性等于 v（双引号）
 *   - [attr='v']     属性等于 v（单引号）
 *   - .cls           className 含 cls
 *   - 复合            按顺序全部 AND（如 '[role="tab"][aria-selected="true"]'）
 *   不支持后代 / 兄弟 / 伪类等高级形态。
 */
function compileSelector(
  sel: string,
): (el: FakeElement) => boolean {
  const parts = parseSelectorParts(sel);
  return function match(el: FakeElement): boolean {
    if (!el || !el.tagName) return false;
    for (const p of parts) {
      if (!matchPart(el, p)) return false;
    }
    return true;
  };
}

interface SelectorPart {
  tag?: string;
  attrName?: string;
  attrValue?: string;
  attrPresenceOnly?: boolean;
  className?: string;
}

function parseSelectorParts(sel: string): SelectorPart[] {
  const s = sel.trim();
  if (!s) return [];
  const parts: SelectorPart[] = [];
  // 切分 token：[xxx] / .cls / TAG
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "[") {
      const close = s.indexOf("]", i);
      if (close < 0) break;
      const inner = s.slice(i + 1, close);
      const eq = inner.indexOf("=");
      if (eq < 0) {
        parts.push({ attrName: inner.trim(), attrPresenceOnly: true });
      } else {
        const name = inner.slice(0, eq).trim();
        let val = inner.slice(eq + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        parts.push({ attrName: name, attrValue: val });
      }
      i = close + 1;
    } else if (c === ".") {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_-]/.test(s[j]!)) j++;
      parts.push({ className: s.slice(i + 1, j) });
      i = j;
    } else if (/[A-Za-z*]/.test(c!)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_-]/.test(s[j]!)) j++;
      parts.push({ tag: s.slice(i, j).toUpperCase() });
      i = j;
    } else {
      i++;
    }
  }
  return parts;
}

function matchPart(el: FakeElement, p: SelectorPart): boolean {
  if (p.tag && el.tagName !== p.tag) return false;
  if (p.className) {
    if (!(" " + (el.className || "") + " ").includes(" " + p.className + " "))
      return false;
  }
  if (p.attrName) {
    const name = p.attrName;
    if (p.attrPresenceOnly) {
      const present = el.attributes.some((a) => a.name === name);
      if (!present) return false;
    } else {
      const v = el.getAttribute(name);
      if (v !== p.attrValue) return false;
    }
  }
  return true;
}

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
  el.classList = {
    add(c: string) {
      classSet.add(c);
      el.className = Array.from(classSet).join(" ");
      const existing = el.attributes.find((a) => a.name === "class");
      if (existing) existing.value = el.className;
      else el.attributes.push({ name: "class", value: el.className });
    },
    remove(c: string) {
      classSet.delete(c);
      el.className = Array.from(classSet).join(" ");
      const existing = el.attributes.find((a) => a.name === "class");
      if (existing) existing.value = el.className;
    },
    contains(c: string) {
      return classSet.has(c);
    },
  };

  const syncProp = (name: string) => {
    let backing: unknown = undefined;
    Object.defineProperty(el, name, {
      get() {
        return backing;
      },
      set(v: unknown) {
        backing = v;
        const existing = el.attributes.find((a) => a.name === name);
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
          el.attributes.push({ name, value: str });
        }
      },
      configurable: true,
      enumerable: true,
    });
  };
  for (const p of NATIVE_PROPS) syncProp(p);
  (el as unknown as { style: string }).style = "";

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
      if ("kind" in c && c.kind === "text") {
        el.textContent = el.children
          .map((x) =>
            "kind" in x && x.kind === "text"
              ? (x as { textContent: string }).textContent
              : ("tagName" in x ? (x as FakeElement).textContent : ""),
          )
          .join("");
      } else if ("tagName" in c) {
        el.textContent = el.children
          .map((x) =>
            "kind" in x && x.kind === "text"
              ? (x as { textContent: string }).textContent
              : ("tagName" in x ? (x as FakeElement).textContent : ""),
          )
          .join("");
      }
    }
    return c;
  };
  // firstChild / lastChild 属性（agentListEl.firstChild 用）
  Object.defineProperty(el, "firstChild", {
    get() {
      return el.children.length > 0 ? el.children[0] : null;
    },
    configurable: true,
  });
  Object.defineProperty(el, "lastChild", {
    get() {
      return el.children.length > 0
        ? el.children[el.children.length - 1]
        : null;
    },
    configurable: true,
  });
  el.setAttribute = function (name: string, value: string) {
    const lower = name.toLowerCase();
    const existing = el.attributes.find(
      (a) => a.name.toLowerCase() === lower,
    );
    if (existing) existing.value = value;
    else el.attributes.push({ name, value });
    if (lower === "id") el.id = value;
    if (lower === "class") el.className = value;
    if (lower === "value") el.value = value;
    if (lower === "type") el.type = value;
    if (lower === "hidden") el.hidden = value === "" || value === "true";
    if (lower === "disabled") el.disabled = value === "" || value === "true";
    if (lower === "tabindex") el.tabIndex = parseInt(value, 10);
    if (lower === "style") el.style = value;
    if (name.startsWith("data-")) {
      el.dataset[name.slice("data-".length)] = value;
    }
  };
  el.getAttribute = function (name: string) {
    const lower = name.toLowerCase();
    return (
      el.attributes.find((a) => a.name.toLowerCase() === lower)?.value ?? null
    );
  };
  el.removeAttribute = function (name: string) {
    const lower = name.toLowerCase();
    const i = el.attributes.findIndex(
      (a) => a.name.toLowerCase() === lower,
    );
    if (i >= 0) el.attributes.splice(i, 1);
    if (lower === "id") el.id = "";
    if (lower === "class") el.className = "";
    if (lower === "hidden") el.hidden = false;
  };
  el.querySelector = function (sel: string) {
    const matcher = compileSelector(sel);
    for (const c of el.children) {
      if ("tagName" in c && matcher(c as FakeElement)) {
        return c as FakeElement;
      }
    }
    // 递归往下找
    for (const c of el.children) {
      if ("tagName" in c) {
        const hit = (c as FakeElement).querySelector(sel);
        if (hit) return hit;
      }
    }
    return null;
  };
  el.querySelectorAll = function (sel: string) {
    const matcher = compileSelector(sel);
    const out: FakeElement[] = [];
    function walk(node: FakeElement) {
      for (const c of node.children) {
        if ("tagName" in c) {
          const e = c as FakeElement;
          if (matcher(e)) out.push(e);
          walk(e);
        }
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
  let active: FakeElement | null = body;
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
      return active;
    },
    set activeElement(v: FakeElement | null) {
      active = v;
    },
    getElementById(id: string) {
      return findById(body, id);
    },
    querySelector(sel: string) {
      const matcher = compileSelector(sel);
      function walk(node: FakeNode): FakeElement | null {
        if ("tagName" in node) {
          const e = node as FakeElement;
          if (matcher(e)) return e;
          for (const c of e.children) {
            const hit = walk(c);
            if (hit) return hit;
          }
        }
        return null;
      }
      return walk(body);
    },
    querySelectorAll(sel: string) {
      const matcher = compileSelector(sel);
      const out: FakeElement[] = [];
      function walk(node: FakeNode) {
        if ("tagName" in node) {
          const e = node as FakeElement;
          if (matcher(e)) out.push(e);
          for (const c of e.children) walk(c);
        }
      }
      walk(body);
      return out;
    },
    addEventListener(
      type: string,
      cb: EventListener,
      opts?: AddEventListenerOptions | boolean,
    ) {
      documentListeners.push({ type, cb });
      void opts;
    },
    removeEventListener() {},
    dispatchEvent(evt: { type: string; detail?: unknown }) {
      // 简单派发：每个注册的 listener 都按 type 过滤调一次
      const seen: Array<{ type: string; cb: EventListener }> = [];
      for (const entry of documentListeners.slice()) {
        if (entry.type === evt.type) {
          seen.push(entry);
          try {
            entry.cb(evt as unknown as Event);
          } catch (_e) {
            /* ignore */
          }
        }
      }
      // 兜底给 tests：保留「最近一次派发的 detail」
      lastDispatchedRef.current = evt;
      return true;
    },
  };
  return { document: doc, body };
}

const documentListeners: Array<{ type: string; cb: EventListener }> = [];
const lastDispatchedRef: { current: { type: string; detail?: unknown } | null } = {
  current: null,
};

// ----------------------------------------------------------------------
// mock fetch 工具
// ----------------------------------------------------------------------

interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  calls: Array<{ url: string; init?: RequestInit }>;
  setNextResponses: (responses: Array<unknown>) => void;
  setNextError: (err: Error) => void;
}

function makeMockFetch(): MockFetch {
  const queue: unknown[] = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) {
      return Promise.resolve({
        status: 200,
        headers: {
          get(name: string) {
            if (name.toLowerCase() === "content-type") {
              return "application/json; charset=utf-8";
            }
            return null;
          },
        },
        text() {
          return Promise.resolve("");
        },
      });
    }
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    const resp = next as {
      status?: number;
      body?: unknown;
      raw?: string;
    };
    const status = resp.status ?? 200;
    let raw: string;
    if (resp.raw !== undefined) raw = resp.raw;
    else if (typeof resp.body === "string") raw = resp.body;
    else if (resp.body === undefined) raw = "";
    else raw = JSON.stringify(resp.body);
    return Promise.resolve({
      status,
      headers: {
        get(name: string) {
          if (name.toLowerCase() === "content-type") {
            return "application/json; charset=utf-8";
          }
          return null;
        },
      },
      text() {
        return Promise.resolve(raw);
      },
    });
  });
  return {
    fn,
    calls,
    setNextResponses(responses: unknown[]) {
      // 追加（不清空已有）—— 这样测试可分别预排 agents + detail 两批响应
      for (const r of responses) queue.push(r);
    },
    setNextError(err: Error) {
      // 追加一条错误响应
      queue.push(err);
    },
  };
}

// ----------------------------------------------------------------------
// 沙箱工厂
// ----------------------------------------------------------------------

interface LoadedSandbox {
  feature: any;
  api: any;
  state: any;
  container: FakeElement;
  mockFetch: MockFetch;
  body: FakeElement;
  /** 监听 document 自定义事件（type → cb[]） */
  docListeners: Array<{ type: string; cb: EventListener }>;
  /** 最近一次 document.dispatchEvent 的事件引用（current 字段实时更新） */
  lastDispatchedRef: { current: { type: string; detail?: unknown } | null };
  /** mock 组件实例 */
  componentsMocks: {
    tabs: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn> };
    modal: { open: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
    button: { el: FakeElement };
    toast: { show: ReturnType<typeof vi.fn> };
  };
}

function buildSandbox(opts: {
  initialCachedAgents?: unknown[];
  initialAgentsResponse?: unknown;
  initialDetailResponse?: unknown;
} = {}): LoadedSandbox {
  documentListeners.length = 0;
  lastDispatchedRef.current = null;

  const mockFetch = makeMockFetch();
  if (opts.initialAgentsResponse !== undefined) {
    mockFetch.setNextResponses([opts.initialAgentsResponse]);
  }
  if (opts.initialDetailResponse !== undefined) {
    mockFetch.setNextResponses([opts.initialDetailResponse]);
  }

  // 组件 mock：tabs / modal / button / toast
  // Tabs 的 select / open 等在这里用 vi.fn 占位
  const tabsOpen = vi.fn();
  const tabsClose = vi.fn();
  const tabsSelect = vi.fn();

  const modalOpen = vi.fn();
  const modalClose = vi.fn();
  const modalDestroy = vi.fn();

  const buttonEl = makeElement("button");
  const buttonDestroy = vi.fn();

  const toastShow = vi.fn();

  // 构造 sandbox
  const doc = makeDocument();
  const sandbox: Record<string, unknown> = {
    localStorage: (() => {
      const data = new Map<string, string>();
      return {
        getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
        setItem: (k: string, v: string) => {
          data.set(k, String(v));
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
        clear: () => data.clear(),
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        get length() {
          return data.size;
        },
      };
    })(),
    document: doc.document,
    body: doc.body,
    console: {
      warn: vi.fn(),
      error: vi.fn(),
      log: vi.fn(),
    },
    setTimeout: setTimeout as typeof setTimeout,
    clearTimeout: clearTimeout as typeof clearTimeout,
    fetch: mockFetch.fn,
    AbortController: AbortController as unknown,
    CustomEvent: class FakeCustomEvent<T = unknown> {
      type: string;
      detail: T;
      bubbles: boolean;
      cancelable: boolean;
      constructor(
        type: string,
        init: {
          detail?: T;
          bubbles?: boolean;
          cancelable?: boolean;
        } = {},
      ) {
        this.type = type;
        this.detail = init.detail as T;
        this.bubbles = !!init.bubbles;
        this.cancelable = !!init.cancelable;
      }
    },
    MyAgent: {},
    globalThis: undefined as unknown,
  };
  (sandbox as { globalThis: unknown }).globalThis = sandbox;

  createContext(sandbox);
  // 1) utils.js
  runInContext(UTILS_SOURCE, sandbox);
  // 2) api.js —— 真实源码（用我们的 mock fetch）
  runInContext(API_SOURCE, sandbox);
  // 3) i18n.js
  runInContext(I18N_SOURCE, sandbox);
  // 4) state.js
  runInContext(STATE_SOURCE, sandbox);

  // 5) 注入 mock components
  const MA = sandbox.MyAgent as any;
  MA.components = {
    Tabs: vi.fn(function (options: any) {
      // 真实 tabs 构造：递归 append panel 内容（用 sandbox.document）
      const root = (sandbox.document as any).createElement("div");
      root.className = "tabs";
      root.id = options.id || "tabs-mock";
      const tablist = (sandbox.document as any).createElement("div");
      tablist.setAttribute("role", "tablist");
      tablist.className = "tablist";
      (options.items || []).forEach((it: any, idx: number) => {
        const tabBtn = (sandbox.document as any).createElement("button");
        tabBtn.setAttribute("role", "tab");
        tabBtn.setAttribute("aria-selected", it.id === options.activeId ? "true" : "false");
        tabBtn.setAttribute("aria-controls", (options.id || "tabs-mock") + "-panel-" + it.id);
        tabBtn.id = (options.id || "tabs-mock") + "-tab-" + it.id;
        tabBtn.type = "button";
        tabBtn.textContent = String(it.label || it.id);
        tablist.appendChild(tabBtn);
        const panel = (sandbox.document as any).createElement("div");
        panel.setAttribute("role", "tabpanel");
        panel.id = (options.id || "tabs-mock") + "-panel-" + it.id;
        panel.setAttribute("aria-labelledby", (options.id || "tabs-mock") + "-tab-" + it.id);
        panel.hidden = it.id !== options.activeId;
        // content 节点直接挂到 panel（content 是 Node，由 agents.js 构造）
        if (it.content && it.content.nodeType) {
          panel.appendChild(it.content);
        }
        root.appendChild(tablist);
        root.appendChild(panel);
        void idx;
      });
      // activeId 切换
      function select(newId: string) {
        const allTabs = tablist.children;
        for (let i = 0; i < allTabs.length; i++) {
          const t = allTabs[i] as FakeElement;
          const tabId = t.id.replace(/-tab-.*$/, "").split("-").slice(-1)[0];
          void tabId;
        }
        // 简化：直接重置 aria-selected + hidden
        const panels = root.children;
        for (let i = 0; i < panels.length; i++) {
          const p = panels[i] as FakeElement;
          if (p.tagName === "DIV" && p.id && p.id.endsWith("-panel-" + newId)) {
            p.hidden = false;
          } else if (p.tagName === "DIV" && p.id && p.id.includes("-panel-")) {
            p.hidden = true;
          }
        }
        for (let i = 0; i < allTabs.length; i++) {
          const t = allTabs[i] as FakeElement;
          if (t.id.endsWith("-tab-" + newId)) t.setAttribute("aria-selected", "true");
          else t.setAttribute("aria-selected", "false");
        }
        if (typeof options.onChange === "function") {
          try {
            options.onChange(newId, "");
          } catch (_e) {
            /* ignore */
          }
        }
      }
      function destroy() {
        if (root.parentNode) root.parentNode.removeChild(root);
      }
      return {
        el: root,
        select,
        destroy,
        _open: tabsOpen,
        _close: tabsClose,
      };
    }),
    Modal: vi.fn(function (options: any) {
      const root = (sandbox.document as any).createElement("div");
      root.className = "modal-root" + (options.className ? " " + options.className : "");
      root.hidden = true;
      const overlay = (sandbox.document as any).createElement("div");
      overlay.className = "modal-overlay";
      root.appendChild(overlay);
      const dialog = (sandbox.document as any).createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      overlay.appendChild(dialog);
      if (options.title) {
        const titleEl = (sandbox.document as any).createElement("h2");
        titleEl.textContent = String(options.title);
        titleEl.id = (options.id || "modal-mock") + "-title";
        dialog.setAttribute("aria-labelledby", titleEl.id);
        dialog.appendChild(titleEl);
      }
      if (options.content) {
        if (options.content.nodeType) {
          dialog.appendChild(options.content);
        } else {
          const div = (sandbox.document as any).createElement("div");
          div.textContent = String(options.content);
          dialog.appendChild(div);
        }
      }
      function open() {
        (sandbox.document as { body: FakeElement }).body.appendChild(root);
        root.hidden = false;
        modalOpen();
      }
      function close() {
        const p = root.parentNode as FakeElement | null;
        if (p) p.removeChild(root);
        modalClose();
        if (typeof options.onClose === "function") {
          try {
            options.onClose();
          } catch (_e) {
            /* ignore */
          }
        }
      }
      function destroy() {
        const p = root.parentNode as FakeElement | null;
        if (p) p.removeChild(root);
        modalDestroy();
        if (typeof options.onClose === "function") {
          try {
            options.onClose();
          } catch (_e) {
            /* ignore */
          }
        }
      }
      return { el: root, open, close, destroy };
    }),
    Button: vi.fn(function (options: any) {
      const btn = makeElement("button");
      btn.type = options.type || "button";
      btn.className =
        "btn btn-" + (options.variant || "secondary") +
        (options.icon && !options.label ? " btn-icon-only" : "");
      if (options.label) btn.textContent = String(options.label);
      if (options.ariaLabel) btn.setAttribute("aria-label", String(options.ariaLabel));
      if (options.disabled) {
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
      }
      if (typeof options.onClick === "function") {
        btn.addEventListener("click", options.onClick);
      }
      function destroy() {
        const p = btn.parentNode as FakeElement | null;
        if (p) p.removeChild(btn);
        buttonDestroy();
      }
      return { el: btn, destroy };
    }),
    Toast: vi.fn(function () {
      function show(o: any) {
        toastShow(o);
      }
      function destroy() {}
      return { show, destroy };
    }),
  };

  // 6) agents.js
  runInContext(AGENTS_SOURCE, sandbox);

  // 7) 预填缓存（若指定）
  if (opts.initialCachedAgents) {
    const agentState = MA.state.getStore("agentState");
    if (agentState) {
      try {
        agentState.set({ agents: opts.initialCachedAgents, skills: [] });
      } catch (_e) {
        /* ignore */
      }
    }
  }

  const container = makeElement("div");
  container.id = "agents-list-region";
  (sandbox.document as { body: FakeElement }).body.appendChild(container);

  return {
    feature: (sandbox as { MyAgent: { agentsFeature: unknown } }).MyAgent
      .agentsFeature,
    api: MA.api,
    state: MA.state,
    container,
    mockFetch,
    body: doc.body,
    docListeners: documentListeners.slice(),
    lastDispatchedRef,
    componentsMocks: {
      tabs: { open: tabsOpen, close: tabsClose, select: tabsSelect },
      modal: { open: modalOpen, close: modalClose, destroy: modalDestroy },
      button: { el: buttonEl },
      toast: { show: toastShow },
    },
  };
}

// 异步刷新（fetchAgentsList 走 Promise.then）
async function flushPromises() {
  // 让 microtask 跑完
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

// ----------------------------------------------------------------------
// 测试用例
// ----------------------------------------------------------------------

describe("features/agents.js — 全局导出", () => {
  it("挂载 agentsFeature 到 window.MyAgent", () => {
    const sb = buildSandbox();
    expect(sb.feature).toBeDefined();
    expect(typeof sb.feature.installAgentsView).toBe("function");
  });

  it("暴露常量 LAUNCH_EVENT / SCOPE_LABELS / SOURCE_LABELS / EMPTY_TEXT", () => {
    const sb = buildSandbox();
    expect(sb.feature.LAUNCH_EVENT).toBe("my-agent:agent-launch");
    expect(sb.feature.SCOPE_LABELS.builtin.zh).toBe("内置");
    expect(sb.feature.SCOPE_LABELS.user.en).toBe("User");
    expect(sb.feature.SCOPE_LABELS.both.zh).toBe("内置+用户");
    expect(sb.feature.EMPTY_TEXT.zh).toBe("暂无 Agent");
  });

  it("暴露 _buildAgentRow / _buildDetailContent / _buildScopeBadge / _truncate / _pickLabel", () => {
    const sb = buildSandbox();
    expect(typeof sb.feature._buildAgentRow).toBe("function");
    expect(typeof sb.feature._buildDetailContent).toBe("function");
    expect(typeof sb.feature._buildScopeBadge).toBe("function");
    expect(typeof sb.feature._truncate).toBe("function");
    expect(typeof sb.feature._pickLabel).toBe("function");
  });
});

describe("installAgentsView — 基本渲染", () => {
  it("未传 container 抛错", () => {
    const sb = buildSandbox();
    expect(() => sb.feature.installAgentsView({} as never)).toThrow(
      /container/,
    );
  });

  it("返回 {el, refresh, destroy, uninstall} 且 el 已挂到 container", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installAgentsView({ container: sb.container });
    expect(inst).toBeDefined();
    expect(inst.el).toBeDefined();
    expect(typeof inst.refresh).toBe("function");
    expect(typeof inst.destroy).toBe("function");
    expect(typeof inst.uninstall).toBe("function");
    // el 已挂到 container
    expect(inst.el.parentNode).toBe(sb.container);
  });

  it("Tabs 包含 Agents + Skills 两项", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installAgentsView({ container: sb.container });
    // 找 role=tablist
    const root = inst.el as FakeElement;
    const tablist = root.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    const tabs = (tablist as FakeElement).querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    expect((tabs[0] as FakeElement).textContent).toBe("子 Agent");
    expect((tabs[1] as FakeElement).textContent).toBe("技能");
  });

  it("Agent 列表默认显示 '加载中…'（无缓存 + 未立即响应）", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installAgentsView({ container: sb.container });
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    expect((list as FakeElement).textContent).toContain("加载中");
  });
});

describe("Agent 列表行 — 数据展示", () => {
  it("fetch 完成后渲染每条 agent（含 name + description + scope 角标）", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "coder",
                name: "Coder",
                description: "代码实现专家",
                description_zh: "代码实现专家",
                description_en: "Code implementation specialist",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: ["read_file", "write_file"],
              },
              {
                id: "reviewer",
                name: "Reviewer",
                description: "代码审查",
                source: "user",
                scope: "user",
                enabled: true,
                tools: [],
              },
              {
                id: "both_one",
                name: "BothAgent",
                description: "用户覆盖内置",
                source: "user",
                scope: "both",
                enabled: true,
                tools: ["bash"],
              },
            ],
          },
        },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();

    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    const items = (list as FakeElement).querySelectorAll('[role="option"]');
    expect(items.length).toBe(3);

    const coder = items[0] as FakeElement;
    expect(coder.dataset.agentId).toBe("coder");
    expect(coder.textContent).toContain("Coder");
    expect(coder.textContent).toContain("代码实现专家");
    const coderBadge = coder.querySelector('[data-scope="builtin"]');
    expect(coderBadge).toBeTruthy();

    const bothBadge = items[2].querySelector('[data-scope="both"]');
    expect(bothBadge).toBeTruthy();
    expect((bothBadge as FakeElement).textContent).toContain("内置+用户");
  });

  it("空数组 → 显示 '暂无 Agent' 占位", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: { ok: true, data: { agents: [] } },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect((list as FakeElement).textContent).toContain("暂无 Agent");
  });

  it("先显示缓存再异步刷新（cache 优先）", async () => {
    const sb = buildSandbox({
      initialCachedAgents: [
        {
          id: "cached",
          name: "CachedAgent",
          description: "cached desc",
          source: "user",
          scope: "user",
          enabled: true,
          tools: ["a"],
        },
      ],
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "fresh",
                name: "FreshAgent",
                description: "fresh desc",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: [],
              },
            ],
          },
        },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    // 同步阶段：应见 cached（不显示加载中）
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect((list as FakeElement).textContent).toContain("CachedAgent");
    // 异步：刷新为 fresh
    await flushPromises();
    expect((list as FakeElement).textContent).toContain("FreshAgent");
    expect((list as FakeElement).textContent).not.toContain("CachedAgent");
  });
});

describe("详情 Modal", () => {
  it("点击 list 项 → 打开 modal（含 name + scope + systemPrompt + tools + 启动按钮）", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "coder",
                name: "Coder",
                description: "代码实现专家",
                description_zh: "代码实现专家",
                description_en: "Code implementation specialist",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: ["read_file", "write_file"],
              },
            ],
          },
        },
      },
      initialDetailResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agent: {
              id: "coder",
              name: "Coder",
              description: "代码实现专家",
              description_zh: "代码实现专家",
              description_en: "Code implementation specialist",
              source: "builtin",
              scope: "builtin",
              enabled: true,
              tools: ["read_file", "write_file"],
              systemPrompt: "You are a senior code implementation specialist.",
            },
          },
        },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    const row = (list as FakeElement).querySelectorAll('[role="option"]')[0] as FakeElement;
    expect(row).toBeTruthy();
    row.click();
    // modal.open() 被调
    expect(sb.componentsMocks.modal.open).toHaveBeenCalled();
    // 等 detail fetch 完成（modal 会被关闭重建）
    await flushPromises();
    // body 仍有 modal
    const modals = sb.body.querySelectorAll('[role="dialog"]');
    expect(modals.length).toBeGreaterThan(0);
    const dialog = modals[0] as FakeElement;
    expect(dialog.textContent).toContain("Coder");
    expect(dialog.textContent).toContain("You are a senior code implementation specialist");
    // 启动按钮存在
    const launchBtn = sb.body.querySelector(
      '[data-agent-launch="coder"], button.btn-primary',
    );
    expect(launchBtn).toBeTruthy();
  });
});

describe("「启动对话」按钮", () => {
  it("点击启动按钮 → 派发 CustomEvent('my-agent:agent-launch', {agentId, agentName})", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "coder",
                name: "Coder",
                description: "desc",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: [],
              },
            ],
          },
        },
      },
      initialDetailResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agent: {
              id: "coder",
              name: "Coder",
              description: "desc",
              source: "builtin",
              scope: "builtin",
              enabled: true,
              tools: [],
              systemPrompt: "x",
            },
          },
        },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    const row = (list as FakeElement).querySelectorAll('[role="option"]')[0] as FakeElement;
    row.click();
    await flushPromises();
    // 找 launch 按钮（先 modal.open 一次，detail 返回后会再 open 一次重建 modal）
    const launchBtn = sb.body.querySelector(
      '[data-agent-launch="coder"], button.btn-primary',
    ) as FakeElement | null;
    expect(launchBtn).toBeTruthy();
    if (launchBtn) {
      launchBtn.click();
    }
    expect(sb.lastDispatchedRef.current).toBeTruthy();
    expect(sb.lastDispatchedRef.current!.type).toBe("my-agent:agent-launch");
    const detail = sb.lastDispatchedRef.current!.detail as {
      agentId: string;
      agentName: string;
    };
    expect(detail.agentId).toBe("coder");
    expect(detail.agentName).toBe("Coder");
  });

  it("若传 options.onLaunch 也调用之（且 modal 自动关闭）", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "a1",
                name: "A1",
                description: "d",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: [],
              },
            ],
          },
        },
      },
      initialDetailResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agent: {
              id: "a1",
              name: "A1",
              description: "d",
              source: "builtin",
              scope: "builtin",
              enabled: true,
              tools: [],
              systemPrompt: "x",
            },
          },
        },
      },
    });
    const onLaunch = vi.fn();
    const inst = sb.feature.installAgentsView({
      container: sb.container,
      onLaunch,
    });
    await flushPromises();
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    const row = (list as FakeElement).querySelectorAll('[role="option"]')[0] as FakeElement;
    row.click();
    await flushPromises();
    const launchBtn = sb.body.querySelector(
      '[data-agent-launch="a1"], button.btn-primary',
    ) as FakeElement | null;
    expect(launchBtn).toBeTruthy();
    if (launchBtn) launchBtn.click();
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const arg = onLaunch.mock.calls[0]?.[0] as {
      agentId: string;
      agentName: string;
    };
    expect(arg.agentId).toBe("a1");
    expect(arg.agentName).toBe("A1");
    // CustomEvent 仍派发
    expect(sb.lastDispatchedRef.current!.type).toBe("my-agent:agent-launch");
    // modal 关闭（modalClose 被调）
    expect(sb.componentsMocks.modal.close).toHaveBeenCalled();
  });
});

describe("a11y 约定", () => {
  it("Tabs 节点含 role=tablist + 每个 tab role=tab + aria-selected", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installAgentsView({ container: sb.container });
    const root = inst.el as FakeElement;
    const tablist = root.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    const tabs = (tablist as FakeElement).querySelectorAll('[role="tab"]');
    expect(tabs.length).toBe(2);
    const first = tabs[0] as FakeElement;
    expect(first.getAttribute("aria-selected")).toBe("true");
    expect(first.getAttribute("aria-controls")).toBeTruthy();
  });

  it("Agent 列表含 role=listbox + 每行 role=option + tabindex", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "x",
                name: "X",
                description: "d",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: [],
              },
            ],
          },
        },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    expect(list!.getAttribute("aria-label")).toBeTruthy();
    const rows = (list as FakeElement).querySelectorAll('[role="option"]');
    expect(rows.length).toBe(1);
    const row = rows[0] as FakeElement;
    expect(row.getAttribute("tabindex")).toBe("0");
    expect(row.dataset.agentId).toBe("x");
  });
});

describe("卸载与生命周期", () => {
  it("destroy() 摘除根节点 + 关闭 modal", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agents: [
              {
                id: "a",
                name: "A",
                description: "d",
                source: "builtin",
                scope: "builtin",
                enabled: true,
                tools: [],
              },
            ],
          },
        },
      },
      initialDetailResponse: {
        status: 200,
        body: {
          ok: true,
          data: {
            agent: {
              id: "a",
              name: "A",
              description: "d",
              source: "builtin",
              scope: "builtin",
              enabled: true,
              tools: [],
              systemPrompt: "",
            },
          },
        },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const root = inst.el as FakeElement;
    expect(root.parentNode).toBe(sb.container);
    // 打开 modal（确保有 modal 可关）
    const list = root.querySelector('[role="listbox"]');
    const row = (list as FakeElement).querySelectorAll('[role="option"]')[0] as FakeElement;
    row.click();
    expect(sb.body.querySelectorAll('[role="dialog"]').length).toBeGreaterThan(0);
    // destroy
    inst.destroy();
    expect(root.parentNode).toBeNull();
    // modal 也被清理
    expect(sb.body.querySelectorAll('[role="dialog"]').length).toBe(0);
  });

  it("uninstall() 是 destroy 的别名", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installAgentsView({ container: sb.container });
    const root = inst.el as FakeElement;
    expect(inst.uninstall).toBe(inst.destroy);
    inst.uninstall();
    expect(root.parentNode).toBeNull();
  });

  it("refresh() 触发一次新 fetch", async () => {
    const sb = buildSandbox({
      initialAgentsResponse: {
        status: 200,
        body: { ok: true, data: { agents: [] } },
      },
    });
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const beforeCalls = sb.mockFetch.calls.length;
    // 排队下次响应
    sb.mockFetch.setNextResponses([
      {
        status: 200,
        body: { ok: true, data: { agents: [{ id: "fresh2", name: "Fresh2", description: "", source: "builtin", scope: "builtin", enabled: true, tools: [] }] } },
      },
    ]);
    inst.refresh();
    await flushPromises();
    expect(sb.mockFetch.calls.length).toBeGreaterThan(beforeCalls);
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect((list as FakeElement).textContent).toContain("Fresh2");
  });
});

describe("错误处理", () => {
  it("fetch 失败 → 错误占位 + Toast 错误", async () => {
    const sb = buildSandbox();
    sb.mockFetch.setNextError(new TypeError("Network down"));
    const inst = sb.feature.installAgentsView({ container: sb.container });
    await flushPromises();
    const root = inst.el as FakeElement;
    const list = root.querySelector('[role="listbox"]');
    expect((list as FakeElement).textContent).toContain("Network down");
    // toast show 至少调一次（error）
    expect(sb.componentsMocks.toast.show).toHaveBeenCalled();
    const lastCall = sb.componentsMocks.toast.show.mock.calls[
      sb.componentsMocks.toast.show.mock.calls.length - 1
    ]?.[0] as { message: string; status: string };
    expect(lastCall.status).toBe("error");
  });
});

describe("源码约定", () => {
  it("不引入任何依赖（无 import / require）", () => {
    expect(AGENTS_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(AGENTS_SOURCE).not.toMatch(/\brequire\s*\(/);
  });

  it("使用 IIFE 模式（spec § 4.4.6）", () => {
    expect(AGENTS_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(AGENTS_SOURCE.trimEnd().endsWith(");")).toBe(true);
  });

  it("挂载到 window.MyAgent.agentsFeature", () => {
    expect(AGENTS_SOURCE).toMatch(/global\.MyAgent\s*=\s*global\.MyAgent\s*\|\|\s*\{\}/);
    expect(AGENTS_SOURCE).toMatch(/global\.MyAgent\.agentsFeature\s*=/);
  });

  it("源码不包含 emoji（spec § 2.2）", () => {
    // 简单扫描：常见 emoji 范围
    expect(AGENTS_SOURCE).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(AGENTS_SOURCE).not.toMatch(/[\u{2600}-\u{27BF}]/u);
  });
});
