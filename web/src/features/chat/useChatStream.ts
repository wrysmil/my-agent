import { useState, useRef, useCallback, useEffect } from 'react';
import { parseSseStream } from '@/lib/sse';
import { apiGet } from '@/lib/api';
import { logger } from '@/lib/logger';
import type {
  ChatStatus,
  ChatMessage,
  ChatOptions,
  Block,
  TextBlock,
  ThinkingBlock,
  ToolCallBlock,
  ToolResultBlock,
  SseEventData,
} from './types';

// ============================================================
// 常量
// ============================================================

const MAX_RETRIES = 5;
const SUBMITTING_TIMEOUT_MS = 60_000;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

let _msgIdCounter = 0;
function nextMsgId(): string {
  _msgIdCounter += 1;
  return `msg-${_msgIdCounter}-${Date.now().toString(36)}`;
}

let _blockIdCounter = 0;
function nextBlockId(): string {
  _blockIdCounter += 1;
  return `blk-${_blockIdCounter}`;
}

// ============================================================
// 辅助函数
// ============================================================

/** 找消息中最后一个匹配类型的 block */
function lastBlockOf<T extends Block>(blocks: Block[], type: T['type']): T | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === type) return blocks[i] as T;
  }
  return undefined;
}

/**
 * 把 blocks 里所有 status === 'streaming' 的项翻成 'done'。
 *
 * 用于流收尾路径（done / error / aborted / 流自然结束）兜底：
 * 正常情况下 `message_stop` 会处理这件事，但 SSE 解析偶发丢包时该事件不到达，
 * 没有这个兜底的话 thinking / tool_call block 会一直停留在 streaming 状态，
 * UI 上 "思考中..." 永远不消失。
 *
 * 如果没有需要收尾的 block，返回原数组引用以避免无谓的重渲染。
 */
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

/** 找消息中最后一个状态不是 done 的 block */
function activeBlock(blocks: Block[]): Block | undefined {
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].status !== 'done' && blocks[i].status !== 'error') return blocks[i];
  }
  return undefined;
}

