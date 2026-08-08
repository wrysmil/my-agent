/**
 * features-skills.test.ts — F13 / WU-05f 单测（≥ 10 用例）
 *
 * 测试模式与 features-agents.test.ts 一致：用 node:vm 起干净沙箱，注入最小 DOM
 * mock + 真实 utils.js / api.js / i18n.js / state.js 源码 + mock fetch + mock components。
 *
 * 覆盖：
 *   - 全局挂载：window.MyAgent.skillsFeature.installSkillsView / uninstall
 *   - installSkillsView({container}) 渲染独立 panel（非 Tabs）
 *   - Skill 列表行展示 name / description / scope 角标
 *   - a11y：<ul role="listbox"> + <li role="option">
 *   - 点击 list 项 → 打开 detail modal（含 id / scope / source / body 预览）
 *   - body 预览截断 ≤ 600 字
 *   - 「使用」按钮 → 派发 CustomEvent('my-agent:skill-use', {skillId, skillName})
 *   - 使用按钮同时调 options.onUse（若传入）
 *   - 卸载：uninstall() / destroy() 摘除节点
 *   - 错误：fetchSkillsList 失败 → Toast + 错误占位
 *   - 缓存：写回 agentState.skills；先显示缓存再后台刷新
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const SKILLS_PATH = fileURLToPath(
  new URL("../../web/js/features/skills.js", import.meta.url),
);
const SKILLS_SOURCE = readFileSync(SKILLS_PATH, "utf-8");

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
// 最小 DOM mock —— 与 features-agents.test.ts 同形态
// ----------------------------------------------------------------------

interface FakeAttr {
  name: string;
  value: string;
}
interface FakeEventTarget {
  _listeners: Map<string, Array<{ cb: EventListener }>>;
  addEventListener(type: string, cb: EventListener): void;
  removeEventListener(type: string, cb: EventListener): void;
  dispatchEvent(evt: { type: string }): boolean;
}
type FakeNode =
  | FakeElement
  | {
      kind: "text";
      nodeType: 3;
      textContent: string;
      parentNode: FakeElement | null;
    };
interface FakeElement extends FakeEventTarget {
  tagName: string;
  nodeType: number;
  children: FakeNode[];
  attributes: FakeAttr[];
  dataset: Record<string, string>;
  parentNode: FakeNode | null;
  textContent: string;
  id: string;
  className: string;
  classList: {
    add(c: string): void;
    remove(c: string): void;
    contains(c: string): boolean;
  };
  hidden: boolean;
  disabled: boolean;
  type: string;
  value: string;
  tabIndex: number;
  firstChild: FakeNode | null;
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
    addEventListener(type, cb) {
      const list = target._listeners.get(type) || [];
      list.push({ cb });
      target._listeners.set(type, list);
    },
    removeEventListener(type, cb) {
      const list = target._listeners.get(type);
      if (!list) return;
      const idx = list.findIndex((e) => e.cb === cb);
      if (idx >= 0) list.splice(idx, 1);
    },
    dispatchEvent(evt) {
      const list = target._listeners.get(evt.type);
      if (!list) return true;
      for (const entry of list.slice()) {
        try {
          entry.cb(evt as unknown as Event);
        } catch {
          /* ignore */
        }
      }
      return true;
    },
  };
  return target;
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
  "role",
  "style",
]);

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
    if (p.attrPresenceOnly) {
      if (!el.attributes.some((a) => a.name === p.attrName)) return false;
    } else if (el.getAttribute(p.attrName) !== p.attrValue) {
      return false;
    }
  }
  return true;
}

function compileSelector(sel: string): (el: FakeElement) => boolean {
  const parts = parseSelectorParts(sel);
  return (el: FakeElement) =>
    !!el && !!el.tagName && parts.every((p) => matchPart(el, p));
}

