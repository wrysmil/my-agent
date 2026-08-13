/**
 * useChatStream — P0 重写版。
 *
 * 核心变更：
 * - 状态从 React local state 迁移到 chatRuntimeStore（Zustand）
 * - SSE 事件按 (sessionId, runId) envelope 做身份校验 + seq 去重
 * - 文本缓冲通过 store 的 rAF 机制按 run 隔离
 * - 历史加载使用 messageId + revision 二层合并
 * - abort 按 (sessionId, runId) 精确中止
 *
 * 删除的旧机制：
 * - generationBySession / streamGenerationRef（不再依赖 generation）
 * - inFlightBySessionRef 快照搬运
 * - computeInflightTail / messageFingerprint / isSameTailMessage
 * - 切换 effect 中 controllerRef.current = null
 * - callback 通过"当前最后一条 assistant"定位更新目标
 */

import { useCallback, useEffect, useMemo } from 'react';
import { parseSseStream } from '@/lib/sse';

/**
 * Streaming tool name cache：模块级 Map<toolId, toolName>。
 *
 * 后端 tool_use_delta SSE 帧不带 name 字段（仅 Anthropic content_block_start
 * 触发的 tool_use_start 帧带 name），而 partial frames 可能先于 start 到达，
 * 或 Anthropic 流式参数收集阶段前端只收到 partial frames——导致新建
 * tool_call block 时 toolName=''。
 *
 * 当任意 SSE event 携带 (toolId, toolName) 时，把 toolName 写入 cache；
 * 后续 partial frames 用 toolId 查 cache 兜底 toolName。
 *
 * Map 永不清空（同一进程内 toolId 唯一），适合单进程前端生命周期。
 */
const toolNameCache = new Map<string, string>();
import { apiGet } from '@/lib/api';
import { logger } from '@/lib/logger';
import {
  useChatRuntimeStore,
  selectSessionHistoryLoaded,
  selectSessionMessages,
  selectSessionStatus,
} from './chatRuntimeStore';
import type {
  ChatStatus,
  ChatMessage,
  ChatOptions,
  Block,
  ChatStreamEnvelope,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
} from './types';
import { stripWorkerEnvelope } from './runTrace';

// ============================================================
// 常量
// ============================================================

const MAX_RETRIES = 5;
const SUBMITTING_TIMEOUT_MS = 60_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

// ============================================================
// 辅助
// ============================================================

let _blockIdCounter = 0;
function nextBlockId(): string {
  _blockIdCounter += 1;
  return `blk-${_blockIdCounter}`;
}

/** 把 blocks 里所有 status === 'streaming' 的项翻成 'done'（兜底） */
function finalizeStreamingBlocks(blocks: Block[]): Block[] {
  let changed = false;
  const next = blocks.map((b) => {
    if (b.status === 'streaming') {
      changed = true;
      return { ...b, status: 'done' as const };
    }
    return b;
  });
  return changed ? next : blocks;
}

/** 提取消息的纯文本 */
export function messageText(msg: ChatMessage): string {
  if (msg.text) return msg.text;
  return msg.blocks
    .filter((b): b is import('./types').TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// ============================================================
// 历史解析类型
// ============================================================

interface SerializedContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  data?: string;
  mediaType?: string;
}

export interface SerializedMsg {
  role: string;
  content: SerializedContentBlock[];
  turnId?: number;
  ts?: number;
  id?: string;
  runId?: string;
}

interface SessionHistoryResponse {
  sessionId: string;
  revision: number;
  messages: SerializedMsg[];
}

// ============================================================
// 历史解析
// ============================================================

function internalCompactionSummaryDetail(text: string): string | null {
  const match = text.match(
    /^(?:\[Active checkpoint summary \(epoch \d+\)\]|\[History summary for turns \d+(?:,\d+)*\]):([\s\S]*)$/,
  );
  return match ? match[1] : null;
}

function parseHistoryBlocks(
  m: SerializedMsg,
): Block[] {
  const blocks: Block[] = [];
  const contentArray = Array.isArray(m.content) ? m.content : [];

  for (let i = 0; i < contentArray.length; i++) {
    const cb = contentArray[i];
    const blockId = cb.id ?? `${m.id ?? 'unknown'}:${i}`;

    switch (cb.type) {
      case 'text':
        if (cb.text) {
          const summaryDetail = internalCompactionSummaryDetail(cb.text);
          blocks.push(
            summaryDetail === null
              ? {
                  id: nextBlockId(), type: 'text', status: 'done',
                  text: cb.text, blockId,
                }
              : {
                  id: nextBlockId(), type: 'thinking', status: 'done',
                  thinking: summaryDetail, collapsed: true, blockId,
                },
          );
        }
        break;
      case 'thinking':
        if (cb.thinking) {
          blocks.push({
            id: nextBlockId(), type: 'thinking', status: 'done',
            thinking: cb.thinking, collapsed: true, blockId,
          });
        }
        break;
      case 'tool_use':
        blocks.push({
          id: nextBlockId(), type: 'tool_call', status: 'done',
          toolId: cb.id ?? '', toolName: cb.name ?? '',
          input: cb.input, inputRaw: '', blockId: cb.id, // tool_use 的 id 即 blockId
        });
        break;
      case 'tool_result':
        blocks.push({
          id: nextBlockId(), type: 'tool_result',
          status: cb.isError ? 'error' : 'done',
          toolCallId: cb.toolUseId ?? '', toolName: cb.name ?? '',
          content: cb.content ?? '', isError: cb.isError ?? false,
          blockId: cb.id ?? `result:${cb.toolUseId ?? 'unknown'}`,
        });
        break;
    }
  }
  return blocks;
}

export function parseHistoryMessages(rawMessages: SerializedMsg[]): ChatMessage[] {
  // 预扫描：识别含 dispatch_to / hand_off_to 的 runId。一次 dispatch 后主 Agent 在
  // JSONL 中会有两条 assistant 行（#1 等待态 id=randomUUID + #2 收尾 id=assistantMessageId，
  // 见 runner.addAssistantMessage 的 persistedAssistantMessageId 逻辑），runId 相同。
  // 这些 run 必须按 messageId 分组拆成独立气泡；普通工具循环（无 dispatch）仍按 runId
  // 合并为单气泡，避免破坏「一次发送一个气泡」的既有行为。
  const dispatchRunIds = new Set<string>();
  for (const m of rawMessages) {
    if (m.role !== 'assistant' || !m.runId) continue;
    const content = Array.isArray(m.content) ? m.content : [];
    const hasDispatch = content.some(
      (c) =>
        c.type === 'tool_use' &&
        (c.name === 'dispatch_to' || c.name === 'hand_off_to'),
    );
    if (hasDispatch) dispatchRunIds.add(m.runId);
  }

  const messages: ChatMessage[] = [];
  const assistantIndexByRun = new Map<string, number>();

  for (const m of rawMessages) {
    const content = Array.isArray(m.content) ? m.content : [];
    const isToolResultRow =
      m.role === 'user' &&
      content.length > 0 &&
      content.every((block) => block.type === 'tool_result');

    if (m.role === 'user' && !isToolResultRow) {
      messages.push({
        id: `hist-${m.id ?? Date.now().toString(36)}`,
        role: 'user',
        blocks: [],
        text: content
          .filter((block) => block.type === 'text')
          .map((block) => block.text || '')
          .join('\n'),
        clientMessageId: m.id,
        messageId: m.id,
        runId: m.runId,
      });
      continue;
    }

    // PersistentSession 按模型调用分别保存 assistant/tool_result 行，
    // UI 则以一次发送为一个气泡。新记录用 runId，旧 JSONL 回退到 turnId。
    // dispatch run 的 assistant 行（有 id）按 messageId 分组，使 #1 等待态 / #2 收尾
    // 分离为独立气泡；tool_result 行始终按 runId 归并到 dispatch 后最后一条 assistant。
    const isDispatchRun = m.runId !== undefined && dispatchRunIds.has(m.runId);
    const useMsgGrouping = m.role === 'assistant' && isDispatchRun && m.id;
    const groupKey = useMsgGrouping
      ? `msg:${m.id}`
      : m.runId
        ? `run:${m.runId}`
        : m.turnId !== undefined
          ? `turn:${m.turnId}`
          : null;
    const blocks = parseHistoryBlocks(m);

    const existingIndex =
      groupKey === null ? undefined : assistantIndexByRun.get(groupKey);

    if (existingIndex !== undefined) {
      const existing = messages[existingIndex];
      const isAssistantRow = m.role !== 'user';
      messages[existingIndex] = {
        ...existing,
        ...(isAssistantRow && m.id
          ? { id: `hist-${m.id}`, messageId: m.id }
          : {}),
        runId: m.runId ?? existing.runId,
        blocks: [...existing.blocks, ...blocks],
      };
      continue;
    }

    const message: ChatMessage = {
      id: `hist-${m.id ?? Date.now().toString(36)}`,
      role: 'assistant',
      blocks,
      messageId: m.role === 'assistant' ? m.id : undefined,
      runId: m.runId,
    };
    messages.push(message);
    if (groupKey !== null) {
      assistantIndexByRun.set(groupKey, messages.length - 1);
    }
    // tool_result 行按 runId 分组归并，需让 run:runId 指向该 run 当前最后一条
    // assistant（dispatch run 中 assistant 行按 msg:id 分组，但 tool_result 无 id，
    // 必须经 runId 归并到等待态气泡 #1，而不是新建气泡）。
    if (m.role === 'assistant' && m.runId) {
      assistantIndexByRun.set(`run:${m.runId}`, messages.length - 1);
    }
  }

  return rebuildDispatchAgentMessages(messages);
}

/**
 * 后处理：从 history 消息里识别 dispatch_to / hand_off_to，
 * 配对对应的 tool_result，剥 worker XML 信封，生成独立的 role:'agent' 消息
 * 插到对应 assistant 之后。
 *
 * JSONL 持久化层未存 agent_message SSE 事件（见上一批 verification-lite），
 * 刷新页面 / refetch 路径下必须靠 tool_call + tool_result 自重建 agent 气泡，
 * 否则 dispatch_to / hand_off_to 的输出在 history 加载时凭空消失。
 */
function rebuildDispatchAgentMessages(
  messages: ChatMessage[],
): ChatMessage[] {
  const DISPATCH_TOOL_NAMES = new Set(['dispatch_to', 'hand_off_to']);

  const dispatchCalls: Array<{
    insertAfter: number;
    agentMsg: ChatMessage;
  }> = [];

  // 1) 收集 assistant 消息中所有 dispatch_to / hand_off_to 调用的 toolId + 目标 agent
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;

    for (const block of msg.blocks) {
      if (block.type !== 'tool_call') continue;
      if (!DISPATCH_TOOL_NAMES.has(block.toolName)) continue;

      // dispatch_to / hand_off_to 的 input 都是 { to, prompt, ... }
      const targetAgent =
        typeof block.input === 'object' &&
        block.input !== null &&
        typeof (block.input as Record<string, unknown>).to === 'string'
          ? ((block.input as Record<string, unknown>).to as string)
          : undefined;

      // 2) 找配对 tool_result：在 messages 里扫所有 tool_result block（不管 role），
      //    其 toolCallId === block.toolId。注意 tool_result 可能跨多条消息存放。
      let matchedContent: string | undefined;
      let matchedResult: ToolResultBlock | undefined;
      for (const candidate of messages) {
        for (const cb of candidate.blocks) {
          if (cb.type !== 'tool_result') continue;
          if (cb.toolCallId !== block.toolId) continue;
          matchedContent = cb.content;
          matchedResult = cb;
          break;
        }
        if (matchedContent !== undefined) break;
      }

      if (matchedContent === undefined || matchedResult === undefined) {
        // 没有 tool_result：跳过（罕见；理论上前端流式层不会让这种情况持久化）
        continue;
      }

      // 3) 剥 worker XML 信封（与流式路径 agent_message.text 等价）
      const text = stripWorkerEnvelope(matchedContent);

      // 4) 重建内部步骤 blocks（与 WU-02 实时路径 agent 气泡 blocks 结构一致）：
      //    tool_call + tool_result，供刷新后 agent 气泡内 trace 步骤完整显示。
      const actorName =
        targetAgent !== undefined ? targetAgent : matchedResult.actorName;
      const internalBlocks: Block[] = [
        {
          id: nextBlockId(),
          type: 'tool_call',
          status: 'done',
          toolId: block.toolId,
          toolName: block.toolName,
          input: block.input,
          inputRaw: block.inputRaw ?? '',
          blockId: block.blockId,
          ...(actorName !== undefined ? { actorName } : {}),
        },
        {
          id: nextBlockId(),
          type: 'tool_result',
          status: matchedResult.isError ? 'error' : 'done',
          toolCallId: block.toolId,
          toolName: block.toolName,
          content: text,
          isError: matchedResult.isError,
          durationMs: matchedResult.durationMs,
          blockId: matchedResult.blockId,
          ...(matchedResult.actorKind !== undefined
            ? { actorKind: matchedResult.actorKind }
            : {}),
          ...(actorName !== undefined ? { actorName } : {}),
        },
      ];

      // 5) 构造 agent 消息；ID 稳定以保证 mergePersistedWithOverlay 复用同一槽位
      const agentMsg: ChatMessage = {
        id: `hist-agent-${block.toolId}`,
        role: 'agent',
        blocks: internalBlocks,
        text,
        runId: msg.runId,
        toolName: block.toolName,
        ...(targetAgent !== undefined ? { actorName: targetAgent } : {}),
        ...(matchedResult.actorKind !== undefined
          ? { actorKind: matchedResult.actorKind }
          : {}),
        ...(matchedResult.actorName !== undefined && targetAgent === undefined
          ? { actorName: matchedResult.actorName }
          : {}),
        summary: buildAgentSummary(internalBlocks),
        status: 'done',
        isFinal: block.toolName === 'hand_off_to',
      };

      dispatchCalls.push({ insertAfter: i, agentMsg });
    }
  }

  if (dispatchCalls.length === 0) return messages;

  // 5) 倒序插入（高 index 先插），避免前面插入导致 index 失效
  const result = [...messages];
  for (let k = dispatchCalls.length - 1; k >= 0; k -= 1) {
    const { insertAfter, agentMsg } = dispatchCalls[k];
    result.splice(insertAfter + 1, 0, agentMsg);
  }
  return result;
}

