/**
 * 状态桥接工具模块（P4 阶段四）。
 *
 * 提供 React 18 useSyncExternalStore 兼容的状态封装和增量累加工具，
 * 用于连接 WebSocket 实时流式状态与 React 组件。
 */

// SnapshotStore - 通用 Store 快照封装
export {
  SnapshotStore,
  createZustandSnapshot,
  createDebouncedSnapshot,
} from './SnapshotStore';
export type { SnapshotStoreOptions } from './SnapshotStore';

// PartialAccumulator - 文本块增量累加器
export {
  PartialAccumulator,
  appendTextToBlock,
  hasAppendableTextBlock,
  getLastStreamingText,
} from './PartialAccumulator';
