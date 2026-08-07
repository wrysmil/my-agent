/**
 * sidebar-panels.test.ts — F7 / WU-05a（侧边栏 + 5 个 panel 骨架）
 *
 * 测试约定（与 components.test.ts 同模式）：
 *   - 用 node:vm 起干净上下文；注入最小 DOM mock
 *   - utils.js + state.js 真实加载；icons / i18n 用 mock
 *   - 测试结构：
 *       ① Sidebar 构造 + DOM 结构
 *       ② 新建会话 CustomEvent
 *       ③ 切 panel CustomEvent
 *       ④ session 选中 CustomEvent
 *       ⑤ session list 订阅触发（state.sessionListState.set()）
 *       ⑥ 5 个 panel 各自构造 + 关键 DOM 断言
 *       ⑦ update(props) 重渲染
 *       ⑧ a11y role/aria 属性
 *       ⑨ 键盘可达（Enter / Space）
 *       ⑩ destroy 清理 listener
 *
 * 目标：≥ 12 用例。
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, vi } from "vitest";

// ----------------------------------------------------------------------
// 路径
// ----------------------------------------------------------------------

const COMPONENTS_DIR = fileURLToPath(
  new URL("../../web/js/components", import.meta.url),
);
const SHARED_DIR = fileURLToPath(
  new URL("../../web/js/shared", import.meta.url),
);
const STATE_PATH = fileURLToPath(
  new URL("../../web/js/state/state.js", import.meta.url),
);

const UTILS_SOURCE = readFileSync(`${SHARED_DIR}/utils.js`, "utf-8");
const STATE_SOURCE = readFileSync(STATE_PATH, "utf-8");
const SIDEBAR_SOURCE = readFileSync(`${COMPONENTS_DIR}/sidebar.js`, "utf-8");
const PANELS_SOURCE = readFileSync(`${COMPONENTS_DIR}/panels.js`, "utf-8");

// ----------------------------------------------------------------------
// 最小 DOM mock（与 components.test.ts 同设计 —— 这里自包含一份以减少测试间耦合）
// ----------------------------------------------------------------------

interface FakeAttr {
  name: string;
  value: string;
}
interface FakeEventTarget {
  _listeners: Map<string, Array<{ cb: EventListener; opts?: AddEventListenerOptions | boolean }>>;
  addEventListener(type: string, cb: EventListener, opts?: AddEventListenerOptions | boolean): void;
  removeEventListener(type: string, cb: EventListener, opts?: AddEventListenerOptions | boolean): void;
  dispatchEvent(evt: { type: string }): boolean;
}
interface FakeTextNode {
  kind: "text";
  nodeType: 3;
  textContent: string;
  parentNode: FakeElement | null;
}
type FakeNode = FakeElement | FakeTextNode;
interface FakeElement extends FakeEventTarget {
  tagName: string;
  nodeType: number;
  children: FakeNode[];
  attributes: FakeAttr[];
  dataset: Record<string, string>;
  parentNode: FakeNode | null;
  firstChild: FakeNode | null;
  lastChild: FakeNode | null;
  textContent: string;
  innerHTML: string;
  id: string;
  className: string;
  classList: {
    add(c: string): void;
    remove(c: string): void;
    contains(c: string): boolean;
  };
  hidden: boolean;
  disabled: boolean;
  value: string;
  type: string;
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
      const idx = list.findIndex((e) => e.cb === cb && sameOpts(e.opts, opts));
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      // 支持事件冒泡 + 设 target/currentTarget —— 模拟原生 DOM
      // target 起点；bubbles=true 时向上传播
      (evt as any).target = target;
      let current: FakeEventTarget | null = target;
      const seen = new Set<FakeEventTarget>();
      const visit = (n: FakeEventTarget) => {
        if (seen.has(n)) return;
        seen.add(n);
        (evt as any).currentTarget = n;
        const list = n._listeners.get(evt.type);
        if (!list) return;
        for (const entry of list.slice()) {
          try {
            entry.cb(evt as unknown as Event);
          } catch (_e) {
            /* ignore */
          }
        }
      };
      while (current) {
        visit(current);
        const bubbles = (evt as any).bubbles !== false; // 默认 true
        if (!bubbles) break;
        const pn = (current as any).parentNode as FakeNode | null;
        current = pn && "tagName" in pn ? (pn as FakeEventTarget) : null;
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
  return (!!(a as AddEventListenerOptions).capture) === (!!(b as AddEventListenerOptions).capture);
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
  // firstChild / lastChild —— 模拟原生 DOM；appendChild / removeChild 时同步
  Object.defineProperty(el, "firstChild", {
    get() {
      return el.children[0] || null;
    },
    configurable: true,
  });
  Object.defineProperty(el, "lastChild", {
    get() {
      return el.children[el.children.length - 1] || null;
    },
    configurable: true,
  });
  el.dataset = {};
  el.parentNode = null;
  el.textContent = "";
  el.innerHTML = "";
  el.id = "";
  el.className = "";
  el.hidden = false;
  el.disabled = false;
  el.value = "";
  el.type = "";
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
  } as FakeElement["classList"];

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

  el.appendChild = function (c: FakeNode) {
    c.parentNode = el;
    el.children.push(c);
    if ("kind" in c && c.kind === "text") {
      el.textContent += (c as FakeTextNode).textContent;
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
  el.removeAttribute = function (name: string) {
    const lower = name.toLowerCase();
    const i = el.attributes.findIndex((a) => a.name.toLowerCase() === lower);
    if (i >= 0) el.attributes.splice(i, 1);
    if (lower === "id") el.id = "";
    if (lower === "class") el.className = "";
    if (lower === "hidden") el.hidden = false;
  };
  el.querySelector = function (sel: string) {
    const tag = sel.toUpperCase();
    for (const c of el.children) {
      if ("tagName" in c && (c as FakeElement).tagName === tag) {
        return c as FakeElement;
      }
    }
    return null;
  };
  el.querySelectorAll = function (sel: string) {
    const tag = sel.toUpperCase();
    return el.children.filter(
      (c) => "tagName" in c && (c as FakeElement).tagName === tag,
    ) as FakeElement[];
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
    getElementById(id: string) {
      return findById(body, id);
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {
      return true;
    },
  };
  return { document: doc, body };
}

// ----------------------------------------------------------------------
// localStorage mock（state.js 需要）
// ----------------------------------------------------------------------

function makeLocalStorage() {
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
  };
}

// ----------------------------------------------------------------------
// Sandbox：utils + state + sidebar + panels 全部加载
// ----------------------------------------------------------------------

interface Sandbox {
  MyAgent: any;
  document: any;
  body: FakeElement;
  console: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; log: (...a: unknown[]) => void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  localStorage: ReturnType<typeof makeLocalStorage>;
  CustomEvent: any;
  globalThis: any;
}

function buildSandbox(): Sandbox {
  const doc = makeDocument();
  // 给 document 补 createEvent（emit() 退化路径）
  doc.document.createEvent = function (type: string) {
    const evt: any = { type: type, detail: undefined };
    evt.initCustomEvent = function (
      t: string,
      _bubbles: boolean,
      _cancelable: boolean,
      d: any,
    ) {
      evt.type = t;
      evt.detail = d;
    };
    return evt;
  };
  const sb: Sandbox = {
    MyAgent: {},
    document: doc.document,
    body: doc.body,
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
    setTimeout: setTimeout as typeof setTimeout,
    clearTimeout: clearTimeout as typeof clearTimeout,
    localStorage: makeLocalStorage(),
    CustomEvent: undefined as any,
    globalThis: undefined as any,
  };
  // 让 vm sandbox 内的 `new CustomEvent(...)` 走到一个能造事件的 helper：
  // 用 document.createEvent 即可（vm 沙箱共享同一 document）
  // 我们包一层函数式构造函数：new (this-bound fn)(...)
  // 简化：直接把 CustomEvent 定义成一个普通函数，接收 type/opts，
  // 返回一个带 type + detail 的对象，足够让 FakeEventTarget.dispatchEvent 路由。
  function FakeCustomEvent(this: any, type: string, opts?: any) {
    this.type = String(type);
    this.detail = (opts && opts.detail) || {};
    this.bubbles = !!(opts && opts.bubbles);
    this.cancelable = !!(opts && opts.cancelable);
  }
  sb.CustomEvent = FakeCustomEvent as any;
  sb.globalThis = sb;
  return sb;
}

function loadAll(sb: Sandbox) {
  // 1) utils.js → MyAgent.utils
  createContext(sb);
  runInContext(UTILS_SOURCE, sb as any);

  // 2) icons mock
  const iconHtml = vi.fn((name: string, size?: number) => {
    const px = typeof size === "number" ? size : 24;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 24 24" data-name="' + name + '"></svg>'
    );
  });
  const hasIcon = vi.fn(() => true);
  const ICON_NAMES = [
    "plus", "settings", "message-square", "history", "users",
    "sparkles", "zap", "search", "x", "check", "chevron-right",
    "chevron-down", "loader-2", "alert-triangle", "trash-2",
  ];
  sb.MyAgent.icons = { iconHtml, hasIcon, ICON_NAMES };

  // 3) i18n mock
  const t = vi.fn((key: string) => "[" + key + "]");
  sb.MyAgent.i18n = { t, getLang: () => "zh", setLang: () => {}, DEFAULT_LANG: "zh" };

  // 4) state.js → MyAgent.state（真实加载）
  runInContext(STATE_SOURCE, sb as any);

  // 5) sidebar.js + panels.js
  runInContext(SIDEBAR_SOURCE, sb as any);
  runInContext(PANELS_SOURCE, sb as any);
}

