/**
 * state.js — 全局状态管理 + FIFO 队列 + localStorage 持久化（F5 / WU-04b）
 * ----------------------------------------------------------------------------
 * 源规范:   .ai-runtime-artifacts/specs/2026-08-07-web-frontend-spec.md § 5
 *           + § 4.4.6 (IIFE 模式) + § 4.3 (零运行时依赖)
 * 实施计划: .ai-runtime-artifacts/plans/2026-08-07-web-frontend-plan.md § 6 WU-04b
 *
 * 职责（与 spec § 3.2 / § 5 + plan § 6 对齐）:
 *   - 通用 Store: createStore({ name, initial, persistKey?, schema? })
 *       get/set/subscribe/reset —— 极简发布订阅 + 可选持久化 + 可选 schema 校验
 *   - 6 个内置 store:
 *       appState / chatState / providerState / sessionListState / agentState / settingsState
 *   - FifoQueue: 限长（默认 100）push/shift/peek/drain/size
 *   - localStorage 持久化: 每个 store 可独立 persistKey → 自动 save/load
 *       写节流 200ms（debounce），避免高频 set 抖动磁盘
 *   - subscribe: store.subscribe(listener) → 返回 unsubscribe;listener 接收 (newValue, oldValue)
 *   - schema 校验（零依赖自实现）: set 时校验,失败 throw ValidationError
 *   - chatState 流控: streaming=true 时 pushMessage 被拒绝(抛错)
 *
 * 与其他模块的协作:
 *   - 不依赖 utils.js / api.js / i18n.js / theme.js(纯 ES2023,零依赖)。
 *     但可在 shared/utils.js 加载后调用 MyAgent.utils.debounce,降级使用本地实现。
 *   - 加载顺序: index.html 在 components 之前(defer)。
 *
 * 不实现:
 *   - selectors / computed / middleware / 时间旅行 —— spec § 4.4.6 「极简」原则。
 *   - WU-04a utils.js / api.js / i18n.js —— 不读、不改。
 */

