/**
 * Chat 会话运行时 Store（P0）。
 *
 * 每个 session 独立保存消息、状态、流控制器和 rAF 缓冲。
 * 页面只订阅当前 session；SSE callback 捕获不可变的 (sessionId, runId)。
 *
 * 约束：
 * - 使用 Zustand 5（项目已有依赖）
 * - React Query 只负责服务端历史快照和 session 列表，不得承担实时 stream state
 * - 切换页面不 dispose 后台 session；应用卸载只断开 subscriber
 */

import { create } from 'zustand';
import type { ChatMessage, ChatStatus, TextBlock } from './types';

// ============================================================
// 常量
// ============================================================

/** 非当前且无 active run 的 session 最大缓存数 */
const MAX_CACHED_SESSIONS = 20;

// ============================================================
// RunRuntime
// ============================================================

export type RunStatus =
  | 'queued'
  | 'running'
  | 'completing'
  | 'succeeded'
  | 'failed'
  | 'aborted';

export interface RunRuntime {
  sessionId: string;
  runId: string;
  streamId: string | null;
  abortController: AbortController | null;
  lastSeq: number;
  pendingTextBuffer: string;
  rafHandle: number | null;
  rafScheduled: boolean;
  status: RunStatus;
}

// ============================================================
// SessionRuntime
// ============================================================

export interface SessionRuntime {
  sessionId: string;
  messages: ChatMessage[];
  historyLoaded: boolean;
  /** 最新已知 JSONL revision */
  historyRevision: number;
  activeRunId: string | null;
  status: ChatStatus;
  error: string | null;
  /** 用户输入草稿（P2 完善） */
  draft?: string;
}

// ============================================================
// Store State & Actions
// ============================================================

interface ChatRuntimeState {
  sessions: Record<string, SessionRuntime>;
  runs: Record<string, RunRuntime>;
  /** LRU 访问顺序追踪 */
  _accessOrder: string[];

  // ---- Session 操作 ----

  /** 幂等创建 SessionRuntime（不存在时初始化） */
  ensureSession: (sessionId: string) => void;
  /** 删除 session 及其关联 run */
  removeSession: (sessionId: string) => void;
  /** 设置 session 消息列表 */
  setSessionMessages: (sessionId: string, messages: ChatMessage[]) => void;
  /** 标记 history 加载完成 */
  setSessionHistoryLoaded: (
    sessionId: string,
    loaded: boolean,
    revision: number,
  ) => void;
  /** 设置 session 的 UI 状态 */
  setSessionStatus: (sessionId: string, status: ChatStatus) => void;
  /** 设置 session 错误 */
  setSessionError: (sessionId: string, error: string | null) => void;
  /** 设置 session 的 active run（同时更新 access order） */
  setActiveRun: (sessionId: string, runId: string | null) => void;

  // ---- Run 操作 ----

  /** 创建新 run */
  createRun: (sessionId: string, runId: string) => void;
  /** 移除 run（清理 controller + rAF） */
  removeRun: (runId: string) => void;
  /** 设置 run 的 streamId */
  setRunStreamId: (runId: string, streamId: string) => void;
  /** 设置 run 的 AbortController */
  setRunAbortController: (
    runId: string,
    ac: AbortController | null,
  ) => void;
  /** 更新 run 的 lastSeq */
  setRunLastSeq: (runId: string, seq: number) => void;
  /** 设置 run 状态 */
  setRunStatus: (runId: string, status: RunStatus) => void;

  // ---- Message 更新（带身份校验） ----

  /**
   * 更新指定 session 的消息列表。
   * 调用方必须提供正确的 sessionId + runId；store 内部验证 activeRunId 一致性。
   */
  updateMessages: (
    sessionId: string,
    runId: string,
    updater: (messages: ChatMessage[]) => ChatMessage[],
  ) => void;

  // ---- rAF 文本缓冲 ----

  /** 追加文本到指定 run 的 buffer */
  appendTextBuffer: (runId: string, text: string) => void;
  /** 立即 flush 指定 run 的 text buffer */
  flushTextBuffer: (runId: string) => void;
  /** 取消指定 run 的 rAF */
  cancelRunRaf: (runId: string) => void;

  // ---- 查询 ----

  getSession: (sessionId: string) => SessionRuntime | undefined;
  getRun: (runId: string) => RunRuntime | undefined;

  // ---- 内部 ----

  _touchSession: (sessionId: string) => void;
  _evictIfNeeded: (currentSessionId?: string) => void;
}

// ============================================================
// Store
// ============================================================