/** 提取消息的纯文本（用于复制、历史加载等） */
export function messageText(msg: ChatMessage): string {
  if (msg.text) return msg.text;
  return msg.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

/** 从 blocks 提取纯文本 */
function blocksText(blocks: Block[]): string {
  return blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

// ============================================================
// Serialized types for history loading
// ============================================================

/** 对应后端 SerializedMessage（session-serde.ts）的 JSON 序列化格式 */
interface SerializedContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  thinkingSignature?: string;
  /** tool_use 块：工具调用 ID（API camelCase） */
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  /** tool_result 块：对应的 tool_use ID（API camelCase） */
  toolUseId?: string;
  content?: string;
  isError?: boolean;
  data?: string;
  mediaType?: string;
}

interface SerializedMsg {
  role: string;
  /** API 返回的 content 始终是 MessageContent[] 数组（非字符串） */
  content: SerializedContentBlock[];
  turnId?: number;
  ts?: number;
}

// ============================================================
// useChatStream hook
// ============================================================

export function useChatStream(sessionId: string) {
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const submittingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusRef = useRef<ChatStatus>('idle');
  const optionsRef = useRef<ChatOptions>({});

  const setStatusSafe = useCallback((s: ChatStatus) => {
    statusRef.current = s;
    setStatus(s);
  }, []);

  // ==========================================================
  // 加载历史消息
  // ==========================================================
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;

    setHistoryLoaded(false);
    setMessages([]);

    apiGet<{ messages: SerializedMsg[] }>(`/api/sessions/${sessionId}/history`)
      .then((data) => {
        if (cancelled || !data?.messages) {
          if (!cancelled) setHistoryLoaded(true);
          return;
        }
        const loaded: ChatMessage[] = [];
        for (const m of data.messages) {
          const role = m.role === 'user' ? 'user' as const : 'assistant' as const;
          const msgId = nextMsgId();

          if (role === 'user') {
            // user 消息的 content 是 MessageContent[] 数组，提取 text 块
            let text = '';
            if (Array.isArray(m.content)) {
              text = m.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text || '')
                .join('\n');
            }
            loaded.push({ id: msgId, role: 'user', blocks: [], text });
          } else {
            // Assistant 消息：解析 content blocks（含 tool_use / tool_result / thinking）
            const blocks = parseHistoryBlocks(m, msgId);
            loaded.push({ id: msgId, role: 'assistant', blocks });
          }
        }
        if (!cancelled) {
          setMessages(loaded);
          setHistoryLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setHistoryLoaded(true);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  // ==========================================================
  // 发送消息
  // ==========================================================
  const send = useCallback(
    async (text: string, options?: ChatOptions) => {
      if (
        ['submitting', 'streaming', 'reconnecting'].includes(statusRef.current)
      )
        return;
      const ctrl = new AbortController();
      controllerRef.current = ctrl;
      streamIdRef.current = null;
      optionsRef.current = options ?? {};
      setStatusSafe('submitting');

      const userMsgId = nextMsgId();
      setMessages((m) => [...m, { id: userMsgId, role: 'user', blocks: [], text }]);
      logger.debug(`📤 发送消息 → ${sessionId}`, { text: text.slice(0, 80) });

      if (submittingTimerRef.current) clearTimeout(submittingTimerRef.current);
      submittingTimerRef.current = setTimeout(() => {
        if (statusRef.current === 'submitting') setStatusSafe('error');
      }, SUBMITTING_TIMEOUT_MS);

      try {
        const body: Record<string, unknown> = { text };
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
          } catch { /* ignore */ }
          const errMsgId = nextMsgId();
          setMessages((m) => [
            ...m,
            {
              id: errMsgId,
              role: 'assistant',
              blocks: [{
                id: nextBlockId(), type: 'text', status: 'error',
                text: `❌ ${errMsg}`,
              }],
            },
          ]);
          setStatusSafe('error');
          return;
        }
        if (!res.body) throw new Error('No response body');

        let retries = 0;
        const assistantMsgId = nextMsgId();
        let assistantCreated = false;

        // rAF 节流状态
        let rafHandle: number | null = null;
        let rafScheduled = false;
        let pendingTextBuf = '';

        const flushTextRaf = () => {
          rafScheduled = false;
          rafHandle = null;
          if (!pendingTextBuf) return;
          const piece = pendingTextBuf;
          pendingTextBuf = '';
          setMessages((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== 'assistant') return m;
            const blocks = [...last.blocks];
            const textBlock = lastBlockOf<TextBlock>(blocks, 'text');
            if (textBlock && textBlock.status !== 'done') {
              const idx = blocks.indexOf(textBlock);
              blocks[idx] = { ...textBlock, text: textBlock.text + piece };
            } else {
              blocks.push({
                id: nextBlockId(), type: 'text', status: 'streaming',
                text: piece,
              });
            }
            return [...m.slice(0, -1), { ...last, blocks }];
          });
        };

        const scheduleFlush = (piece: string) => {
          pendingTextBuf += piece;
          if (!rafScheduled) {
            rafScheduled = true;
            rafHandle = requestAnimationFrame(flushTextRaf);
          }
        };

        // 确保 assistant 消息存在
        const ensureAssistant = () => {
          if (assistantCreated) return;
          assistantCreated = true;
          setMessages((m) => [
            ...m,
            {
              id: assistantMsgId,
              role: 'assistant',
              blocks: [],
              streamState: 'thinking',
              streamStartTime: Date.now(),
            },
          ]);
        };

        for await (const evt of parseSseStream(res.body)) {
          try {
            const data = evt.data as SseEventData;

            switch (evt.event) {
              // ---- 消息开始 ----
              case 'message_start': {
                setStatusSafe('streaming');
                if (submittingTimerRef.current) clearTimeout(submittingTimerRef.current);
                const msg = (data as Record<string, unknown>)?.message as Record<string, unknown> | undefined;
                if (msg?.stream_id) streamIdRef.current = msg.stream_id as string;
                ensureAssistant();
                break;
              }

              // ---- 文本块 ----
              case 'content_block_start': {
                ensureAssistant();
                const d = data as Record<string, unknown>;
                const cb = d?.content_block as Record<string, unknown> | undefined;
                if (cb?.type === 'tool_use') {
                  // 工具调用块开始
                  setMessages((m) => {
                    const last = m[m.length - 1];
                    if (!last || last.role !== 'assistant') return m;
                    const blocks = [...last.blocks];
                    const tcBlock: ToolCallBlock = {
                      id: nextBlockId(),
                      type: 'tool_call',
                      status: 'streaming',
                      toolId: (cb.id as string) || '',
                      toolName: (cb.name as string) || '',
                      inputRaw: '',
                    };
                    blocks.push(tcBlock);
                    return [...m.slice(0, -1), {
                      ...last,
                      blocks,
                      streamState: 'tool_executing',
                      activeToolCount: (last.activeToolCount ?? 0) + 1,
                    }];
                  });
                }
                break;
              }

              case 'content_block_delta': {
                const d = data as Record<string, unknown>;
                const delta = d?.delta as Record<string, unknown> | undefined;
                if (!delta) break;

                // 文本增量
                if (delta.type === 'text_delta' && typeof delta.text === 'string') {
                  ensureAssistant();
                  scheduleFlush(delta.text);
                  setMessages((m) => {
                    const last = m[m.length - 1];
                    if (!last || last.role !== 'assistant') return m;
                    if (last.streamState !== 'generating') {
                      return [...m.slice(0, -1), { ...last, streamState: 'generating' }];
                    }
                    return m;
                  });
                }

                // JSON 增量（工具参数）
                if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
                  setMessages((m) => {
                    const last = m[m.length - 1];
                    if (!last || last.role !== 'assistant') return m;
                    const blocks = [...last.blocks];
                    const tcBlock = lastBlockOf<ToolCallBlock>(blocks, 'tool_call');
                    if (tcBlock && tcBlock.status === 'streaming') {
                      const idx = blocks.indexOf(tcBlock);
                      blocks[idx] = {
                        ...tcBlock,
                        inputRaw: tcBlock.inputRaw + delta.partial_json,
                      };
                      return [...m.slice(0, -1), { ...last, blocks }];
                    }
                    return m;
                  });
                }
                break;
              }

              case 'content_block_stop': {
                // 标记当前文本块完成
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || last.role !== 'assistant') return m;
                  const blocks = [...last.blocks];
                  const textBlock = lastBlockOf<TextBlock>(blocks, 'text');
                  if (textBlock && textBlock.status !== 'done') {
                    const idx = blocks.indexOf(textBlock);
                    blocks[idx] = { ...textBlock, status: 'done' };
                  }
                  return [...m.slice(0, -1), { ...last, blocks }];
                });
                break;
              }

              // ---- 思考块 ----
              case 'thinking_delta': {
                ensureAssistant();
                const d = data as Record<string, unknown>;
                const thinking = (d?.thinking as string) ?? '';
                if (!thinking) break;
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || last.role !== 'assistant') return m;
                  const blocks = [...last.blocks];
                  const thBlock = lastBlockOf<ThinkingBlock>(blocks, 'thinking');
                  if (thBlock && thBlock.status === 'streaming') {
                    const idx = blocks.indexOf(thBlock);
                    blocks[idx] = { ...thBlock, thinking: thBlock.thinking + thinking };
                  } else {
                    // 标记之前的 thinking block 为 done
                    if (thBlock && thBlock.status === 'done') {
                      const idx = blocks.indexOf(thBlock);
                      blocks[idx] = { ...thBlock, status: 'done' };
                    }
                    blocks.push({
                      id: nextBlockId(),
                      type: 'thinking',
                      status: 'streaming',
                      thinking,
                      collapsed: true, // 默认折叠
                    });
                  }
                  return [...m.slice(0, -1), { ...last, blocks, streamState: 'thinking' }];
                });
                break;
              }

              // ---- 工具调用 ----
              case 'tool_use': {
                ensureAssistant();
                const d = data as Record<string, unknown>;
                const toolId = (d?.id as string) ?? '';
                const toolName = (d?.name as string) ?? '';
                const isPartial = d?.partial === true;

                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || last.role !== 'assistant') return m;
                  const blocks = [...last.blocks];
                  const tcBlock = blocks.find(
                    (b): b is ToolCallBlock => b.type === 'tool_call' && b.toolId === toolId
                  );

                  if (tcBlock) {
                    const idx = blocks.indexOf(tcBlock);
                    if (isPartial) {
                      // 更新参数增量
                      const input = d?.input;
                      const delta = typeof input === 'string' ? input : '';
                      blocks[idx] = {
                        ...tcBlock,
                        toolName: toolName || tcBlock.toolName,
                        inputRaw: tcBlock.inputRaw + delta,
                      };
                    } else {
                      // 完整参数到达
                      const input = d?.input;
                      blocks[idx] = {
                        ...tcBlock,
                        toolName: toolName || tcBlock.toolName,
                        input: typeof input === 'object' && input !== null
                          ? input as Record<string, unknown>
                          : tcBlock.input,
                        status: 'done',
                      };
                    }
                  } else if (toolId) {
                    // 新工具调用
                    const input = d?.input;
                    const newTc: ToolCallBlock = {
                      id: nextBlockId(),
                      type: 'tool_call',
                      status: isPartial ? 'streaming' : 'done',
                      toolId,
                      toolName,
                      inputRaw: '',
                      input: (!isPartial && typeof input === 'object' && input !== null)
                        ? input as Record<string, unknown>
                        : undefined,
                    };
                    if (isPartial && typeof input === 'string') {
                      newTc.inputRaw = input;
                    }
                    blocks.push(newTc);
                  }

                  return [...m.slice(0, -1), {
                    ...last,
                    blocks,
                    streamState: 'tool_executing',
                    activeToolCount: (last.activeToolCount ?? 0) + (tcBlock ? 0 : 1),
                  }];
                });
                break;
              }

              // ---- 工具结果 ----
              case 'tool_result': {
                const d = data as Record<string, unknown>;
                const toolUseId = (d?.tool_use_id as string) ?? '';
                const toolName = (d?.tool_name as string) ?? '';
                const content = (d?.content as string) ?? '';
                const isError = (d?.is_error as boolean) ?? false;
                const durationMs = (d?.duration_ms as number) ?? undefined;

                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || last.role !== 'assistant') return m;
                  const blocks = [...last.blocks];

                  // 标记对应的 tool_call block 为 done
                  const tcBlock = blocks.find(
                    (b): b is ToolCallBlock => b.type === 'tool_call' && b.toolId === toolUseId
                  );
                  if (tcBlock && tcBlock.status !== 'done') {
                    const idx = blocks.indexOf(tcBlock);
                    blocks[idx] = { ...tcBlock, status: 'done' };
                  }

                  // 添加 tool_result block
                  const existingResult = blocks.find(
                    (b): b is ToolResultBlock => b.type === 'tool_result' && b.toolCallId === toolUseId
                  );
                  if (!existingResult) {
                    blocks.push({
                      id: nextBlockId(),
                      type: 'tool_result',
                      status: isError ? 'error' : 'done',
                      toolCallId: toolUseId,
                      toolName,
                      content,
                      isError,
                      durationMs,
                    });
                  }

                  const remainingTools = blocks.filter(
                    (b) => b.type === 'tool_call' && b.status !== 'done'
                  ).length;

                  return [...m.slice(0, -1), {
                    ...last,
                    blocks,
                    streamState: remainingTools > 0 ? 'tool_executing' : 'generating',
                    activeToolCount: remainingTools,
                  }];
                });
                break;
              }

              // ---- 工具进度 ----
              case 'tool_progress': {
                // 工具进度暂时不创建独立块，通过 activity 展示
                // 后续可扩展为进程追踪
                break;
              }

              // ---- 上下文管理 ----
              case 'compaction':
              case 'context_status':
              case 'retry':
              case 'provider_fallback': {
                // 这些事件用于调试/监控，暂不在前端渲染
                break;
              }

              // ---- 消息结束 ----
              case 'message_delta': {
                const d = data as Record<string, unknown>;
                logger.debug('📥 message_delta', { stop_reason: d?.stop_reason });
                break;
              }

              case 'message_stop': {
                // 标记所有 streaming block 为 done
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || last.role !== 'assistant') return m;
                  const blocks = last.blocks.map((b) =>
                    b.status === 'streaming' ? { ...b, status: 'done' as const } : b
                  );
                  // 标记最后的 text block 状态（如果存在但未标记）
                  const allDone = blocks.map((b) => {
                    if (b.type === 'text' && b.status !== 'done' && b.status !== 'error') {
                      return { ...b, status: 'done' as const };
                    }
                    return b;
                  });
                  return [...m.slice(0, -1), {
                    ...last,
                    blocks: allDone,
                    streamState: 'done',
                  }];
                });
                break;
              }

              // ---- Token 用量 ----
              case 'usage': {
                const d = data as Record<string, unknown>;
                const usage = d?.usage as Record<string, unknown> | undefined;
                if (usage) {
                  setMessages((m) => {
                    const last = m[m.length - 1];
                    if (!last || last.role !== 'assistant') return m;
                    return [...m.slice(0, -1), {
                      ...last,
                      usage: {
                        inputTokens: (usage.inputTokens as number) ?? 0,
                        outputTokens: (usage.outputTokens as number) ?? 0,
                        totalTokens: (usage.totalTokens as number) ?? 0,
                      },
                    }];
                  });
                }
                break;
              }

              // ---- 流结束 ----
              case 'done': {
                // 刷新剩余的 text buffer + 兜底 finalize 所有 streaming block
                // （防止 message_stop 丢失导致 thinking/tool_call 永远停在 streaming）
                if (pendingTextBuf) {
                  const remaining = pendingTextBuf;
                  pendingTextBuf = '';
                  setMessages((m) => {
                    const last = m[m.length - 1];
                    if (!last || last.role !== 'assistant') return m;
                    const blocks = [...last.blocks];
                    const textBlock = lastBlockOf<TextBlock>(blocks, 'text');
                    if (textBlock && textBlock.status !== 'done') {
                      const idx = blocks.indexOf(textBlock);
                      blocks[idx] = { ...textBlock, text: textBlock.text + remaining, status: 'done' };
                    }
                    return [...m.slice(0, -1), {
                      ...last, blocks: finalizeStreamingBlocks(blocks), streamState: 'done',
                    }];
                  });
                } else {
                  // 没有 pending text buffer，也要兜底 finalize 残留的 streaming block
                  setMessages((m) => {
                    const last = m[m.length - 1];
                    if (!last || last.role !== 'assistant') return m;
                    const finalized = finalizeStreamingBlocks(last.blocks);
                    if (finalized === last.blocks) return m;
                    return [...m.slice(0, -1), {
                      ...last, blocks: finalized, streamState: 'done',
                    }];
                  });
                }
                // 取消 pending rAF
                if (rafHandle !== null) {
                  cancelAnimationFrame(rafHandle);
                  rafHandle = null;
                  rafScheduled = false;
                }
                logger.debug('📥 流式响应完成');
                setStatusSafe('done');
                return;
              }

              // ---- 错误 ----
              case 'error': {
                if (rafHandle !== null) {
                  cancelAnimationFrame(rafHandle);
                  rafHandle = null;
                  rafScheduled = false;
                }
                const d = data as Record<string, unknown>;
                const errInfo = d?.error as Record<string, unknown> | undefined;
                const errMsg = (errInfo?.message as string) || '未知错误';
                logger.error(`❌ 流式响应错误: ${errMsg}`);
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (last?.role === 'assistant') {
                    // 兜底 finalize 残留的 streaming block，再追加错误文本块
                    const blocks = finalizeStreamingBlocks([...last.blocks]);
                    blocks.push({
                      id: nextBlockId(),
                      type: 'text',
                      status: 'error',
                      text: `❌ 错误：${errMsg}`,
                    });
                    return [...m.slice(0, -1), {
                      ...last, blocks, streamState: 'done',
                    }];
                  }
                  return [
                    ...m,
                    {
                      id: nextMsgId(),
                      role: 'assistant',
                      blocks: [{
                        id: nextBlockId(), type: 'text', status: 'error',
                        text: `❌ 错误：${errMsg}`,
                      }],
                    },
                  ];
                });
                setStatusSafe('error');
                return;
              }

              // ---- 中断 ----
              case 'aborted': {
                if (rafHandle !== null) {
                  cancelAnimationFrame(rafHandle);
                  rafHandle = null;
                  rafScheduled = false;
                }
                // 兜底 finalize 残留的 streaming block
                setMessages((m) => {
                  const last = m[m.length - 1];
                  if (!last || last.role !== 'assistant') return m;
                  const finalized = finalizeStreamingBlocks(last.blocks);
                  if (finalized === last.blocks) return m;
                  return [...m.slice(0, -1), {
                    ...last, blocks: finalized, streamState: 'done',
                  }];
                });
                setStatusSafe('aborted');
                return;
              }

              default:
                break;
            }
          } catch {
            if (retries >= MAX_RETRIES) {
              setStatusSafe('error');
              return;
            }
            retries += 1;
            await new Promise((r) =>
              setTimeout(r, BACKOFF_MS[retries - 1] ?? 16000),
            );
            setStatusSafe('reconnecting');
          }
        }

        // 流自然结束（没有 done 事件的情况）
        if (pendingTextBuf) {
          const remaining = pendingTextBuf;
          pendingTextBuf = '';
          setMessages((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== 'assistant') return m;
            const blocks = [...last.blocks];
            const textBlock = lastBlockOf<TextBlock>(blocks, 'text');
            if (textBlock && textBlock.status !== 'done') {
              const idx = blocks.indexOf(textBlock);
              blocks[idx] = { ...textBlock, text: textBlock.text + remaining, status: 'done' };
            }
            return [...m.slice(0, -1), {
              ...last, blocks: finalizeStreamingBlocks(blocks), streamState: 'done',
            }];
          });
        } else {
          // 没有 pending text buffer，也要兜底 finalize 残留的 streaming block
          setMessages((m) => {
            const last = m[m.length - 1];
            if (!last || last.role !== 'assistant') return m;
            const finalized = finalizeStreamingBlocks(last.blocks);
            if (finalized === last.blocks) return m;
            return [...m.slice(0, -1), {
              ...last, blocks: finalized, streamState: 'done',
            }];
          });
        }
        setStatusSafe('done');
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          logger.debug('⏹️ 请求已取消');
          setStatusSafe('aborted');
        } else {
          logger.error('❌ 流式请求失败', { error: err instanceof Error ? err.message : String(err) });
          setStatusSafe('error');
        }
      }
    },
    [sessionId],
  );

  const abort = useCallback(() => {
    controllerRef.current?.abort();
    setStatusSafe('aborted');
  }, []);

  const retry = useCallback(() => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg) {
      const text = lastUserMsg.text ?? messageText(lastUserMsg);
      send(text, optionsRef.current);
    }
  }, [messages, send]);

  return { status, messages, send, abort, retry, historyLoaded };
}

