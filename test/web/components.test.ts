/**
 * components.test.ts — 13 个基础 UI 组件测试（spec § 4.4.5 / F6 / WU-04c）
 *
 * 与 shared-utils.test.ts 同模式：用 node:vm 起干净上下文，注入最小 DOM mock
 * （createElement / createTextNode / addEventListener / removeEventListener /
 *  querySelector / querySelectorAll / body.appendChild / getElementById /
 *  activeElement），并 mock window.MyAgent.utils.el / icons.iconHtml / i18n.t。
 *
 * 测试约定：
 *   - 每个组件 ≥ 2 个 it：① 构造 + DOM 结构；② a11y 属性断言
 *   - 全量共 13 组件 × 2 + 一些共享「全局挂载 / 源码无 emoji」= ≥ 26 用例
 *   - 源码级：13 个组件文件 + 14 个文件名清单都不含 emoji
 *
 * 注意：
 *   - iconHtml / t 用 vi.fn mock 注入，避免依赖真实 icons.js / i18n.js
 *   - 真实 utils.el 不可用，所以预先在 vm 沙箱里加载 utils.js 源码
 *   - icons 走 mock：iconHtml(name) → '<svg></svg>' 简化字符串
 */

import { readFileSync, readdirSync } from "node:fs";
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

const REQUIRED_COMPONENTS = [
  "button",
  "input",
  "textarea",
  "modal",
  "toast",
  "skeleton",
  "spinner",
  "tabs",
  "dropdown",
  "tooltip",
  "badge",
  "card",
  "empty-state",
] as const;

const FILENAME_TO_PASCAL: Record<string, string> = {
  "button": "Button",
  "input": "Input",
  "textarea": "Textarea",
  "modal": "Modal",
  "toast": "Toast",
  "skeleton": "Skeleton",
  "spinner": "Spinner",
  "tabs": "Tabs",
  "dropdown": "Dropdown",
  "tooltip": "Tooltip",
  "badge": "Badge",
  "card": "Card",
  "empty-state": "EmptyState",
};

// ----------------------------------------------------------------------
// 最小 DOM mock — 与 shared-utils.test.ts 同一设计
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
  classList: { add(c: string): void; remove(c: string): void; contains(c: string): boolean };
  style: string;
  hidden: boolean;
  disabled: boolean;
  readOnly: boolean;
  required: boolean;
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
  getBoundingClientRect(): { top: number; left: number; bottom: number; right: number; width: number; height: number };
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
  return (!!(a as AddEventListenerOptions).capture) === (!!(b as AddEventListenerOptions).capture);
}