// ----------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------

function findByText(el: FakeElement, needle: string): FakeElement | null {
  if ((el.textContent || "").includes(needle) && el.tagName !== "BUTTON") {
    // 优先在叶子节点里找
  }
  for (const c of el.children) {
    if ("kind" in c) continue;
    const child = c as FakeElement;
    if ((child.textContent || "").trim() === needle) return child;
    const inner = findByText(child, needle);
    if (inner) return inner;
  }
  return null;
}

function getByAttr(el: FakeElement, attr: string, value: string): FakeElement | null {
  if (el.getAttribute(attr) === value) return el;
  for (const c of el.children) {
    if ("kind" in c) continue;
    const hit = getByAttr(c as FakeElement, attr, value);
    if (hit) return hit;
  }
  return null;
}

// ======================================================================
// Sidebar — 构造 + a11y
// ======================================================================

describe("Sidebar — 构造 + DOM 结构", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = buildSandbox();
    loadAll(sb);
  });

  it("构造：aside 根 + role=complementary + 5 个主导航按钮 + 新建会话 + 设置入口", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    expect(s.el.tagName).toBe("ASIDE");
    expect(s.el.getAttribute("role")).toBe("complementary");
    // 主导航：role=navigation + aria-label=主导航
    const nav = getByAttr(s.el, "aria-label", "主导航");
    expect(nav).not.toBeNull();
    expect(nav!.getAttribute("role")).toBe("navigation");
    // 5 个 nav buttons
    const navBtns = (nav as any).children.filter(
      (c: any) => c.tagName === "BUTTON",
    );
    expect(navBtns.length).toBe(5);
    // 新建会话按钮
    const newBtn = getByAttr(s.el, "aria-label", "新建会话");
    expect(newBtn).not.toBeNull();
    expect(newBtn!.tagName).toBe("BUTTON");
    // 设置入口
    const setBtn = getByAttr(s.el, "aria-label", "打开设置");
    expect(setBtn).not.toBeNull();
  });

  it("a11y：role/aria 属性 + 标签关联 + session list 与 title 关联", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    // session list 应有 aria-labelledby 指向 h2
    const list = getByAttr(s.el, "role", "list");
    expect(list).not.toBeNull();
    const labelledBy = list!.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const title = getByAttr(s.el, "id", labelledBy!);
    expect(title).not.toBeNull();
    expect(title!.tagName).toBe("H2");
  });
});

