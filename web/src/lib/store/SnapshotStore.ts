/**
 * SnapshotStore — 通用 Store 快照封装（P4 阶段四状态桥接）。
 *
 * 使任意响应式 store 与 React 18 `useSyncExternalStore` 兼容。
 *
 * 职责：
 * - getSnapshot(): T — 返回当前状态快照
 * - subscribe(onStoreChange): () => void — 订阅变更，返回取消函数
 * - 浅比较优化：两次 getSnapshot() 结果相同时不触发重渲染
 * - 支持 useSyncExternalStore 的 getServerSnapshot
 *
 * 使用示例：
 * ```typescript
 * // 从 Zustand store 创建 SnapshotStore
 * const snapshotStore = new SnapshotStore(
 *   () => useChatRuntimeStore.getState().sessions[sessionId],
 *   (onChange) => useChatRuntimeStore.subscribe(onChange),
 *   (a, b) => a === b // 浅比较
 * );
 * ```
 */

export interface SnapshotStoreOptions<T> {
  /**
   * 自定义相等比较函数。
   * 返回 true 表示两次快照相等，不需要触发重渲染。
   * 默认使用严格相等 (a === b)。
   */
  isEqual?: (a: T, b: T) => boolean;
}

export class SnapshotStore<T> {
  private readonly _getSnapshot: () => T;
  private readonly _subscribe: (onStoreChange: () => void) => () => void;
  private readonly _isEqual: (a: T, b: T) => boolean;
  private _latestSnapshot: T;
  private _lastNotifiedSnapshot: T | undefined;

  constructor(
    getSnapshot: () => T,
    subscribe: (onStoreChange: () => void) => () => void,
    options?: SnapshotStoreOptions<T>
  );
  constructor(
    getSnapshot: () => T,
    subscribe: (onStoreChange: () => void) => () => void,
    isEqual?: (a: T, b: T) => boolean
  );
  constructor(
    getSnapshot: () => T,
    subscribe: (onStoreChange: () => void) => () => void,
    isEqualOrOptions?: ((a: T, b: T) => boolean) | SnapshotStoreOptions<T>
  ) {
    this._getSnapshot = getSnapshot;
    this._subscribe = subscribe;

    // 处理两种调用形式
    if (typeof isEqualOrOptions === 'function') {
      this._isEqual = isEqualOrOptions;
    } else if (isEqualOrOptions?.isEqual) {
      this._isEqual = isEqualOrOptions.isEqual;
    } else {
      this._isEqual = (a, b) => a === b;
    }

    // 初始化快照
    this._latestSnapshot = this._getSnapshot();
  }

  /**
   * 获取当前状态快照。
   * 每次调用都会从源 store 读取最新值。
   */
  getSnapshot(): T {
    this._latestSnapshot = this._getSnapshot();
    return this._latestSnapshot;
  }

  /**
   * 服务端渲染快照（同 getSnapshot）。
   * useSyncExternalStore 要求 getServerSnapshot 在服务端返回稳定值。
   */
  getServerSnapshot(): T {
    return this._getSnapshot();
  }

  /**
   * 订阅变更。
   *
   * 内部实现了引用相等优化：只有当快照实际发生变化时，
   * 才通知 React 重新渲染。
   *
   * @param onStoreChange - store 变更时的回调
   * @returns 取消订阅函数
   */
  subscribe(onStoreChange: () => void): () => void {
    // 追踪是否需要通知
    let maybeNotify = false;

    const notifyIfChanged = () => {
      if (!maybeNotify) return;

      const current = this._getSnapshot();
      const prevNotified = this._lastNotifiedSnapshot;

      // 浅比较优化：相等时不触发重渲染
      if (prevNotified !== undefined && this._isEqual(prevNotified, current)) {
        return;
      }

      this._lastNotifiedSnapshot = current;
      maybeNotify = false;
      onStoreChange();
    };

    // 标记需要检查是否变更
    const checkAndNotify = () => {
      maybeNotify = true;
      // 使用微任务延迟通知，让 React 先处理完当前的批量更新
      queueMicrotask(notifyIfChanged);
    };

    // 订阅源 store
    const unsubscribe = this._subscribe(checkAndNotify);

    return () => {
      unsubscribe();
    };
  }

  /**
   * 获取当前快照的引用（不重新读取源 store）。
   * 用于调试和测试。
   */
  getCurrentSnapshot(): Readonly<T> {
    return this._latestSnapshot;
  }

  /**
   * 重置内部状态，强制下次 getSnapshot 重新读取。
   * 主要用于测试场景。
   */
  reset(): void {
    this._latestSnapshot = this._getSnapshot();
    this._lastNotifiedSnapshot = undefined;
    this._notifyScheduled = false;
  }

  private _notifyScheduled = false;

  /**
   * 同步获取最新快照并通知变更（如果实际变化）。
   * 用于外部需要主动触发检查的场景。
   */
  checkAndNotify(): boolean {
    const current = this._getSnapshot();
    const prevNotified = this._lastNotifiedSnapshot;

    if (prevNotified !== undefined && this._isEqual(prevNotified, current)) {
      return false;
    }

    this._lastNotifiedSnapshot = current;
    return true;
  }
}

// ============================================================
// 便捷工厂函数
// ============================================================

/**
 * 从 Zustand store 创建 SnapshotStore。
 *
 * @param store - Zustand store
 * @param selector - 状态选择器
 * @param options - 可选配置
 * @returns SnapshotStore 实例
 *
 * @example
 * ```typescript
 * const sessionSnapshot = createZustandSnapshot(
 *   useChatRuntimeStore,
 *   (state) => state.sessions[sessionId],
 *   { isEqual: (a, b) => a === b }
 * );
 * ```
 */
export function createZustandSnapshot<S, T>(
  store: { getState: () => S; subscribe: (listener: () => void) => () => void },
  selector: (state: S) => T,
  options?: SnapshotStoreOptions<T>
): SnapshotStore<T> {
  return new SnapshotStore<T>(
    () => selector(store.getState()),
    (onChange) => store.subscribe(onChange),
    options
  );
}

/**
 * 创建带防抖的 SnapshotStore。
 * 适用于高频更新的 store，防止过度渲染。
 *
 * @param store - 源 store
 * @param selector - 状态选择器
 * @param debounceMs - 防抖延迟（毫秒）
 * @param options - 可选配置
 */
export function createDebouncedSnapshot<S, T>(
  store: { getState: () => S; subscribe: (listener: () => void) => () => void },
  selector: (state: S) => T,
  debounceMs: number,
  options?: SnapshotStoreOptions<T>
): SnapshotStore<T> {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingChange = false;

  return new SnapshotStore<T>(
    () => selector(store.getState()),
    (onChange) => {
      const handler = () => {
        pendingChange = true;
        if (debounceTimer === null) {
          debounceTimer = setTimeout(() => {
            debounceTimer = null;
            if (pendingChange) {
              pendingChange = false;
              onChange();
            }
          }, debounceMs);
        }
      };
      return store.subscribe(handler);
    },
    options
  );
}