/**
 * persisted 快照只替换已经达到该 run 持久化 revision 的 overlay。
 * 没有稳定 ID 的旧消息按本地 id 去重，避免重复 history/refetch 膨胀。
 *
 * 方案 B（spec §4.2）：以 overlay 顺序为骨架（保留流式顺序），persisted
 * 中与 overlay identity / runId 匹配的条目就地 merge；persisted 独有的
 * 旧历史条目按「下一个 / 上一个已存在锚点」插入正确位置。
 *
 * 修复动机（spec §4.1）：旧算法以 persisted 为基底，overlay 中排在首位、
 * 在 persisted 中找不到匹配的 user 消息会被 splice 到 result.length（末尾），
 * 导致 done 后 history refetch 把 user 排到 assistant 后面。
 */
export function mergePersistedWithOverlay(
  persisted: ChatMessage[],
  overlay: ChatMessage[],
  historyRevision: number,
  requiredRevisionForRun: (runId: string) => number | null,
): ChatMessage[] {
  const identity = (message: ChatMessage) =>
    message.messageId ?? message.clientMessageId ?? message.id;

  // 步骤 1：以 overlay 顺序为骨架
  const result = [...overlay];
  const overlayIdentityIndex = new Map<string, number>();
  result.forEach((message, index) => {
    const key = identity(message);
    if (!overlayIdentityIndex.has(key)) overlayIdentityIndex.set(key, index);
  });
  const overlayRunIds = new Set(
    result.filter((m) => m.role === 'assistant' && m.runId).map((m) => m.runId),
  );

  // 步骤 2：遍历 persisted，匹配条目就地 merge
  for (
    let persistedIndex = 0;
    persistedIndex < persisted.length;
    persistedIndex += 1
  ) {
    const persistedMsg = persisted[persistedIndex];

    const idMatch = result.findIndex(
      (message) => identity(message) === identity(persistedMsg),
    );
    if (idMatch >= 0) {
      const candidate = result[idMatch];
      // agent 气泡（WU-04 review-fix）：实时气泡是权威（worker 步骤 blocks / 流式文本），
      // persisted 重建气泡仅用于补齐缺失字段，不覆盖实时渲染，避免 refetch 后闪烁。
      if (candidate.role === 'agent') {
        result[idMatch] = mergeAgentForSameRun(persistedMsg, candidate);
        continue;
      }
      const indexedRevision = candidate.runId
        ? requiredRevisionForRun(candidate.runId)
        : null;
      const requiredRevision =
        indexedRevision ?? candidate.pendingPersistenceRevision ?? null;
      result[idMatch] = mergeAssistantForSameRun(
        persistedMsg,
        candidate,
        requiredRevision !== null && historyRevision < requiredRevision
          ? 'overlay-wins'
          : 'persisted-wins',
      );
      continue;
    }

    // runId 二次匹配（assistant）：overlay 常以 `asst-${runId}` 存在，persisted
    // 以 `hist-${messageId}` + messageId 存在，identity 不匹配时按 runId 归并，
    // 防止同 run 出现多个 trace bubble（duplicate trace bubble fix 回归保护）。
    if (
      persistedMsg.role === 'assistant' &&
      persistedMsg.runId &&
      overlayRunIds.has(persistedMsg.runId)
    ) {
      const runMatch = result.findIndex(
        (message) =>
          message.role === 'assistant' && message.runId === persistedMsg.runId,
      );
      if (runMatch >= 0) {
        const candidate = result[runMatch];
        const indexedRevision = candidate.runId
          ? requiredRevisionForRun(candidate.runId)
          : null;
        const requiredRevision =
          indexedRevision ?? candidate.pendingPersistenceRevision ?? null;
        result[runMatch] = mergeAssistantForSameRun(
          persistedMsg,
          candidate,
          requiredRevision !== null && historyRevision < requiredRevision
            ? 'overlay-wins'
            : 'persisted-wins',
        );
        continue;
      }
    }

    // user 双身份去重：同一次发送的 user 消息（runId 相同）在 overlay / persisted
    // 两侧 identity 可能不同（messageId vs clientMessageId 时序差异），视为同一条，
    // 否则 persisted 收敛后会把 overlay 的 user 当作新条目重复插入。
    if (persistedMsg.role === 'user' && persistedMsg.runId) {
      const userMatch = result.findIndex(
        (message) =>
          message.role === 'user' && message.runId === persistedMsg.runId,
      );
      if (userMatch >= 0) {
        result[userMatch] = mergeUserForSameRun(
          result[userMatch],
          persistedMsg,
        );
        continue;
      }
    }

    // agent 兜底去重（WU-04 review-fix）：persisted 重建的 agent 气泡与 overlay 实时
    // agent 气泡按 runId + toolName 归并。实时气泡 id 已与历史重建同构（
    // hist-agent-${tool_use id}），正常按 identity 命中；此处兜底覆盖「实时 toolId
    // 不可得（回退 blk-N）」的罕见场景，防止 persisted 重建气泡被当作独有条目插入。
    if (persistedMsg.role === 'agent' && persistedMsg.runId) {
      const agentMatch = result.findIndex(
        (message) =>
          message.role === 'agent' &&
          message.runId === persistedMsg.runId &&
          message.toolName !== undefined &&
          message.toolName === persistedMsg.toolName,
      );
      if (agentMatch >= 0) {
        result[agentMatch] = mergeAgentForSameRun(
          persistedMsg,
          result[agentMatch],
        );
        continue;
      }
    }

    // 步骤 3：persisted 独有（overlay 中没有的旧历史条目）按锚点插入
    insertPersistedOnlyAtAnchor(
      result,
      persisted,
      persistedIndex,
      identity,
      overlayIdentityIndex,
    );
  }

  // 步骤 4：overlay 独有（persisted 尚未落盘的新条目）已在步骤 1 按 overlay
  // 顺序放入 result，无需额外处理。
  return result;
}