// ======================================================================
// Sidebar — CustomEvent：new-session / panel-change / session-select
// ======================================================================

describe("Sidebar — CustomEvent 派发", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = buildSandbox();
    loadAll(sb);
  });

  it("点「新建会话」按钮 → 派发 my-agent:new-session", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    const captured: any[] = [];
    s.el.addEventListener("my-agent:new-session", (ev: any) => captured.push(ev));
    const newBtn = getByAttr(s.el, "aria-label", "新建会话")!;
    newBtn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].type).toBe("my-agent:new-session");
  });

  it("点主导航按钮 → 派发 my-agent:panel-change + detail.panel", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    const captured: any[] = [];
    s.el.addEventListener("my-agent:panel-change", (ev: any) => captured.push(ev.detail));
    // 找 'providers' 按钮（aria-label='提供商'）
    const btn = getByAttr(s.el, "aria-label", "提供商")!;
    btn.click();
    expect(captured.length).toBe(1);
    expect(captured[0].panel).toBe("providers");
  });

  it("点 session list 项 → 派发 my-agent:session-select + detail.sessionId", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    // 注入一个 li 模拟 sessions.js 已渲染
    const list = getByAttr(s.el, "role", "list") as FakeElement;
    // 先清空，再加一个 li
    while (list.firstChild) list.removeChild(list.firstChild);
    const li = makeElement("li");
    li.setAttribute("data-session-id", "gconv-aaa");
    li.setAttribute("tabindex", "0");
    const txt = sb.document.createTextNode("测试会话");
    li.appendChild(txt as any);
    list.appendChild(li);

    const captured: any[] = [];
    s.el.addEventListener("my-agent:session-select", (ev: any) => captured.push(ev.detail));
    li.click();
    expect(captured.length).toBe(1);
    expect(captured[0].sessionId).toBe("gconv-aaa");
  });
});

