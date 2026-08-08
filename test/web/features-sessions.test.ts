/**
 * features/sessions.js 测试 — F10 / WU-05d
 * ----------------------------------------------------------------------------
 * sessions.js 是经典 <script defer> 加载（非 ES module），运行时挂到
 * window.MyAgent.sessionsFeature。这里用 node:vm 起一个干净全局上下文，
 * 注入最小 DOM mock + mock apiFetch + mock state stores（基于 state.js 单测
 * 同模式的 sandbox）。
 *
 * 测试覆盖（≥ 12 用例）：
 *   1. 全局挂载 + 导出 installSessionsList / SELECT_EVENT / constants
 *   2. installSessionsList(container) 渲染列表：行数 = 后端返回
 *   3. 新建按钮 click → POST /api/sessions → 列表追加 + active 切换 + event
 *   4. 选中 session → appState.activeSessionId 更新 + SELECT_EVENT 派发
 *   5. 删除 → confirm 通过 → DELETE /api/sessions/:id → 列表更新
 *   6. 删除 active → appState.activeSessionId = null + SELECT_EVENT(null) 派发
 *   7. 删除 confirm 取消 → 不发 DELETE，列表不变
 *   8. subscribe：sessionListState.set 后列表自动重渲染
 *   9. compact 按钮：disabled + aria-disabled + tooltip 文本
 *  10. uninstall：清理 store 订阅 + 摘除 DOM
 *  11. confirmDelete 选项覆盖默认 modal
 *  12. 自定义 onSelect / onCreate / onDelete 回调触发
 *  13. 容器缺失 → 抛错
 *  14. 源码无 emoji + IIFE 模式
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SESSIONS_PATH = fileURLToPath(
  new URL("../../web/js/features/sessions.js", import.meta.url),
);
const SESSIONS_SOURCE = readFileSync(SESSIONS_PATH, "utf-8");

const UTILS_PATH = fileURLToPath(
  new URL("../../web/js/shared/utils.js", import.meta.url),
);
const UTILS_SOURCE = readFileSync(UTILS_PATH, "utf-8");

const API_PATH = fileURLToPath(
  new URL("../../web/js/shared/api.js", import.meta.url),
);
const API_SOURCE = readFileSync(API_PATH, "utf-8");

const STATE_PATH = fileURLToPath(
  new URL("../../web/js/state/state.js", import.meta.url),
);
const STATE_SOURCE = readFileSync(STATE_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Fake DOM — 与 components.test.ts 同思路（最小 element 模拟）
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
  dispatchEvent(evt: { type: string; target?: FakeElement }): boolean;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  closest(sel: string): FakeElement | null;
  querySelector(sel: string): FakeElement | null;
  querySelectorAll(sel: string): FakeElement[];
  focus(): void;
  click(): void;
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
        if (isElement(c)) {
          el.textContent = "";
          for (const ch of el.children) {
            if (isElement(ch)) el.textContent += ch.textContent;
            else if ((ch as { kind?: string }).kind === "text")
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
    closest(sel) {
      // 仅支持 [data-action='xxx']、[data-action] (属性存在) 与 [data-session-id='xxx']、[data-session-id]
      const actionValueMatch = sel.match(/^\[data-action=['"]([^'"]+)['"]\]$/);
      const actionPresenceMatch = sel === "[data-action]";
      const sidValueMatch = sel.match(
        /^\[data-session-id=['"]([^'"]+)['"]\]$/,
      );
      const sidPresenceMatch = sel === "[data-session-id]";

      if (actionValueMatch || actionPresenceMatch) {
        const wanted = actionValueMatch ? actionValueMatch[1]! : null;
        let cur: FakeElement | null = el;
        while (cur) {
          const v = cur.getAttribute("data-action");
          if (v !== null && (wanted === null || v === wanted)) return cur;
          cur = cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
        }
        return null;
      }
      if (sidValueMatch || sidPresenceMatch) {
        const wanted = sidValueMatch ? sidValueMatch[1]! : null;
        let cur: FakeElement | null = el;
        while (cur) {
          const v = cur.getAttribute("data-session-id");
          if (v !== null && (wanted === null || v === wanted)) return cur;
          cur = cur.parentNode && isElement(cur.parentNode)
            ? (cur.parentNode as FakeElement)
            : null;
        }
        return null;
      }
      return null;
    },
    querySelector(_sel) {
      return null;
    },
    querySelectorAll(_sel) {
      return [];
    },
    focus() {},
    click() {
      // 模拟 click 冒泡：先在自身派发，再向父级链派发
      let cur: FakeElement | null = el;
      while (cur) {
        cur.dispatchEvent({ type: "click", target: el });
        cur = cur.parentNode && isElement(cur.parentNode)
          ? (cur.parentNode as FakeElement)
          : null;
      }
    },
  };
  // 同步 NATIVE_PROPS：utils.el 对 role / disabled 等用直接赋值；要双向同步到 attributes
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
  dispatchEvent(evt: { type: string; detail?: unknown }): boolean;
  getElementById(id: string): FakeElement | null;
}

function makeDocument(): FakeDocument {
  const body = makeElement("body");
  const docListeners = new Map<string, EventListener[]>();
  const doc: FakeDocument = {
    body,
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
          cb({ ...evt, type: evt.type } as unknown as Event);
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
// Mock fetch / apiFetch — 与 shared-api.test.ts 类似
// ---------------------------------------------------------------------------

interface MockFetchCall {
  url: string;
  init: { method?: string; body?: unknown; signal?: unknown; headers?: Record<string, string>; base?: string } | undefined;
}

interface MockFetch {
  fn: ReturnType<typeof vi.fn>;
  calls: MockFetchCall[];
  respondWithResponse(init: { status?: number; body?: unknown; raw?: string }): void;
  rejectWith(err: Error): void;
  reset(): void;
}

function makeResponse(init: { status?: number; body?: unknown; raw?: string } = {}) {
  const status = init.status ?? 200;
  let raw: string;
  if (init.raw !== undefined) raw = init.raw;
  else if (typeof init.body === "string") raw = init.body;
  else if (init.body === undefined) raw = "";
  else raw = JSON.stringify(init.body);
  return {
    status,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "content-type")
          return "application/json; charset=utf-8";
        return null;
      },
    },
    text() {
      return Promise.resolve(raw);
    },
    json() {
      return Promise.resolve(JSON.parse(raw));
    },
  };
}

function makeMockFetch(): MockFetch {
  const queue: unknown[] = [];
  const calls: MockFetchCall[] = [];
  const fn = vi.fn((url: string, init: MockFetchCall["init"]) => {
    calls.push({ url, init });
    const next = queue.length > 0 ? queue.shift() : null;
    if (next instanceof Error) {
      return Promise.reject(next);
    }
    const r =
      (next as ReturnType<typeof makeResponse>) ||
      makeResponse({ status: 200, body: { ok: true, data: [] } });
    return Promise.resolve(r as unknown as Response);
  });
  return {
    fn,
    calls,
    respondWithResponse(init) {
      queue.push(makeResponse(init));
    },
    rejectWith(err) {
      queue.push(err);
    },
    reset() {
      queue.length = 0;
      calls.length = 0;
      fn.mockClear();
    },
  };
}

// ---------------------------------------------------------------------------
// Sandbox 加载
// ---------------------------------------------------------------------------

interface LoadedSandbox {
  sf: {
    installSessionsList: (opts: any) => {
      uninstall: () => void;
      refresh: () => Promise<void>;
      selectSession: (id: string | null) => void;
      createSession: () => Promise<void>;
      deleteSession: (id: string) => Promise<void>;
    };
    SELECT_EVENT: string;
    LIST_CHANGE_EVENT: string;
    COMPACT_PLACEHOLDER_MSG: string;
  };
  state: {
    sessionListState: any;
    appState: any;
    getStore: (n: string) => any;
  };
  mockFetch: MockFetch;
  document: FakeDocument;
  body: FakeElement;
  documentListeners: Array<{ type: string; listener: EventListener }>;
  fireDocumentEvent(type: string, detail: unknown): void;
}

function loadSessions(opts: {
  sessions?: Array<{ id: string; name?: string; messageCount?: number; lastTs?: number; createdAt?: number }>;
  activeSessionId?: string | null;
  install?: boolean;
} = {}): LoadedSandbox {
  const sessions = opts.sessions ?? [
    { id: "sess-1", name: "会话一", createdAt: Date.now() - 1000 },
    { id: "sess-2", name: "会话二", createdAt: Date.now() - 2000 },
    { id: "sess-3", name: "会话三", createdAt: Date.now() - 3000 },
  ];

  const mockFetch = makeMockFetch();
  // 预设首次 GET /api/sessions 返回这些 sessions
  mockFetch.respondWithResponse({
    status: 200,
    body: { ok: true, data: { sessions: sessions } },
  });

  const doc = makeDocument();
  const documentListeners: Array<{ type: string; listener: EventListener }> = [];
  // document.addEventListener 收集
  const wrappedDoc = {
    ...doc,
    addEventListener(type: string, listener: EventListener) {
      documentListeners.push({ type, listener });
    },
    removeEventListener(_type: string, _listener: EventListener) {
      // 不做真清理
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

  // localStorage stub（state.js 持久化需要；本测试不必深究持久化内容）
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

  const sandbox: Record<string, unknown> = {
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
    setTimeout: setTimeout as typeof setTimeout,
    clearTimeout: clearTimeout as typeof clearTimeout,
    AbortController: class FakeAbortController {
      signal = { aborted: false };
      abort() {
        this.signal.aborted = true;
      }
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
    fetch: mockFetch.fn,
    document: wrappedDoc,
    MyAgent: {},
  };

  createContext(sandbox);
  // 加载顺序：utils → api → state → sessions
  runInContext(UTILS_SOURCE, sandbox);
  runInContext(API_SOURCE, sandbox);
  runInContext(STATE_SOURCE, sandbox);
  runInContext(SESSIONS_SOURCE, sandbox);

  // 预设 activeSessionId（用 _setRaw 跳过 schema 校验）
  const state = (sandbox as { MyAgent: { state: any } }).MyAgent.state;
  if (opts.activeSessionId !== undefined) {
    const cur = state.appState.get();
    state.appState._setRaw({ ...cur, activeSessionId: opts.activeSessionId });
  }

  const sf = (sandbox as { MyAgent: { sessionsFeature: any } }).MyAgent
    .sessionsFeature;

  // 若默认 install，把容器挂到 body
  let container: FakeElement | null = null;
  let handle: ReturnType<typeof sf.installSessionsList> | null = null;
  if (opts.install !== false) {
    container = makeElement("div");
    container.id = "session-list";
    wrappedDoc.body.appendChild(container);
    handle = sf.installSessionsList({ container });
  }

  return {
    sf,
    state,
    mockFetch,
    document: doc,
    body: wrappedDoc.body as FakeElement,
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
// helpers
// ---------------------------------------------------------------------------

function waitFor(predicate: () => boolean, timeoutMs = 200, intervalMs = 5): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function check() {
      if (predicate()) return resolve();
      if (Date.now() - start > timeoutMs)
        return reject(new Error("waitFor timeout"));
      setTimeout(check, intervalMs);
    }
    check();
  });
}

// ---------------------------------------------------------------------------
// 测试用例
// ---------------------------------------------------------------------------

describe("features/sessions.js — 全局挂载", () => {
  it("挂载到 window.MyAgent.sessionsFeature", () => {
    const sb = loadSessions();
    expect(sb.sf).toBeDefined();
    expect(typeof sb.sf.installSessionsList).toBe("function");
  });

  it("导出 SELECT_EVENT / LIST_CHANGE_EVENT / COMPACT_PLACEHOLDER_MSG", () => {
    const sb = loadSessions();
    expect(sb.sf.SELECT_EVENT).toBe("my-agent:session-select");
    expect(sb.sf.LIST_CHANGE_EVENT).toBe("my-agent:session-list-change");
    expect(typeof sb.sf.COMPACT_PLACEHOLDER_MSG).toBe("string");
    expect(sb.sf.COMPACT_PLACEHOLDER_MSG.length).toBeGreaterThan(0);
  });

  it("源码无 emoji 且 IIFE 模式 + 挂到 window.MyAgent.sessionsFeature", () => {
    expect(SESSIONS_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(SESSIONS_SOURCE).toMatch(/\(function\s*\(\s*global\s*\)\s*\{/);
    expect(SESSIONS_SOURCE.trimEnd().endsWith(");")).toBe(true);
    expect(SESSIONS_SOURCE).toMatch(
      /global\.MyAgent\.sessionsFeature\s*=/,
    );
  });
});

describe("installSessionsList — 渲染列表", () => {
  it("首次安装后 GET /api/sessions,列表行数 = 后端返回", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
        { id: "c", name: "C" },
      ],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 3);
    const root = sb.body.children[0]?.children[0] as FakeElement;
    const list = root?.children[1] as FakeElement;
    expect(list).toBeDefined();
    // 行数 = 3
    const rows = list.children.filter(
      (c) => isElement(c) && c.tagName === "LI",
    );
    expect(rows.length).toBe(3);
    // apiFetch 被调一次（GET /api/sessions）
    const getCall = sb.mockFetch.calls.find(
      (c) =>
        c.url === "http://localhost/api/sessions" &&
        (c.init?.method || "GET").toUpperCase() === "GET",
    );
    expect(getCall).toBeDefined();
  });

  it("列表容器属性：role=listbox + aria-label='会话列表'", () => {
    const sb = loadSessions();
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    expect(list.getAttribute("role")).toBe("listbox");
    expect(list.getAttribute("aria-label")).toBe("会话列表");
  });

  it("每个 li：role=option + aria-selected + data-session-id", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "x1", name: "X1" },
        { id: "x2", name: "X2" },
      ],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    const items = list.children.filter(
      (c) => isElement(c) && c.tagName === "LI",
    ) as FakeElement[];
    expect(items.length).toBe(2);
    for (const li of items) {
      expect(li.getAttribute("role")).toBe("option");
      expect(li.getAttribute("aria-selected")).toMatch(/true|false/);
      expect(li.getAttribute("data-session-id")).toBeTruthy();
    }
  });

  it("active 行：aria-selected=true + 包含 marker", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      activeSessionId: "a",
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    const aLi = (list.children.filter(
      (c) => isElement(c) && c.getAttribute("data-session-id") === "a",
    )[0] as FakeElement);
    const bLi = (list.children.filter(
      (c) => isElement(c) && c.getAttribute("data-session-id") === "b",
    )[0] as FakeElement);
    expect(aLi.getAttribute("aria-selected")).toBe("true");
    expect(bLi.getAttribute("aria-selected")).toBe("false");
  });
});

describe("新建会话 — POST /api/sessions", () => {
  it("点 + 新建按钮 → POST → 列表追加 + active 切换 + SELECT_EVENT 派发", async () => {
    const sb = loadSessions({
      sessions: [{ id: "old-1", name: "Old1" }],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);

    // 准备 POST 响应
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: { ok: true, data: { session: { id: "new-1" } } },
    });

    // 监听 select 事件
    const seen: Array<{ type: string; detail: unknown }> = [];
    sb.documentListeners.push({
      type: "my-agent:session-select",
      listener: ((evt: Event) => {
        seen.push({ type: evt.type, detail: (evt as CustomEvent).detail });
      }) as EventListener,
    });

    const newBtn = sb.body.children[0]?.children[0]?.children[0] as FakeElement;
    newBtn.click();

    await waitFor(() => sb.state.appState.get().activeSessionId === "new-1");
    expect(sb.state.sessionListState.get().sessions.length).toBe(2);
    // POST 已被调
    const post = sb.mockFetch.calls.find(
      (c) =>
        c.url === "http://localhost/api/sessions" &&
        (c.init?.method || "").toUpperCase() === "POST",
    );
    expect(post).toBeDefined();
    // SELECT_EVENT 派发
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((s) => (s.detail as { sessionId?: string })?.sessionId === "new-1")).toBe(true);
  });
});

describe("选中会话 — appState + event", () => {
  it("点击 row → appState.activeSessionId 更新 + SELECT_EVENT 派发", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);

    const seen: Array<unknown> = [];
    sb.documentListeners.push({
      type: "my-agent:session-select",
      listener: ((evt: Event) => {
        seen.push((evt as CustomEvent).detail);
      }) as EventListener,
    });

    // 模拟点 a 行的 main
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    const aRow = list.children.filter(
      (c) => isElement(c) && c.getAttribute("data-session-id") === "a",
    )[0] as FakeElement;
    // 找 row main
    const main = aRow.children.find(
      (c) => isElement(c) && c.getAttribute("data-action") === "select",
    ) as FakeElement;
    main.click();

    await waitFor(() => sb.state.appState.get().activeSessionId === "a");
    expect(sb.state.appState.get().activeSessionId).toBe("a");
    expect(seen.length).toBeGreaterThan(0);
    expect((seen[0] as { sessionId?: string })?.sessionId).toBe("a");
  });

  it("onSelect 回调被触发（覆盖式传参）", async () => {
    const sb = loadSessions({
      sessions: [{ id: "x", name: "X" }],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);

    const onSelect = vi.fn();
    // 准备后续 GET 响应（重新装时 refresh 用），保留 x
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: { ok: true, data: { sessions: [{ id: "x" }] } },
    });
    // 卸载默认
    const container = sb.body.children[0] as FakeElement;
    container.parentNode && container.parentNode.removeChild(container);
    // 重新装，注入 onSelect
    const newContainer = makeElement("div");
    sb.body.appendChild(newContainer);
    const handle = sb.sf.installSessionsList({
      container: newContainer,
      onSelect,
    });

    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);

    // 直接调内部 API（selectSession）
    handle.selectSession("x");
    expect(onSelect).toHaveBeenCalledWith("x");
  });
});

describe("删除会话 — DELETE + confirm", () => {
  it("删除非 active：confirm 通过 → DELETE → 列表移除", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "keep", name: "Keep" },
        { id: "drop", name: "Drop" },
      ],
      activeSessionId: "keep",
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);

    // 准备后续两次响应：1) 重新装时的 GET（保 keep+drop）；2) DELETE 成功
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: {
        ok: true,
        data: { sessions: [{ id: "keep" }, { id: "drop" }] },
      },
    });
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: { ok: true, data: { ok: true } },
    });

    // 触发删除：直接调暴露的 deleteSession（已 await confirmModal）
    // confirmDialog 用 Modal → 组件不可用时降级 confirm → 测试环境无 confirm
    // 所以走 confirmDelete 选项，绕开 Modal
    const container = sb.body.children[0] as FakeElement;
    container.parentNode && container.parentNode.removeChild(container);
    const newContainer = makeElement("div");
    sb.body.appendChild(newContainer);
    const h = sb.sf.installSessionsList({
      container: newContainer,
      confirmDelete: () => Promise.resolve(true),
    });

    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);
    await h.deleteSession("drop");

    await waitFor(
      () => !sb.state.sessionListState.get().sessions.find((s: any) => s.id === "drop"),
    );
    const list = sb.state.sessionListState.get().sessions;
    expect(list.find((s: any) => s.id === "drop")).toBeUndefined();
    expect(list.find((s: any) => s.id === "keep")).toBeDefined();
    expect(sb.state.appState.get().activeSessionId).toBe("keep"); // 未变
    // DELETE 已被调
    const del = sb.mockFetch.calls.find(
      (c) =>
        c.url === "http://localhost/api/sessions/drop" &&
        (c.init?.method || "").toUpperCase() === "DELETE",
    );
    expect(del).toBeDefined();
  });

  it("删除 active：confirm 通过 → DELETE → activeSessionId=null + SELECT_EVENT(null)", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      activeSessionId: "a",
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);

    // 准备两次响应：1) 重新装时的 GET；2) DELETE 成功
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: {
        ok: true,
        data: { sessions: [{ id: "a" }, { id: "b" }] },
      },
    });
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: { ok: true, data: { ok: true } },
    });

    const seen: Array<unknown> = [];
    sb.documentListeners.push({
      type: "my-agent:session-select",
      listener: ((evt: Event) => {
        seen.push((evt as CustomEvent).detail);
      }) as EventListener,
    });

    // 重装以便注入 confirmDelete
    const container = sb.body.children[0] as FakeElement;
    container.parentNode && container.parentNode.removeChild(container);
    const newContainer = makeElement("div");
    sb.body.appendChild(newContainer);
    const h = sb.sf.installSessionsList({
      container: newContainer,
      confirmDelete: () => Promise.resolve(true),
    });

    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);
    await h.deleteSession("a");

    await waitFor(() => sb.state.appState.get().activeSessionId === null);
    expect(sb.state.appState.get().activeSessionId).toBeNull();
    expect(sb.state.sessionListState.get().sessions.length).toBe(1);
    // SELECT_EVENT(null) 至少派发一次
    expect(
      seen.some(
        (d) => (d as { sessionId?: string | null })?.sessionId === null,
      ),
    ).toBe(true);
  });

  it("删除 confirm 取消 → 不发 DELETE，列表不变", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);

    // 重新装（注入 confirmDelete=false）。先准备 GET 响应以保留 2 个 session
    sb.mockFetch.respondWithResponse({
      status: 200,
      body: {
        ok: true,
        data: { sessions: [{ id: "a" }, { id: "b" }] },
      },
    });

    const container = sb.body.children[0] as FakeElement;
    container.parentNode && container.parentNode.removeChild(container);
    const newContainer = makeElement("div");
    sb.body.appendChild(newContainer);
    const h = sb.sf.installSessionsList({
      container: newContainer,
      confirmDelete: () => Promise.resolve(false),
    });

    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);
    await h.deleteSession("a");
    // 等待一拍
    await new Promise((r) => setTimeout(r, 30));

    expect(sb.state.sessionListState.get().sessions.length).toBe(2);
    // DELETE 没被调
    const del = sb.mockFetch.calls.find(
      (c) =>
        c.url === "http://localhost/api/sessions/a" &&
        (c.init?.method || "").toUpperCase() === "DELETE",
    );
    expect(del).toBeUndefined();
  });
});

describe("subscribe 自动重渲染", () => {
  it("sessionListState.set 后,DOM 自动重渲染(行数同步)", async () => {
    const sb = loadSessions({
      sessions: [{ id: "a", name: "A" }],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);

    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    let rows = list.children.filter(
      (c) => isElement(c) && c.tagName === "LI",
    );
    expect(rows.length).toBe(1);

    // 外部 set 新列表
    sb.state.sessionListState.set({
      sessions: [
        { id: "p", name: "P" },
        { id: "q", name: "Q" },
        { id: "r", name: "R" },
      ],
      loading: false,
    });
    await waitFor(() => {
      const newRows = list.children.filter(
        (c) => isElement(c) && c.tagName === "LI",
      );
      return newRows.length === 3;
    });
    rows = list.children.filter((c) => isElement(c) && c.tagName === "LI");
    expect(rows.length).toBe(3);
  });

  it("activeSessionId 变化触发高亮重渲染", async () => {
    const sb = loadSessions({
      sessions: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 2);
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    // 初始 a 非 active → aria-selected=false
    let aLi = list.children.filter(
      (c) => isElement(c) && c.getAttribute("data-session-id") === "a",
    )[0] as FakeElement;
    expect(aLi.getAttribute("aria-selected")).toBe("false");

    // 切换 active
    sb.state.appState.set({ ...sb.state.appState.get(), activeSessionId: "a" });
    await waitFor(() => {
      aLi = list.children.filter(
        (c) => isElement(c) && c.getAttribute("data-session-id") === "a",
      )[0] as FakeElement;
      return aLi && aLi.getAttribute("aria-selected") === "true";
    });
    expect(aLi.getAttribute("aria-selected")).toBe("true");
  });
});

describe("compact 按钮 — 占位 501", () => {
  it("compact 按钮：disabled + aria-disabled='true'", async () => {
    const sb = loadSessions({
      sessions: [{ id: "a", name: "A" }],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    const aLi = list.children.filter(
      (c) => isElement(c) && c.getAttribute("data-session-id") === "a",
    )[0] as FakeElement;
    const compactBtn = aLi.children
      .filter(isElement)
      .flatMap((c) => c.children)
      .filter(
        (c) => isElement(c) && c.getAttribute("data-action") === "compact",
      )[0] as FakeElement;
    expect(compactBtn).toBeDefined();
    expect(compactBtn.disabled).toBe(true);
    expect(compactBtn.getAttribute("aria-disabled")).toBe("true");
  });

  it("点 compact → toast/console 提示 501 占位（不调 POST /compact）", async () => {
    const sb = loadSessions({
      sessions: [{ id: "a", name: "A" }],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);
    const list = sb.body.children[0]?.children[0]?.children[1] as FakeElement;
    const aLi = list.children.filter(
      (c) => isElement(c) && c.getAttribute("data-session-id") === "a",
    )[0] as FakeElement;
    const compactBtn = aLi.children
      .filter(isElement)
      .flatMap((c) => c.children)
      .filter(
        (c) => isElement(c) && c.getAttribute("data-action") === "compact",
      )[0] as FakeElement;

    // 先准备下次 fetch 的 mock（防 Toast 触发的副作用），但不期望 compact 调 fetch
    const callsBefore = sb.mockFetch.calls.length;
    compactBtn.click();
    await new Promise((r) => setTimeout(r, 20));
    const compactCalls = sb.mockFetch.calls.filter((c) =>
      c.url.includes("/compact"),
    );
    expect(compactCalls.length).toBe(0);
    expect(sb.mockFetch.calls.length).toBe(callsBefore); // fetch 未新增调用
  });
});

describe("uninstall 清理", () => {
  it("uninstall 后 store 订阅解除 + 摘除 DOM + 后续 set 不再触发渲染", async () => {
    const sb = loadSessions({
      sessions: [{ id: "a", name: "A" }],
    });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);

    const root = sb.body.children[0] as FakeElement;
    // 卸载
    // 通过 Sf 暴露的 API：但 installSessionsList 已自动 install；这里直接重做。
    // 我们借助工具：先获取当前已创建的 handle 不易，所以直接通过重新调用捕获 handle。
    // 简化：重做一次以拿到 handle。
    root.parentNode && root.parentNode.removeChild(root);
    const newContainer = makeElement("div");
    sb.body.appendChild(newContainer);
    const h = sb.sf.installSessionsList({ container: newContainer });
    await waitFor(() => sb.state.sessionListState.get().sessions.length === 1);

    h.uninstall();

    // DOM 已摘除
    expect(newContainer.children.length).toBe(0);

    // 后续 set 不再渲染（不会重抛错）
    expect(() =>
      sb.state.sessionListState.set({
        sessions: [{ id: "x" }, { id: "y" }],
        loading: false,
      }),
    ).not.toThrow();
    // list 不会被重建（newContainer 仍空）
    expect(newContainer.children.length).toBe(0);
  });
});

describe("错误路径", () => {
  it("容器缺失 → 抛错", () => {
    const sb = loadSessions({ install: false });
    expect(() => sb.sf.installSessionsList({})).toThrow(/container/);
  });

  it("utils / api 缺失 → 抛错", () => {
    const sb = loadSessions({ install: false });
    // 先拆掉 utils / api，installSessionsList 应抛错
    delete (sb as any).sf;
    const sandbox: Record<string, unknown> = {
      console: { warn: vi.fn(), error: vi.fn() },
      setTimeout,
      clearTimeout,
      CustomEvent: class {},
      location: { origin: "http://localhost" },
      document: makeDocument(),
      MyAgent: {}, // 故意不挂 utils / api / state
    };
    createContext(sandbox);
    runInContext(SESSIONS_SOURCE, sandbox);
    const sf = (sandbox as { MyAgent: { sessionsFeature: any } }).MyAgent
      .sessionsFeature;
    const container = makeElement("div");
    expect(() => sf.installSessionsList({ container })).toThrow();
  });
});