/**
 * user 消息双身份去重：保留 overlay 内容与 clientMessageId，吸收 persisted
 * 的稳定 id / messageId（history 再收敛时 identity 趋于稳定）。
 */
function mergeUserForSameRun(
  overlayMsg: ChatMessage,
  persistedMsg: ChatMessage,
): ChatMessage {
  return {
    ...overlayMsg,
    id: persistedMsg.id ?? overlayMsg.id,
    messageId: persistedMsg.messageId ?? overlayMsg.messageId,
  };
}

/**
 * persisted 独有条目插入：利用 overlay 与 persisted 共有的 identity 锚点。
 * 优先插到 persisted 中「下一个已存在锚点」之前（保持时间线顺序），
 * 找不到则插到「上一个已存在锚点」之后；都找不到则 append（极端场景兜底）。
 */
function insertPersistedOnlyAtAnchor(
  result: ChatMessage[],
  persisted: ChatMessage[],
  persistedIndex: number,
  identity: (message: ChatMessage) => string,
  overlayIdentityIndex: Map<string, number>,
): void {
  const persistedMsg = persisted[persistedIndex];

  // 下一个锚点：persisted 中位于 persistedMsg 之后、且在 overlay 骨架里有身份的条目
  for (let i = persistedIndex + 1; i < persisted.length; i += 1) {
    const nextKey = identity(persisted[i]);
    if (overlayIdentityIndex.has(nextKey)) {
      const resultIdx = result.findIndex((m) => identity(m) === nextKey);
      if (resultIdx >= 0) {
        result.splice(resultIdx, 0, persistedMsg);
        return;
      }
    }
  }

  // 上一个锚点：persisted 中位于 persistedMsg 之前的匹配条目
  for (let i = persistedIndex - 1; i >= 0; i -= 1) {
    const prevKey = identity(persisted[i]);
    if (overlayIdentityIndex.has(prevKey)) {
      const resultIdx = result.findIndex((m) => identity(m) === prevKey);
      if (resultIdx >= 0) {
        result.splice(resultIdx + 1, 0, persistedMsg);
        return;
      }
    }
  }

  // 兜底：append（极端场景，不影响当前 bug 修复路径）
  result.push(persistedMsg);
}

/**
 * history 收敛时 persisted 结构优先，但若 overlay 含更长 final text 则保留 overlay 文本。
 * 背景：done 后 history refetch 可能早于后端写入 final text 行，此时 persisted 只有
 * thinking/tool blocks，直接丢弃 overlay 会导致「回复流被吞 / 最终内容没了」。
 */
function mergeAssistantTextFromOverlay(
  target: ChatMessage,
  overlay: ChatMessage,
): ChatMessage {
  const targetTextLen = messageText(target).length;
  const overlayTextLen = messageText(overlay).length;
  if (overlayTextLen <= targetTextLen) return target;

  const nonTextBlocks = target.blocks.filter((b) => b.type !== 'text');
  const overlayTextBlocks = overlay.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => ({ ...b, status: 'done' as const }));
  return { ...target, blocks: [...nonTextBlocks, ...overlayTextBlocks] };
}

function mergeAssistantForSameRun(
  persisted: ChatMessage,
  overlay: ChatMessage,
  mode: 'overlay-wins' | 'persisted-wins',
): ChatMessage {
  if (mode === 'overlay-wins') {
    return {
      ...overlay,
      id: persisted.id,
      messageId: persisted.messageId ?? overlay.messageId,
    };
  }
  return mergeAssistantTextFromOverlay(persisted, overlay);
}

/**
 * agent 气泡去重合并（WU-04 review-fix）：overlay 实时气泡是权威（worker 步骤
 * blocks / 流式文本），persisted 重建气泡只补齐 overlay 缺失的稳定字段 / 内容，
 * 不覆盖实时渲染——避免 refetch 后 agent 气泡内容闪烁或丢失实时步骤。
 */
function mergeAgentForSameRun(
  persisted: ChatMessage,
  overlay: ChatMessage,
): ChatMessage {
  const overlayHasText = Boolean(overlay.text && overlay.text.length > 0);
  const overlayHasBlocks = overlay.blocks.length > 0;
  return {
    ...overlay,
    id: persisted.id ?? overlay.id,
    ...(!overlayHasText && persisted.text
      ? { text: persisted.text }
      : {}),
    ...(!overlayHasBlocks && persisted.blocks.length > 0
      ? { blocks: persisted.blocks, summary: persisted.summary }
      : {}),
    ...(overlay.actorName === undefined && persisted.actorName !== undefined
      ? { actorName: persisted.actorName }
      : {}),
  };
}

/**
 * 更新 runId 对应的「最后一条」assistant 消息。
 *
 * 主 Agent 多气泡（mainResume）后，同一 run 可能只有一条 assistant（旧气泡），
 * 收尾气泡使用新 runId——因此这里保持按 runId 精确匹配即可。改为从末尾向前
 * 查找：若同 runId 出现多条 assistant（历史路径等场景），以最新一条为准，
 * 避免旧等待态气泡被后续流式事件误更新。
 */
function updateAssistantForRun(
  messages: ChatMessage[],
  runId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  let index = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant' && message.runId === runId) {
      index = i;
      break;
    }
  }
  if (index < 0) return messages;
  const updated = updater(messages[index]);
  if (updated === messages[index]) return messages;
  const next = [...messages];
  next[index] = updated;
  return next;
}

/**
 * 把 agent 消息插入到 runId 匹配的最后一条 assistant 消息之后（WU-03 §4.3）。
 *
 * 锚定「该 run 最后一条 assistant」；若其后已有同 run 的 agent 消息则继续越过，
 * 以保持多个 agent_message 的到达顺序。找不到 assistant 时追加到末尾。
 * 返回新数组（不可变）。
 */
export function insertAgentMessage(
  messages: ChatMessage[],
  runId: string,
  agentMsg: ChatMessage,
): ChatMessage[] {
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === 'assistant' && message.runId === runId) {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) {
    return [...messages, agentMsg];
  }
  let insertAt = lastAssistantIdx + 1;
  while (
    insertAt < messages.length &&
    messages[insertAt].role === 'agent' &&
    messages[insertAt].runId === runId
  ) {
    insertAt += 1;
  }
  const next = [...messages];
  next.splice(insertAt, 0, agentMsg);
  return next;
}

