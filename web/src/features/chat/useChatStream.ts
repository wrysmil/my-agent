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
} from './types';

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

interface SerializedMsg {
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

function parseHistoryMessages(rawMessages: SerializedMsg[]): ChatMessage[] {
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
    const groupKey = m.runId
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
  }

  return messages;
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

function updateAssistantForRun(
  messages: ChatMessage[],
  runId: string,
  updater: (message: ChatMessage) => ChatMessage,
): ChatMessage[] {
  const index = messages.findIndex(
    (message) => message.role === 'assistant' && message.runId === runId,
  );
  if (index < 0) return messages;
  const updated = updater(messages[index]);
  if (updated === messages[index]) return messages;
  const next = [...messages];
  next[index] = updated;
  return next;
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
                  store.updateMessages(sessionId, runId, (msgs) =>
                    updateAssistantForRun(msgs, runId, (assistant) => {
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
                  // P0: 使用 store 的 rAF 缓冲（按 run 隔离）
                  store.appendTextBuffer(runId, delta.text);
                  store.updateMessages(sessionId, runId, (msgs) =>
                    updateAssistantForRun(msgs, runId, (assistant) =>
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
                  store.updateMessages(sessionId, runId, (msgs) =>
                    updateAssistantForRun(msgs, runId, (assistant) => {
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
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => {
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
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => {
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

                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => {
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

                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => {
                  const blocks = [...assistant.blocks];

                  // 标记对应 tool_call 为 done；同时补救 toolName —— Anthropic 协议下
                  // 部分 tool_use start 事件可能晚于 input delta，或 initial 事件的 name 字段
                  // 为空，需借助 tool_result 的 tool_name 兜底，否则用户看到工具名长时间空白。
                  const tcIdx = blocks.findIndex(
                    (b) => b.type === 'tool_call' && (b as import('./types').ToolCallBlock).toolId === trToolUseId,
                  );
                  if (tcIdx >= 0) {
                    const tc = blocks[tcIdx] as import('./types').ToolCallBlock;
                    blocks[tcIdx] = {
                      ...tc,
                      toolName: trToolName || tc.toolName,
                      status: 'done',
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
                store.setRunMessageStopped(runId, true);
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => ({
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
                  store.updateMessages(sessionId, runId, (msgs) =>
                    updateAssistantForRun(msgs, runId, (assistant) => ({
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
                store.updateMessages(sessionId, runId, (msgs) => {
                  const assistantExists = msgs.some(
                    (message) =>
                      message.role === 'assistant' && message.runId === runId,
                  );
                  if (assistantExists) {
                    return updateAssistantForRun(msgs, runId, (assistant) => {
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
                      runId,
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
                store.updateMessages(sessionId, runId, (msgs) =>
                  updateAssistantForRun(msgs, runId, (assistant) => {
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