(function (global) {
  'use strict';

  // ------------------------------------------------------------------
  // 常量
  // ------------------------------------------------------------------

  /** 持久化写节流延迟(spec § 5 — 200ms)。 */
  var PERSIST_DEBOUNCE_MS = 200;

  /** FifoQueue 默认长度上限(可被构造参数覆盖)。 */
  var FIFO_DEFAULT_CAPACITY = 100;

  // ------------------------------------------------------------------
  // ValidationError(校验失败抛错)
  // ------------------------------------------------------------------

  /**
   * 校验失败错误。
   *
   * 字段:
   *   code    — 固定 'VALIDATION_ERROR'(机器可读)
   *   errors  — 字段级错误数组 [{ path, message }]
   *   message — 人类可读首条信息
   *
   * @param {string} message
   * @param {Array<{path:(string|number), message:string}>} [errors=[]]
   */
  function ValidationError(message, errors) {
    var msg = message || 'Validation failed';
    var err = new Error(msg);
    Object.setPrototypeOf(err, ValidationError.prototype);
    err.name = 'ValidationError';
    err.code = 'VALIDATION_ERROR';
    err.errors = Array.isArray(errors) ? errors : [];
    return err;
  }

  ValidationError.prototype = Object.create(Error.prototype);
  ValidationError.prototype.constructor = ValidationError;

  // ------------------------------------------------------------------
  // 极简 schema 校验(零依赖、自实现最小子集)
  //
  // 支持的 schema 形态(本期):
  //   {
  //     type: 'object',                  // 必填
  //     required?: string[],             // 必填字段名
  //     properties?: {                   // 字段级 schema
  //       [field]: { type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'function' }
  //     }
  //   }
  //
  // 校验失败 → ValidationError(包含 errors 数组)。
  // ------------------------------------------------------------------

  /**
   * 校验 value 是否符合 schema。
   *
   * @param {unknown} value
   * @param {object} schema
   * @returns {{ ok: true } | { ok: false, errors: Array<{path:(string|number), message:string}> }}
   */
  function validate(value, schema) {
    var errors = [];

    if (!schema || typeof schema !== 'object') {
      return { ok: true };
    }

    // type === 'object' 必须为 plain object(不是 null / array / primitive)
    if (schema.type === 'object') {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        errors.push({
          path: '',
          message: 'expected object, got ' + describeType(value),
        });
        return { ok: false, errors: errors };
      }

      // required 字段
      if (Array.isArray(schema.required)) {
        schema.required.forEach(function (key) {
          if (!(key in value)) {
            errors.push({
              path: key,
              message: 'missing required field "' + key + '"',
            });
          }
        });
      }

      // properties 字段类型(每个字段若存在则类型匹配)
      if (schema.properties && typeof schema.properties === 'object') {
        Object.keys(schema.properties).forEach(function (key) {
          if (!(key in value)) return; // required 已处理
          var fieldSchema = schema.properties[key];
          if (!fieldSchema || typeof fieldSchema !== 'object') return;
          if (!fieldSchema.type) return;
          if (!checkType(value[key], fieldSchema.type)) {
            errors.push({
              path: key,
              message:
                'expected ' +
                fieldSchema.type +
                ', got ' +
                describeType(value[key]),
            });
          }
        });
      }

      return errors.length === 0 ? { ok: true } : { ok: false, errors: errors };
    }

    // 非 'object' 类型:直接判定整体类型
    if (schema.type && !checkType(value, schema.type)) {
      errors.push({
        path: '',
        message: 'expected ' + schema.type + ', got ' + describeType(value),
      });
      return { ok: false, errors: errors };
    }

    return { ok: true };
  }

  /**
   * 检查 value 是否匹配 typeName(string/number/boolean/object/array/function/null)。
   * @param {unknown} value
   * @param {string} typeName
   * @returns {boolean}
   */
  function checkType(value, typeName) {
    switch (typeName) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'function':
        return typeof value === 'function';
      case 'object':
        return (
          value !== null &&
          typeof value === 'object' &&
          !Array.isArray(value)
        );
      case 'array':
        return Array.isArray(value);
      case 'null':
        return value === null;
      default:
        return true; // 未知 type → 放行(spec 极简原则)
    }
  }

  /**
   * describeType(value) → 类型名(用于错误消息)。
   * @param {unknown} value
   * @returns {string}
   */
  function describeType(value) {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  // ------------------------------------------------------------------
  // localStorage 读写 helper(带 try/catch 防御隐私模式)
  // ------------------------------------------------------------------

  /**
   * 安全读 localStorage(异常时返回 null)。
   * @param {string} key
   * @returns {string | null}
   */
  function storageGet(key) {
    try {
      var raw = global.localStorage.getItem(key);
      return raw;
    } catch (_e) {
      return null;
    }
  }

  /**
   * 安全写 localStorage(异常时静默失败)。
   * @param {string} key
   * @param {string} value
   * @returns {boolean} true 写入成功;false 失败
   */
  function storageSet(key, value) {
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (_e) {
      return false;
    }
  }

  /**
   * 安全删 localStorage。
   * @param {string} key
   */
  function storageRemove(key) {
    try {
      global.localStorage.removeItem(key);
    } catch (_e) {
      // 静默
    }
  }

  // ------------------------------------------------------------------
  // 极简 debounce(leading=false, trailing=true)
  // 与 utils.debounce 行为一致;为保持零依赖自包含,本文件自带副本。
  // ------------------------------------------------------------------

  /**
   * @template {(...args: any[]) => void} F
   * @param {F} fn
   * @param {number} ms
   * @returns {F & { cancel(): void, flush(): void }}
   */
  function debounce(fn, ms) {
    var timer = null;
    var lastArgs = null;
    var lastThis = null;

    function debounced() {
      lastArgs = arguments;
      lastThis = this;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(function invoke() {
        timer = null;
        fn.apply(lastThis, lastArgs);
        lastArgs = null;
        lastThis = null;
      }, ms);
    }

    debounced.cancel = function cancel() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      lastArgs = null;
      lastThis = null;
    };

    debounced.flush = function flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        var args = lastArgs;
        var ctx = lastThis;
        lastArgs = null;
        lastThis = null;
        fn.apply(ctx, args);
      }
    };

    return debounced;
  }

  // ------------------------------------------------------------------
  // createStore({ name, initial, persistKey?, schema? })
  // ------------------------------------------------------------------

  /**
   * 创建一个通用 Store。
   *
   * Store API:
   *   get()              → 当前 value
   *   set(next)          → 写入(浅引用替换),触发订阅者;可选 schema 校验;若 persistKey 则 debounce 写 localStorage
   *   update(fn)         → 读旧 → fn(oldValue) → set(返回值) 的糖
   *   subscribe(fn)      → 注册订阅者,返回 unsubscribe
   *                        listener 签名 (newValue, oldValue)
   *   reset()            → 恢复到 initial(并清掉持久化值)
   *   name               → string(只读)
   *
   * 校验策略:
   *   - set 时若提供 schema,会先 validate(value);失败 throw ValidationError(不写入、不通知订阅者、不持久化)
   *   - 也提供内部 _setRaw(next, { skipSchema }) 用于内建 chatState 等需要避开校验的场景
   *
   * 持久化策略:
   *   - 创建时若 localStorage[persistKey] 存在且 JSON 解析成功 → 替换 initial;
   *     否则用 initial(不写 localStorage,避免覆盖已有但同 key 的别处写入)。
   *   - set 触发 → debounce(PERSIST_DEBOUNCE_MS) → 写 localStorage。
   *   - reset → 同步删 localStorage(避免遗留)。
   *
   * @param {{name:string, initial:any, persistKey?:string, schema?:object}} opts
   * @returns {{
   *   name: string,
   *   get: () => any,
   *   set: (next: any) => void,
   *   update: (fn: (oldValue: any) => any) => void,
   *   subscribe: (fn: (newValue: any, oldValue: any) => void) => () => void,
   *   reset: () => void,
   *   _setRaw: (next: any, opts?: {skipSchema?: boolean}) => void,
   *   _listenersCount: () => number,
   * }}
   */
  function createStore(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new Error('createStore: opts is required');
    }
    if (typeof opts.name !== 'string' || opts.name.length === 0) {
      throw new Error('createStore: name must be a non-empty string');
    }
    if (!Object.prototype.hasOwnProperty.call(opts, 'initial')) {
      throw new Error('createStore: initial is required');
    }

    var name = opts.name;
    var initial = cloneForInit(opts.initial);
    var persistKey = typeof opts.persistKey === 'string' ? opts.persistKey : null;
    var schema = opts.schema || null;

    // 已存在同名 store → 抛错(spec § 4.4.6 — 避免重复创建)
    if (storeRegistry[name]) {
      throw new Error('createStore: store "' + name + '" already exists');
    }

    // 恢复持久化值
    var current = initial;
    if (persistKey) {
      var stored = storageGet(persistKey);
      if (stored !== null) {
        try {
          var parsed = JSON.parse(stored);
          // schema 校验(若提供)—— 持久化值若非法则回退到 initial
          if (schema) {
            var v = validate(parsed, schema);
            if (v.ok) {
              current = parsed;
            }
          } else {
            current = parsed;
          }
        } catch (_e) {
          // JSON.parse 失败 → 保留 initial,不删存储(避免误删)
        }
      }
    }

    var listeners = [];

    // 持久化 debounce
    var persist = null;
    if (persistKey) {
      persist = debounce(function persistWrite(value) {
        try {
          storageSet(persistKey, JSON.stringify(value));
        } catch (_e) {
          // JSON.stringify 失败(循环引用) — 静默
        }
      }, PERSIST_DEBOUNCE_MS);
    }

    function notify(newValue, oldValue) {
      // 快照副本 → 触发过程中如有 listener 调 subscribe/unsubscribe 不影响本次派发
      var snap = listeners.slice();
      for (var i = 0; i < snap.length; i++) {
        try {
          snap[i](newValue, oldValue);
        } catch (_e) {
          // listener 抛错不应阻断后续 listener
        }
      }
    }

    /**
     * 写入新值。失败抛 ValidationError(不写入)。
     * @param {any} next
     */
    function set(next) {
      if (schema) {
        var v = validate(next, schema);
        if (!v.ok) {
          throw new ValidationError(
            'Store "' + name + '" validation failed: ' +
              (v.errors[0] && v.errors[0].message ? v.errors[0].message : 'invalid'),
            v.errors,
          );
        }
      }
      var oldValue = current;
      current = next;
      if (persist) persist(current);
      notify(current, oldValue);
    }

    /**
     * 内部写入 —— 可跳过 schema 校验(用于 chatState 等需要 partial update 的内置 store)。
     * @param {any} next
     * @param {{skipSchema?:boolean}=} oOpts
     */
    function setRaw(next, oOpts) {
      oOpts = oOpts || {};
      var oldValue = current;
      current = next;
      if (persist) persist(current);
      notify(current, oldValue);
    }

    /**
     * update(fn) — 读旧 → 算新 → set(等价于 immutable update 的糖)。
     * @param {(oldValue:any) => any} fn
     */
    function update(fn) {
      if (typeof fn !== 'function') {
        throw new Error('Store.update: fn must be a function');
      }
      set(fn(current));
    }

    /**
     * 注册订阅者,返回 unsubscribe。
     * @param {(newValue:any, oldValue:any) => void} fn
     * @returns {() => void}
     */
    function subscribe(fn) {
      if (typeof fn !== 'function') {
        throw new Error('Store.subscribe: fn must be a function');
      }
      listeners.push(fn);
      var removed = false;
      return function unsubscribe() {
        if (removed) return;
        removed = true;
        var idx = listeners.indexOf(fn);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }

    /**
     * 恢复到 initial,并清掉持久化。
     */
    function reset() {
      if (persist) persist.cancel();
      var oldValue = current;
      current = cloneForInit(opts.initial);
      storageRemove(persistKey);
      notify(current, oldValue);
    }

    /**
     * 深克隆 initial(避免外部突变影响 store 初始快照)。
     * @param {any} v
     * @returns {any}
     */
    function cloneForInit(v) {
      if (v === null || v === undefined) return v;
      if (typeof v !== 'object') return v;
      try {
        return JSON.parse(JSON.stringify(v));
      } catch (_e) {
        return v;
      }
    }

    var store = {
      name: name,
      get: function () {
        return current;
      },
      set: set,
      update: update,
      subscribe: subscribe,
      reset: reset,
      // 内部钩子(供 chatState 等内置 store 使用)
      _setRaw: setRaw,
      // 调试辅助
      _listenersCount: function () {
        return listeners.length;
      },
      // 暴露 schema(用于测试断言 + 调试)
      _schema: schema,
      _persistKey: persistKey,
    };

    storeRegistry[name] = store;
    return store;
  }

  // ------------------------------------------------------------------
  // storeRegistry — 全局 store 索引(供 getStore / listStores 使用)
  // ------------------------------------------------------------------

  var storeRegistry = Object.create(null);

  /**
   * 按名取已建 store;不存在返回 null。
   * @param {string} name
   * @returns {object | null}
   */
  function getStore(name) {
    return storeRegistry[name] || null;
  }

  /**
   * 列出所有已建 store(调试用)。
   * @returns {string[]}
   */
  function listStores() {
    return Object.keys(storeRegistry);
  }

  // ------------------------------------------------------------------
  // FifoQueue: 限长 FIFO 队列(用于 spec § 5 「防止并发」messageQueues)
  // ------------------------------------------------------------------

  /**
   * 限长 FIFO 队列。
   * - 默认容量 100;push 超过容量 → 丢老(shift 旧的)
   * - push/shift/peek/drain/size/clear/isFull/isEmpty
   *
   * 设计:
   *   - 用 Array 作底层;满时 push 前先 shift(简洁,O(1) 摊销)
   *   - drain() 返回并清空当前所有元素(用于 spec § 3.2 messageQueues 的串行化消费)
   *   - peek() 返回首元素(不移除),空时返回 undefined
   *   - size() 当前长度
   */
  function FifoQueue(capacity) {
    if (!(this instanceof FifoQueue)) {
      return new FifoQueue(capacity);
    }
    var cap = typeof capacity === 'number' && capacity > 0 ? Math.floor(capacity) : FIFO_DEFAULT_CAPACITY;
    this._capacity = cap;
    this._items = [];
  }

  /**
   * 推入队尾;超过容量 → 丢老(shift 队首)。
   * @param {any} value
   * @returns {FifoQueue} this(链式)
   */
  FifoQueue.prototype.push = function push(value) {
    if (this._items.length >= this._capacity) {
      this._items.shift();
    }
    this._items.push(value);
    return this;
  };

  /**
   * 弹出队首;空时返回 undefined。
   * @returns {any | undefined}
   */
  FifoQueue.prototype.shift = function shift() {
    if (this._items.length === 0) return undefined;
    return this._items.shift();
  };

  /**
   * 看队首(不移除);空时返回 undefined。
   * @returns {any | undefined}
   */
  FifoQueue.prototype.peek = function peek() {
    return this._items.length === 0 ? undefined : this._items[0];
  };

  /**
   * 返回并清空当前所有元素。
   * @returns {any[]}
   */
  FifoQueue.prototype.drain = function drain() {
    var all = this._items;
    this._items = [];
    return all;
  };

  /**
   * 当前长度。
   * @returns {number}
   */
  FifoQueue.prototype.size = function size() {
    return this._items.length;
  };

  /**
   * 容量上限(只读)。
   * @returns {number}
   */
  FifoQueue.prototype.capacity = function capacity() {
    return this._capacity;
  };

  /**
   * 清空(等价 drain 但不返回)。
   * @returns {FifoQueue} this
   */
  FifoQueue.prototype.clear = function clear() {
    this._items = [];
    return this;
  };

  /**
   * 是否已满。
   * @returns {boolean}
   */
  FifoQueue.prototype.isFull = function isFull() {
    return this._items.length >= this._capacity;
  };

  /**
   * 是否为空。
   * @returns {boolean}
   */
  FifoQueue.prototype.isEmpty = function isEmpty() {
    return this._items.length === 0;
  };

  // ------------------------------------------------------------------
  // 内置 store —— appState
  //   { activeView, activeSessionId, sidebarOpen, modalStack }
  //   persistKey: 'my-agent.appState'
  // ------------------------------------------------------------------

  var appState = createStore({
    name: 'appState',
    initial: {
      activeView: 'main-menu', // 'main-menu' | 'chat' | 'sessions' | 'providers' | 'agents' | 'skills' | 'settings'
      activeSessionId: null,
      sidebarOpen: true,
      modalStack: [],
    },
    persistKey: 'my-agent.appState',
    schema: {
      type: 'object',
      required: ['activeView', 'sidebarOpen', 'modalStack'],
      properties: {
        activeView: { type: 'string' },
        activeSessionId: { type: ['string', 'null'] }, // null 也合法
        sidebarOpen: { type: 'boolean' },
        modalStack: { type: 'array' },
      },
    },
  });

  // ------------------------------------------------------------------
  // 内置 store —— chatState
  //   { messages[], streaming, abortController, streamId }
  //   - 特殊:streaming=true 时 pushMessage 拒绝(抛错)
  //   - 不持久化(messages 体积大,AbortController 不可序列化;刷新后回到空流)
  // ------------------------------------------------------------------

  var chatState = createStore({
    name: 'chatState',
    initial: {
      messages: [], // SerializedMessage[]
      streaming: false,
      abortController: null, // AbortController | null
      streamId: null, // string | null(用于去重/取消旧流)
    },
    schema: {
      type: 'object',
      required: ['messages', 'streaming'],
      properties: {
        messages: { type: 'array' },
        streaming: { type: 'boolean' },
        abortController: { type: ['object', 'null'] },
        streamId: { type: ['string', 'null'] },
      },
    },
  });

  /**
   * 流控:streaming=true 时拒绝 push。
   * 失败抛 StreamingInProgressError(name = 'StreamingInProgressError', code = 'STREAMING_IN_PROGRESS')。
   *
   * @param {object} message 消息对象
   * @returns {void}
   */
  function pushMessage(message) {
    var current = chatState.get();
    if (current.streaming) {
      var err = new Error(
        'chatState: cannot push message while streaming (streamId=' +
          (current.streamId || 'null') +
          ')',
      );
      Object.setPrototypeOf(err, StreamingInProgressError.prototype);
      err.name = 'StreamingInProgressError';
      err.code = 'STREAMING_IN_PROGRESS';
      throw err;
    }
    var nextMessages = current.messages.concat([message]);
    chatState.set(
      Object.assign({}, current, { messages: nextMessages }),
    );
  }

  function StreamingInProgressError() {}
  StreamingInProgressError.prototype = Object.create(Error.prototype);
  StreamingInProgressError.prototype.constructor = StreamingInProgressError;

  /**
   * 流控便捷方法:开始流(设 streaming=true + 可选 abortController + streamId)。
   * @param {{abortController?: AbortController, streamId?: string}} [opts]
   */
  function beginStream(opts) {
    opts = opts || {};
    var current = chatState.get();
    chatState.set(
      Object.assign({}, current, {
        streaming: true,
        abortController: opts.abortController || null,
        streamId: opts.streamId || null,
      }),
    );
  }

  /**
   * 流控便捷方法:结束流(streaming=false,abortController 置 null,但保留 streamId 以便上游追踪)。
   */
  function endStream() {
    var current = chatState.get();
    chatState.set(
      Object.assign({}, current, {
        streaming: false,
        abortController: null,
      }),
    );
  }

  // ------------------------------------------------------------------
  // 内置 store —— providerState
  //   { providers[], activeProviderId, loading }
  // ------------------------------------------------------------------

  var providerState = createStore({
    name: 'providerState',
    initial: {
      providers: [],
      activeProviderId: null,
      loading: false,
    },
    schema: {
      type: 'object',
      required: ['providers', 'loading'],
      properties: {
        providers: { type: 'array' },
        activeProviderId: { type: ['string', 'null'] },
        loading: { type: 'boolean' },
      },
    },
  });

  // ------------------------------------------------------------------
  // 内置 store —— sessionListState
  //   { sessions[], loading }
  // ------------------------------------------------------------------

  var sessionListState = createStore({
    name: 'sessionListState',
    initial: {
      sessions: [],
      loading: false,
    },
    schema: {
      type: 'object',
      required: ['sessions', 'loading'],
      properties: {
        sessions: { type: 'array' },
        loading: { type: 'boolean' },
      },
    },
  });

  // ------------------------------------------------------------------
  // 内置 store —— agentState
  //   { agents[], skills[] }
  // ------------------------------------------------------------------

  var agentState = createStore({
    name: 'agentState',
    initial: {
      agents: [],
      skills: [],
    },
    schema: {
      type: 'object',
      required: ['agents', 'skills'],
      properties: {
        agents: { type: 'array' },
        skills: { type: 'array' },
      },
    },
  });

  // ------------------------------------------------------------------
  // 内置 store —— settingsState
  //   { theme, lang, model }
  //   persistKey: 'my-agent.settings'
  // ------------------------------------------------------------------

  var settingsState = createStore({
    name: 'settingsState',
    initial: {
      theme: 'system', // 'dark' | 'light' | 'system'
      lang: 'zh-CN',
      model: null, // string | null(默认模型)
    },
    persistKey: 'my-agent.settings',
    schema: {
      type: 'object',
      required: ['theme', 'lang'],
      properties: {
        theme: { type: 'string' },
        lang: { type: 'string' },
        model: { type: ['string', 'null'] },
      },
    },
  });

  // ------------------------------------------------------------------
  // 暴露
  // ------------------------------------------------------------------

  global.MyAgent = global.MyAgent || {};
  global.MyAgent.state = {
    // 通用 API
    createStore: createStore,
    getStore: getStore,
    listStores: listStores,

    // 内置 store
    appState: appState,
    chatState: chatState,
    providerState: providerState,
    sessionListState: sessionListState,
    agentState: agentState,
    settingsState: settingsState,

    // chatState 流控便捷方法
    pushMessage: pushMessage,
    beginStream: beginStream,
    endStream: endStream,

    // 工具类
    FifoQueue: FifoQueue,
    ValidationError: ValidationError,

    // 内部 helper(便于测试 + 调试)
    _validate: validate,
    _PERSIST_DEBOUNCE_MS: PERSIST_DEBOUNCE_MS,
    _FIFO_DEFAULT_CAPACITY: FIFO_DEFAULT_CAPACITY,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);