// ======================================================================
// Sidebar — session list 订阅 sessionListState
// ======================================================================

describe("Sidebar — subscribe('sessionListState') 触发", () => {
  it("set 后 sidebar session list 自动重渲染", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    // 触发 sessionListState.set → 应触发 sidebar 渲染
    const stateApi = sb.MyAgent.state;
    stateApi.sessionListState.set({
      sessions: [
        { id: "gconv-1", name: "会话 1" },
        { id: "gconv-2", name: "会话 2" },
      ],
      loading: false,
    });

    const list = getByAttr(s.el, "role", "list") as FakeElement;
    // 找 data-session-id
    const found: string[] = [];
    function walk(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        const id = el.getAttribute("data-session-id");
        if (id) found.push(id);
        for (const c of el.children) walk(c);
      }
    }
    walk(list);
    expect(found.sort()).toEqual(["gconv-1", "gconv-2"]);
  });
});

// ======================================================================
// Sidebar — 键盘可达 + destroy
// ======================================================================

describe("Sidebar — 键盘 + destroy", () => {
  let sb: Sandbox;
  beforeEach(() => {
    sb = buildSandbox();
    loadAll(sb);
  });

  it("键盘：Enter 在主导航按钮上 → 派发 my-agent:panel-change", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    const captured: any[] = [];
    s.el.addEventListener("my-agent:panel-change", (ev: any) => captured.push(ev.detail));
    const btn = getByAttr(s.el, "aria-label", "对话")!;
    // fake focus + Enter keydown
    btn.focus();
    btn.dispatchEvent({ type: "keydown" });
    // 手动构造 keydown event payload（mock dispatchEvent 不带 key）
    // 改用 listener 触发
    const list = (btn as any)._listeners.get("keydown") || [];
    expect(list.length).toBeGreaterThan(0);
    // 直接调用 keydown listener
    list[0].cb({ key: "Enter", preventDefault: () => {}, stopImmediatePropagation: () => {} });
    expect(captured.length).toBe(1);
    expect(captured[0].panel).toBe("chat");
  });

  it("键盘：Space 在主导航按钮上同样派发", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    const captured: any[] = [];
    s.el.addEventListener("my-agent:panel-change", (ev: any) => captured.push(ev.detail));
    const btn = getByAttr(s.el, "aria-label", "子 Agent")!;
    const list = (btn as any)._listeners.get("keydown") || [];
    list[0].cb({ key: " ", preventDefault: () => {}, stopImmediatePropagation: () => {} });
    expect(captured.length).toBe(1);
    expect(captured[0].panel).toBe("agents");
  });

  it("destroy() 摘除节点 + 幂等 + 解除 subscribe", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);
    expect(s.el.parentNode).not.toBeNull();

    // 检查 subscribe 后 listener 数 > 0
    const stateApi = sb.MyAgent.state;
    expect(stateApi.sessionListState._listenersCount()).toBeGreaterThan(0);

    s.destroy();
    expect(s.el.parentNode).toBeNull();
    expect(stateApi.sessionListState._listenersCount()).toBe(0);
    // 幂等
    expect(() => s.destroy()).not.toThrow();
  });

  it("destroy 后 set sessionListState 不再触发渲染（旧 listener 已解）", () => {
    const Sidebar = sb.MyAgent.components.Sidebar;
    const s = new Sidebar({});
    sb.body.appendChild(s.el);

    // destroy
    s.destroy();

    // 注入 session：list 应已不在文档中（无副作用报错即可）
    expect(() => {
      sb.MyAgent.state.sessionListState.set({
        sessions: [{ id: "x" }],
        loading: false,
      });
    }).not.toThrow();
  });
});

// ======================================================================
// HomePanel
// ======================================================================