/**
 * 按 (runId, actorId) 定位 agent 气泡（WU-02 并发 dispatch 隔离路由）。
 *
 * agent 气泡在同一 run 内可多条（不同 actorId）；命名 agent 的 actor.id 恒等于
 * agent_id（后端 `tools.ts` 不随派发实例唯一），同 turn 二次派发时 actorId 相同。
 * 因此从末尾向前查找取「最后一条」匹配气泡——它是最近一次 dispatch 的活动气泡，
 * 避免 worker 事件误写入已关闭的旧气泡。
 */
function findAgentMessageIndex(
  messages: ChatMessage[],
  runId: string,
  actorId: string,
): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (
      message.role === 'agent' &&
      message.runId === runId &&
      message.actorId === actorId
    ) {
      return i;
    }
  }
  return -1;
}

/** 对 (runId, actorId) 对应的 agent 气泡应用 updater；未找到时原样返回（不可变）。 */
function updateAgentForActor(
  messages: ChatMessage[],
  runId: string,
  actorId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const index = findAgentMessageIndex(messages, runId, actorId);
  if (index < 0) return messages;
  const updated = updater(messages[index]);
  if (updated === messages[index]) return messages;
  const next = [...messages];
  next[index] = updated;
  return next;
}

/** agent 气泡折叠摘要：已完成步骤 / 工具计数（WU-03 summary-line 契约）。 */
export function buildAgentSummary(blocks: Block[]): string {
  const doneSteps = blocks.filter(
    (block) => block.status === 'done' || block.status === 'error',
  ).length;
  const doneTools = blocks.filter(
    (block) =>
      block.type === 'tool_call' &&
      (block.status === 'done' || block.status === 'error'),
  ).length;
  return `已完成 ${doneSteps} 步 · ${doneTools} 个工具`;
}

// ============================================================
// useChatStream hook
// ============================================================

