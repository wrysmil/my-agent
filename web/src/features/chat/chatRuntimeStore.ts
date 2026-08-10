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
import type {
  ChatMessage,
  ChatOptions,
  ChatStatus,
  TextBlock,
} from './types';

// ============================================================
// 常量
// ============================================================

/** 非当前且无 active run 的 session 最大缓存数 */
const MAX_CACHED_SESSIONS = 20;
const MAX_TERMINAL_RUNS_PER_SESSION = 20;
/** 每个 session 最多保留的快速 persistence convergence 索引项 */
export const MAX_PENDING_PERSISTENCE_PER_SESSION = 32;
/** 未收敛索引保留 30 分钟；overlay 自身继续携带安全 revision 门槛 */
export const PENDING_PERSISTENCE_TTL_MS = 30 * 60 * 1000;
const EMPTY_MESSAGES: ChatMessage[] = [];

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
  submittingTimer: ReturnType<typeof setTimeout> | null;
  messageStopped: boolean;
  persistedRevision: number | null;
  createdAt: number;
  terminalAt: number | null;
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
  /** run metadata 被清理后仍保留的持久化收敛门槛 */
  pendingPersistence: Record<string, number>;
  /** pendingPersistence 各项最后更新时间，用于 TTL/cap 淘汰 */
  pendingPersistenceUpdatedAt: Record<string, number>;
  /** 当前 session 唯一的可重试发送身份；单槽位保证有界 */
  retryCandidate: {
    clientMessageId: string;
    runId: string;
    sourceRunId: string;
    options: ChatOptions;
  } | null;
  /** 用户输入草稿（P2 完善） */
  draft?: string;
}

// ============================================================
// Store State & Actions
// ============================================================