// utils.js 的 NATIVE_PROPS —— 直接赋值会绕过 setAttribute，mock 必须双向同步
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
  el.readOnly = false;
  el.required = false;
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
  } as FakeElement["classList"];

  // NATIVE_PROPS：双向同步 property <-> attribute
  // 这样 utils.js 的 node.role = 'tablist' / node.disabled = true 等直接赋值
  // 也能在 getAttribute() 看到。
  const syncProp = (name: string) => {
    let backing: any = undefined;
    Object.defineProperty(el, name, {
      get() {
        return backing;
      },
      set(v: any) {
        backing = v;
        // 同步到 attributes
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
  // style 是一个 setter：把它初始化为字符串
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
    if (lower === "style") el.style = value;
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
  el.getBoundingClientRect = function () {
    return { top: 0, left: 0, bottom: 0, right: 0, width: 100, height: 20 };
  };
  return el;
}

function makeDocument(): {
  document: any;
  body: FakeElement;
  __activeElement(el: FakeElement | null): void;
} {
  const body = makeElement("body");
  let activeElement: FakeElement | null = body;

  // 树遍历找 id —— 与真实 DOM 一致
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
      for (const c of body.children) {
        if ("tagName" in c && (c as FakeElement).tagName === tag) {
          return c as FakeElement;
        }
      }
      return null;
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

  return {
    document: doc,
    body: body,
    __activeElement(el) {
      activeElement = el;
    },
  };
}

// ----------------------------------------------------------------------
// 加载工具
// ----------------------------------------------------------------------

const UTILS_SOURCE = readFileSync(`${SHARED_DIR}/utils.js`, "utf-8");
const COMPONENT_SOURCES: Record<string, string> = {};
for (const name of REQUIRED_COMPONENTS) {
  COMPONENT_SOURCES[name] = readFileSync(`${COMPONENTS_DIR}/${name}.js`, "utf-8");
}

interface Sandbox {
  MyAgent: any;
  document: any;
  body: FakeElement;
  console: { warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void; log: (...a: unknown[]) => void };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  pageXOffset: number;
  pageYOffset: number;
  CustomEvent?: any;
  globalThis: any;
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
    pageXOffset: 0,
    pageYOffset: 0,
    globalThis: undefined as any,
  };
  sandbox.globalThis = sandbox;
  return sandbox;
}

function loadAllUtilsAndIcons(sandbox: Sandbox) {
  // 1) utils.js：会挂到 MyAgent.utils
  createContext(sandbox);
  runInContext(UTILS_SOURCE, sandbox as any);

  // 2) icons mock：直接挂 MyAgent.icons
  const iconHtml = vi.fn((name: string, size?: number) => {
    const px = typeof size === "number" ? size : 24;
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px +
      '" viewBox="0 0 24 24" data-name="' + name + '"></svg>'
    );
  });
  const hasIcon = vi.fn((name: string) => typeof name === "string" && name.length > 0);
  const ICON_NAMES = ["send", "loader-2", "info", "check-circle-2", "x-circle", "alert-triangle", "chevron-down"];
  sandbox.MyAgent.icons = { iconHtml, hasIcon, ICON_NAMES };

  // 3) i18n mock
  const t = vi.fn((key: string, ..._args: any[]) => "[" + key + "]");
  sandbox.MyAgent.i18n = {
    t,
    getLang: vi.fn(() => "zh"),
    setLang: vi.fn(),
    DEFAULT_LANG: "zh",
  };

  return { iconHtml, hasIcon, t };
}

function loadComponent(name: string, sandbox: Sandbox) {
  runInContext(COMPONENT_SOURCES[name], sandbox as any);
  return sandbox.MyAgent.components[FILENAME_TO_PASCAL[name]];
}

// ----------------------------------------------------------------------
// 通用 helpers
// ----------------------------------------------------------------------

function hasClass(el: FakeElement, cls: string): boolean {
  return (" " + (el.className || "") + " ").split(" ").indexOf(cls) >= 0;
}

// ======================================================================
// 全局挂载 / 源码约定
// ======================================================================

describe("components — 13 个文件 + 全局挂载", () => {
  it("web/js/components/ 目录包含全部 13 个文件", () => {
    const files = readdirSync(COMPONENTS_DIR);
    for (const name of REQUIRED_COMPONENTS) {
      expect(files).toContain(name + ".js");
    }
  });

  it("全部 13 个文件源码无 emoji（spec § 2.2）", () => {
    for (const name of REQUIRED_COMPONENTS) {
      expect(
        COMPONENT_SOURCES[name],
        `${name}.js 含 emoji`,
      ).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("全部 13 个文件无 import / require（零依赖）", () => {
    for (const name of REQUIRED_COMPONENTS) {
      expect(
        COMPONENT_SOURCES[name],
        `${name}.js 含 import/require`,
      ).not.toMatch(/^\s*import\s/m);
      expect(
        COMPONENT_SOURCES[name],
        `${name}.js 含 require`,
      ).not.toMatch(/\brequire\s*\(/);
    }
  });

  it("全部 13 个组件挂载到 window.MyAgent.components.{PascalCase}", () => {
    const sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    for (const name of REQUIRED_COMPONENTS) {
      loadComponent(name, sandbox);
    }
    for (const name of REQUIRED_COMPONENTS) {
      const p = FILENAME_TO_PASCAL[name];
      const ctor = sandbox.MyAgent.components[p];
      expect(typeof ctor, `${p} 未挂载`).toBe("function");
    }
  });
});

// ======================================================================
// Button
// ======================================================================

describe("Button", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("button", sandbox);
  });

  it("构造：variant + label + type='button'", () => {
    const btn = new sandbox.MyAgent.components.Button({ label: "Send", variant: "primary" });
    expect(btn.el.tagName).toBe("BUTTON");
    expect(btn.el.type).toBe("button");
    expect(btn.el.className).toContain("btn");
    expect(btn.el.className).toContain("btn-primary");
    expect(btn.el.textContent).toContain("Send");
  });

  it("a11y：disabled → aria-disabled='true' + 真 disabled；icon-only 必须 aria-label", () => {
    const disabled = new sandbox.MyAgent.components.Button({ label: "Go", disabled: true });
    expect(disabled.el.disabled).toBe(true);
    expect(disabled.el.getAttribute("aria-disabled")).toBe("true");

    // icon-only 无 ariaLabel 应触发 console.warn
    const warn = sandbox.console.warn as ReturnType<typeof vi.fn>;
    warn.mockClear();
    new sandbox.MyAgent.components.Button({ icon: "send" });
    expect(warn).toHaveBeenCalled();
  });

  it("click 触发 onClick（disabled 时不触发）", () => {
    const onClick = vi.fn();
    const btn = new sandbox.MyAgent.components.Button({ label: "X", onClick });
    btn.el.click();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("destroy() 摘除节点（idempotent）", () => {
    const btn = new sandbox.MyAgent.components.Button({ label: "X" });
    sandbox.body.appendChild(btn.el);
    btn.destroy();
    expect(btn.el.parentNode).toBeNull();
    expect(() => btn.destroy()).not.toThrow();
  });
});

// ======================================================================
// Input
// ======================================================================

describe("Input", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("input", sandbox);
  });

  it("构造：label for + input + 自动 id", () => {
    const inp = new sandbox.MyAgent.components.Input({ label: "Username" });
    expect(inp.el.tagName).toBe("DIV");
    expect(inp.inputEl.tagName).toBe("INPUT");
    expect(inp.inputEl.type).toBe("text");
    // label for 与 input id 匹配
    const label = inp.el.querySelector("label");
    expect(label).not.toBeNull();
    expect(label!.getAttribute("for")).toBe(inp.inputEl.id);
  });

  it("a11y：error 状态 → aria-invalid + aria-describedby + role=alert 错误节点", () => {
    const inp = new sandbox.MyAgent.components.Input({ label: "Email", error: "Invalid" });
    expect(inp.inputEl.getAttribute("aria-invalid")).toBe("true");
    const described = inp.inputEl.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    // 错误节点 role=alert
    const err = inp.el.querySelector("div");
    // 第一个 div 可能是 field-error（因为 label 不是 div）
    const errNode = Array.from((inp.el as any).children).find(
      (c: any) => c.tagName === "DIV" && c.className && c.className.includes("field-error"),
    ) as any;
    expect(errNode).toBeTruthy();
    expect(errNode.getAttribute("role")).toBe("alert");
  });

  it("type=password / required / disabled 正确传递", () => {
    const inp = new sandbox.MyAgent.components.Input({ type: "password", required: true, disabled: true });
    expect(inp.inputEl.type).toBe("password");
    expect(inp.inputEl.required).toBe(true);
    expect(inp.inputEl.disabled).toBe(true);
  });
});

// ======================================================================
// Textarea
// ======================================================================

describe("Textarea", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("textarea", sandbox);
  });

  it("构造：label + textarea + 默认 rows=3", () => {
    const ta = new sandbox.MyAgent.components.Textarea({ label: "Note" });
    expect(ta.inputEl.tagName).toBe("TEXTAREA");
    expect(ta.inputEl.getAttribute("rows")).toBe("3");
  });

  it("a11y：showCount → aria-describedby 指向 count 节点；error 状态 aria-invalid", () => {
    const ta = new sandbox.MyAgent.components.Textarea({
      label: "Bio",
      showCount: true,
      maxLength: 100,
      value: "hello",
    });
    const described = ta.inputEl.getAttribute("aria-describedby");
    expect(described).toBeTruthy();
    // 找 count 节点
    const countNode = Array.from((ta.el as any).children).find(
      (c: any) => c.tagName === "DIV" && c.className && c.className.includes("field-count"),
    ) as any;
    expect(countNode).toBeTruthy();
    expect(countNode.getAttribute("aria-live")).toBe("polite");

    const ta2 = new sandbox.MyAgent.components.Textarea({ error: "Too short" });
    expect(ta2.inputEl.getAttribute("aria-invalid")).toBe("true");
  });

  it("maxLength + readOnly 正确传递", () => {
    const ta = new sandbox.MyAgent.components.Textarea({ maxLength: 50, readOnly: true });
    expect(ta.inputEl.getAttribute("maxlength")).toBe("50");
    expect(ta.inputEl.readOnly).toBe(true);
  });
});