export function useChatStream(sessionId: string) {
  const messagesSelector = useMemo(
    () => selectSessionMessages(sessionId),
    [sessionId],
  );
  const statusSelector = useMemo(
    () => selectSessionStatus(sessionId),
    [sessionId],
  );
  const historyLoadedSelector = useMemo(
    () => selectSessionHistoryLoaded(sessionId),
    [sessionId],
  );
  const messages = useChatRuntimeStore(messagesSelector);
  const status = useChatRuntimeStore(statusSelector);
  const historyLoaded = useChatRuntimeStore(historyLoadedSelector);

  // ==========================================================
  // 初始化 + 加载历史
  // ==========================================================
  useEffect(() => {
    if (!sessionId) return;
    const store = useChatRuntimeStore.getState();
    store.ensureSession(sessionId);

    let cancelled = false;

    apiGet<SessionHistoryResponse>(
      `/api/sessions/${sessionId}/history`,
    )
      .then((data) => {
        if (cancelled) return;
        const rawMessages = data?.messages;
        if (!rawMessages) {
          store.applySessionHistory(sessionId, 0, (current) => current);
          return;
        }

        const revision = data.revision ?? rawMessages.length;
        if (data.sessionId && data.sessionId !== sessionId) return;
        const loaded = parseHistoryMessages(rawMessages);
        store.applySessionHistory(
          sessionId,
          revision,
          (overlay, pendingPersistence) =>
            mergePersistedWithOverlay(
              loaded,
              overlay,
              revision,
              (targetRunId) => pendingPersistence[targetRunId] ?? null,
            ),
        );
      })
      .catch(() => {
        if (!cancelled) {
          store.applySessionHistory(sessionId, 0, (current) => current);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // ==========================================================
  // 发送消息
  // ==========================================================
  const sendAttempt = useCallback(
    async (
      text: string,
      options?: ChatOptions,
      retryClientMessageId?: string,
    ) => {
      const store = useChatRuntimeStore.getState();
      const currentSession = store.getSession(sessionId);
      const currentStatus = currentSession?.status ?? 'idle';
      // P0 guard：status 检查 + activeRunId 检查双保险。
      // 背景：status='done'/'error'/'aborted' 等非终态切换瞬间，可能与 hub 端 active run
      // 状态不同步（用户切走 → 流在 B 渲染期间完成 → status 已切回 done，但 hub.runId 仍注册中）。
      // 此时前端如直接 send，后端 hub.hasActiveRun 会 409 并回写错误消息，
      // 视觉上呈现为「多了几个 AI 气泡」。
      if (['submitting', 'streaming', 'reconnecting'].includes(currentStatus)) {
        return;
      }
      if (currentSession?.activeRunId) {
        logger.warn('[useChatStream] send blocked: activeRunId present despite non-streaming status', {
          sessionId,
          status: currentStatus,
          activeRunId: currentSession.activeRunId,
        });
        return;
      }

      const ctrl = new AbortController();

      // 普通发送创建幂等键；retry 只复用 clientMessageId，run 始终重新创建。
      const clientMessageId =
        retryClientMessageId ?? crypto.randomUUID();
      const runId = crypto.randomUUID();

      store.createRun(sessionId, runId);
      store.setRunAbortController(runId, ctrl);
      store.setActiveRun(sessionId, runId);
      store.setSessionStatus(sessionId, 'submitting');

      // 添加 user 消息
      const userMsg: ChatMessage = {
        id: `user-${clientMessageId}`,
        role: 'user',
        blocks: [],
        text,
        clientMessageId,
        messageId: clientMessageId,
        runId,
      };
      const currentMessages = store.getSession(sessionId)?.messages ?? [];
      store.setSessionMessages(
        sessionId,
        retryClientMessageId
          ? currentMessages.map((message) =>
              message.role === 'user' &&
              message.clientMessageId === clientMessageId
                ? { ...message, runId }
                : message,
            )
          : [...currentMessages, userMsg],
      );
      const previousCandidate = store.getSession(sessionId)?.retryCandidate;
      store.setSessionRetryCandidate(sessionId, {
        clientMessageId,
        runId,
        sourceRunId:
          retryClientMessageId && previousCandidate
            ? previousCandidate.sourceRunId ?? previousCandidate.runId
            : runId,
        options: { ...(options ?? {}) },
      });

      logger.debug('📤 发送消息', {
        textLength: text.length,
        sessionId,
        runId,
      });

      const submittingTimer = setTimeout(() => {
        const currentRun = store.getRun(runId);
        if (currentRun?.status === 'queued') {
          currentRun.abortController?.abort();
          store.setRunStatus(runId, 'failed');
          store.setRunSubmittingTimer(runId, null);
          store.setRunAbortController(runId, null);
          if (store.getSession(sessionId)?.activeRunId === runId) {
            store.setActiveRun(sessionId, null);
            store.setSessionStatus(sessionId, 'error');
          }
        }
      }, SUBMITTING_TIMEOUT_MS);
      store.setRunSubmittingTimer(runId, submittingTimer);

      const finishRun = (
        runStatus: 'succeeded' | 'failed' | 'aborted',
        sessionStatus: ChatStatus,
        retainForPersistence = false,
      ) => {
        const ownsUi =
          store.getSession(sessionId)?.activeRunId === runId;
        store.setRunStatus(runId, runStatus);
        store.setRunSubmittingTimer(runId, null);
        store.setRunAbortController(runId, null);
        if (ownsUi) {
          store.setActiveRun(sessionId, null);
          store.setSessionStatus(sessionId, sessionStatus);
        }
        if (!retainForPersistence) store.removeRun(runId);
      };

      try {
        const body: Record<string, unknown> = { text, clientMessageId, runId };
        if (options?.model) body.model = options.model;
        if (options?.thinkingLevel) body.thinkingLevel = options.thinkingLevel;

        const res = await fetch(
          `/api/sessions/${sessionId}/messages/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal,
            credentials: 'same-origin',
          },
        );

        if (!res.ok) {
          const errBody = await res.text().catch(() => '');
          let errMsg = `HTTP ${res.status}`;
          try {
            const j = JSON.parse(errBody);
            if (j?.error?.message) errMsg = j.error.message;
          } catch {
            /* ignore */
          }
          // 409 特殊处理：已有 active run
          if (res.status === 409) {
            logger.warn('Session 已有 active run，拒绝发送');
          }
          store.updateMessages(sessionId, runId, (msgs) => [
            ...msgs,
            {
              id: `err-${Date.now().toString(36)}`,
              role: 'assistant',
              blocks: [
                {
                  id: nextBlockId(),
                  type: 'text',
                  status: 'error',
                  text: `❌ ${errMsg}`,
                },
              ],
              runId,
            },
          ]);
          finishRun('failed', 'error');
          return;
        }

        if (!res.body) throw new Error('No response body');

        let retries = 0;
        let assistantCreated = false;
        let terminalReceived = false;
        /**
         * 主 Agent 恢复（mainResume）后新建收尾气泡的 runId。
         * dispatch_done（dispatch_to）触发 mainResume 时写入；此后同一响应内
         * 的 assistant 流式事件（文本增量等）路由到该新气泡。
         */
        let mainResumeRunId: string | null = null;

        /** 确保 assistant 消息存在 */
        const ensureAssistant = () => {
          if (assistantCreated) return;
          assistantCreated = true;
          store.updateMessages(sessionId, runId, (msgs) => [
            ...msgs,
            {
              id: `asst-${runId}`,
              role: 'assistant',
              blocks: [],
              runId,
              streamState: 'thinking',
              streamStartTime: Date.now(),
            },
          ]);
        };

        for await (const evt of parseSseStream(res.body)) {
          try {
            const rawData = evt.data as Record<string, unknown>;

            // P0: 提取 envelope 字段
            const envSessionId = rawData.sessionId as string | undefined;
            const envRunId = rawData.runId as string | undefined;
            const envSeq = rawData.seq as number | undefined;
            const envEvent = (rawData.event as string) ?? evt.event;
            const innerData = (rawData.data as Record<string, unknown>) ?? rawData;

            // P0: 身份校验 — sessionId 必须匹配
            if (envSessionId && envSessionId !== sessionId) {
              logger.warn('事件 sessionId 不匹配，丢弃', {
                expected: sessionId,
                got: envSessionId,
              });
              continue;
            }

            // callback 捕获不可变 runId；activeRunId 在终态会先清空，
            // 不能用它阻断同一 run 后续的 rAF/history 收敛。
            if (envRunId && envRunId !== runId) {
              // 该事件属于已过期的 run，静默丢弃
              continue;
            }

            // P0: seq 去重
            if (envSeq !== undefined && envRunId) {
              const run = store.getRun(envRunId);
              if (run && envSeq <= run.lastSeq) continue;
              store.setRunLastSeq(envRunId, envSeq);
            }

            // ---- 事件分发 ----
            switch (envEvent) {
              case 'message_start': {
                ensureAssistant();
                if (store.getSession(sessionId)?.activeRunId === runId) {
                  store.setSessionStatus(sessionId, 'streaming');
                }
                store.setRunSubmittingTimer(runId, null);
                const msg = innerData.message as Record<string, unknown> | undefined;
                if (msg?.stream_id) {
                  store.setRunStreamId(runId, msg.stream_id as string);
                }
                if (msg?.id) {
                  // 更新 assistant 消息的 messageId
                  store.updateMessages(sessionId, runId, (msgs) =>
                    updateAssistantForRun(msgs, runId, (assistant) => ({
                      ...assistant,
                      messageId: msg.id as string,
                    })),
                  );
                }
                store.setRunStatus(runId, 'running');
                break;
              }

              case 'content_block_start': {
                ensureAssistant();
                const cb = innerData.content_block as Record<string, unknown> | undefined;
                if (cb?.type === 'tool_use') {
                  const toolId = (cb.id as string) || '';
                  const cbName = (cb.name as string) || '';
                  if (toolId && cbName) toolNameCache.set(toolId, cbName);
                  const toolName = cbName || toolNameCache.get(toolId) || '';
                  const blockStartRunId = mainResumeRunId ?? runId;
                  store.updateMessages(sessionId, blockStartRunId, (msgs) =>
                    updateAssistantForRun(msgs, blockStartRunId, (assistant) => {
                    const blocks = [...assistant.blocks];
                    blocks.push({
                      id: nextBlockId(),
                      type: 'tool_call',
                      status: 'streaming',
                      toolId,
                      toolName,
                      inputRaw: '',
                      blockId: cb.id as string | undefined,
                    });
                    return {
                        ...assistant,
                        blocks,
                        streamState: 'tool_executing',
                        activeToolCount: (assistant.activeToolCount ?? 0) + 1,
                      };
                    }),
                  );
                }
                break;
              }

              case 'content_block_delta': {
                const delta = innerData.delta as Record<string, unknown> | undefined;
                if (!delta) break;

                if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                  ensureAssistant();
                  // mainResume 后主 Agent 继续流式：文本路由到新收尾气泡，避免污染旧等待态气泡。
                  const targetRunId = mainResumeRunId ?? runId;
                  // P0: 使用 store 的 rAF 缓冲（按 run 隔离）
                  store.appendTextBuffer(targetRunId, delta.text);
                  store.updateMessages(sessionId, targetRunId, (msgs) =>
                    updateAssistantForRun(msgs, targetRunId, (assistant) =>
                      assistant.streamState === 'generating'
                        ? assistant
                        : { ...assistant, streamState: 'generating' },
                    ),
                  );
                }

                if (
                  delta.type === 'input_json_delta' &&
                  typeof delta.partial_json === 'string'
                ) {
                  const inputJsonRunId = mainResumeRunId ?? runId;
                  store.updateMessages(sessionId, inputJsonRunId, (msgs) =>
                    updateAssistantForRun(msgs, inputJsonRunId, (assistant) => {
                    const blocks = [...assistant.blocks];
                    let tcIdx = -1;
                    for (let i = blocks.length - 1; i >= 0; i--) {
                      if (blocks[i].type === 'tool_call' && blocks[i].status === 'streaming') {
                        tcIdx = i;
                        break;
                      }
                    }
                    if (tcIdx >= 0) {
                      const tc = blocks[tcIdx] as ToolCallBlock;
                      blocks[tcIdx] = {
                        ...tc,
                        inputRaw: tc.inputRaw + delta.partial_json,
                      };
                      return { ...assistant, blocks };
                    }
                    return assistant;
                    }),
                  );
                }
                break;
              }

              case 'content_block_stop': {
                const blockStopRunId = mainResumeRunId ?? runId;
                store.updateMessages(sessionId, blockStopRunId, (msgs) =>
                  updateAssistantForRun(msgs, blockStopRunId, (assistant) => {
                  const blocks = [...assistant.blocks];
                  let textIdx = -1;
                  for (let i = blocks.length - 1; i >= 0; i--) {
                    if (blocks[i].type === 'text' && blocks[i].status !== 'done') {
                      textIdx = i;
                      break;
                    }
                  }
                  if (textIdx >= 0) {
                    blocks[textIdx] = { ...blocks[textIdx], status: 'done' };
                  }
                  return { ...assistant, blocks };
                  }),
                );
                break;
              }

              case 'thinking_delta': {
                ensureAssistant();
                const thinking = (innerData.thinking as string) ?? '';
                if (!thinking) break;
                const thinkingRunId = mainResumeRunId ?? runId;
                store.updateMessages(sessionId, thinkingRunId, (msgs) =>
                  updateAssistantForRun(msgs, thinkingRunId, (assistant) => {
                  const blocks = [...assistant.blocks];
                  let thIdx = -1;
                  for (let i = blocks.length - 1; i >= 0; i--) {
                    if (blocks[i].type === 'thinking' && blocks[i].status === 'streaming') {
                      thIdx = i;
                      break;
                    }
                  }
                  if (thIdx >= 0) {
                    const th = blocks[thIdx] as ThinkingBlock;
                    blocks[thIdx] = {
                      ...th,
                      thinking: th.thinking + thinking,
                    };
                  } else {
                    // 标记之前 done 的 thinking
                    for (let i = blocks.length - 1; i >= 0; i--) {
                      if (blocks[i].type === 'thinking' && blocks[i].status === 'done') {
                        blocks[i] = { ...blocks[i], status: 'done' };
                        break;
                      }
                    }
                    blocks.push({
                      id: nextBlockId(),
                      type: 'thinking',
                      status: 'streaming',
                      thinking,
                      collapsed: true,
                    });
                  }
                  return { ...assistant, blocks, streamState: 'thinking' };
                  }),
                );
                break;
              }

              case 'tool_use': {
                ensureAssistant();
                const toolId = (innerData.id as string) ?? '';
                const cbName = (innerData.name as string) ?? '';
                if (toolId && cbName) toolNameCache.set(toolId, cbName);
                // 兜底：tool_use_delta SSE 帧不带 name —— 查同进程 toolNameCache
                const toolName = cbName || toolNameCache.get(toolId) || '';
                const isPartial = innerData.partial === true;
                // 子 Agent 身份（WU-03）：tool_use 帧可选 actor_name/actor_kind
                const actorName = (innerData.actor_name as string) ?? undefined;
                const actorKind = (innerData.actor_kind as string) ?? undefined;
                const actorFields =
                  actorName !== undefined || actorKind !== undefined
                    ? {
                        ...(actorName !== undefined ? { actorName } : {}),
                        ...(actorKind !== undefined ? { actorKind } : {}),
                      }
                    : {};

                const toolUseRunId = mainResumeRunId ?? runId;
                store.updateMessages(sessionId, toolUseRunId, (msgs) =>
                  updateAssistantForRun(msgs, toolUseRunId, (assistant) => {
                  const blocks = [...assistant.blocks];
                  const tcIdx = blocks.findIndex(
                    (b) => b.type === 'tool_call' && (b as import('./types').ToolCallBlock).toolId === toolId,
                  );

                  if (tcIdx >= 0) {
                    const tc = blocks[tcIdx] as import('./types').ToolCallBlock;
                    if (isPartial) {
                      const delta = typeof innerData.input === 'string' ? innerData.input : '';
                      blocks[tcIdx] = {
                        ...tc,
                        toolName: toolName || tc.toolName,
                        inputRaw: tc.inputRaw + delta,
                        ...actorFields,
                      };
                    } else {
                      blocks[tcIdx] = {
                        ...tc,
                        toolName: toolName || tc.toolName,
                        input:
                          typeof innerData.input === 'object' && innerData.input !== null
                            ? (innerData.input as Record<string, unknown>)
                            : tc.input,
                        status: 'done',
                        ...actorFields,
                      };
                    }
                  } else if (toolId) {
                    blocks.push({
                      id: nextBlockId(),
                      type: 'tool_call',
                      status: isPartial ? 'streaming' : 'done',
                      toolId,
                      toolName,
                      inputRaw: '',
                      blockId: toolId,
                      ...actorFields,
                    });
                  }
                  return {
                      ...assistant,
                      blocks,
                      streamState: 'tool_executing',
                      activeToolCount: (assistant.activeToolCount ?? 0) + (tcIdx >= 0 ? 0 : 1),
                    };
                  }),
                );
                break;
              }

              case 'tool_result': {
                const trToolUseId = (innerData.tool_use_id as string) ?? '';
                const trToolName = (innerData.tool_name as string) ?? '';
                const trContent = (innerData.content as string) ?? '';
                const trIsError = (innerData.is_error as boolean) ?? false;
                const trDurationMs = innerData.duration_ms as number | undefined;
                // 子 Agent 身份（WU-03）：tool_result 帧可选 actor_name/actor_kind
                const actorName = (innerData.actor_name as string) ?? undefined;
                const actorKind = (innerData.actor_kind as string) ?? undefined;

                const toolResultRunId = mainResumeRunId ?? runId;
                store.updateMessages(sessionId, toolResultRunId, (msgs) =>
                  updateAssistantForRun(msgs, toolResultRunId, (assistant) => {
                  const blocks = [...assistant.blocks];

                  // 标记对应 tool_call 为 done；同时补救 toolName —— Anthropic 协议下
                  // 部分 tool_use start 事件可能晚于 input delta，或 initial 事件的 name 字段
                  // 为空，需借助 tool_result 的 tool_name 兜底，否则用户看到工具名长时间空白。
                  // actor 字段同理：tool_call 优先，tool_result 兜底（仅缺失时补写）。
                  const tcIdx = blocks.findIndex(
                    (b) => b.type === 'tool_call' && (b as import('./types').ToolCallBlock).toolId === trToolUseId,
                  );
                  if (tcIdx >= 0) {
                    const tc = blocks[tcIdx] as import('./types').ToolCallBlock;
                    blocks[tcIdx] = {
                      ...tc,
                      toolName: trToolName || tc.toolName,
                      status: 'done',
                      ...(actorName !== undefined && tc.actorName === undefined
                        ? { actorName }
                        : {}),
                      ...(actorKind !== undefined && tc.actorKind === undefined
                        ? { actorKind }
                        : {}),
                    };
                  }

                  const existingResult = blocks.find(
                    (b) =>
                      b.type === 'tool_result' &&
                      (b as import('./types').ToolResultBlock).toolCallId === trToolUseId,
                  );
                  if (!existingResult) {
                    blocks.push({
                      id: nextBlockId(),
                      type: 'tool_result',
                      status: trIsError ? 'error' : 'done',
                      toolCallId: trToolUseId,
                      toolName: trToolName,
                      content: trContent,
                      isError: trIsError,
                      durationMs: trDurationMs,
                      blockId: `result:${trToolUseId}`,
                      ...(actorName !== undefined ? { actorName } : {}),
                      ...(actorKind !== undefined ? { actorKind } : {}),
                    });
                  }

                  const remaining = blocks.filter(
                    (b) => b.type === 'tool_call' && b.status !== 'done',
                  ).length;

                  return {
                      ...assistant,
                      blocks,
                      streamState: remaining > 0 ? 'tool_executing' : 'generating',
                      activeToolCount: remaining,
                    };
                  }),
                );
                break;
              }

              case 'tool_progress':
                break;

              // ==================================================
              // WU-02：子 Agent 实时流式气泡状态机
              // 事件契约见 spec §2 / plan WU-02；所有 agent 气泡更新
              // 均按 (runId, actorId) 路由，支持并发 dispatch 隔离。
              // ==================================================

              case 'dispatch_started': {
                // 派发开始：立即创建 role:'agent' 气泡（status working），
                // 插到该 run 最后一条 assistant 之后。
                // 同名 agent（actor.id=agent_id）可能同 turn 连续派发：若上一气泡
                // 仍在工作中（未 close），复用现有气泡而非新建。
                const dsActorId = (innerData.actorId as string) ?? '';
                if (!dsActorId) break;
                const dsToolName = (innerData.toolName as string) ?? '';
                const dsToolId = (innerData.toolId as string) ?? '';
                const dsIsFinal = (innerData.isFinal as boolean) ?? false;
                store.updateMessages(sessionId, runId, (msgs) => {
                  const existingIdx = findAgentMessageIndex(msgs, runId, dsActorId);
                  const existingActive =
                    existingIdx >= 0 &&
                    msgs[existingIdx].status !== 'done';
                  if (existingActive) return msgs;
                  // 稳定 id（WU-04 review-fix）：与历史重建 rebuildDispatchAgentMessages
                  // 同构 `hist-agent-${tool_use id}`，使 done 后 refetch 的 merge 能按
                  // identity 命中 persisted 重建的 agent 气泡，避免重复插入。
                  // 后端 dispatch_started 的 toolId 是合成 `sub:...`，与持久化 tool_use id
                  // 不一致，因此回查该 run assistant 消息里最后一个未被占用的 dispatch
                  // tool_call block，取其真实 tool_use id。
                  const agentId = (() => {
                    for (let i = msgs.length - 1; i >= 0; i -= 1) {
                      const msg = msgs[i];
                      if (msg.role !== 'assistant') continue;
                      const blocks = msg.blocks;
                      for (let b = blocks.length - 1; b >= 0; b -= 1) {
                        const block = blocks[b];
                        if (block.type !== 'tool_call') continue;
                        if (block.toolName !== dsToolName) continue;
                        if (!block.toolId) continue;
                        const candidateId = `hist-agent-${block.toolId}`;
                        if (
                          !msgs.some(
                            (m) => m.role === 'agent' && m.id === candidateId,
                          )
                        ) {
                          return candidateId;
                        }
                      }
                    }
                    return nextBlockId();
                  })();
                  return insertAgentMessage(msgs, runId, {
                    id: agentId,
                    role: 'agent',
                    blocks: [],
                    text: '',
                    actorId: dsActorId,
                    ...((innerData.actorName as string | undefined)
                      ? { actorName: innerData.actorName as string }
                      : {}),
                    ...(dsToolName ? { toolName: dsToolName } : {}),
                    ...(dsToolId ? { toolId: dsToolId } : {}),
                    isFinal: dsIsFinal,
                    status: 'working',
                    runId,
                  });
                });
                break;
              }

              case 'worker_step_start': {
                // worker 步骤开始：向对应气泡 blocks 推入 thinking / tool_call 步骤。
                const wsActorId = (innerData.actorId as string) ?? '';
                if (!wsActorId) break;
                const kind = (innerData.kind as string) ?? '';
                const label = (innerData.label as string) ?? '';
                const stepId = (innerData.stepId as string) ?? '';
                if (!stepId) break;
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAgentForActor(msgs, runId, wsActorId, (agentMsg) => {
                    const blocks = [...agentMsg.blocks];
                    if (kind === 'thinking') {
                      blocks.push({
                        id: nextBlockId(),
                        type: 'thinking',
                        status: 'streaming' as const,
                        thinking: label,
                        collapsed: false,
                        stepId,
                      });
                    } else {
                      blocks.push({
                        id: nextBlockId(),
                        type: 'tool_call',
                        status: 'streaming' as const,
                        toolId: stepId,
                        toolName: label,
                        inputRaw: '',
                        stepId,
                      });
                    }
                    return { ...agentMsg, blocks, summary: buildAgentSummary(blocks) };
                  }),
                );
                break;
              }

              case 'worker_text_delta': {
                // worker 文本增量：agent 气泡 .text 追加（typewriter）。
                const wtActorId = (innerData.actorId as string) ?? '';
                const deltaText = (innerData.text as string) ?? '';
                if (!wtActorId || !deltaText) break;
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAgentForActor(msgs, runId, wtActorId, (agentMsg) => ({
                    ...agentMsg,
                    text: (agentMsg.text ?? '') + deltaText,
                  })),
                );
                break;
              }

              case 'worker_step_end': {
                // worker 步骤结束：finalize 对应内部步骤 + 追加 tool_result 摘要。
                const weActorId = (innerData.actorId as string) ?? '';
                const weStepId = (innerData.stepId as string) ?? '';
                if (!weActorId || !weStepId) break;
                const stepSummary = (innerData.summary as string) ?? '';
                const stepIsError = (innerData.isError as boolean) ?? false;
                const stepStatus: 'done' | 'error' = stepIsError ? 'error' : 'done';
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAgentForActor(msgs, runId, weActorId, (agentMsg) => {
                    const blocks = agentMsg.blocks.map((block) => {
                      if (block.stepId !== weStepId) return block;
                      if (block.type === 'tool_call') {
                        return { ...block, status: stepStatus };
                      }
                      if (block.type === 'thinking') {
                        return { ...block, status: 'done' as const };
                      }
                      return block;
                    });
                    const toolCall = agentMsg.blocks.find(
                      (block): block is ToolCallBlock =>
                        block.type === 'tool_call' && block.stepId === weStepId,
                    );
                    const nextBlocks = toolCall
                      ? [
                          ...blocks,
                          {
                            id: nextBlockId(),
                            type: 'tool_result' as const,
                            status: stepStatus as 'done' | 'error',
                            toolCallId: toolCall.toolId,
                            toolName: toolCall.toolName,
                            content: stepSummary,
                            isError: stepIsError,
                            stepId: weStepId,
                          },
                        ]
                      : blocks;
                    return {
                      ...agentMsg,
                      blocks: nextBlocks,
                      summary: buildAgentSummary(nextBlocks),
                    };
                  }),
                );
                break;
              }

              case 'dispatch_done': {
                // 派发完成：关闭 agent 气泡；dispatch_to（非 hand_off_to）触发 mainResume
                // → 旧主 Agent 气泡标 done + 新建收尾气泡（新 runId 隔离路由）。
                const ddActorId = (innerData.actorId as string) ?? '';
                if (!ddActorId) break;
                const ddToolName = (innerData.toolName as string) ?? '';
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAgentForActor(msgs, runId, ddActorId, (agentMsg) =>
                    agentMsg.status === 'done'
                      ? agentMsg
                      : { ...agentMsg, status: 'done' },
                  ),
                );
                const isHandOff = ddToolName === 'hand_off_to';
                if (!isHandOff) {
                  const newRunId = crypto.randomUUID();
                  store.createRun(sessionId, newRunId);
                  store.setRunStatus(newRunId, 'running');
                  store.updateMessages(sessionId, runId, (msgs) => {
                    const withOldDone = updateAssistantForRun(msgs, runId, (assistant) => {
                      const next: ChatMessage =
                        assistant.streamState === 'done'
                          ? assistant
                          : { ...assistant, streamState: 'done' };
                      // WU-04 review-fix：等待态气泡的 messageId 来自 message_start
                      //（= assistantMessageId），但该 id 属于终态收尾行（runner 非终态
                      // 行用 randomUUID）。这里清空，避免 refetch merge 时 persisted
                      // 终态行按 messageId 误命中等待气泡 → 收尾文本双份。
                      if (next.messageId !== undefined) {
                        return { ...next, messageId: undefined };
                      }
                      return next;
                    });
                    return [
                      ...withOldDone,
                      {
                        id: nextBlockId(),
                        role: 'assistant',
                        blocks: [],
                        runId: newRunId,
                        streamState: 'generating',
                        streamStartTime: Date.now(),
                      },
                    ];
                  });
                  mainResumeRunId = newRunId;
                }
                break;
              }

              case 'agent_message': {
                // WU-03：子 Agent 可见回复。
                // - 已有「实时气泡」（dispatch_started 创建，带 toolName/toolId）→ 收尾：
                //   标 done / isFinal，文本与 worker_text_delta 流式内容去重；
                // - 无实时气泡（纯 agent_message 兼容路径）→ 维持既有逻辑：每个事件新建气泡。
                const amActorId = (innerData.actorId as string) ?? '';
                if (!amActorId) break;
                const amText = (innerData.text as string) ?? '';
                const amIsFinal = (innerData.isFinal as boolean) ?? false;
                store.updateMessages(sessionId, runId, (msgs) => {
                  const existingIdx = findAgentMessageIndex(msgs, runId, amActorId);
                  const realtimeBubble =
                    existingIdx >= 0 &&
                    Boolean(
                      msgs[existingIdx].toolName ?? msgs[existingIdx].toolId,
                    );
                  if (realtimeBubble) {
                    const existing = msgs[existingIdx];
                    const existingText = existing.text ?? '';
                    // 文本合并：最终文本权威。流式文本为最终文本前缀时以最终文本为准，
                    // 避免 includes 在前缀场景（流式丢尾 / 与最终 result 不一致）重复拼接。
                    const nextText =
                      amText !== '' && amText.startsWith(existingText)
                        ? amText
                        : existingText.startsWith(amText)
                          ? existingText
                          : existingText + amText;
                    const next = [...msgs];
                    next[existingIdx] = {
                      ...existing,
                      text: nextText,
                      isFinal: amIsFinal,
                      status: 'done',
                    };
                    return next;
                  }
                  return insertAgentMessage(msgs, runId, {
                    id: nextBlockId(),
                    role: 'agent',
                    blocks: [],
                    text: amText,
                    actorId: amActorId,
                    ...(innerData.actorName !== undefined
                      ? { actorName: innerData.actorName as string }
                      : {}),
                    ...(innerData.actorKind !== undefined
                      ? { actorKind: innerData.actorKind as string }
                      : {}),
                    isFinal: amIsFinal,
                    status: 'done',
                    runId,
                  });
                });
                break;
              }

              case 'compaction':
              case 'context_status':
              case 'retry':
              case 'provider_fallback':
                break;

              case 'message_delta': {
                logger.debug('📥 message_delta', {
                  stop_reason: innerData.stop_reason,
                });
                break;
              }

              case 'message_stop': {
                // mainResume 后主 Agent 恢复流在同一响应内：终态路由到恢复气泡。
                const stopRunId = mainResumeRunId ?? runId;
                store.setRunMessageStopped(stopRunId, true);
                store.updateMessages(sessionId, stopRunId, (msgs) =>
                  updateAssistantForRun(msgs, stopRunId, (assistant) => ({
                    ...assistant,
                    blocks: assistant.blocks.map((block) =>
                      block.status === 'streaming'
                        ? { ...block, status: 'done' as const }
                        : block,
                    ),
                    streamState: 'done',
                  })),
                );
                break;
              }

              case 'usage': {
                const usage = innerData.usage as Record<string, unknown> | undefined;
                if (usage) {
                  const usageRunId = mainResumeRunId ?? runId;
                  store.updateMessages(sessionId, usageRunId, (msgs) =>
                    updateAssistantForRun(msgs, usageRunId, (assistant) => ({
                        ...assistant,
                        usage: {
                          inputTokens: (usage.inputTokens as number) ?? 0,
                          outputTokens: (usage.outputTokens as number) ?? 0,
                          totalTokens: (usage.totalTokens as number) ?? 0,
                        },
                      }),
                    ),
                  );
                }
                break;
              }

              case 'done': {
                terminalReceived = true;
                const persistedRevision = innerData.persistedRevision as number | undefined;
                const messageId = innerData.messageId as string | undefined;
                const deduplicated = innerData.deduplicated === true;

                if (deduplicated) {
                  store.cancelRunRaf(runId);
                  const retryCandidate =
                    store.getSession(sessionId)?.retryCandidate;
                  store.updateMessages(sessionId, runId, (messages) =>
                    messages
                      .filter(
                        (message) =>
                          !(
                            message.role === 'assistant' &&
                            message.runId === runId &&
                            message.blocks.length === 0
                          ),
                      )
                      .map((message) => {
                        if (
                          message.role === 'user' &&
                          retryCandidate?.runId === runId &&
                          message.clientMessageId ===
                            retryCandidate.clientMessageId
                        ) {
                          return {
                            ...message,
                            runId: retryCandidate.sourceRunId,
                          };
                        }
                        if (
                          message.role === 'assistant' &&
                          messageId &&
                          message.messageId === messageId &&
                          persistedRevision !== undefined
                        ) {
                          return {
                            ...message,
                            pendingPersistenceRevision: persistedRevision,
                          };
                        }
                        return message;
                      }),
                  );

                  if (persistedRevision !== undefined && messageId) {
                    apiGet<SessionHistoryResponse>(
                      `/api/sessions/${sessionId}/history`,
                    )
                      .then((data) => {
                        if (!data?.messages) return;
                        if (data.sessionId && data.sessionId !== sessionId) return;
                        const currentRevision =
                          data.revision ?? data.messages.length;
                        const freshLoaded = parseHistoryMessages(data.messages);
                        store.applySessionHistory(
                          sessionId,
                          currentRevision,
                          (overlay, pendingPersistence) =>
                            mergePersistedWithOverlay(
                              freshLoaded,
                              overlay,
                              currentRevision,
                              (targetRunId) =>
                                pendingPersistence[targetRunId] ?? null,
                            ),
                        );
                      })
                      .catch(() => {
                        // dedup refetch 失败时保留原 overlay，不创建占位消息。
                      });
                  }

                  logger.debug('📥 去重响应已收敛', {
                    sessionId,
                    runId,
                    messageId,
                    persistedRevision,
                  });
                  finishRun('succeeded', 'done');
                  return;
                }

                // flush text buffer + finalize
                store.flushTextBuffer(runId);
                store.cancelRunRaf(runId);
                // mainResume 后主 Agent 恢复流的文本缓冲按新 run 隔离，需一并冲刷，
                // 恢复气泡同步 finalize，并回收合成 run（避免僵尸 run 累积）。
                const resumeRunId = mainResumeRunId;
                if (resumeRunId) {
                  store.flushTextBuffer(resumeRunId);
                  store.cancelRunRaf(resumeRunId);
                  store.updateMessages(sessionId, resumeRunId, (msgs) =>
                    updateAssistantForRun(msgs, resumeRunId, (assistant) => {
                      const finalized = finalizeStreamingBlocks(assistant.blocks);
                      const finalizedAssistant: ChatMessage =
                        finalized === assistant.blocks
                          ? assistant
                          : {
                              ...assistant,
                              blocks: finalized,
                              streamState: 'done',
                            };
                      // WU-04 review-fix：done.messageId 即终态收尾 assistant 的持久化
                      // id。写入合成收尾气泡，使 refetch merge 按 messageId 精确命中该
                      // 气泡（而非等待态气泡），收尾文本只保留一份。
                      if (messageId !== undefined) {
                        return { ...finalizedAssistant, messageId };
                      }
                      return finalizedAssistant;
                    }),
                  );
                  store.removeRun(resumeRunId);
                }
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => {
                    const finalized = finalizeStreamingBlocks(assistant.blocks);
                    return finalized === assistant.blocks
                      ? assistant
                      : { ...assistant, blocks: finalized, streamState: 'done' };
                  }),
                );

                // P0: 收到 persistedRevision → 触发 history refetch
                if (persistedRevision !== undefined) {
                  store.setRunPersistedRevision(runId, persistedRevision);
                  store.markRunAwaitingPersistence(runId, persistedRevision);
                  // 异步 refetch history 以原子替换 overlay
                  apiGet<SessionHistoryResponse>(
                    `/api/sessions/${sessionId}/history`,
                  )
                    .then((data) => {
                      if (!data?.messages) return;
                      if (data.sessionId && data.sessionId !== sessionId) return;
                      const currentRevision = data.revision ?? data.messages.length;
                      const freshLoaded = parseHistoryMessages(data.messages);
                      store.applySessionHistory(
                        sessionId,
                        currentRevision,
                        (overlay, pendingPersistence) =>
                          mergePersistedWithOverlay(
                            freshLoaded,
                            overlay,
                            currentRevision,
                            (targetRunId) =>
                              pendingPersistence[targetRunId] ?? null,
                          ),
                      );
                    })
                    .catch(() => {
                      // refetch 失败保留 overlay
                    });
                }

                logger.debug('📥 流式响应完成');
                finishRun(
                  'succeeded',
                  'done',
                  persistedRevision !== undefined,
                );
                return;
              }

              case 'error': {
                terminalReceived = true;
                store.flushTextBuffer(runId);
                store.cancelRunRaf(runId);
                const errInfo = innerData.error as Record<string, unknown> | undefined;
                const errMsg = (errInfo?.message as string) || '未知错误';
                logger.error(`❌ 流式响应错误: ${errMsg}`);
                const errRunId = mainResumeRunId ?? runId;
                store.updateMessages(sessionId, errRunId, (msgs) => {
                  const assistantExists = msgs.some(
                    (message) =>
                      message.role === 'assistant' && message.runId === errRunId,
                  );
                  if (assistantExists) {
                    return updateAssistantForRun(msgs, errRunId, (assistant) => {
                    const blocks = finalizeStreamingBlocks([...assistant.blocks]);
                    blocks.push({
                      id: nextBlockId(),
                      type: 'text',
                      status: 'error',
                      text: `❌ 错误：${errMsg}`,
                    });
                    return { ...assistant, blocks, streamState: 'done' };
                    });
                  }
                  return [
                    ...msgs,
                    {
                      id: `err-${Date.now().toString(36)}`,
                      role: 'assistant',
                      blocks: [
                        {
                          id: nextBlockId(),
                          type: 'text',
                          status: 'error',
                          text: `❌ 错误：${errMsg}`,
                        },
                      ],
                      runId: errRunId,
                    },
                  ];
                });
                finishRun('failed', 'error');
                return;
              }

              case 'aborted': {
                terminalReceived = true;
                store.flushTextBuffer(runId);
                store.cancelRunRaf(runId);
                const abortedRunId = mainResumeRunId ?? runId;
                store.updateMessages(sessionId, abortedRunId, (msgs) =>
                  updateAssistantForRun(msgs, abortedRunId, (assistant) => {
                    const finalized = finalizeStreamingBlocks(assistant.blocks);
                    return finalized === assistant.blocks
                      ? assistant
                      : { ...assistant, blocks: finalized, streamState: 'done' };
                  }),
                );
                finishRun('aborted', 'aborted');
                return;
              }

              default:
                break;
            }
          } catch {
            if (retries >= MAX_RETRIES) {
              finishRun('failed', 'error');
              return;
            }
            retries += 1;
            await new Promise((r) =>
              setTimeout(r, BACKOFF_MS[retries - 1] ?? 16000),
            );
            if (store.getSession(sessionId)?.activeRunId === runId) {
              store.setSessionStatus(sessionId, 'reconnecting');
            }
          }
        }

        if (!terminalReceived) {
          // 正常 EOF 只表示连接关闭，不代表 run 成功；保留已 flush 的 partial overlay。
          store.flushTextBuffer(runId);
          store.cancelRunRaf(runId);
          logger.error('❌ 流式连接在 terminal 事件前关闭', {
            sessionId,
            runId,
          });
          finishRun('failed', 'error');
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          logger.debug('⏹️ 请求已取消');
          finishRun('aborted', 'aborted');
        } else {
          logger.error('❌ 流式请求失败', {
            error: err instanceof Error ? err.message : String(err),
          });
          finishRun('failed', 'error');
        }
      }
    },
    [sessionId],
  );

  const send = useCallback(
    (text: string, options?: ChatOptions) => sendAttempt(text, options),
    [sendAttempt],
  );

  // ==========================================================
  // abort — 精确按 (sessionId, runId) 中止
  // ==========================================================
  const abort = useCallback(() => {
    const store = useChatRuntimeStore.getState();
    const currentRunId = store.getSession(sessionId)?.activeRunId;
    if (!currentRunId) return;

    // 1) abort fetch
    const run = store.getRun(currentRunId);
    run?.abortController?.abort();
    store.setRunAbortController(currentRunId, null);

    // 2) 切状态
    store.setSessionStatus(sessionId, 'aborted');
    store.setRunStatus(currentRunId, 'aborted');
    store.setRunSubmittingTimer(currentRunId, null);
    store.setActiveRun(sessionId, null);
  }, [sessionId]);

  // ==========================================================
  // retry
  // ==========================================================
  const retry = useCallback(() => {
    const store = useChatRuntimeStore.getState();
    const sess = store.getSession(sessionId);
    const candidate = sess?.retryCandidate;
    if (!sess || !candidate) return;
    const lastUserMsg = [...sess.messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'user' &&
          message.clientMessageId === candidate.clientMessageId,
      );
    if (lastUserMsg) {
      const text = lastUserMsg.text ?? messageText(lastUserMsg);
      void sendAttempt(
        text,
        candidate.options,
        candidate.clientMessageId,
      );
    }
  }, [sessionId, sendAttempt]);

  return { status, messages, send, abort, retry, historyLoaded };
}