function textOf(node: FakeNode): string {
  if ("kind" in node && node.kind === "text") return node.textContent;
  if ("tagName" in node) return (node as FakeElement).textContent;
  return "";
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
    contains: (c: string) => classSet.has(c),
  };

  for (const name of NATIVE_PROPS) {
    let backing: unknown = undefined;
    Object.defineProperty(el, name, {
      get: () => backing,
      set(v: unknown) {
        backing = v;
        const existing = el.attributes.find((a) => a.name === name);
        const str =
          v === true ? "" : v === false || v == null ? null : String(v);
        if (existing) {
          if (str === null) {
            el.attributes.splice(el.attributes.indexOf(existing), 1);
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
  }

  const recomputeText = () => {
    el.textContent = el.children.map(textOf).join("");
  };

  el.appendChild = function (c: FakeNode) {
    c.parentNode = el;
    el.children.push(c);
    recomputeText();
    return c;
  };
  el.removeChild = function (c: FakeNode) {
    const i = el.children.indexOf(c);
    if (i >= 0) {
      el.children.splice(i, 1);
      (c as { parentNode: FakeNode | null }).parentNode = null;
      recomputeText();
    }
    return c;
  };
  Object.defineProperty(el, "firstChild", {
    get: () => (el.children.length > 0 ? el.children[0]! : null),
    configurable: true,
  });
  el.setAttribute = function (name: string, value: string) {
    const lower = name.toLowerCase();
    const existing = el.attributes.find((a) => a.name.toLowerCase() === lower);
    if (existing) existing.value = value;
    else el.attributes.push({ name, value });
    if (lower === "id") el.id = value;
    if (lower === "class") el.className = value;
    if (lower === "tabindex") el.tabIndex = parseInt(value, 10);
    if (name.startsWith("data-")) el.dataset[name.slice("data-".length)] = value;
  };
  el.getAttribute = function (name: string) {
    const lower = name.toLowerCase();
    return (
      el.attributes.find((a) => a.name.toLowerCase() === lower)?.value ?? null
    );
  };
  el.removeAttribute = function (name: string) {
    const lower = name.toLowerCase();
    const i = el.attributes.findIndex((a) => a.name.toLowerCase() === lower);
    if (i >= 0) el.attributes.splice(i, 1);
  };
  el.querySelector = function (sel: string) {
    const matcher = compileSelector(sel);
    for (const c of el.children) {
      if ("tagName" in c && matcher(c as FakeElement)) return c as FakeElement;
    }
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
    (function walk(node: FakeElement) {
      for (const c of node.children) {
        if ("tagName" in c) {
          const e = c as FakeElement;
          if (matcher(e)) out.push(e);
          walk(e);
        }
      }
    })(el);
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
  el.focus = () => {};
  el.click = () => {
    el.dispatchEvent({ type: "click" });
  };
  return el;
}

interface DispatchedEvent {
  type: string;
  detail?: unknown;
}

function makeDocument(dispatched: DispatchedEvent[]) {
  const body = makeElement("body");
  const listeners: Array<{ type: string; cb: EventListener }> = [];
  const doc = {
    createElement: (tag: string) => makeElement(tag),
    createTextNode: (text: string) => ({
      kind: "text" as const,
      nodeType: 3 as const,
      textContent: String(text),
      parentNode: null as FakeElement | null,
    }),
    body,
    addEventListener(type: string, cb: EventListener) {
      listeners.push({ type, cb });
    },
    removeEventListener(type: string, cb: EventListener) {
      const i = listeners.findIndex((l) => l.type === type && l.cb === cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(evt: DispatchedEvent) {
      dispatched.push(evt);
      for (const l of listeners.slice()) {
        if (l.type === evt.type) {
          try {
            l.cb(evt as unknown as Event);
          } catch {
            /* ignore */
          }
        }
      }
      return true;
    },
    querySelector(sel: string) {
      const matcher = compileSelector(sel);
      return (function walk(node: FakeNode): FakeElement | null {
        if (!("tagName" in node)) return null;
        const e = node as FakeElement;
        if (matcher(e)) return e;
        for (const c of e.children) {
          const hit = walk(c);
          if (hit) return hit;
        }
        return null;
      })(body);
    },
    querySelectorAll(sel: string) {
      const matcher = compileSelector(sel);
      const out: FakeElement[] = [];
      (function walk(node: FakeNode) {
        if (!("tagName" in node)) return;
        const e = node as FakeElement;
        if (matcher(e)) out.push(e);
        for (const c of e.children) walk(c);
      })(body);
      return out;
    },
  };
  return { document: doc, body, listeners };
}

// ----------------------------------------------------------------------
// mock fetch
// ----------------------------------------------------------------------

interface MockResponse {
  status?: number;
  body?: unknown;
  raw?: string;
}

function makeMockFetch() {
  const queue: Array<MockResponse | Error> = [];
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = vi.fn((url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (next instanceof Error) return Promise.reject(next);
    const resp = next ?? {};
    const status = resp.status ?? 200;
    let raw: string;
    if (resp.raw !== undefined) raw = resp.raw;
    else if (typeof resp.body === "string") raw = resp.body;
    else if (resp.body === undefined) raw = "";
    else raw = JSON.stringify(resp.body);
    return Promise.resolve({
      status,
      headers: { get: () => "application/json; charset=utf-8" },
      text: () => Promise.resolve(raw),
    });
  });
  return {
    fn,
    calls,
    enqueue(...items: Array<MockResponse | Error>) {
      for (const it of items) queue.push(it);
    },
  };
}

/** {ok:true,data} 成功壳 */
function okBody(data: unknown): MockResponse {
  return { status: 200, body: { ok: true, data } };
}

// ----------------------------------------------------------------------
// 沙箱工厂
// ----------------------------------------------------------------------

function buildSandbox(
  opts: {
    listResponse?: MockResponse | Error;
    detailResponse?: MockResponse | Error;
    cachedSkills?: unknown[];
  } = {},
) {
  const mockFetch = makeMockFetch();
  if (opts.listResponse !== undefined) mockFetch.enqueue(opts.listResponse);
  if (opts.detailResponse !== undefined) mockFetch.enqueue(opts.detailResponse);

  const dispatched: DispatchedEvent[] = [];
  const doc = makeDocument(dispatched);

  const modalOpen = vi.fn();
  const modalClose = vi.fn();
  const modalDestroy = vi.fn();
  const toastShow = vi.fn();

  const sandbox: Record<string, unknown> = {
    localStorage: (() => {
      const data = new Map<string, string>();
      return {
        getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
        setItem: (k: string, v: string) => void data.set(k, String(v)),
        removeItem: (k: string) => void data.delete(k),
        clear: () => data.clear(),
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        get length() {
          return data.size;
        },
      };
    })(),
    document: doc.document,
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
    setTimeout,
    clearTimeout,
    fetch: mockFetch.fn,
    AbortController,
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
    MyAgent: {},
    globalThis: undefined as unknown,
  };
  sandbox.globalThis = sandbox;

  createContext(sandbox);
  runInContext(UTILS_SOURCE, sandbox);
  runInContext(API_SOURCE, sandbox);
  runInContext(I18N_SOURCE, sandbox);
  runInContext(STATE_SOURCE, sandbox);

  const MA = sandbox.MyAgent as any;

  // mock components: Modal / Button / Toast（skills.js 不用 Tabs）
  MA.components = {
    Modal: vi.fn(function (options: any) {
      const root = doc.document.createElement("div");
      root.className =
        "modal-root" + (options.className ? " " + options.className : "");
      const dialog = doc.document.createElement("div");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      root.appendChild(dialog);
      if (options.title) {
        const titleEl = doc.document.createElement("h2");
        titleEl.className = "modal-title";
        titleEl.appendChild(doc.document.createTextNode(String(options.title)));
        dialog.appendChild(titleEl);
      }
      if (options.content && options.content.nodeType) {
        dialog.appendChild(options.content);
      }
      return {
        el: root,
        open() {
          doc.body.appendChild(root);
          modalOpen();
        },
        close() {
          if (root.parentNode)
            (root.parentNode as FakeElement).removeChild(root);
          modalClose();
          options.onClose?.();
        },
        destroy() {
          if (root.parentNode)
            (root.parentNode as FakeElement).removeChild(root);
          modalDestroy();
          options.onClose?.();
        },
      };
    }),
    Button: vi.fn(function (options: any) {
      const btn = makeElement("button");
      btn.type = options.type || "button";
      btn.className = "btn btn-" + (options.variant || "secondary");
      if (options.label) {
        btn.appendChild(doc.document.createTextNode(String(options.label)));
      }
      if (typeof options.onClick === "function") {
        btn.addEventListener("click", options.onClick);
      }
      return { el: btn, destroy() {} };
    }),
    Toast: vi.fn(function () {
      return { show: (o: any) => toastShow(o), destroy() {} };
    }),
  };

  runInContext(SKILLS_SOURCE, sandbox);

  if (opts.cachedSkills) {
    const store = MA.state.getStore("agentState");
    try {
      store.set({ agents: [], skills: opts.cachedSkills });
    } catch {
      /* ignore */
    }
  }

  const container = makeElement("div");
  container.id = "skills-region";
  doc.body.appendChild(container);

  return {
    feature: MA.skillsFeature,
    state: MA.state,
    container,
    body: doc.body,
    document: doc.document,
    mockFetch,
    dispatched,
    mocks: {
      modal: { open: modalOpen, close: modalClose, destroy: modalDestroy },
      toast: { show: toastShow },
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

const SAMPLE_SKILLS = [
  {
    id: "brainstorming",
    name: "Brainstorming",
    description: "发散设计方案",
    source: "builtin",
    scope: "builtin",
  },
  {
    id: "my-custom",
    name: "My Custom",
    description: "用户自定义技能",
    source: "user",
    scope: "user",
  },
  {
    id: "market-one",
    name: "Market One",
    description: "市场技能",
    source: "marketplace",
    scope: "marketplace",
  },
];

/** 装载视图并等首批 fetch 完成 */
async function installReady(
  sb: ReturnType<typeof buildSandbox>,
  options: Record<string, unknown> = {},
) {
  const inst = sb.feature.installSkillsView({
    container: sb.container,
    ...options,
  });
  await flushPromises();
  return inst;
}

// ----------------------------------------------------------------------
// 测试用例
// ----------------------------------------------------------------------

describe("features/skills.js — 全局导出", () => {
  it("挂载 skillsFeature 到 window.MyAgent，导出 installSkillsView + uninstall", () => {
    const sb = buildSandbox();
    expect(sb.feature).toBeDefined();
    expect(typeof sb.feature.installSkillsView).toBe("function");
    expect(typeof sb.feature.uninstall).toBe("function");
  });

  it("暴露常量 USE_EVENT / BODY_PREVIEW_MAX / SCOPE_LABELS / EMPTY_TEXT", () => {
    const sb = buildSandbox();
    expect(sb.feature.USE_EVENT).toBe("my-agent:skill-use");
    expect(sb.feature.BODY_PREVIEW_MAX).toBe(600);
    expect(sb.feature.SCOPE_LABELS.builtin.zh).toBe("内置");
    expect(sb.feature.SCOPE_LABELS.user.en).toBe("User");
    expect(sb.feature.SCOPE_LABELS.marketplace.zh).toBe("市场");
    expect(sb.feature.EMPTY_TEXT.zh).toBe("暂无可用技能");
  });

  it("_truncate 在 600 字处截断并补省略号", () => {
    const sb = buildSandbox();
    const long = "字".repeat(1000);
    const out = sb.feature._truncate(long, sb.feature.BODY_PREVIEW_MAX);
    expect(out.length).toBe(601);
    expect(out.endsWith("…")).toBe(true);
    // 短文本原样返回
    expect(sb.feature._truncate("短", 600)).toBe("短");
    expect(sb.feature._truncate(undefined, 600)).toBe("");
  });
});

describe("installSkillsView — 基本渲染与 a11y", () => {
  it("未传 container 抛错", () => {
    const sb = buildSandbox();
    expect(() => sb.feature.installSkillsView({})).toThrow(/container/);
  });

  it("返回 {el, refresh, destroy, uninstall} 且 el 挂到 container；独立 panel 无 tablist", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installSkillsView({ container: sb.container });
    expect(typeof inst.refresh).toBe("function");
    expect(typeof inst.destroy).toBe("function");
    expect(typeof inst.uninstall).toBe("function");
    expect(inst.el.parentNode).toBe(sb.container);
    // spec § 5.5：Skills 是独立 panel，不依赖 agents tab
    expect((inst.el as FakeElement).querySelector('[role="tablist"]')).toBeNull();
    expect((inst.el as FakeElement).getAttribute("role")).toBe("region");
  });

  it("a11y：列表是 <ul role=\"listbox\">，加载中显示占位", () => {
    const sb = buildSandbox();
    const inst = sb.feature.installSkillsView({ container: sb.container });
    const list = (inst.el as FakeElement).querySelector('[role="listbox"]');
    expect(list).toBeTruthy();
    expect((list as FakeElement).tagName).toBe("UL");
    expect((list as FakeElement).textContent).toContain("加载中");
  });

  it("请求命中 GET /api/skills 端点", async () => {
    const sb = buildSandbox({ listResponse: okBody({ skills: SAMPLE_SKILLS }) });
    await installReady(sb);
    expect(sb.mockFetch.calls.length).toBeGreaterThanOrEqual(1);
    expect(sb.mockFetch.calls[0]!.url).toContain("/api/skills");
  });
});

describe("Skill 列表行 — 数据展示", () => {
  it("渲染每条 skill（name + description + scope 角标），行为 role=option", async () => {
    const sb = buildSandbox({ listResponse: okBody({ skills: SAMPLE_SKILLS }) });
    const inst = await installReady(sb);
    const rows = (inst.el as FakeElement).querySelectorAll('[role="option"]');
    expect(rows.length).toBe(3);

    const first = rows[0]!;
    expect(first.tagName).toBe("LI");
    expect(first.getAttribute("data-skill-id")).toBe("brainstorming");
    expect(first.textContent).toContain("Brainstorming");
    expect(first.textContent).toContain("发散设计方案");
    // scope 角标
    const badge = first.querySelector(".badge-scope");
    expect(badge).toBeTruthy();
    expect(badge!.textContent).toBe("内置");
    expect(badge!.getAttribute("data-scope")).toBe("builtin");

    // user / marketplace scope 文案
    expect(rows[1]!.querySelector(".badge-scope")!.textContent).toBe("用户");
    expect(rows[2]!.querySelector(".badge-scope")!.textContent).toBe("市场");
  });

  it("空列表渲染「暂无可用技能」占位", async () => {
    const sb = buildSandbox({ listResponse: okBody({ skills: [] }) });
    const inst = await installReady(sb);
    const list = (inst.el as FakeElement).querySelector('[role="listbox"]')!;
    expect(list.textContent).toContain("暂无可用技能");
    expect(list.querySelectorAll('[role="option"]').length).toBe(0);
  });

  it("缓存写回 agentState.skills", async () => {
    const sb = buildSandbox({ listResponse: okBody({ skills: SAMPLE_SKILLS }) });
    await installReady(sb);
    const cached = sb.state.getStore("agentState").get();
    expect(Array.isArray(cached.skills)).toBe(true);
    expect(cached.skills.map((s: any) => s.id)).toEqual([
      "brainstorming",
      "my-custom",
      "market-one",
    ]);
  });

  it("有缓存时先渲染缓存再后台刷新（无 loading 闪烁）", async () => {
    const sb = buildSandbox({
      cachedSkills: [
        {
          id: "cached-one",
          name: "Cached",
          description: "来自缓存",
          source: "user",
          scope: "user",
        },
      ],
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
    });
    const inst = sb.feature.installSkillsView({ container: sb.container });
    // 同步阶段：缓存内容已渲染，非「加载中」
    const list = (inst.el as FakeElement).querySelector('[role="listbox"]')!;
    expect(list.textContent).toContain("Cached");
    expect(list.textContent).not.toContain("加载中");
    // 后台刷新完成后替换为最新
    await flushPromises();
    expect(list.textContent).toContain("Brainstorming");
    expect(list.textContent).not.toContain("Cached");
  });
});

describe("详情 Modal", () => {
  it("点击列表行 → 打开 modal，展示 id / scope / source / body 预览", async () => {
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: okBody({
        skill: {
          id: "brainstorming",
          name: "Brainstorming",
          description: "发散设计方案",
          description_zh: "发散设计方案",
          description_en: "Diverge on design options",
          source: "builtin",
          scope: "builtin",
          body: "# Brainstorming\n\n正文内容。",
        },
      }),
    });
    const inst = await installReady(sb);
    const row = (inst.el as FakeElement).querySelectorAll('[role="option"]')[0]!;
    row.dispatchEvent({ type: "click" });
    await flushPromises();

    expect(sb.mocks.modal.open).toHaveBeenCalled();
    // 详情请求打到 /api/skills/:id
    const detailCall = sb.mockFetch.calls.find((c) =>
      c.url.includes("/api/skills/brainstorming"),
    );
    expect(detailCall).toBeTruthy();

    const detail = sb.body.querySelector(".skill-detail")!;
    expect(detail).toBeTruthy();
    expect(detail.textContent).toContain("brainstorming"); // id
    expect(detail.textContent).toContain("内置"); // scope / source 文案
    expect(detail.textContent).toContain("正文内容"); // body 预览
    expect(detail.textContent).toContain("Diverge on design options");
    expect(detail.querySelector(".skill-detail-body")).toBeTruthy();
  });

  it("键盘 Enter 也能打开详情（a11y）", async () => {
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: okBody({ skill: { ...SAMPLE_SKILLS[0], body: "x" } }),
    });
    const inst = await installReady(sb);
    const row = (inst.el as FakeElement).querySelectorAll('[role="option"]')[0]!;
    expect(row.getAttribute("tabindex")).toBe("0");
    row.dispatchEvent({ type: "keydown", key: "Enter" } as never);
    await flushPromises();
    expect(sb.mocks.modal.open).toHaveBeenCalled();
  });

  it("body 超长时预览截断到 600 字 + 省略号", async () => {
    const longBody = "内".repeat(2000);
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: okBody({
        skill: { ...SAMPLE_SKILLS[0], body: longBody },
      }),
    });
    const inst = await installReady(sb);
    (inst.el as FakeElement)
      .querySelectorAll('[role="option"]')[0]!
      .dispatchEvent({ type: "click" });
    await flushPromises();

    const pre = sb.body.querySelector(".skill-detail-body")!;
    expect(pre).toBeTruthy();
    expect(pre.textContent.length).toBe(601);
    expect(pre.textContent.endsWith("…")).toBe(true);
  });

  it("详情请求失败 → Toast 提示（概要 modal 仍在）", async () => {
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: {
        status: 404,
        body: {
          ok: false,
          error: { code: "SKILL_NOT_FOUND", message: 'Skill "x" not found' },
        },
      },
    });
    const inst = await installReady(sb);
    (inst.el as FakeElement)
      .querySelectorAll('[role="option"]')[0]!
      .dispatchEvent({ type: "click" });
    await flushPromises();

    expect(sb.mocks.toast.show).toHaveBeenCalled();
    const arg = sb.mocks.toast.show.mock.calls.at(-1)![0];
    expect(arg.status).toBe("error");
    expect(String(arg.message)).toContain("not found");
  });
});

describe("「使用」按钮", () => {
  it("点击派发 CustomEvent('my-agent:skill-use') 且 detail 含 skillId / skillName", async () => {
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: okBody({
        skill: { ...SAMPLE_SKILLS[0], body: "正文" },
      }),
    });
    const inst = await installReady(sb);
    (inst.el as FakeElement)
      .querySelectorAll('[role="option"]')[0]!
      .dispatchEvent({ type: "click" });
    await flushPromises();

    const useBtn = sb.body.querySelector(".skill-detail-footer")!
      .children[0] as FakeElement;
    expect(useBtn.tagName).toBe("BUTTON");
    expect(useBtn.textContent).toContain("使用");

    useBtn.dispatchEvent({ type: "click" });

    const evt = sb.dispatched.find((e) => e.type === "my-agent:skill-use");
    expect(evt).toBeTruthy();
    expect(evt!.detail).toEqual({
      skillId: "brainstorming",
      skillName: "Brainstorming",
    });
  });

  it("同时调用 options.onUse 回调并关闭 modal", async () => {
    const onUse = vi.fn();
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: okBody({
        skill: { ...SAMPLE_SKILLS[1], body: "正文" },
      }),
    });
    const inst = await installReady(sb, { onUse });
    (inst.el as FakeElement)
      .querySelectorAll('[role="option"]')[1]!
      .dispatchEvent({ type: "click" });
    await flushPromises();

    const useBtn = sb.body.querySelector(".skill-detail-footer")!
      .children[0] as FakeElement;
    useBtn.dispatchEvent({ type: "click" });

    expect(onUse).toHaveBeenCalledWith({
      skillId: "my-custom",
      skillName: "My Custom",
    });
    // modal 关闭
    expect(sb.mocks.modal.close).toHaveBeenCalled();
    expect(sb.body.querySelector(".skill-detail")).toBeNull();
  });
});

