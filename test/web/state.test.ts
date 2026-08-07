/**
 * state.js 测试 — F5 / WU-04b
 * ----------------------------------------------------------------------------
 * state.js 是经典 <script defer> 加载（非 ES module），运行时挂到 window.MyAgent.state。
 * 这里用 node:vm 起一个干净的全局上下文，注入 localStorage / AbortController /
 * CustomEvent 等最小 mock。state.js 自身零依赖（自带 debounce / validate），
 * 不需要引 utils.js / api.js。
 *
 * 测试结构：
 *   1. 全局挂载 + 6 个内置 store + FifoQueue 导出
 *   2. createStore 基础(get / set / update / subscribe / reset / name)
 *   3. subscribe 返回 unsubscribe(幂等)
 *   4. 持久化(localStorage round-trip + 重启恢复)
 *   5. 持久化节流(连续 set N 次只写 1 次 localStorage — fake timers)
 *   6. FifoQueue(push / shift / peek / drain / size / 满后丢老)
 *   7. 多 store 隔离 + 同名重复创建抛错
 *   8. schema 校验(失败抛 ValidationError + 不写入)
 *   9. chatState 流控(streaming 时 push 拒绝)
 *  10. ValidationError 形态(name / code / errors[])
 *  11. reset() 清持久化
 *  12. 边界(null/undefined / 空 schema / 深对象)
 *
 * 目标：≥ 18 用例。
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const STATE_PATH = fileURLToPath(
  new URL("../../web/js/state/state.js", import.meta.url),
);
const STATE_SOURCE = readFileSync(STATE_PATH, "utf-8");

// ---------------------------------------------------------------------------
// Sandbox 工厂：每次 create 一个干净全局 + 干净 localStorage
// ---------------------------------------------------------------------------

interface FakeStorage {
  data: Map<string, string>;
  getItem: (k: string) => string | null;
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
  clear: () => void;
  key: (i: number) => string | null;
  get length(): number;
}

function createFakeStorage(initial?: Record<string, string>): FakeStorage {
  const data = new Map<string, string>();
  if (initial) {
    for (const k of Object.keys(initial)) data.set(k, initial[k]!);
  }
  return {
    data,
    getItem: (k) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k, v) => {
      data.set(k, String(v));
    },
    removeItem: (k) => {
      data.delete(k);
    },
    clear: () => {
      data.clear();
    },
    key: (i) => Array.from(data.keys())[i] ?? null,
    get length() {
      return data.size;
    },
  };
}

interface LoadedState {
  state: {
    createStore: (opts: any) => any;
    getStore: (name: string) => any;
    listStores: () => string[];
    appState: any;
    chatState: any;
    providerState: any;
    sessionListState: any;
    agentState: any;
    settingsState: any;
    pushMessage: (msg: unknown) => void;
    beginStream: (opts?: any) => void;
    endStream: () => void;
    FifoQueue: new (capacity?: number) => any;
    ValidationError: new (...args: any[]) => Error & {
      name: string;
      code: string;
      errors: unknown[];
    };
    _validate: (value: unknown, schema: unknown) => any;
    _PERSIST_DEBOUNCE_MS: number;
    _FIFO_DEFAULT_CAPACITY: number;
  };
  storage: FakeStorage;
  setStorageSpy: ReturnType<typeof vi.fn>;
}

function loadState(opts: { initialStorage?: Record<string, string> } = {}): LoadedState {
  const storage = createFakeStorage(opts.initialStorage);
  const setStorageSpy = vi.fn((k: string, v: string) => {
    storage.setItem(k, v);
  });
  // 用 spy 包一层,方便断言「写入次数」
  const spiedStorage = {
    data: storage.data,
    getItem: storage.getItem,
    setItem: setStorageSpy,
    removeItem: storage.removeItem,
    clear: storage.clear,
    key: storage.key,
    get length() {
      return storage.data.size;
    },
  };

  const sandbox: Record<string, unknown> = {
    localStorage: spiedStorage,
    console: { warn: vi.fn(), error: vi.fn(), log: vi.fn() },
    setTimeout,
    clearTimeout,
    AbortController: class FakeAbortController {
      signal: { aborted: boolean };
      constructor() {
        this.signal = { aborted: false };
      }
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
    MyAgent: {},
  };

  createContext(sandbox);
  runInContext(STATE_SOURCE, sandbox);

  const state = (sandbox as { MyAgent: { state: LoadedState["state"] } }).MyAgent.state;
  return { state, storage, setStorageSpy };
}

// ======================================================================
// 1. 全局挂载 + 内置 store + FifoQueue
// ======================================================================

describe("state.js — 全局挂载", () => {
  it("挂载到 window.MyAgent.state", () => {
    const { state } = loadState();
    expect(state).toBeDefined();
    expect(typeof state.createStore).toBe("function");
    expect(typeof state.getStore).toBe("function");
    expect(typeof state.listStores).toBe("function");
  });

  it("导出 6 个内置 store", () => {
    const { state } = loadState();
    expect(state.appState).toBeDefined();
    expect(state.chatState).toBeDefined();
    expect(state.providerState).toBeDefined();
    expect(state.sessionListState).toBeDefined();
    expect(state.agentState).toBeDefined();
    expect(state.settingsState).toBeDefined();
  });

  it("导出 FifoQueue / ValidationError / 流控方法", () => {
    const { state } = loadState();
    expect(typeof state.FifoQueue).toBe("function");
    expect(typeof state.ValidationError).toBe("function");
    expect(typeof state.pushMessage).toBe("function");
    expect(typeof state.beginStream).toBe("function");
    expect(typeof state.endStream).toBe("function");
  });

  it("源码无 emoji 且无 import / require", () => {
    expect(STATE_SOURCE).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(STATE_SOURCE).not.toMatch(/^\s*import\s/m);
    expect(STATE_SOURCE).not.toMatch(/\brequire\s*\(/);
  });
});

describe("内置 store — 默认 initial 值", () => {
  it("appState 默认值", () => {
    const { state } = loadState();
    const v = state.appState.get();
    expect(v.activeView).toBe("main-menu");
    expect(v.activeSessionId).toBe(null);
    expect(v.sidebarOpen).toBe(true);
    expect(v.modalStack).toEqual([]);
  });

  it("chatState 默认值", () => {
    const { state } = loadState();
    const v = state.chatState.get();
    expect(v.messages).toEqual([]);
    expect(v.streaming).toBe(false);
    expect(v.abortController).toBe(null);
    expect(v.streamId).toBe(null);
  });

  it("settingsState 默认值 + 持久化 key", () => {
    const { state } = loadState();
    const v = state.settingsState.get();
    expect(v.theme).toBe("system");
    expect(v.lang).toBe("zh-CN");
    expect(v.model).toBe(null);
  });
});

// ======================================================================
// 2. createStore 基础 + 隔离
// ======================================================================

describe("createStore — 基础", () => {
  it("get / set 读写", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "test-basic", initial: { a: 1 } });
    expect(s.get()).toEqual({ a: 1 });
    s.set({ a: 2 });
    expect(s.get()).toEqual({ a: 2 });
  });

  it("update(fn) 用旧值算新值", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "test-update", initial: { count: 0 } });
    s.update((old: { count: number }) => ({ count: old.count + 1 }));
    s.update((old: { count: number }) => ({ count: old.count + 1 }));
    expect(s.get()).toEqual({ count: 2 });
  });

  it("reset() 恢复 initial", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "test-reset", initial: { x: "init" } });
    s.set({ x: "changed" });
    expect(s.get()).toEqual({ x: "changed" });
    s.reset();
    expect(s.get()).toEqual({ x: "init" });
  });

  it("缺 name / initial → 抛错", () => {
    const { state } = loadState();
    expect(() =>
      state.createStore({ initial: {} } as never),
    ).toThrow(/name/);
    expect(() =>
      state.createStore({ name: "x" } as never),
    ).toThrow(/initial/);
  });

  it("同名重复创建 → 抛错", () => {
    const { state } = loadState();
    state.createStore({ name: "dup", initial: {} });
    expect(() => state.createStore({ name: "dup", initial: {} })).toThrow(
      /already exists/,
    );
  });

  it("getStore / listStores 注册中心", () => {
    const { state } = loadState();
    state.createStore({ name: "reg-a", initial: 1 });
    state.createStore({ name: "reg-b", initial: 2 });
    expect(state.listStores()).toEqual(expect.arrayContaining(["reg-a", "reg-b"]));
    const a = state.getStore("reg-a");
    expect(a).not.toBeNull();
    expect(a.get()).toBe(1);
    expect(state.getStore("nonexistent")).toBeNull();
  });
});

// ======================================================================
// 3. subscribe + unsubscribe
// ======================================================================

describe("subscribe — 订阅 + 返回 unsubscribe", () => {
  it("set 触发订阅者,listener 接收 (newValue, oldValue)", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "sub", initial: { v: 0 } });
    const cb = vi.fn();
    s.subscribe(cb);

    s.set({ v: 1 });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ v: 1 }, { v: 0 });

    s.set({ v: 2 });
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenLastCalledWith({ v: 2 }, { v: 1 });
  });

  it("unsubscribe 调用一次即解除,后续 set 不再触发", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "sub-off", initial: 0 });
    const cb = vi.fn();
    const off = s.subscribe(cb);
    s.set(1);
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    s.set(2);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("unsubscribe 幂等(多次调用安全)", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "sub-idem", initial: 0 });
    const off = s.subscribe(() => {});
    expect(() => {
      off();
      off();
      off();
    }).not.toThrow();
  });

  it("listener 内抛错不阻断后续 listener", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "sub-throw", initial: 0 });
    const cb1 = vi.fn(() => {
      throw new Error("listener boom");
    });
    const cb2 = vi.fn();
    s.subscribe(cb1);
    s.subscribe(cb2);
    s.set(1);
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });
});

// ======================================================================
// 4. 持久化 + 5. 节流
// ======================================================================

describe("持久化 — localStorage round-trip", () => {
  it("set 后 debounce 触发 localStorage.setItem", async () => {
    const { state, setStorageSpy } = loadState();
    const s = state.createStore({
      name: "persist-basic",
      initial: { x: 0 },
      persistKey: "test.persist.basic",
    });

    s.set({ x: 1 });
    // debounce 200ms 内未触发
    expect(setStorageSpy).not.toHaveBeenCalled();
    // advance 200ms
    await new Promise((r) => setTimeout(r, 210));
    expect(setStorageSpy).toHaveBeenCalledTimes(1);
    expect(setStorageSpy.mock.calls[0]?.[0]).toBe("test.persist.basic");
    const written = JSON.parse(setStorageSpy.mock.calls[0]?.[1] as string);
    expect(written).toEqual({ x: 1 });
  });

  it("重启 → 从 localStorage 恢复(新 store 实例读到旧值)", async () => {
    // 先在 sandbox 1 中创建 store + 写入,等待 debounce 触发
    const first = loadState();
    const s1 = first.state.createStore({
      name: "persist-rt",
      initial: { v: "init" },
      persistKey: "test.persist.rt",
    });
    s1.set({ v: "persisted" });
    await new Promise((r) => setTimeout(r, 210));
    expect(first.storage.getItem("test.persist.rt")).not.toBeNull();

    // 在 sandbox 2 中预先注入相同 key,然后加载 state.js
    const second = loadState({
      initialStorage: { "test.persist.rt": JSON.stringify({ v: "persisted" }) },
    });
    const s2 = second.state.createStore({
      name: "persist-rt-2", // 不同 name,避免同名重复
      initial: { v: "init" },
      persistKey: "test.persist.rt",
    });
    expect(s2.get()).toEqual({ v: "persisted" });
  });

  it("持久化值 schema 校验失败 → 回退到 initial", () => {
    const { state } = loadState({
      initialStorage: {
        "test.persist.bad": JSON.stringify({ wrong: "shape" }),
      },
    });
    const s = state.createStore({
      name: "persist-bad",
      initial: { x: 0 },
      persistKey: "test.persist.bad",
      schema: {
        type: "object",
        required: ["x"],
      },
    });
    expect(s.get()).toEqual({ x: 0 });
  });

  it("持久化值 JSON.parse 失败 → 回退到 initial(不删存储)", () => {
    const { state, storage } = loadState({
      initialStorage: { "test.persist.broken": "not-json{{{" },
    });
    const s = state.createStore({
      name: "persist-broken",
      initial: { x: 1 },
      persistKey: "test.persist.broken",
    });
    expect(s.get()).toEqual({ x: 1 });
    // 损坏的存储保留(避免误删)
    expect(storage.getItem("test.persist.broken")).toBe("not-json{{{");
  });

  it("reset() 清掉 localStorage", async () => {
    const { state, storage } = loadState();
    const s = state.createStore({
      name: "persist-reset",
      initial: { x: 0 },
      persistKey: "test.persist.reset",
    });
    s.set({ x: 9 });
    await new Promise((r) => setTimeout(r, 210));
    expect(storage.getItem("test.persist.reset")).not.toBeNull();
    s.reset();
    expect(storage.getItem("test.persist.reset")).toBeNull();
  });
});

describe("持久化 — debounce 节流(连续 N 次只写 1 次)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("连续 100 次 set → 只触发 1 次 localStorage.setItem", () => {
    const { state, setStorageSpy } = loadState();
    const s = state.createStore({
      name: "throttle",
      initial: 0,
      persistKey: "test.throttle",
    });

    for (let i = 1; i <= 100; i++) {
      s.set(i);
    }
    expect(setStorageSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(199);
    expect(setStorageSpy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setStorageSpy).toHaveBeenCalledTimes(1);
    // 写入的是最后一次的值
    const written = JSON.parse(setStorageSpy.mock.calls[0]?.[1] as string);
    expect(written).toBe(100);
  });

  it("debounce 间隔结束后再次 set → 重新计时", () => {
    const { state, setStorageSpy } = loadState();
    const s = state.createStore({
      name: "throttle-restart",
      initial: 0,
      persistKey: "test.throttle.restart",
    });

    s.set(1);
    vi.advanceTimersByTime(200);
    expect(setStorageSpy).toHaveBeenCalledTimes(1);

    s.set(2);
    vi.advanceTimersByTime(100);
    expect(setStorageSpy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(setStorageSpy).toHaveBeenCalledTimes(2);
  });
});

// ======================================================================
// 6. FifoQueue
// ======================================================================

describe("FifoQueue — 基本行为", () => {
  it("push / shift / peek", () => {
    const { state } = loadState();
    const q = new state.FifoQueue(10);
    expect(q.size()).toBe(0);
    expect(q.isEmpty()).toBe(true);

    q.push("a").push("b").push("c");
    expect(q.size()).toBe(3);
    expect(q.peek()).toBe("a");

    expect(q.shift()).toBe("a");
    expect(q.shift()).toBe("b");
    expect(q.peek()).toBe("c");
  });

  it("drain 清空并返回全部", () => {
    const { state } = loadState();
    const q = new state.FifoQueue(10);
    q.push(1).push(2).push(3);
    expect(q.drain()).toEqual([1, 2, 3]);
    expect(q.size()).toBe(0);
    expect(q.isEmpty()).toBe(true);
  });

  it("空队列 shift / peek → undefined", () => {
    const { state } = loadState();
    const q = new state.FifoQueue(5);
    expect(q.shift()).toBeUndefined();
    expect(q.peek()).toBeUndefined();
  });

  it("容量满后 push 丢老(FIFO 行为)", () => {
    const { state } = loadState();
    const q = new state.FifoQueue(3);
    q.push(1).push(2).push(3);
    expect(q.isFull()).toBe(true);
    q.push(4); // 丢 1
    expect(q.drain()).toEqual([2, 3, 4]);

    // 新建一个 cap=5 的队列,推 5 个应全部保留
    const q2 = new state.FifoQueue(5);
    q2.push("a").push("b").push("c").push("d").push("e");
    expect(q2.drain()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("默认容量 = 100", () => {
    const { state } = loadState();
    const q = new state.FifoQueue();
    expect(q.capacity()).toBe(state._FIFO_DEFAULT_CAPACITY);
    expect(q.capacity()).toBe(100);
  });

  it("非法 capacity → 回退默认", () => {
    const { state } = loadState();
    expect(new state.FifoQueue(0).capacity()).toBe(100);
    expect(new state.FifoQueue(-5).capacity()).toBe(100);
    expect(new state.FifoQueue(NaN).capacity()).toBe(100);
  });

  it("clear / isEmpty / isFull", () => {
    const { state } = loadState();
    const q = new state.FifoQueue(2);
    expect(q.isEmpty()).toBe(true);
    q.push("x");
    expect(q.isEmpty()).toBe(false);
    q.push("y");
    expect(q.isFull()).toBe(true);
    q.clear();
    expect(q.isEmpty()).toBe(true);
  });
});

// ======================================================================
// 7. 多 store 隔离
// ======================================================================

describe("多 store 隔离", () => {
  it("两个 store 互不干扰(各自的 initial / set)", () => {
    const { state } = loadState();
    const a = state.createStore({ name: "iso-a", initial: { v: "a0" } });
    const b = state.createStore({ name: "iso-b", initial: { v: "b0" } });
    a.set({ v: "a1" });
    expect(a.get()).toEqual({ v: "a1" });
    expect(b.get()).toEqual({ v: "b0" });
  });

  it("两个 store 的订阅互不触发", () => {
    const { state } = loadState();
    const a = state.createStore({ name: "iso-sub-a", initial: 0 });
    const b = state.createStore({ name: "iso-sub-b", initial: 0 });
    const cbA = vi.fn();
    const cbB = vi.fn();
    a.subscribe(cbA);
    b.subscribe(cbB);
    a.set(1);
    expect(cbA).toHaveBeenCalledTimes(1);
    expect(cbB).not.toHaveBeenCalled();
  });
});

// ======================================================================
// 8. schema 校验
// ======================================================================

describe("schema 校验 — 失败抛 ValidationError", () => {
  it("type=object 但传入 array → 抛错", () => {
    const { state } = loadState();
    const s = state.createStore({
      name: "schema-1",
      initial: { x: 0 },
      schema: { type: "object" },
    });
    expect(() => s.set([1, 2, 3] as never)).toThrow(
      /expected object/,
    );
  });

  it("required 字段缺失 → 抛错(且不写入)", () => {
    const { state } = loadState();
    const s = state.createStore({
      name: "schema-2",
      initial: { x: 0 },
      schema: { type: "object", required: ["x", "y"] },
    });
    expect(() => s.set({ x: 1 })).toThrow(/missing required field "y"/);
    expect(s.get()).toEqual({ x: 0 }); // 未写入
  });

  it("properties 类型不匹配 → 抛错", () => {
    const { state } = loadState();
    const s = state.createStore({
      name: "schema-3",
      initial: { name: "init" },
      schema: {
        type: "object",
        properties: { name: { type: "string" } },
      },
    });
    expect(() => s.set({ name: 123 as never })).toThrow(/expected string/);
  });

  it("validate 合法值 → 写入成功", () => {
    const { state } = loadState();
    const s = state.createStore({
      name: "schema-ok",
      initial: { count: 0 },
      schema: {
        type: "object",
        required: ["count"],
        properties: { count: { type: "number" } },
      },
    });
    s.set({ count: 1 });
    expect(s.get()).toEqual({ count: 1 });
  });

  it("ValidationError 含 name / code / errors[]", () => {
    const { state } = loadState();
    const ValidationError = state.ValidationError;
    let caught: any = null;
    const s = state.createStore({
      name: "schema-err-shape",
      initial: { x: 0 },
      schema: { type: "object", required: ["x"] },
    });
    try {
      s.set({} as never);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect(caught.name).toBe("ValidationError");
    expect(caught.code).toBe("VALIDATION_ERROR");
    expect(Array.isArray(caught.errors)).toBe(true);
    expect(caught.errors.length).toBeGreaterThanOrEqual(1);
  });
});

// ======================================================================
// 9. chatState 流控
// ======================================================================

describe("chatState — 流控(pushMessage)", () => {
  it("streaming=false 时可 pushMessage", () => {
    const { state } = loadState();
    expect(state.chatState.get().streaming).toBe(false);
    expect(() =>
      state.pushMessage({ role: "user", content: "hello" }),
    ).not.toThrow();
    const messages = state.chatState.get().messages;
    expect(messages.length).toBe(1);
    expect(messages[0]).toEqual({ role: "user", content: "hello" });
  });

  it("streaming=true 时 pushMessage 被拒绝(抛 StreamingInProgressError)", () => {
    const { state } = loadState();
    state.beginStream({ streamId: "s-1", abortController: null });
    expect(state.chatState.get().streaming).toBe(true);
    expect(() => state.pushMessage({ role: "user", content: "x" })).toThrow(
      /streaming/i,
    );
    // messages 不变
    expect(state.chatState.get().messages.length).toBe(0);
  });

  it("endStream() 后可继续 push", () => {
    const { state } = loadState();
    state.beginStream({ streamId: "s-2" });
    expect(() => state.pushMessage({ role: "user", content: "x" })).toThrow();
    state.endStream();
    expect(state.chatState.get().streaming).toBe(false);
    expect(() =>
      state.pushMessage({ role: "user", content: "y" }),
    ).not.toThrow();
    expect(state.chatState.get().messages.length).toBe(1);
  });

  it("beginStream 设置 abortController + streamId", () => {
    const { state } = loadState();
    state.beginStream({ streamId: "s-x", abortController: { signal: {} } });
    const v = state.chatState.get();
    expect(v.streaming).toBe(true);
    expect(v.streamId).toBe("s-x");
    expect(v.abortController).toEqual({ signal: {} });
  });
});

// ======================================================================
// 10. 内置 store 实际持久化(以 appState 为例)
// ======================================================================

describe("内置 store 持久化", () => {
  it("appState 持久化 + 重启恢复", async () => {
    const first = loadState();
    const appState = first.state.appState;
    appState.set({
      activeView: "chat",
      activeSessionId: "cid-1",
      sidebarOpen: false,
      modalStack: [],
    });
    await new Promise((r) => setTimeout(r, 210));
    expect(first.storage.getItem("my-agent.appState")).not.toBeNull();

    const second = loadState({
      initialStorage: {
        "my-agent.appState": JSON.stringify({
          activeView: "chat",
          activeSessionId: "cid-1",
          sidebarOpen: false,
          modalStack: [],
        }),
      },
    });
    const restored = second.state.appState.get();
    expect(restored.activeView).toBe("chat");
    expect(restored.activeSessionId).toBe("cid-1");
    expect(restored.sidebarOpen).toBe(false);
  });

  it("appState 持久化值校验失败 → 回退默认", () => {
    const { state } = loadState({
      initialStorage: {
        "my-agent.appState": JSON.stringify({ totally: "wrong" }),
      },
    });
    // appState 自身持久化键已存在,但 schema 校验失败 → 第二次创建时不再(同名已注册)
    // 这里测的是:新建一个临时 store 模拟「校验失败的持久化值」
    const s = state.createStore({
      name: "appstate-restore-bad",
      initial: { activeView: "main-menu", sidebarOpen: true, modalStack: [] },
      persistKey: "my-agent.appState",
      schema: {
        type: "object",
        required: ["activeView", "sidebarOpen", "modalStack"],
      },
    });
    expect(s.get()).toEqual({
      activeView: "main-menu",
      sidebarOpen: true,
      modalStack: [],
    });
  });
});

// ======================================================================
// 11. 边界 + 12. 常量
// ======================================================================

describe("边界 + 常量", () => {
  it("initial 为 null / undefined 时仍可 set", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "edge-null", initial: null });
    expect(s.get()).toBe(null);
    s.set(42);
    expect(s.get()).toBe(42);
  });

  it("initial 为深层对象 → 修改 store 不影响 initial", () => {
    const { state } = loadState();
    const initial = { nested: { x: 1 } };
    const s = state.createStore({ name: "edge-deep", initial });
    s.set({ nested: { x: 999 } });
    expect(initial.nested.x).toBe(1); // 未被影响
    s.reset();
    expect(s.get()).toEqual({ nested: { x: 1 } });
  });

  it("无 schema 时 set 任何值都通过", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "no-schema", initial: 0 });
    expect(() => s.set("string" as never)).not.toThrow();
    expect(() => s.set({ complex: [1, 2] } as never)).not.toThrow();
    expect(() => s.set(null)).not.toThrow();
  });

  it("_PERSIST_DEBOUNCE_MS = 200", () => {
    const { state } = loadState();
    expect(state._PERSIST_DEBOUNCE_MS).toBe(200);
  });

  it("subscribe 必须传入函数", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "sub-fn", initial: 0 });
    expect(() =>
      s.subscribe("not a function" as never),
    ).toThrow(/must be a function/);
  });

  it("update(fn) 中 fn 必须为函数", () => {
    const { state } = loadState();
    const s = state.createStore({ name: "upd-fn", initial: 0 });
    expect(() => s.update(null as never)).toThrow(/must be a function/);
  });
});