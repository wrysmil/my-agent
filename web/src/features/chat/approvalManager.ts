/**
 * approvalManager — 审批状态管理器。
 *
 * 职责：
 * 1. 监听 WebSocket 帧流，过滤 approval/requested 入队
 * 2. 管理审批队列状态
 * 3. 提供审批操作接口
 *
 * 设计：
 * - 与 ApprovalContext 协同工作
 * - 支持多 session 并发审批
 * - 提供 session 级别的审批过滤器
 */

import type { ApprovalRequested } from '@/lib/api-protocol/frames';
import type { RpcResult } from '@/lib/api-protocol';

// ─── Types ─────────────────────────────────────────────────────────────────────

/** API 客户端接口（用于审批响应） */
interface ApiClientLike {
  respond: (rpcId: string, result: RpcResult<unknown>) => void;
}

export interface ApprovalRequest {
  id: string;
  rpcId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  payload: Record<string, unknown>;
  description?: string;
  createdAt: number;
  timeoutMs: number;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  resolvedAt?: number;
  reason?: string;
}

export interface ApprovalManagerOptions {
  /** API 客户端 */
  apiClient: ApiClientLike;
  /** 默认超时（毫秒） */
  defaultTimeoutMs?: number;
  /** 超时回调 */
  onTimeout?: (request: ApprovalRequest) => void;
  /** 审批完成回调 */
  onResolved?: (request: ApprovalRequest) => void;
  /** 新审批到达回调 */
  onPending?: (request: ApprovalRequest) => void;
}

type ApprovalListener = (request: ApprovalRequest) => void;

// ─── Manager ──────────────────────────────────────────────────────────────────

/**
 * 审批状态管理器。
 *
 * 用法：
 * ```ts
 * const manager = new ApprovalManager({ apiClient });
 *
 * // 在 WebSocket 消息处理中
 * manager.onFrame(frame);
 *
 * // 允许审批
 * await manager.approve(rpcId);
 *
 * // 拒绝审批
 * await manager.reject(rpcId, '用户拒绝');
 * ```
 */
export class ApprovalManager {
  private readonly apiClient: ApiClientLike;
  private readonly defaultTimeoutMs: number;
  private readonly onTimeout?: (request: ApprovalRequest) => void;
  private readonly onResolved?: (request: ApprovalRequest) => void;
  private readonly onPending?: (request: ApprovalRequest) => void;

  private readonly requests = new Map<string, ApprovalRequest>();
  private readonly listeners = new Set<ApprovalListener>();
  private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: ApprovalManagerOptions) {
    this.apiClient = options.apiClient;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5 * 60 * 1000;
    this.onTimeout = options.onTimeout;
    this.onResolved = options.onResolved;
    this.onPending = options.onPending;
  }

  /**
   * 处理 WebSocket 帧。
   * 自动过滤 approval/requested 入队。
   */
  onFrame(frame: unknown): void {
    const f = frame as { kind?: string };
    if (f?.kind === 'approval/requested') {
      this.enqueue(frame as ApprovalRequested);
    }
  }

  /**
   * 入队一个新的审批请求。
   */
  enqueue(request: ApprovalRequested): void {
    // Extract string value from RpcId (which has .value property) or use as-is
    const rpcIdStr = (request.rpcId as unknown as { value?: string }).value ?? String(request.rpcId);
    const id = `${request.sessionId}:${rpcIdStr}`;
    if (this.requests.has(id)) {
      return; // 幂等：已存在则忽略
    }

    const approvalRequest: ApprovalRequest = {
      id,
      rpcId: String(request.rpcId),
      sessionId: request.sessionId,
      toolUseId: request.toolUseId,
      toolName: request.toolName,
      payload: request.input,
      description: request.description,
      createdAt: Date.now(),
      timeoutMs: this.defaultTimeoutMs,
      status: 'pending',
    };

    this.requests.set(id, approvalRequest);

    // 设置超时
    if (this.defaultTimeoutMs > 0) {
      const timer = setTimeout(() => {
        this.expire(id);
      }, this.defaultTimeoutMs);
      this.timeoutTimers.set(id, timer);
    }

    // 通知监听器
    this.onPending?.(approvalRequest);
    this.notifyListeners(approvalRequest);
  }

  /**
   * 允许审批。
   */
  async approve(rpcId: string, reason?: string): Promise<boolean> {
    return this.resolve(rpcId, true, reason);
  }

  /**
   * 拒绝审批。
   */
  async reject(rpcId: string, reason?: string): Promise<boolean> {
    return this.resolve(rpcId, false, reason);
  }

  /**
   * 获取所有待审批请求。
   */
  getPending(): ApprovalRequest[] {
    return Array.from(this.requests.values()).filter((r) => r.status === 'pending');
  }

  /**
   * 按 session 获取待审批请求。
   */
  getPendingBySession(sessionId: string): ApprovalRequest[] {
    return this.getPending().filter((r) => r.sessionId === sessionId);
  }

  /**
   * 获取当前最近的待审批请求。
   */
  getCurrent(): ApprovalRequest | null {
    const pending = this.getPending();
    if (pending.length === 0) return null;
    // 按创建时间排序
    return pending.sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  /**
   * 获取请求详情。
   */
  get(rpcId: string): ApprovalRequest | undefined {
    for (const request of Array.from(this.requests.values())) {
      if (request.rpcId === rpcId) {
        return request;
      }
    }
    return undefined;
  }

  /**
   * 添加监听器。
   */
  addListener(listener: ApprovalListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 清空所有请求（切换会话时调用）。
   */
  clear(): void {
    for (const timer of Array.from(this.timeoutTimers.values())) {
      clearTimeout(timer);
    }
    this.timeoutTimers.clear();
    this.requests.clear();
  }

  /**
   * 清空指定 session 的请求。
   */
  clearBySession(sessionId: string): void {
    const toRemove = Array.from(this.requests.entries()).filter(
      ([, r]) => r.sessionId === sessionId,
    );
    for (const [id, request] of toRemove) {
      const timer = this.timeoutTimers.get(id);
      if (timer) {
        clearTimeout(timer);
        this.timeoutTimers.delete(id);
      }
      this.requests.delete(id);
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private async resolve(
    rpcId: string,
    approved: boolean,
    reason?: string,
  ): Promise<boolean> {
    const request = this.get(rpcId);
    if (!request || request.status !== 'pending') {
      return false;
    }

    // 清除超时
    const timer = this.timeoutTimers.get(request.id);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(request.id);
    }

    // 更新状态
    request.status = approved ? 'approved' : 'rejected';
    request.resolvedAt = Date.now();
    request.reason = reason;

    // 发送响应
    try {
      const result: RpcResult<unknown> = approved
        ? { ok: true, data: undefined }
        : { ok: false, code: 'rejected', message: reason };
      this.apiClient.respond(rpcId, result);
    } catch (err) {
      console.error('[ApprovalManager] respond failed:', err);
      return false;
    }

    // 通知回调
    this.onResolved?.(request);
    this.notifyListeners(request);

    return true;
  }

  private expire(rpcId: string): void {
    const request = this.get(rpcId);
    if (!request || request.status !== 'pending') {
      return;
    }

    request.status = 'expired';
    request.resolvedAt = Date.now();

    this.onTimeout?.(request);
    this.notifyListeners(request);
  }

  private notifyListeners(request: ApprovalRequest): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(request);
      } catch (err) {
        console.error('[ApprovalManager] listener error:', err);
      }
    }
  }
}