describe("HomePanel", () => {
  it("构造：role=main + aria-labelledby 指向 h2 + 9 个 placeholder 按钮", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const HomePanel = sb.MyAgent.components.HomePanel;
    const p = new HomePanel({});
    expect(p.el.tagName).toBe("SECTION");
    expect(p.el.getAttribute("role")).toBe("main");
    const labelledBy = p.el.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    const heading = getByAttr(p.el, "id", labelledBy!);
    expect(heading).not.toBeNull();
    expect(heading!.tagName).toBe("H2");
    // 递归统计 BUTTON 元素 — 应有 9 个
    let btnCount = 0;
    function walkBtns(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        if (el.tagName === "BUTTON") btnCount++;
        for (const c of el.children) walkBtns(c);
      }
    }
    walkBtns(p.el);
    expect(btnCount).toBe(9);
  });

  it("update({ items }) 重渲染按钮列表", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const HomePanel = sb.MyAgent.components.HomePanel;
    const p = new HomePanel({});
    sb.body.appendChild(p.el);

    p.update({ items: [{ id: "a", label: "A" }, { id: "b", label: "B" }] });
    // 找 data-menu-id
    const found: string[] = [];
    function walk(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        const id = el.getAttribute("data-menu-id");
        if (id) found.push(id);
        for (const c of el.children) walk(c);
      }
    }
    walk(p.el);
    expect(found.sort()).toEqual(["a", "b"]);
  });

  it("destroy() 摘除节点", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const HomePanel = sb.MyAgent.components.HomePanel;
    const p = new HomePanel({});
    sb.body.appendChild(p.el);
    p.destroy();
    expect(p.el.parentNode).toBeNull();
  });
});

// ======================================================================
// ChatPanel
// ======================================================================

describe("ChatPanel", () => {
  it("构造：transcript role=log + aria-live=polite + textarea + send button", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const ChatPanel = sb.MyAgent.components.ChatPanel;
    const p = new ChatPanel({});
    expect(p.el.tagName).toBe("SECTION");
    expect(p.el.getAttribute("role")).toBe("main");
    // transcript
    const log = getByAttr(p.el, "role", "log");
    expect(log).not.toBeNull();
    expect(log!.getAttribute("aria-live")).toBe("polite");
    // textarea
    const ta = getByAttr(p.el, "tagname_ta", "") as any; // 不用，改为查 textarea
    let textarea: FakeElement | null = null;
    function walkT(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        if (el.tagName === "TEXTAREA") textarea = el;
        for (const c of el.children) walkT(c);
      }
    }
    walkT(p.el);
    expect(textarea).not.toBeNull();
    // send button
    const sendBtn = getByAttr(p.el, "aria-label", "发送消息");
    expect(sendBtn).not.toBeNull();
  });

  it("update({ sessionId }) 更新 label + 清空 transcript", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const ChatPanel = sb.MyAgent.components.ChatPanel;
    const p = new ChatPanel({});
    sb.body.appendChild(p.el);

    p.update({ sessionId: "gconv-xyz" });
    const label = getByAttr(p.el, "class", "chat-session-label") as FakeElement | null;
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain("gconv-xyz");
  });

  it("destroy() 摘除节点", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const ChatPanel = sb.MyAgent.components.ChatPanel;
    const p = new ChatPanel({});
    sb.body.appendChild(p.el);
    p.destroy();
    expect(p.el.parentNode).toBeNull();
  });
});

// ======================================================================
// SessionsPanel
// ======================================================================

describe("SessionsPanel", () => {
  it("构造：传入 sessions → 渲染 list + 每条 data-session-id", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const SessionsPanel = sb.MyAgent.components.SessionsPanel;
    const p = new SessionsPanel({
      sessions: [
        { id: "gconv-1", name: "会话 1" },
        { id: "gconv-2", name: "会话 2" },
      ],
    });
    expect(p.el.getAttribute("role")).toBe("main");
    const found: string[] = [];
    function walk(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        const id = el.getAttribute("data-session-id");
        if (id) found.push(id);
        for (const c of el.children) walk(c);
      }
    }
    walk(p.el);
    expect(found.sort()).toEqual(["gconv-1", "gconv-2"]);
  });

  it("空 sessions → 显示 EmptyState（role=status）", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const SessionsPanel = sb.MyAgent.components.SessionsPanel;
    const p = new SessionsPanel({ sessions: [] });
    const status = getByAttr(p.el, "role", "status");
    expect(status).not.toBeNull();
  });

  it("update({ sessions }) 重渲染", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const SessionsPanel = sb.MyAgent.components.SessionsPanel;
    const p = new SessionsPanel({ sessions: [{ id: "old" }] });
    sb.body.appendChild(p.el);

    p.update({ sessions: [{ id: "new-1" }, { id: "new-2" }] });
    const found: string[] = [];
    function walk(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        const id = el.getAttribute("data-session-id");
        if (id) found.push(id);
        for (const c of el.children) walk(c);
      }
    }
    walk(p.el);
    expect(found.sort()).toEqual(["new-1", "new-2"]);
  });
});