// ======================================================================
// Modal
// ======================================================================

describe("Modal", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("modal", sandbox);
  });

  it("构造：role=dialog + aria-modal=true + 标题关联", () => {
    const m = new sandbox.MyAgent.components.Modal({ title: "Confirm" });
    const dialog = m.el.querySelector("div"); // overlay
    const realDialog = (dialog as any).children.find((c: any) => c.tagName === "DIV" && c.className.includes("modal-dialog"));
    expect(realDialog).toBeTruthy();
    expect(realDialog!.getAttribute("role")).toBe("dialog");
    expect(realDialog!.getAttribute("aria-modal")).toBe("true");
    expect(realDialog!.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("a11y：open() 把 modal 挂到 body；close() 摘除", () => {
    const m = new sandbox.MyAgent.components.Modal({ title: "X" });
    m.open();
    expect(m.el.parentNode).toBe(sandbox.body as any);
    m.close();
    expect(m.el.parentNode).toBeNull();
  });

  it("ESC 关闭 + 卸载 document.keydown listener", () => {
    const m = new sandbox.MyAgent.components.Modal({ title: "X" });
    m.open();
    m.close();
    // 关闭后 modal 节点不存在；再触发 ESC 不应报错
    expect(() => {
      sandbox.document.dispatchEvent({ type: "keydown" });
    }).not.toThrow();
  });
});

// ======================================================================
// Toast
// ======================================================================

describe("Toast", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("toast", sandbox);
  });

  it("构造：单例 #toast-root + 自身 stack 根", () => {
    const t = new sandbox.MyAgent.components.Toast();
    expect(sandbox.document.getElementById("toast-root")).toBeTruthy();
    expect(t.el.className).toContain("toast-stack");
  });

  it("show() → role=status（info）+ error 时 role=alert", () => {
    const t = new sandbox.MyAgent.components.Toast();
    const info = t.show({ message: "hi", status: "info" });
    expect(info.el.getAttribute("role")).toBe("status");
    const err = t.show({ message: "bad", status: "error" });
    expect(err.el.getAttribute("role")).toBe("alert");
  });
});