export const useChatRuntimeStore = create<ChatRuntimeState>()(
  (set, get) => ({
    sessions: {},
    runs: {},
    _accessOrder: [],

    // ==========================================================
    // Session 操作
    // ==========================================================

    ensureSession: (sessionId) => {
      const { sessions } = get();
      if (sessions[sessionId]) {
        get()._touchSession(sessionId);
        return;
      }
      set((s) => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            sessionId,
            messages: [],
            historyLoaded: false,
            historyRevision: 0,
            activeRunId: null,
            status: 'idle',
            error: null,
          },
        },
        _accessOrder: [...s._accessOrder.filter((id) => id !== sessionId), sessionId],
      }));
      get()._evictIfNeeded(sessionId);
    },

    removeSession: (sessionId) => {
      const session = get().sessions[sessionId];
      if (!session) return;

      // 1. abort active run
      if (session.activeRunId) {
        const run = get().runs[session.activeRunId];
        if (run) {
          try {
            run.abortController?.abort();
          } catch {
            /* ignore */
          }
        }
        get().removeRun(session.activeRunId);
      }

      // 2. 清理 session runtime
      set((s) => {
        const { [sessionId]: _, ...restSessions } = s.sessions;
        return {
          sessions: restSessions,
          _accessOrder: s._accessOrder.filter((id) => id !== sessionId),
        };
      });
    },

    setSessionMessages: (sessionId, messages) => {
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...ses, messages },
          },
        };
      });
    },

    setSessionHistoryLoaded: (sessionId, loaded, revision) => {
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...ses,
              historyLoaded: loaded,
              historyRevision: revision,
            },
          },
        };
      });
    },

    setSessionStatus: (sessionId, status) => {
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...ses, status },
          },
        };
      });
    },

    setSessionError: (sessionId, error) => {
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...ses, error },
          },
        };
      });
    },

    setActiveRun: (sessionId, runId) => {
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...ses, activeRunId: runId },
          },
        };
      });
      get()._touchSession(sessionId);
    },

    // ==========================================================
    // Run 操作
    // ==========================================================

    createRun: (sessionId, runId) => {
      set((s) => ({
        runs: {
          ...s.runs,
          [runId]: {
            sessionId,
            runId,
            streamId: null,
            abortController: null,
            lastSeq: -1,
            pendingTextBuffer: '',
            rafHandle: null,
            rafScheduled: false,
            status: 'queued',
          },
        },
      }));
    },

    removeRun: (runId) => {
      const run = get().runs[runId];
      if (!run) return;
      // 清理 rAF
      if (run.rafHandle !== null) {
        cancelAnimationFrame(run.rafHandle);
      }
      set((s) => {
        const { [runId]: _, ...restRuns } = s.runs;
        return { runs: restRuns };
      });
    },

    setRunStreamId: (runId, streamId) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        return {
          runs: { ...s.runs, [runId]: { ...run, streamId } },
        };
      });
    },

    setRunAbortController: (runId, ac) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        return {
          runs: { ...s.runs, [runId]: { ...run, abortController: ac } },
        };
      });
    },

    setRunLastSeq: (runId, seq) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run || seq <= run.lastSeq) return s;
        return {
          runs: { ...s.runs, [runId]: { ...run, lastSeq: seq } },
        };
      });
    },

    setRunStatus: (runId, status) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        return {
          runs: { ...s.runs, [runId]: { ...run, status } },
        };
      });
    },

    // ==========================================================
    // Message 更新（带身份校验）
    // ==========================================================

    updateMessages: (sessionId, runId, updater) => {
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses) return s;
        // 校验：只允许 activeRunId 匹配的 run 写入
        if (ses.activeRunId !== runId) return s;
        const nextMessages = updater(ses.messages);
        if (nextMessages === ses.messages) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...ses, messages: nextMessages },
          },
        };
      });
    },

    // ==========================================================
    // rAF 文本缓冲（按 run 隔离）
    // ==========================================================

    appendTextBuffer: (runId, text) => {
      const run = get().runs[runId];
      if (!run || run.status !== 'running') return;

      const nextBuffer = run.pendingTextBuffer + text;
      set((s) => ({
        runs: {
          ...s.runs,
          [runId]: { ...s.runs[runId], pendingTextBuffer: nextBuffer },
        },
      }));

      if (!run.rafScheduled) {
        const handle = requestAnimationFrame(() => {
          get().flushTextBuffer(runId);
        });
        set((s) => {
          const r = s.runs[runId];
          if (!r) return s;
          return {
            runs: {
              ...s.runs,
              [runId]: { ...r, rafHandle: handle, rafScheduled: true },
            },
          };
        });
      }
    },

    flushTextBuffer: (runId) => {
      const run = get().runs[runId];
      if (!run) return;

      const buf = run.pendingTextBuffer;
      // 重置 buffer 和 rAF 状态
      set((s) => ({
        runs: {
          ...s.runs,
          [runId]: {
            ...s.runs[runId],
            pendingTextBuffer: '',
            rafHandle: null,
            rafScheduled: false,
          },
        },
      }));

      if (!buf) return;

      // 写入该 run 对应 session 的最后一条 assistant 消息
      const sid = run.sessionId;
      get().updateMessages(sid, runId, (msgs) => {
        const last = msgs[msgs.length - 1];
        if (!last || last.role !== 'assistant') return msgs;
        const blocks = [...last.blocks];
        // 找最后一个 text block
        let textBlockIdx = -1;
        for (let i = blocks.length - 1; i >= 0; i--) {
          if (blocks[i].type === 'text' && blocks[i].status !== 'done') {
            textBlockIdx = i;
            break;
          }
        }
        if (textBlockIdx >= 0) {
          const tb = blocks[textBlockIdx] as TextBlock;
          blocks[textBlockIdx] = {
            ...tb,
            text: tb.text + buf,
          };
        } else {
          // 新建 text block
          blocks.push({
            id: `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'text',
            status: 'streaming',
            text: buf,
          });
        }
        return [...msgs.slice(0, -1), { ...last, blocks }];
      });
    },

    cancelRunRaf: (runId) => {
      const run = get().runs[runId];
      if (!run) return;
      if (run.rafHandle !== null) {
        cancelAnimationFrame(run.rafHandle);
      }
      set((s) => ({
        runs: {
          ...s.runs,
          [runId]: {
            ...s.runs[runId],
            pendingTextBuffer: '',
            rafHandle: null,
            rafScheduled: false,
          },
        },
      }));
    },

    // ==========================================================
    // 查询
    // ==========================================================

    getSession: (sessionId) => {
      return get().sessions[sessionId];
    },

    getRun: (runId) => {
      return get().runs[runId];
    },

    // ==========================================================
    // LRU
    // ==========================================================

    _touchSession: (sessionId) => {
      set((s) => ({
        _accessOrder: [
          ...s._accessOrder.filter((id) => id !== sessionId),
          sessionId,
        ],
      }));
    },

    _evictIfNeeded: (currentSessionId) => {
      const { sessions, runs, _accessOrder } = get();
      // 收集可驱逐的 session（非当前、无 activeRunId）
      const evictable = _accessOrder.filter((sid) => {
        if (sid === currentSessionId) return false;
        const ses = sessions[sid];
        if (!ses) return false;
        return !ses.activeRunId;
      });

      while (evictable.length > MAX_CACHED_SESSIONS) {
        const oldest = evictable.shift()!;
        const ses = sessions[oldest];
        if (ses?.activeRunId) {
          const run = runs[ses.activeRunId];
          run?.abortController?.abort();
          get().removeRun(ses.activeRunId);
        }
        set((s) => {
          const { [oldest]: _, ...rest } = s.sessions;
          return {
            sessions: rest,
            _accessOrder: s._accessOrder.filter((id) => id !== oldest),
          };
        });
      }
    },
  }),
);

// ============================================================
// 便捷 selectors
// ============================================================

/** 获取指定 session 的消息列表（浅比较优化） */
export function selectSessionMessages(
  sessionId: string,
): (state: ChatRuntimeState) => ChatMessage[] {
  return (state) => state.sessions[sessionId]?.messages ?? [];
}

/** 获取指定 session 的状态 */
export function selectSessionStatus(
  sessionId: string,
): (state: ChatRuntimeState) => ChatStatus {
  return (state) => state.sessions[sessionId]?.status ?? 'idle';
}

/** 获取指定 session 的 historyLoaded */
export function selectSessionHistoryLoaded(
  sessionId: string,
): (state: ChatRuntimeState) => boolean {
  return (state) => state.sessions[sessionId]?.historyLoaded ?? false;
}

/** 带 sessionId 参数 selector 的工厂（避免每次 render 创建新函数） */
export function createSessionSelectors(sessionId: string) {
  return {
    messages: (s: ChatRuntimeState) => s.sessions[sessionId]?.messages ?? [],
    status: (s: ChatRuntimeState) => s.sessions[sessionId]?.status ?? 'idle',
    historyLoaded: (s: ChatRuntimeState) =>
      s.sessions[sessionId]?.historyLoaded ?? false,
    activeRunId: (s: ChatRuntimeState) =>
      s.sessions[sessionId]?.activeRunId ?? null,
  };
}