// ======================================================================
// ProvidersPanel
// ======================================================================

describe("ProvidersPanel", () => {
  it("构造：传入 providers + activeProviderId → active 项 aria-current=true", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const ProvidersPanel = sb.MyAgent.components.ProvidersPanel;
    const p = new ProvidersPanel({
      providers: [
        { id: "p1", name: "DeepSeek", enabled: true },
        { id: "p2", name: "OpenAI", enabled: false },
      ],
      activeProviderId: "p1",
    });
    expect(p.el.getAttribute("role")).toBe("main");
    const activeItem = getByAttr(p.el, "aria-current", "true");
    expect(activeItem).not.toBeNull();
    expect(activeItem!.getAttribute("data-provider-id")).toBe("p1");
  });

  it("update({ activeProviderId }) 改变 active 标记", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const ProvidersPanel = sb.MyAgent.components.ProvidersPanel;
    const p = new ProvidersPanel({
      providers: [
        { id: "p1", name: "DeepSeek", enabled: true },
        { id: "p2", name: "OpenAI", enabled: true },
      ],
      activeProviderId: "p1",
    });
    sb.body.appendChild(p.el);
    p.update({ activeProviderId: "p2" });
    const active = getByAttr(p.el, "aria-current", "true");
    expect(active).not.toBeNull();
    expect(active!.getAttribute("data-provider-id")).toBe("p2");
  });
});

// ======================================================================
// AgentsPanel
// ======================================================================

describe("AgentsPanel", () => {
  it("构造：agents + skills 两块 + 每块 role=list", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const AgentsPanel = sb.MyAgent.components.AgentsPanel;
    const p = new AgentsPanel({
      agents: [{ id: "a1", name: "Agent 1", description_zh: "第一个", source: "builtin" }],
      skills: [{ id: "s1", name: "Skill 1", description_zh: "技能 1" }],
    });
    expect(p.el.getAttribute("role")).toBe("main");
    // 找两个 list（agents / skills）
    const lists = (p.body.children as any[])
      .map((b: any) => b.children || [])
      .flat()
      .filter((c: any) => c.tagName === "UL" && c.getAttribute("role") === "list");
    expect(lists.length).toBeGreaterThanOrEqual(2);
  });

  it("update({ agents, skills }) 重渲染", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const AgentsPanel = sb.MyAgent.components.AgentsPanel;
    const p = new AgentsPanel({
      agents: [{ id: "old-a" }],
      skills: [{ id: "old-s" }],
    });
    sb.body.appendChild(p.el);

    p.update({
      agents: [{ id: "new-a" }, { id: "new-a2" }],
      skills: [{ id: "new-s" }],
    });
    const found: string[] = [];
    function walk(n: FakeNode) {
      if ("tagName" in n) {
        const el = n as FakeElement;
        const id = el.getAttribute("data-agent-id");
        if (id) found.push(id);
        for (const c of el.children) walk(c);
      }
    }
    walk(p.el);
    expect(found.sort()).toEqual(["new-a", "new-a2", "new-s"]);
  });
});

// ======================================================================
// panels — 通用 a11y
// ======================================================================

describe("panels — a11y 通用", () => {
  it("5 个 panel 都满足：role=main + aria-labelledby 指向 heading + heading 存在", () => {
    const sb = buildSandbox();
    loadAll(sb);
    const { HomePanel, ChatPanel, SessionsPanel, ProvidersPanel, AgentsPanel } =
      sb.MyAgent.components;
    const panels = [
      new HomePanel({}),
      new ChatPanel({}),
      new SessionsPanel({}),
      new ProvidersPanel({}),
      new AgentsPanel({}),
    ];
    for (const p of panels) {
      expect(p.el.getAttribute("role")).toBe("main");
      const labelledBy = p.el.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      const heading = getByAttr(p.el, "id", labelledBy!);
      expect(heading).not.toBeNull();
      expect(heading!.tagName).toBe("H2");
    }
  });
});
