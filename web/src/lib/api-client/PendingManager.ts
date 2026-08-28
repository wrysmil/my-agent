/**
 * PendingManager — manages pending approvals (approval/requested → approval/resolved).
 *
 * Responsibilities:
 * - Register pending approvals with their metadata
 * - Resolve pending approvals (approve/reject)
 * - Track pending state for recovery after reconnection
 * - Persist pending state to sessionStorage for recovery
 *
 * The pending state survives reconnections, allowing the UI to show
 * pending approvals even after the WebSocket connection is lost.
 */

import { RpcId } from '../api-protocol';
import type { ApprovalRequested, ApprovalResolved, RpcResult } from '../api-protocol';

export interface PendingApproval {
  /** RPC ID for matching resolution */
  rpcId: RpcId;
  /** Session ID */
  sessionId: string;
  /** Tool use ID */
  toolUseId: string;
  /** Tool name */
  toolName: string;
  /** Tool input */
  input: Record<string, unknown>;
  /** Human-readable description */
  description?: string;
  /** Timestamp when registered */
  registeredAt: number;
  /** Custom data stored with the pending approval */
  metadata?: Record<string, unknown>;
}

export type PendingApprovalResolve = (
  rpcId: RpcId,
  approved: boolean,
  reason?: string,
) => void;

export interface PendingManagerOptions {
  /** SessionStorage key prefix (default: 'pending:') */
  storageKeyPrefix?: string;
  /** Maximum age for persisted pending items in ms (default: 1 hour) */
  maxAge?: number;
}

/** Event types emitted by PendingManager */
export type PendingEvent =
  | { type: 'registered'; approval: PendingApproval }
  | { type: 'resolved'; rpcId: RpcId; approved: boolean }
  | { type: 'cleared' };

export type PendingEventHandler = (event: PendingEvent) => void;

/**
 * Manages pending approvals with optional sessionStorage persistence.
 *
 * @example
 * const manager = new PendingManager();
 *
 * // Register a pending approval
 * manager.register({
 *   rpcId: RpcId.mint(),
 *   sessionId: 'session-1',
 *   toolUseId: 'tool-1',
 *   toolName: 'bash',
 *   input: { command: 'rm -rf /' },
 * });
 *
 * // Resolve it
 * manager.resolve(rpcId, true, 'Safe to run');
 */
export class PendingManager {
  private _pending = new Map<string, PendingApproval>();
  private _resolvers = new Map<string, PendingApprovalResolve>();
  private _handlers = new Set<PendingEventHandler>();
  private _options: Required<PendingManagerOptions>;
  private _storageKey: string;