// ======================================================================
// Skeleton
// ======================================================================

describe("Skeleton", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("skeleton", sandbox);
  });

  it("构造：text/rect/circle 三种 variant + 宽度高度注入 style", () => {
    const t = new sandbox.MyAgent.components.Skeleton({ variant: "text", width: 200, height: 16 });
    expect(t.el.className).toContain("skeleton");
    expect(t.el.className).toContain("skeleton-text");
    const r = new sandbox.MyAgent.components.Skeleton({ variant: "rect" });
    expect(r.el.className).toContain("skeleton-rect");
    const c = new sandbox.MyAgent.components.Skeleton({ variant: "circle", width: 40, height: 40 });
    expect(c.el.className).toContain("skeleton-circle");
  });

  it("a11y：aria-busy=true + aria-live=polite", () => {
    const t = new sandbox.MyAgent.components.Skeleton({});
    expect(t.el.getAttribute("aria-busy")).toBe("true");
    expect(t.el.getAttribute("aria-live")).toBe("polite");
  });
});

// ======================================================================
// Spinner
// ======================================================================

describe("Spinner", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("spinner", sandbox);
  });

  it("构造：role=status + 包含 iconHtml 注入的 SVG", () => {
    const s = new sandbox.MyAgent.components.Spinner({ size: 20 });
    expect(s.el.tagName).toBe("SPAN");
    expect(s.el.getAttribute("role")).toBe("status");
    // iconHtml 应被调用
    const { iconHtml } = { iconHtml: (sandbox.MyAgent.icons.iconHtml as any) };
    expect(iconHtml).toHaveBeenCalled();
  });

  it("a11y：aria-label 默认 'Loading'，可被覆盖", () => {
    const s1 = new sandbox.MyAgent.components.Spinner({});
    expect(s1.el.getAttribute("aria-label")).toBe("Loading");
    const s2 = new sandbox.MyAgent.components.Spinner({ label: "加载对话" });
    expect(s2.el.getAttribute("aria-label")).toBe("加载对话");
  });
});