// ============================================================
// 历史消息解析
// ============================================================

function parseHistoryBlocks(m: SerializedMsg, _msgId: string): Block[] {
  const blocks: Block[] = [];
  // API 返回的 content 始终是 MessageContent[] 数组
  const contentArray = Array.isArray(m.content) ? m.content : [];

  for (const cb of contentArray) {
    switch (cb.type) {
      case 'text':
        if (cb.text) {
          blocks.push({
            id: nextBlockId(), type: 'text', status: 'done',
            text: cb.text,
          });
        }
        break;
      case 'thinking':
        if (cb.thinking) {
          blocks.push({
            id: nextBlockId(), type: 'thinking', status: 'done',
            thinking: cb.thinking, collapsed: true,
          });
        }
        break;
      case 'tool_use':
        // API 返回 camelCase：id, name, input
        blocks.push({
          id: nextBlockId(), type: 'tool_call', status: 'done',
          toolId: cb.id ?? '',
          toolName: cb.name ?? '',
          input: cb.input,
          inputRaw: '',
        });
        break;
      case 'tool_result':
        // API 返回 camelCase：toolUseId, content, isError
        blocks.push({
          id: nextBlockId(), type: 'tool_result',
          status: cb.isError ? 'error' : 'done',
          toolCallId: cb.toolUseId ?? '',
          toolName: cb.name ?? '',
          content: cb.content ?? '',
          isError: cb.isError ?? false,
        });
        break;
    }
  }

  return blocks;
}