describe("错误处理", () => {
  it("列表请求失败 → 错误占位 + Toast", async () => {
    const sb = buildSandbox({
      listResponse: {
        status: 500,
        body: {
          ok: false,
          error: { code: "INTERNAL_ERROR", message: "扫描技能目录失败" },
        },
      },
    });
    const inst = await installReady(sb);
    const list = (inst.el as FakeElement).querySelector('[role="listbox"]')!;
    expect(list.querySelector(".skill-list-error")).toBeTruthy();
    expect(list.textContent).toContain("扫描技能目录失败");
    expect(sb.mocks.toast.show).toHaveBeenCalledWith({
      message: "扫描技能目录失败",
      status: "error",
    });
  });

  it("网络错误 → Toast（NETWORK_ERROR 消息）", async () => {
    const sb = buildSandbox({ listResponse: new Error("connection refused") });
    await installReady(sb);
    expect(sb.mocks.toast.show).toHaveBeenCalled();
    const arg = sb.mocks.toast.show.mock.calls.at(-1)![0];
    expect(String(arg.message)).toContain("connection refused");
  });
});

describe("卸载", () => {
  it("inst.uninstall() 摘除根节点", async () => {
    const sb = buildSandbox({ listResponse: okBody({ skills: SAMPLE_SKILLS }) });
    const inst = await installReady(sb);
    expect(sb.container.children.length).toBe(1);
    inst.uninstall();
    expect(sb.container.children.length).toBe(0);
    expect(inst.el.parentNode).toBeNull();
  });

  it("模块级 uninstall() 销毁最近视图，且重复调用幂等", async () => {
    const sb = buildSandbox({ listResponse: okBody({ skills: SAMPLE_SKILLS }) });
    const inst = await installReady(sb);
    sb.feature.uninstall();
    expect(inst.el.parentNode).toBeNull();
    expect(sb.container.children.length).toBe(0);
    // 幂等：再调不抛
    expect(() => sb.feature.uninstall()).not.toThrow();
  });

  it("destroy 关闭打开中的 modal", async () => {
    const sb = buildSandbox({
      listResponse: okBody({ skills: SAMPLE_SKILLS }),
      detailResponse: okBody({ skill: { ...SAMPLE_SKILLS[0], body: "正文" } }),
    });
    const inst = await installReady(sb);
    (inst.el as FakeElement)
      .querySelectorAll('[role="option"]')[0]!
      .dispatchEvent({ type: "click" });
    await flushPromises();
    expect(sb.body.querySelector(".skill-detail")).toBeTruthy();

    inst.destroy();
    expect(sb.mocks.modal.destroy).toHaveBeenCalled();
    expect(sb.body.querySelector(".skill-detail")).toBeNull();
  });
});