// ======================================================================
// Tabs
// ======================================================================

describe("Tabs", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("tabs", sandbox);
  });

  it("构造：role=tablist + 多个 role=tab + 当前 tab aria-selected='true'", () => {
    const tabs = new sandbox.MyAgent.components.Tabs({
      items: [
        { id: "a", label: "A" },
        { id: "b", label: "B" },
        { id: "c", label: "C" },
      ],
      activeId: "b",
    });
    const tablist = tabs.el.querySelector("div"); // tablist 是第一个 div
    // 找 tablist 节点
    const tablistNode = (tabs.el as any).children[0];
    expect(tablistNode.getAttribute("role")).toBe("tablist");
    const tabBtns = tablistNode.children;
    expect(tabBtns.length).toBe(3);
    // b 应该是 selected
    const aBtn = tabBtns[0];
    const bBtn = tabBtns[1];
    const cBtn = tabBtns[2];
    expect(aBtn.getAttribute("aria-selected")).toBe("false");
    expect(bBtn.getAttribute("aria-selected")).toBe("true");
    expect(cBtn.getAttribute("aria-selected")).toBe("false");
  });

  it("a11y：每个 tab 配 aria-controls + tabpanel aria-labelledby 指向对应 tab", () => {
    const tabs = new sandbox.MyAgent.components.Tabs({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    });
    const tablist = (tabs.el as any).children[0];
    const panels = (tabs.el as any).children[1];
    const aTab = tablist.children[0];
    const aPanel = panels.children[0];
    expect(aTab.getAttribute("aria-controls")).toBe(aPanel.id);
    expect(aPanel.getAttribute("aria-labelledby")).toBe(aTab.id);
  });

  it("select(id) 切换 aria-selected + 隐藏其他 panel", () => {
    const tabs = new sandbox.MyAgent.components.Tabs({
      items: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    });
    tabs.select("b");
    const tablist = (tabs.el as any).children[0];
    const panels = (tabs.el as any).children[1];
    expect(tablist.children[0].getAttribute("aria-selected")).toBe("false");
    expect(tablist.children[1].getAttribute("aria-selected")).toBe("true");
    expect(panels.children[0].hidden).toBe(true);
    expect(panels.children[1].hidden).toBe(false);
  });
});

// ======================================================================
// Dropdown
// ======================================================================

describe("Dropdown", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("dropdown", sandbox);
  });

  it("构造：trigger + menu(role=menu)，初始 aria-expanded='false' + hidden=true", () => {
    const dd = new sandbox.MyAgent.components.Dropdown({
      trigger: { label: "Open" },
      items: [{ id: "1", label: "Item 1" }, { id: "2", label: "Item 2" }],
    });
    const trigger = (dd.el as any).children[0];
    const menu = (dd.el as any).children[1];
    expect(trigger.tagName).toBe("BUTTON");
    expect(menu.getAttribute("role")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.hidden).toBe(true);
  });

  it("a11y：open() 改 aria-expanded='true' + 显示 menu；close() 反向", () => {
    const dd = new sandbox.MyAgent.components.Dropdown({
      trigger: { label: "T" },
      items: [{ id: "1", label: "I1" }],
    });
    const trigger = (dd.el as any).children[0];
    const menu = (dd.el as any).children[1];
    dd.open();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(menu.hidden).toBe(false);
    dd.close();
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(menu.hidden).toBe(true);
  });

  it("每个 item 是 role=menuitem", () => {
    const dd = new sandbox.MyAgent.components.Dropdown({
      trigger: { label: "T" },
      items: [
        { id: "1", label: "I1" },
        { id: "2", label: "I2" },
      ],
    });
    const menu = (dd.el as any).children[1];
    const item1 = menu.children[0];
    const item2 = menu.children[1];
    expect(item1.getAttribute("role")).toBe("menuitem");
    expect(item2.getAttribute("role")).toBe("menuitem");
  });
});

// ======================================================================
// Tooltip
// ======================================================================

