/**
 * PartialAccumulator — 文本块增量累加器（P4 阶段四状态桥接）。
 *
 * 从 chatRuntimeStore 的 rAF 缓冲逻辑抽取为独立工具。
 *
 * 职责：
 * - 按 key（runId）隔离缓冲
 * - append(key, text) — 追加文本，自动调度 rAF
 * - flush(key) — 立即冲刷缓冲，返回累积文本
 * - cancel(key) — 取消待执行 rAF
 * - 引用相等时不触发更新
 */

import type { Block, TextBlock } from '@/features/chat/types';

// ============================================================
// 常量
// ============================================================

let _blockIdCounter = 0;

function generateBlockId(): string {
  _blockIdCounter += 1;
  return `blk-${_blockIdCounter.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============================================================
// PartialAccumulator
// ============================================================

/**
 * 文本块增量累加器。
 *
 * 将高频文本增量合并后批量应用，避免每次增量都触发 React 重渲染。
 * 使用 requestAnimationFrame 调度刷新，实现与浏览器渲染周期的同步。
 *
 * @typeParam T - 携带 blocks 数组的目标类型（如 ChatMessage）
 *
 * @example
 * ```typescript
 * const accumulator = new PartialAccumulator<ChatMessage>({
 *   getTarget: (runId) => findMessageByRunId(runId),
 *   updateTarget: (runId, updater) => applyMessageUpdate(runId, updater),
 * });
 *
 * // 追加文本（高频调用，自动合并）
 * accumulator.append(runId, 'Hello');
 * accumulator.append(runId, ' ');
 * accumulator.append(runId, 'World');
 *
 * // 手动冲刷（通常由调用方在适当时候触发）
 * const flushed = accumulator.flush(runId);
 * ```
 */
export class PartialAccumulator<T extends { id: string }> {
  private readonly _getTarget: (key: string) => T | undefined;
  private readonly _updateTarget: (key: string, updater: (target: T) => T) => void;
  private readonly _generateBlockId: () => string;
  private readonly _targetExists: (key: string) => boolean;

  /** 每个 key 的缓冲文本 */
  private readonly _buffers: Map<string, string> = new Map();

  /** 每个 key 的 rAF handle */
  private readonly _rafHandles: Map<string, number> = new Map();

  /** 每个 key 是否已调度 rAF */
  private readonly _rafScheduled: Map<string, boolean> = new Map();

  constructor(
    getTarget: (key: string) => T | undefined,
    updateTarget: (key: string, updater: (target: T) => T) => void,
    options?: {
      generateBlockId?: () => string;
      targetExists?: (key: string) => boolean;
    }
  ) {
    this._getTarget = getTarget;
    this._updateTarget = updateTarget;
    this._generateBlockId = options?.generateBlockId ?? generateBlockId;
    this._targetExists = options?.targetExists ?? ((key) => this._getTarget(key) !== undefined);
  }

  /**
   * 追加文本到指定 key 的缓冲。
   * 如果该 key 尚未调度 rAF，自动调度。
   *
   * @param key - 标识符（如 runId）
   * @param text - 要追加的文本
   */
  append(key: string, text: string): void {
    if (!text) return;

    // 累加到缓冲
    const currentBuffer = this._buffers.get(key) ?? '';
    const nextBuffer = currentBuffer + text;
    this._buffers.set(key, nextBuffer);

    // 检查是否需要调度 rAF
    if (this._rafScheduled.get(key)) {
      return;
    }

    // 调度 rAF
    const handle = requestAnimationFrame(() => {
      this.flush(key);
    });

    this._rafHandles.set(key, handle);
    this._rafScheduled.set(key, true);
  }

  /**
   * 立即冲刷指定 key 的缓冲。
   * 将累积的文本追加到目标的 blocks 数组。
   *
   * @param key - 标识符
   * @returns 实际冲刷的文本（为空时返回空字符串）
   */
  flush(key: string): string {
    const buf = this._buffers.get(key);
    if (!buf) {
      this._cleanup(key);
      return '';
    }

    // 清空缓冲
    this._buffers.set(key, '');

    // 检查目标是否存在
    if (!this._targetExists(key)) {
      // 目标尚未建立时保留缓冲，释放已执行的 rAF handle，
      // 后续 append 或终态同步 flush 会再次尝试。
      this._cleanup(key);
      return buf;
    }

    // 应用更新
    this._updateTarget(key, (target) => {
      return this._appendToTarget(target, buf);
    });

    this._cleanup(key);
    return buf;
  }

  /**
   * 取消指定 key 的待执行 rAF。
   * 同时清除缓冲。
   *
   * @param key - 标识符
   */
  cancel(key: string): void {
    // 取消 rAF
    const handle = this._rafHandles.get(key);
    if (handle !== undefined) {
      cancelAnimationFrame(handle);
    }

    // 清理状态
    this._buffers.delete(key);
    this._rafHandles.delete(key);
    this._rafScheduled.delete(key);
  }

  /**
   * 冲刷所有待处理的缓冲。
   * 通常在应用卸载或会话清理时调用。
   */
  flushAll(): void {
    const keys = Array.from(this._buffers.keys());
    for (const key of keys) {
      this.flush(key);
    }
  }

  /**
   * 获取指定 key 当前缓冲的文本长度。
   * 用于调试和监控。
   */
  getBufferLength(key: string): number {
    return this._buffers.get(key)?.length ?? 0;
  }

  /**
   * 检查指定 key 是否存在待冲刷的缓冲。
   */
  hasPendingBuffer(key: string): boolean {
    const buffer = this._buffers.get(key);
    return buffer !== undefined && buffer.length > 0;
  }

  /**
   * 获取所有有待处理缓冲的 key 列表。
   */
  getPendingKeys(): string[] {
    return Array.from(this._buffers.entries())
      .filter(([, buf]) => buf.length > 0)
      .map(([key]) => key);
  }

  // ============================================================
  // 内部方法
  // ============================================================

  /**
   * 将文本追加到目标对象的 blocks 数组。
   * 查找最后一个非 done 的 text block，追加到其末尾；
   * 如果不存在则创建新的 text block。
   */
  private _appendToTarget(target: T, text: string): T {
    // 假设 target 有 blocks 字段
    const targetWithBlocks = target as unknown as { blocks: Block[] };
    const blocks = targetWithBlocks.blocks;

    if (!Array.isArray(blocks)) {
      return target;
    }

    // 找最后一个非 done 的 text block
    let textBlockIdx = -1;
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === 'text' && blocks[i].status !== 'done') {
        textBlockIdx = i;
        break;
      }
    }

    let nextBlocks: Block[];
    if (textBlockIdx >= 0) {
      // 追加到现有 text block
      const existingBlock = blocks[textBlockIdx] as TextBlock;
      const updatedBlock: TextBlock = {
        ...existingBlock,
        text: existingBlock.text + text,
      };
      nextBlocks = blocks.map((b, i) =>
        i === textBlockIdx ? updatedBlock : b
      );
    } else {
      // 创建新的 text block
      const newBlock: TextBlock = {
        id: this._generateBlockId(),
        type: 'text',
        status: 'streaming',
        text,
      };
      nextBlocks = [...blocks, newBlock];
    }

    return { ...target, blocks: nextBlocks } as unknown as T;
  }
  /**
   * 清理 key 的 rAF 状态。
   */
  private _cleanup(key: string): void {
    this._rafHandles.delete(key);
    this._rafScheduled.delete(key);
  }
}

// ============================================================
// 独立使用的辅助函数
// ============================================================

/**
 * 找最后一个可追加的 text block 的索引。
 * 返回 -1 表示需要新建 block。
 */
function findAppendableBlockIndex(blocks: Block[]): number {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text' && blocks[i].status !== 'done') {
      return i;
    }
  }
  return -1;
}

/**
 * 将文本追加到 blocks 数组。
 * 提取自 chatRuntimeStore.flushTextBuffer 的核心逻辑。
 *
 * @param blocks - 现有的 blocks 数组
 * @param text - 要追加的文本
 * @param nextBlockId - 生成新 block ID 的函数
 * @returns 更新后的 blocks 数组
 */
export function appendTextToBlock(
  blocks: Block[],
  text: string,
  nextBlockId: () => string
): Block[] {
  const appendableIdx = findAppendableBlockIndex(blocks);

  if (appendableIdx >= 0) {
    const tb = blocks[appendableIdx] as TextBlock;
    const updatedBlock: TextBlock = {
      ...tb,
      text: tb.text + text,
    };
    return blocks.map((b, i) =>
      i === appendableIdx ? updatedBlock : b
    );
  }

  // 新建 text block
  const newBlock: TextBlock = {
    id: nextBlockId(),
    type: 'text',
    status: 'streaming',
    text,
  };
  return [...blocks, newBlock];
}

/**
 * 检查 blocks 数组是否包含可追加的 text block。
 */
export function hasAppendableTextBlock(blocks: Block[]): boolean {
  return blocks.some(
    (b) => b.type === 'text' && b.status !== 'done'
  );
}

/**
 * 获取最后一个非 done 的 text block 的文本。
 */
export function getLastStreamingText(blocks: Block[]): string | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === 'text' && blocks[i].status !== 'done') {
      return (blocks[i] as TextBlock).text;
    }
  }
  return undefined;
}