export interface ChatRuntimeState {
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
  /** 原子应用不低于当前 revision 的 history，并清理已收敛 run */
  applySessionHistory: (
    sessionId: string,
    revision: number,
    merge: (
      currentMessages: ChatMessage[],
      pendingPersistence: Record<string, number>,
    ) => ChatMessage[],
  ) => boolean;
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
  /** 更新 session 自有的单槽位 retry 身份 */
  setSessionRetryCandidate: (
    sessionId: string,
    candidate: SessionRuntime['retryCandidate'],
  ) => void;

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
  /** 设置 run 自有的 submitting 超时，避免 hook/session 间共享 */
  setRunSubmittingTimer: (
    runId: string,
    timer: ReturnType<typeof setTimeout> | null,
  ) => void;
  /** 记录该 run 是否收到 message_stop */
  setRunMessageStopped: (runId: string, stopped: boolean) => void;
  /** 记录成功终态要求的持久化 revision */
  setRunPersistedRevision: (runId: string, revision: number | null) => void;
  /** 在 session 上持久保存收敛门槛，不依赖 RunRuntime 生命周期 */
  markRunAwaitingPersistence: (runId: string, revision: number) => void;

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
  _pruneTerminalRuns: (sessionId: string) => void;
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
            pendingPersistence: {},
            pendingPersistenceUpdatedAt: {},
            retryCandidate: null,
          },
        },
        _accessOrder: [...s._accessOrder.filter((id) => id !== sessionId), sessionId],
      }));
      get()._evictIfNeeded(sessionId);
    },

    removeSession: (sessionId) => {
      const session = get().sessions[sessionId];
      if (!session) return;

      // 1. abort + remove 所有关联 run（包括 activeRunId 已清空的孤儿）
      for (const run of Object.values(get().runs)) {
        if (run.sessionId === sessionId) {
          try {
            run.abortController?.abort();
          } catch {
            /* ignore */
          }
          get().removeRun(run.runId);
        }
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

    applySessionHistory: (sessionId, revision, merge) => {
      let applied = false;
      set((s) => {
        const ses = s.sessions[sessionId];
        if (!ses || revision < ses.historyRevision) return s;

        applied = true;
        const messages = merge(ses.messages, ses.pendingPersistence);
        const pendingPersistence = { ...ses.pendingPersistence };
        const pendingPersistenceUpdatedAt = {
          ...ses.pendingPersistenceUpdatedAt,
        };
        const convergedRunIds = Object.entries(pendingPersistence)
          .filter(([, requiredRevision]) => revision >= requiredRevision)
          .map(([runId]) => runId);
        for (const runId of convergedRunIds) {
          delete pendingPersistence[runId];
          delete pendingPersistenceUpdatedAt[runId];
        }

        let runs = s.runs;
        if (convergedRunIds.length > 0) {
          const converged = new Set(convergedRunIds);
          runs = Object.fromEntries(
            Object.entries(s.runs).filter(([runId]) => !converged.has(runId)),
          );
        }

        return {
          runs,
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...ses,
              messages,
              historyLoaded: true,
              historyRevision: revision,
              pendingPersistence,
              pendingPersistenceUpdatedAt,
            },
          },
        };
      });
      return applied;
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

    setSessionRetryCandidate: (sessionId, candidate) => {
      set((s) => {
        const session = s.sessions[sessionId];
        if (!session) return s;
        return {
          sessions: {
            ...s.sessions,
            [sessionId]: { ...session, retryCandidate: candidate },
          },
        };
      });
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
            submittingTimer: null,
            messageStopped: false,
            persistedRevision: null,
            createdAt: Date.now(),
            terminalAt: null,
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
      if (run.submittingTimer !== null) {
        clearTimeout(run.submittingTimer);
      }
      try {
        run.abortController?.abort();
      } catch {
        /* ignore */
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
      let sessionId: string | undefined;
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        sessionId = run.sessionId;
        const terminalAt = ['succeeded', 'failed', 'aborted'].includes(status)
          ? (run.terminalAt ?? Date.now())
          : null;
        return {
          runs: { ...s.runs, [runId]: { ...run, status, terminalAt } },
        };
      });
      if (sessionId) get()._pruneTerminalRuns(sessionId);
    },

    setRunSubmittingTimer: (runId, timer) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        if (run.submittingTimer !== null && run.submittingTimer !== timer) {
          clearTimeout(run.submittingTimer);
        }
        return {
          runs: { ...s.runs, [runId]: { ...run, submittingTimer: timer } },
        };
      });
    },

    setRunMessageStopped: (runId, stopped) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        return {
          runs: { ...s.runs, [runId]: { ...run, messageStopped: stopped } },
        };
      });
    },

    setRunPersistedRevision: (runId, revision) => {
      set((s) => {
        const run = s.runs[runId];
        if (!run) return s;
        return {
          runs: { ...s.runs, [runId]: { ...run, persistedRevision: revision } },
        };
      });
    },

    markRunAwaitingPersistence: (runId, revision) => {
      const run = get().runs[runId];
      if (!run) return;
      set((s) => {
        const session = s.sessions[run.sessionId];
        if (!session) return s;
        const now = Date.now();
        const requiredRevision = Math.max(
          session.pendingPersistence[runId] ?? 0,
          revision,
        );
        const pendingPersistence = {
          ...session.pendingPersistence,
          [runId]: requiredRevision,
        };
        const pendingPersistenceUpdatedAt = {
          ...session.pendingPersistenceUpdatedAt,
          [runId]: now,
        };

        for (const [pendingRunId, updatedAt] of Object.entries(
          pendingPersistenceUpdatedAt,
        )) {
          if (
            pendingRunId !== session.activeRunId &&
            now - updatedAt > PENDING_PERSISTENCE_TTL_MS
          ) {
            delete pendingPersistence[pendingRunId];
            delete pendingPersistenceUpdatedAt[pendingRunId];
          }
        }

        const excess =
          Object.keys(pendingPersistence).length -
          MAX_PENDING_PERSISTENCE_PER_SESSION;
        if (excess > 0) {
          const oldestEvictable = Object.keys(pendingPersistence)
            .filter((pendingRunId) => pendingRunId !== session.activeRunId)
            .sort(
              (left, right) =>
                (pendingPersistenceUpdatedAt[left] ?? 0) -
                (pendingPersistenceUpdatedAt[right] ?? 0),
            );
          for (const pendingRunId of oldestEvictable.slice(0, excess)) {
            delete pendingPersistence[pendingRunId];
            delete pendingPersistenceUpdatedAt[pendingRunId];
          }
        }

        return {
          sessions: {
            ...s.sessions,
            [run.sessionId]: {
              ...session,
              messages: session.messages.map((message) =>
                message.runId === runId
                  ? {
                      ...message,
                      pendingPersistenceRevision: requiredRevision,
                    }
                  : message,
              ),
              pendingPersistence,
              pendingPersistenceUpdatedAt,
            },
          },
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
        // run 终态后 activeRunId 会先清空，但同一 run 的 rAF/history
        // 收敛仍必须能写入；因此校验稳定 run 身份，而不是瞬时 activeRunId。
        const run = s.runs[runId];
        if (!run || run.sessionId !== sessionId) return s;
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
      if (!buf) return;

      const sid = run.sessionId;
      const targetExists = get().sessions[sid]?.messages.some(
        (message) => message.role === 'assistant' && message.runId === runId,
      );
      if (!targetExists) {
        // placeholder 尚未建立时保留 buffer；只释放已执行的 rAF handle，
        // 后续 append 或终态同步 flush 会再次尝试。
        set((s) => {
          const current = s.runs[runId];
          if (!current) return s;
          return {
            runs: {
              ...s.runs,
              [runId]: { ...current, rafHandle: null, rafScheduled: false },
            },
          };
        });
        return;
      }

      get().updateMessages(sid, runId, (msgs) => {
        const messageIndex = msgs.findIndex(
          (message) => message.role === 'assistant' && message.runId === runId,
        );
        if (messageIndex < 0) return msgs;
        const target = msgs[messageIndex];
        const blocks = [...target.blocks];
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
        const next = [...msgs];
        next[messageIndex] = { ...target, blocks };
        return next;
      });

      set((s) => {
        const current = s.runs[runId];
        if (!current) return s;
        return {
          runs: {
            ...s.runs,
            [runId]: {
              ...current,
              pendingTextBuffer: '',
              rafHandle: null,
              rafScheduled: false,
            },
          },
        };
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
        for (const run of Object.values(get().runs)) {
          if (run.sessionId === oldest) {
            run.abortController?.abort();
            get().removeRun(run.runId);
          }
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

    _pruneTerminalRuns: (sessionId) => {
      const terminalRuns = Object.values(get().runs)
        .filter(
          (run) =>
            run.sessionId === sessionId &&
            ['succeeded', 'failed', 'aborted'].includes(run.status),
        )
        .sort(
          (left, right) =>
            (left.terminalAt ?? left.createdAt) -
            (right.terminalAt ?? right.createdAt),
        );
      const excess = terminalRuns.length - MAX_TERMINAL_RUNS_PER_SESSION;
      if (excess <= 0) return;
      for (const run of terminalRuns.slice(0, excess)) {
        get().removeRun(run.runId);
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
  return (state) => state.sessions[sessionId]?.messages ?? EMPTY_MESSAGES;
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
    messages: (s: ChatRuntimeState) =>
      s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES,
    status: (s: ChatRuntimeState) => s.sessions[sessionId]?.status ?? 'idle',
    historyLoaded: (s: ChatRuntimeState) =>
      s.sessions[sessionId]?.historyLoaded ?? false,
    activeRunId: (s: ChatRuntimeState) =>
      s.sessions[sessionId]?.activeRunId ?? null,
  };
}
