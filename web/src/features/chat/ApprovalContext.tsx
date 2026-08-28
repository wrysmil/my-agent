/**
 * ApprovalContext — 审批全局上下文。
 *
 * 提供：
 * - 当前待审批项（ApprovalRequested）
 * - 审批操作（approve / reject）
 * - 审批历史
 *
 * 用法：
 * ```tsx
 * <ApprovalProvider apiClient={apiClient}>
 *   <App />
 * </ApprovalProvider>
 * ```
 */

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';
import type { ApprovalRequested, ApprovalResolved } from '@/lib/api-protocol/frames';
import type { RpcResult } from '@/lib/api-protocol';
import { RpcId } from '@/lib/api-protocol';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** API 客户端接口（用于审批响应） */
export type ApiClientLike = {
  respond: (rpcId: string, result: RpcResult<unknown>) => void;
};

export interface ApprovalItem extends ApprovalRequested {
  /** 进入时间（用于超时计算） */
  createdAt: number;
  /** 0 = 无超时 */
  timeoutMs: number;
}

export interface ApprovalContextValue {
  /** 当前待审批项（队列头） */
  currentApproval: ApprovalItem | null;
  /** 所有待审批项（队列） */
  pendingApprovals: ApprovalItem[];
  /** 历史已完成的审批 */
  resolvedApprovals: ApprovalResolved[];
  /** 提交审批结果 */
  submit: (
    rpcId: string,
    approved: boolean,
    reason?: string,
  ) => Promise<void>;
  /** 拒绝当前审批（快捷方法） */
  rejectCurrent: (reason?: string) => Promise<void>;
  /** 允许当前审批（快捷方法） */
  approveCurrent: () => Promise<void>;
  /** 是否有待审批 */
  hasPending: boolean;
  /** 待审批数量 */
  pendingCount: number;
}

// ─── Context ───────────────────────────────────────────────────────────────────

const ApprovalContext = createContext<ApprovalContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export interface ApprovalProviderProps {
  children: ReactNode;
  /** API 客户端（用于发送审批响应） */
  apiClient?: ApiClientLike;
  /** 默认超时（毫秒），0 = 无超时 */
  defaultTimeoutMs?: number;
}

export function ApprovalProvider({
  children,
  apiClient,
  defaultTimeoutMs = 5 * 60 * 1000,
}: ApprovalProviderProps) {
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalItem[]>([]);
  const [resolvedApprovals, setResolvedApprovals] = useState<ApprovalResolved[]>([]);

  /** 入队一个新的审批请求 */
  const enqueue = useCallback((approval: ApprovalRequested) => {
    const item: ApprovalItem = {
      ...approval,
      createdAt: Date.now(),
      timeoutMs: defaultTimeoutMs,
    };
    setPendingApprovals((prev) => [...prev, item]);
  }, [defaultTimeoutMs]);

  /** 提交审批结果 */
  const submit = useCallback(
    async (rpcIdStr: string, approved: boolean, reason?: string) => {
      // 从队列移除
      setPendingApprovals((prev) => {
        const idx = prev.findIndex((a) => a.rpcId.value === rpcIdStr);
        if (idx === -1) return prev;
        const next = [...prev];
        next.splice(idx, 1);
        return next;
      });

      // 记录历史
      const resolved: ApprovalResolved = {
        kind: 'approval/resolved',
        rpcId: RpcId.from(rpcIdStr),
        sessionId: pendingApprovals.find((a) => a.rpcId.value === rpcIdStr)?.sessionId ?? '',
        approved,
        reason,
      };
      setResolvedApprovals((prev) => [...prev.slice(-99), resolved]);

      // 通过 API 客户端发送响应
      if (apiClient) {
        try {
          const result: RpcResult<unknown> = approved
            ? { ok: true, data: undefined }
            : { ok: false, code: 'rejected', message: reason };
          apiClient.respond(rpcIdStr, result);
        } catch (err) {
          console.error('[ApprovalContext] respond failed:', err);
        }
      }
    },
    [apiClient, pendingApprovals],
  );

  /** 拒绝当前审批 */
  const rejectCurrent = useCallback(
    async (reason?: string) => {
      const current = pendingApprovals[0];
      if (!current) return;
      await submit(current.rpcId.value, false, reason);
    },
    [pendingApprovals, submit],
  );

  /** 允许当前审批 */
  const approveCurrent = useCallback(async () => {
    const current = pendingApprovals[0];
    if (!current) return;
    await submit(current.rpcId.value, true);
  }, [pendingApprovals, submit]);

  const value: ApprovalContextValue = {
    currentApproval: pendingApprovals[0] ?? null,
    pendingApprovals,
    resolvedApprovals,
    submit,
    rejectCurrent,
    approveCurrent,
    hasPending: pendingApprovals.length > 0,
    pendingCount: pendingApprovals.length,
  };

  return (
    <ApprovalContext.Provider value={value}>
      {children}
    </ApprovalContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * 使用审批上下文。
 * 在组件中调用以获取审批状态和操作。
 */
export function useApproval(): ApprovalContextValue {
  const ctx = useContext(ApprovalContext);
  if (!ctx) {
    throw new Error('useApproval must be used within <ApprovalProvider>');
  }
  return ctx;
}

// ─── Internal helpers (for integration) ────────────────────────────────────────

/**
 * 创建审批处理器，用于接入 WebSocket 帧流。
 *
 * 用法：
 * ```ts
 * const handler = createApprovalHandler({ enqueue: myEnqueueFn });
 * ws.on('message', (data) => {
 *   const frame = JSON.parse(data);
 *   if (frame.kind === 'approval/requested') {
 *     handler(frame);
 *   }
 * });
 * ```
 */
export function createApprovalHandler(deps: {
  enqueue: (approval: ApprovalRequested) => void;
}) {
  return function handleApprovalFrame(frame: ApprovalRequested) {
    if (frame.kind === 'approval/requested') {
      deps.enqueue(frame);
    }
  };
}