  constructor(options: PendingManagerOptions = {}) {
    this._options = {
      storageKeyPrefix: options.storageKeyPrefix ?? 'pending:',
      maxAge: options.maxAge ?? 3600000, // 1 hour
    };
    this._storageKey = `${this._options.storageKeyPrefix}approvals`;

    // Restore persisted state
    this._restore();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a new pending approval.
   *
   * @param approval - Approval details
   * @param resolve - Optional resolver function that will be called when the approval is resolved
   */
  register(approval: Omit<PendingApproval, 'registeredAt'>, resolve?: PendingApprovalResolve): void {
    const pending: PendingApproval = {
      ...approval,
      registeredAt: Date.now(),
    };

    this._pending.set(approval.rpcId.value, pending);

    if (resolve) {
      this._resolvers.set(approval.rpcId.value, resolve);
    }

    this._persist();
    this._emit({ type: 'registered', approval: pending });
  }

  /**
   * Handle an incoming approval/requested frame.
   *
   * @param frame - The approval/requested frame
   * @param resolve - Optional resolver to call when resolved
   * @returns The registered pending approval
   */
  handleApprovalRequested(
    frame: ApprovalRequested,
    resolve?: PendingApprovalResolve,
  ): PendingApproval {
    // Check if already registered
    const existing = this._pending.get(frame.rpcId.value);
    if (existing) {
      return existing;
    }

    const approval: PendingApproval = {
      rpcId: frame.rpcId,
      sessionId: frame.sessionId,
      toolUseId: frame.toolUseId,
      toolName: frame.toolName,
      input: frame.input,
      description: frame.description,
      registeredAt: Date.now(),
    };

    this._pending.set(frame.rpcId.value, approval);

    if (resolve) {
      this._resolvers.set(frame.rpcId.value, resolve);
    }

    this._persist();
    this._emit({ type: 'registered', approval });
    return approval;
  }

  /**
   * Resolve a pending approval.
   *
   * @param rpcId - The RPC ID of the pending approval
   * @param approved - Whether approved or rejected
   * @param reason - Optional reason for the decision
   */
  resolve(rpcId: RpcId, approved: boolean, reason?: string): void {
    const pending = this._pending.get(rpcId.value);
    if (!pending) {
      console.warn(`PendingManager: No pending approval for rpcId=${rpcId.value}`);
      return;
    }

    // Call the resolver if registered
    const resolver = this._resolvers.get(rpcId.value);
    if (resolver) {
      resolver(rpcId, approved, reason);
      this._resolvers.delete(rpcId.value);
    }

    this._pending.delete(rpcId.value);
    this._persist();
    this._emit({ type: 'resolved', rpcId, approved });
  }

  /**
   * Handle an incoming approval/resolved frame.
   *
   * @param frame - The approval/resolved frame
   */
  handleApprovalResolved(frame: ApprovalResolved): void {
    const pending = this._pending.get(frame.rpcId.value);
    if (pending) {
      this._pending.delete(frame.rpcId.value);
      this._persist();
    }
    this._emit({ type: 'resolved', rpcId: frame.rpcId, approved: frame.approved });
  }

  /**
   * Get a pending approval by RPC ID.
   */
  get(rpcId: RpcId): PendingApproval | undefined {
    return this._pending.get(rpcId.value);
  }

  /**
   * Get all pending approvals for a session.
   */
  getBySession(sessionId: string): PendingApproval[] {
    const result: PendingApproval[] = [];
    for (const approval of Array.from(this._pending.values())) {
      if (approval.sessionId === sessionId) {
        result.push(approval);
      }
    }
    return result;
  }

  /**
   * Get all pending approvals.
   */
  getAll(): PendingApproval[] {
    return Array.from(this._pending.values());
  }

  /**
   * Check if there are any pending approvals.
   */
  get hasPending(): boolean {
    return this._pending.size > 0;
  }

  /**
   * Get the count of pending approvals.
   */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * Clear a specific pending approval without resolving it.
   */
  clear(rpcId: RpcId): void {
    if (this._pending.has(rpcId.value)) {
      this._pending.delete(rpcId.value);
      this._resolvers.delete(rpcId.value);
      this._persist();
    }
  }

  /**
   * Clear all pending approvals.
   */
  clearAll(): void {
    this._pending.clear();
    this._resolvers.clear();
    this._persist();
    this._emit({ type: 'cleared' });
  }

  /**
   * Clean up expired pending approvals based on maxAge.
   */
  cleanup(): void {
    const now = Date.now();
    let changed = false;

    for (const [rpcId, approval] of Array.from(this._pending.entries())) {
      if (now - approval.registeredAt > this._options.maxAge) {
        this._pending.delete(rpcId);
        this._resolvers.delete(rpcId);
        changed = true;
      }
    }

    if (changed) {
      this._persist();
    }
  }

  /**
   * Register an event handler.
   *
   * @param handler - Event handler function
   * @returns Unsubscribe function
   */
  on(handler: PendingEventHandler): () => void {
    this._handlers.add(handler);
    return () => this._handlers.delete(handler);
  }

  // ─── Private ───────────────────────────────────────────────────────────────

  private _emit(event: PendingEvent): void {
    for (const handler of Array.from(this._handlers)) {
      try {
        handler(event);
      } catch (err) {
        console.error('PendingManager: Handler error', err);
      }
    }
  }

  private _persist(): void {
    try {
      const data = Array.from(this._pending.values()).map((approval) => ({
        rpcId: approval.rpcId.value,
        sessionId: approval.sessionId,
        toolUseId: approval.toolUseId,
        toolName: approval.toolName,
        input: approval.input,
        description: approval.description,
        registeredAt: approval.registeredAt,
        metadata: approval.metadata,
      }));

      sessionStorage.setItem(this._storageKey, JSON.stringify(data));
    } catch {
      // sessionStorage may be unavailable (e.g., private browsing)
      console.warn('PendingManager: Failed to persist to sessionStorage');
    }
  }

  private _restore(): void {
    try {
      const raw = sessionStorage.getItem(this._storageKey);
      if (!raw) return;

      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;

      const now = Date.now();

      for (const item of data) {
        // Check expiration
        if (now - (item.registeredAt ?? 0) > this._options.maxAge) {
          continue;
        }

        const approval: PendingApproval = {
          rpcId: RpcId.from(item.rpcId),
          sessionId: item.sessionId,
          toolUseId: item.toolUseId,
          toolName: item.toolName,
          input: item.input ?? {},
          description: item.description,
          registeredAt: item.registeredAt ?? now,
          metadata: item.metadata,
        };

        this._pending.set(item.rpcId, approval);
      }
    } catch {
      // Ignore parse errors or unavailable storage
    }
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export type { ApprovalRequested, ApprovalResolved, RpcId, RpcResult };