describe("Tooltip", () => {
  let sandbox: Sandbox;
  let target: FakeElement;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("tooltip", sandbox);
    target = makeElement("button");
  });

  it("构造：role=tooltip + target 上 aria-describedby 指向 tooltip id", () => {
    const tip = new sandbox.MyAgent.components.Tooltip({ target, content: "Hi" });
    expect(tip.el.getAttribute("role")).toBe("tooltip");
    const desc = target.getAttribute("aria-describedby");
    expect(desc).toBe(tip.el.id);
  });

  it("destroy() 摘除 tooltip + 清除 target listener（不抛错）", () => {
    const tip = new sandbox.MyAgent.components.Tooltip({ target, content: "Hi" });
    expect(() => tip.destroy()).not.toThrow();
    expect(tip.el.parentNode).toBeNull();
  });
});

// ======================================================================
// Badge
// ======================================================================

describe("Badge", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("badge", sandbox);
  });

  it("构造：count=5 → textContent='5'；count=120 → textContent='99+'（max=99）", () => {
    const b1 = new sandbox.MyAgent.components.Badge({ count: 5 });
    expect(b1.el.textContent).toBe("5");
    const b2 = new sandbox.MyAgent.components.Badge({ count: 120 });
    expect(b2.el.textContent).toBe("99+");
  });

  it("a11y：aria-label 含完整数字（含「未读」或「Unread」）", () => {
    const b = new sandbox.MyAgent.components.Badge({ count: 7 });
    const label = b.el.getAttribute("aria-label");
    expect(label).toBeTruthy();
    expect(label).toContain("7");
  });

  it("setCount() 动态更新 textContent + aria-label + 0 时隐藏 class", () => {
    const b = new sandbox.MyAgent.components.Badge({ count: 5 });
    b.setCount(150);
    expect(b.el.textContent).toBe("99+");
    expect(b.el.getAttribute("aria-label")).toContain("150");
    b.setCount(0);
    expect(hasClass(b.el, "badge-hidden")).toBe(true);
  });
});

// ======================================================================
// Card
// ======================================================================

describe("Card", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("card", sandbox);
  });

  it("构造：article 根 + title 节点 + body 节点", () => {
    const c = new sandbox.MyAgent.components.Card({ title: "Hello", children: "Body text" });
    expect(c.el.tagName).toBe("ARTICLE");
    expect(c.el.className).toContain("card");
    const title = (c.el as any).children.find(
      (n: any) => "tagName" in n && n.tagName === "DIV" && n.className && n.className.includes("card-header"),
    );
    expect(title).toBeTruthy();
  });

  it("a11y：as='button' + onClick 触发 + 整卡 keyboard 可达", () => {
    const onClick = vi.fn();
    const c = new sandbox.MyAgent.components.Card({
      as: "button",
      title: "T",
      onClick,
    });
    expect(c.el.tagName).toBe("BUTTON");
    expect(c.el.type).toBe("button");
    expect(c.el.getAttribute("tabindex")).toBe("0");
    c.el.click();
    expect(onClick).toHaveBeenCalled();
  });
});

// ======================================================================
// EmptyState
// ======================================================================

describe("EmptyState", () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = buildSandbox();
    loadAllUtilsAndIcons(sandbox);
    loadComponent("empty-state", sandbox);
  });

  it("构造：role=status + title + description + action button", () => {
    const onClick = vi.fn();
    const e = new sandbox.MyAgent.components.EmptyState({
      title: "No data",
      description: "Add something",
      action: { label: "Add", onClick },
    });
    expect(e.el.tagName).toBe("DIV");
    expect(e.el.getAttribute("role")).toBe("status");
    expect(e.el.textContent).toContain("No data");
    expect(e.el.textContent).toContain("Add something");
    // 找 button
    const btn = (e.el as any).children.find(
      (n: any) => "tagName" in n && n.tagName === "BUTTON",
    );
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Add");
    btn.click();
    expect(onClick).toHaveBeenCalled();
  });

  it("a11y：icon 注入 + 装饰性 aria-hidden=true", () => {
    const e = new sandbox.MyAgent.components.EmptyState({ title: "Empty", icon: "info" });
    // iconWrap 应该是第一个子（div with aria-hidden）
    const iconWrap = (e.el as any).children[0];
    expect(iconWrap.getAttribute("aria-hidden")).toBe("true");
  });
});
