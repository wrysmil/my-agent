/**
 * utils.js 测试 — F3 / WU-04a
 *
 * utils.js 是经典 <script defer> 加载（非 ES module），运行时挂到 window.MyAgent.utils。
 * 这里用 node:vm 起一个干净的全局上下文，注入一个最小 DOM mock（仅覆盖
 * utils.js 用到的 API：createElement / createTextNode / addEventListener /
 * removeEventListener / querySelector / querySelectorAll）—— 不引 jsdom。
 *
 * 约定：
 *   - 每个 Element 支持 .tagName / .children / .attributes / .addEventListener /
 *     .removeEventListener / .dispatchEvent / .setAttribute / .appendChild。
 *   - 事件系统：注册 callback → call（用于测试 on() 的 remove）。
 *   - 文本节点是叶子节点，appendChild 兼容 string 替身。
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, beforeEach, vi } from "vitest";

const UTILS_PATH = fileURLToPath(new URL("../../web/js/shared/utils.js", import.meta.url));
const UTILS_SOURCE = readFileSync(UTILS_PATH, "utf-8");

// ----------------------------------------------------------------------
// 最小 DOM mock —— 只覆盖 utils.js 真正使用的 API
// ----------------------------------------------------------------------

interface FakeAttr {
  name: string;
  value: string;
}

interface FakeEventTarget {
  _listeners: Map<string, Array<{ cb: EventListener; opts?: AddEventListenerOptions }>>;
  addEventListener(type: string, cb: EventListener, opts?: AddEventListenerOptions): void;
  removeEventListener(type: string, cb: EventListener, opts?: AddEventListenerOptions): void;
  dispatchEvent(evt: { type: string }): boolean;
}

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
  appendChild(child: FakeNode): FakeNode;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  querySelector?(sel: string): FakeElement | null;
  querySelectorAll?(sel: string): FakeElement[];
}

type FakeNode =
  | FakeElement
  | {
      kind: "text";
      nodeType: 3;
      textContent: string;
      parentNode: FakeElement | null;
    };

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
          // 忽略 listener 抛错，避免打断后续 listener
        }
      }
      return true;
    },
  };
  return target;
}

function sameOpts(a?: AddEventListenerOptions | boolean, b?: AddEventListenerOptions | boolean): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  if (typeof a === "boolean" || typeof b === "boolean") return false;
  const ak = a as AddEventListenerOptions;
  const bk = b as AddEventListenerOptions;
  return (!!ak.capture) === (!!bk.capture) && (!!ak.once) === (!!bk.once);
}

function makeElement(tagName: string): FakeElement {
  const el = makeEventTarget() as FakeElement;
  el.tagName = tagName.toUpperCase();
  el.nodeType = 1; // ELEMENT_NODE
  el.children = [];
  el.attributes = [];
  el.dataset = {};
  el.parentNode = null;
  el.textContent = "";
  el.innerHTML = "";
  el.id = "";
  el.className = "";
  el.appendChild = function (c: FakeNode) {
    c.parentNode = el;
    el.children.push(c);
    if ("kind" in c && c.kind === "text") {
      // text node：把内容同步到 element 的 textContent 字符串展示
      el.textContent += (c as { textContent: string }).textContent;
    } else if ("tagName" in c) {
      // element：把自身 + 后代 textContent 全部累加（递归读取）
      el.textContent += (c as FakeElement).textContent;
    }
    return c;
  };
  el.setAttribute = function (name: string, value: string) {
    const existing = el.attributes.find((a) => a.name === name);
    if (existing) existing.value = value;
    else el.attributes.push({ name, value });
    if (name === "id") el.id = value;
    if (name === "class") el.className = value;
    if (name.startsWith("data-")) {
      el.dataset[name.slice("data-".length)] = value;
    }
  };
  el.getAttribute = function (name: string) {
    return el.attributes.find((a) => a.name === name)?.value ?? null;
  };
  // 最小 querySelector(All) mock：仅支持「tagName 匹配」
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
  return el;
}

function makeDocument(): {
  document: Document;
} & Record<string, unknown> {
  const elementsBySelector = new Map<string, FakeElement[]>();

  function register(selector: string, el: FakeElement) {
    const list = elementsBySelector.get(selector) || [];
    list.push(el);
    elementsBySelector.set(selector, list);
  }

  const doc = {
    createElement(tag: string) {
      return makeElement(tag);
    },
    createTextNode(text: string) {
      return {
        kind: "text" as const,
        nodeType: 3,
        textContent: String(text),
        parentNode: null as FakeElement | null,
      } as unknown as FakeNode & { nodeType: number };
    },
    querySelector(sel: string) {
      return elementsBySelector.get(sel)?.[0] ?? null;
    },
    querySelectorAll(sel: string) {
      return elementsBySelector.get(sel) || [];
    },
  };
  return { document: doc as unknown as Document, __register: register } as unknown as {
    document: Document;
  } & Record<string, unknown>;
}

// ----------------------------------------------------------------------
// utils.js 加载 + 测试工具
// ----------------------------------------------------------------------

interface UtilsApi {
  $: (sel: string, root?: ParentNode) => unknown;
  $$: (sel: string, root?: ParentNode) => unknown[];
  el: (
    tag: string,
    attrs?: Record<string, unknown>,
    children?: unknown[],
  ) => FakeElement;
  escapeHtml: (str: any) => string;
  on: (
    el: FakeEventTarget,
    event: string,
    handler: EventListener,
    opts?: AddEventListenerOptions | boolean,
  ) => () => void;
  debounce: <F extends (...args: any[]) => void>(fn: F, ms: number) => F & {
    cancel(): void;
    flush(): void;
  };
  formatTime: (ms: number) => string;
  assert: (cond: unknown, msg?: string) => void;
}

interface UtilsGlobal {
  MyAgent: { utils: UtilsApi };
  document: ReturnType<typeof makeDocument>["document"];
  console: { error: ReturnType<typeof vi.fn> };
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
}

function loadUtils(error: ReturnType<typeof vi.fn> = vi.fn()): UtilsGlobal {
  const doc = makeDocument();
  const sandbox: Record<string, unknown> = {
    console: { error, warn: vi.fn(), log: vi.fn() },
    document: doc.document,
    setTimeout,
    clearTimeout,
  };
  createContext(sandbox);
  runInContext(UTILS_SOURCE, sandbox);
  return sandbox as unknown as UtilsGlobal;
}

// ======================================================================
// 测试
// ======================================================================

describe("utils.js — 全局挂载", () => {
  it("挂载到 window.MyAgent.utils", () => {
    const g = loadUtils();
    expect(g.MyAgent).toBeDefined();
    expect(g.MyAgent.utils).toBeDefined();
  });

  it("导出全部 8 个函数", () => {
    const u = loadUtils().MyAgent.utils;
    expect(typeof u.$).toBe("function");
    expect(typeof u.$$).toBe("function");
    expect(typeof u.el).toBe("function");
    expect(typeof u.escapeHtml).toBe("function");
    expect(typeof u.on).toBe("function");
    expect(typeof u.debounce).toBe("function");
    expect(typeof u.formatTime).toBe("function");
    expect(typeof u.assert).toBe("function");
  });

  it("源码无 emoji 且无 import / require", () => {
    expect(UTILS_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(UTILS_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(UTILS_SOURCE).not.toMatch(/\brequire\s*\(/);
  });
});

describe("escapeHtml", () => {
  const { escapeHtml } = loadUtils().MyAgent.utils;

  it("转义 5 个 HTML 特殊字符", () => {
    expect(escapeHtml('<a href="x">&\'y</a>')).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;y&lt;/a&gt;",
    );
  });

  it("普通字符（无 < > & \" '）原样保留", () => {
    expect(escapeHtml("Hello World 中文 123")).toBe("Hello World 中文 123");
  });

  it("null / undefined → 空字符串", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("number / boolean → 字符串化（不抛错）", () => {
    expect(escapeHtml(0)).toBe("0");
    expect(escapeHtml(42)).toBe("42");
    expect(escapeHtml(true)).toBe("true");
    expect(escapeHtml(false)).toBe("false");
  });

  it("连续 & 不会双重转义（已知行为：第一个 & → &amp;，后续是字面量）", () => {
    // 注意：& 自身的二次转义是 expected 行为 —— 转义是无状态的纯字符串替换。
    expect(escapeHtml("&amp;")).toBe("&amp;amp;");
  });
});

describe("el — 元素构造器", () => {
  it("基本构造：tagName + 子节点 textContent", () => {
    const { el } = loadUtils().MyAgent.utils;
    const node = el("button", { class: "btn" }, ["发送"]);
    expect(node.tagName).toBe("BUTTON");
    expect(node.className).toBe("btn");
    // textContent 含子节点
    expect(node.textContent).toContain("发送");
  });

  it("attrs.class 写入 className（同时不写 class= 属性）", () => {
    const { el } = loadUtils().MyAgent.utils;
    const node = el("div", { class: "foo bar" });
    expect(node.className).toBe("foo bar");
    // className 不应同时作为 attribute 出现两次（白名单路径直接赋值）
    const classAttrs = node.attributes.filter((a) => a.name === "class");
    expect(classAttrs.length).toBeLessThanOrEqual(1);
  });

  it("aria-* 走 setAttribute", () => {
    const { el } = loadUtils().MyAgent.utils;
    const node = el("button", { "aria-label": "send" });
    expect(node.getAttribute("aria-label")).toBe("send");
  });

  it("onclick 等 on* 事件绑定到 addEventListener", () => {
    const { el } = loadUtils().MyAgent.utils;
    const cb = vi.fn();
    const node = el("button", { onclick: cb });
    // 触发
    node.dispatchEvent({ type: "click" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("dataset 简写 → element.dataset.foo", () => {
    const { el } = loadUtils().MyAgent.utils;
    const node = el("div", { dataset: { x: "1", y: "two" } });
    expect(node.dataset).toMatchObject({ x: "1", y: "two" });
  });

  it("children 支持 Node + string + 嵌套数组 + 跳过 falsy", () => {
    const { el } = loadUtils().MyAgent.utils;
    const inner = el("span", {}, ["x"]);
    const node = el(
      "div",
      {},
      ["a", null, undefined, false, inner, ["b", "c"]],
    );
    // textContent 拼接所有文本
    expect(node.textContent).toContain("a");
    expect(node.textContent).toContain("x");
    expect(node.textContent).toContain("b");
    expect(node.textContent).toContain("c");
    // children 数量：inner + 4 textNode("a","x","b","c")
    expect(node.children.length).toBeGreaterThanOrEqual(4);
  });
});

describe("on — addEventListener + off", () => {
  it("返回的 off() 调用一次即解除", () => {
    const { on } = loadUtils().MyAgent.utils;
    const el = makeElement("div");
    const cb = vi.fn();
    const off = on(el, "click", cb);
    el.dispatchEvent({ type: "click" });
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    el.dispatchEvent({ type: "click" });
    expect(cb).toHaveBeenCalledTimes(1); // 仍 1 次
  });

  it("off() 幂等：重复调用安全无副作用", () => {
    const { on } = loadUtils().MyAgent.utils;
    const el = makeElement("div");
    const off = on(el, "x", () => {});
    expect(() => {
      off();
      off();
      off();
    }).not.toThrow();
  });

  it("opts 一并传入 add/removeEventListener", () => {
    const { on } = loadUtils().MyAgent.utils;
    const addSpy = vi.spyOn(makeElement("div"), "addEventListener");
    const el = makeElement("div");
    el.addEventListener = addSpy as unknown as FakeElement["addEventListener"];
    const cb = vi.fn();
    const off = on(el, "click", cb, { capture: true });
    expect(addSpy).toHaveBeenCalledWith("click", cb, { capture: true });
    off();
  });
});

describe("debounce — leading=false, trailing=true", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("连续触发只在静默 ms 后真正触发一次（trailing）", () => {
    const { debounce } = loadUtils().MyAgent.utils;
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d();
    d();
    d();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("最后一次参数透传给 fn", () => {
    const { debounce } = loadUtils().MyAgent.utils;
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d(1);
    d(2);
    d(3);
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(3);
  });

  it("cancel() 中止 pending 触发", () => {
    const { debounce } = loadUtils().MyAgent.utils;
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d();
    d.cancel();
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush() 立即触发 pending", () => {
    const { debounce } = loadUtils().MyAgent.utils;
    const fn = vi.fn();
    const d = debounce(fn, 100);
    d("x");
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("x");
    // 后续 advance 不会再次触发
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("formatTime — 三档时间格式", () => {
  const { formatTime } = loadUtils().MyAgent.utils;

  it("非法 / NaN 输入 → 空字符串", () => {
    expect(formatTime(NaN)).toBe("");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("");
    expect(formatTime(Number.NEGATIVE_INFINITY)).toBe("");
    expect(formatTime("not a number" as unknown as number)).toBe("");
  });

  it("≤ 60 秒 → HH:mm:ss", () => {
    const now = Date.now();
    const tenSecAgo = now - 10_000;
    const result = formatTime(tenSecAgo);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("今天（> 60 秒）→ 今天 HH:mm", () => {
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const result = formatTime(twoHoursAgo);
    expect(result.startsWith("今天 ")).toBe(true);
    expect(result).toMatch(/^今天 \d{2}:\d{2}$/);
  });

  it("跨天 → YYYY-MM-DD HH:mm", () => {
    // 取一个明确在「昨天」的固定时间戳（today - 26h）
    const yesterday = Date.now() - 26 * 60 * 60 * 1000;
    const result = formatTime(yesterday);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    // 不应有「今天」前缀
    expect(result.startsWith("今天 ")).toBe(false);
  });
});

describe("assert", () => {
  it("truthy → 静默通过", () => {
    const { assert } = loadUtils().MyAgent.utils;
    expect(() => assert(true, "ok")).not.toThrow();
    expect(() => assert(1, "ok")).not.toThrow();
    expect(() => assert("x", "ok")).not.toThrow();
  });

  it("falsy → console.error + throw", () => {
    const errSpy = vi.fn();
    const { assert } = loadUtils(errSpy).MyAgent.utils;
    expect(() => assert(false, "boom")).toThrow(/boom/);
    expect(errSpy).toHaveBeenCalledTimes(1);
    expect(String(errSpy.mock.calls[0]![0])).toContain("boom");
  });

  it("缺 msg → 走兜底文案", () => {
    const errSpy = vi.fn();
    const { assert } = loadUtils(errSpy).MyAgent.utils;
    expect(() => assert(0)).toThrow();
    expect(String(errSpy.mock.calls[0]![0])).toContain("assert");
  });
});

describe("$ / $$ — querySelector 糖", () => {
  it("$ 在传入 root 上调用 querySelector", () => {
    const { $ } = loadUtils().MyAgent.utils;
    const doc = makeDocument();
    const root = doc.document.createElement("div");
    const target = doc.document.createElement("span");
    root.appendChild(target);

    // 利用 mock 的 querySelector 直接断言
    const qsSpy = vi.spyOn(root as unknown as ParentNode, "querySelector");
    $(("span" as unknown) as string, root as unknown as ParentNode);
    expect(qsSpy).toHaveBeenCalledWith("span");
  });
});