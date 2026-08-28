/**
 * my-agent Web 前端 — Pending Approval Store (M4)。
 *
 * 用途：存储待审批的 approval/requested 帧，等待客户端 resolve。
 *
 * 设计：
 * - 按 `rpcId` 索引（与 ServerRequest.rpCId 对应）
 * - `pendingResolve` 把 resolve fn 存入 map，客户端 resolve 后调用
 * - 幂等：同一 rpcId 只能注册一次（防重复 resolve）
 * - 5 分钟超时：超时后自动 reject 并从 store 移除
 */

import type { Logger } from "../../shared/logger.js";

// ─── 类型 ──────────────────────────────────────────────────────────────────────

/** 待审批的请求 */
export type PendingApproval = {
  rpcId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  /** 到达时间（用于超时计算） */
  createdAt: number;
  /** 5 分钟超时 */
  timeoutMs?: number;
  /** 触发 resolve：approved=true/false，reason 可选 */
  resolve: (approved: boolean, reason?: string) => void;
};

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * 进程内 pending approval 注册表。
 *
 * 全局单例（一个 Node 进程只有一个 HTTP server）。
 */
export class PendingApprovalStore {
  private readonly _map = new Map<string, PendingApproval>();
  private readonly _timeoutMs: number;
  private readonly _logger?: Logger;

  constructor(timeoutMs = 5 * 60 * 1000, logger?: Logger) {
    this._timeoutMs = timeoutMs;
    this._logger = logger;
  }

  /**
   * 注册一条待审批请求。
   * 返回 `true` 表示注册成功；`false` 表示该 rpcId 已存在（幂等拒绝）。
   */
  register(approval: PendingApproval): boolean {
    if (this._map.has(approval.rpcId)) {
      this._logger?.debug(`PendingApprovalStore: rpcId="${approval.rpcId}" already registered, skipping`);
      return false;
    }

    this._map.set(approval.rpcId, approval);

    // 设置超时自动 reject
    const timer = setTimeout(() => {
      const entry = this._map.get(approval.rpcId);
      if (entry) {
        this._map.delete(approval.rpcId);
        this._logger?.debug(`PendingApprovalStore: rpcId="${approval.rpcId}" timed out`);
        entry.resolve(false, "timeout");
      }
    }, approval.timeoutMs ?? this._timeoutMs);
    timer.unref?.();

    this._logger?.debug(`PendingApprovalStore: registered rpcId="${approval.rpcId}" session="${approval.sessionId}" tool="${approval.toolName}"`);
    return true;
  }

  /**
   * 根据 rpcId 查找待审批请求。
   */
  get(rpcId: string): PendingApproval | undefined {
    return this._map.get(rpcId);
  }

  /**
   * 移除（resolve 后调用）。
   */
  remove(rpcId: string): void {
    this._map.delete(rpcId);
  }

  /**
   * 按 sessionId 列出所有待审批请求。
   */
  listBySession(sessionId: string): PendingApproval[] {
    return [...this._map.values()].filter((a) => a.sessionId === sessionId);
  }

  /**
   * 当前待审批数量（监控用）。
   */
  size(): number {
    return this._map.size;
  }

  /**
   * 关闭所有（graceful shutdown）。
   */
  close(): void {
    for (const approval of this._map.values()) {
      approval.resolve(false, "server_shutdown");
    }
    this._map.clear();
  }
}

/**
 * 进程级单例。
 */
export const pendingApprovalStore = new PendingApprovalStore();
