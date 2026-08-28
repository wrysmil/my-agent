/**
 * AbstractApiClient — base class for all API client implementations.
 *
 * Provides:
 * - `callUnary(method, payload)` — sends a ClientRequest and waits for the matching ServerResponse
 * - `respond(rpcId, result)` — sends a ClientResponse (e.g. approval resolution)
 * - Internal pending-requests map so callers get a Promise that resolves when the response arrives
 *
 * Subclasses must implement `send(frame)` to handle the actual transport.
 */

import { RpcId } from '../api-protocol';
import type {
  ClientRequest,
  ClientResponse,
  RpcResult,
  ServerResponse,
} from '../api-protocol';

export type { RpcId, RpcResult };

/** Frame that can be sent by the client */
export type OutgoingFrame = ClientRequest | ClientResponse;

/**
 * Event map for frame listeners. Allows subclasses to expose typed event handlers.
 */
export interface FrameHandlers {
  /** A ServerResponse arrived for one of our pending ClientRequests */
  'server-response': (frame: ServerResponse) => void;
  /** A ServerRequest arrived (e.g. approval request) */
  'server-request': (frame: import('../api-protocol').ServerRequest) => void;
  /** A MuxFrame arrived (session/approval/host frame) */
  'mux-frame': (frame: import('../api-protocol').MuxFrame) => void;
  /** Connection was opened */
  open: () => void;
  /** Connection was closed */
  close: (code: number, reason: string) => void;
  /** Connection error */
  error: (err: Error) => void;
}

/**
 * Base class for RPC-style API clients.
 *
 * Manages a Map of pending request Promises. When a ServerResponse arrives,
 * the matching Promise is resolved/rejected based on the result.
 *
 * @example
 * class MyClient extends AbstractApiClient {
 *   protected send(frame: OutgoingFrame): void { ... }
 * }
 */
export abstract class AbstractApiClient {
  /** Map from RpcId -> { resolve, reject } for in-flight requests */
  private readonly _pending = new Map<
    string,
    {
      resolve: (result: RpcResult<unknown>) => void;
      reject: (err: Error) => void;
    }
  >();

  /** Frame event listeners */
  private readonly _handlers = new Map<keyof FrameHandlers, Set<Function>>();

  /**
   * Send a ClientRequest and wait for the corresponding ServerResponse.
   *
   * @param method - RPC method name
   * @param payload - Method payload
   * @returns Promise that resolves with the server's result
   */
  callUnary<T = unknown>(method: string, payload: unknown): Promise<T> {
    const rpcId = RpcId.mint();
    const frame: ClientRequest = {
      type: 'client-request',
      rpcId,
      method,
      payload,
    };

    return new Promise<T>((resolve, reject) => {
      this._pending.set(rpcId.value, {
        resolve: (result) => {
          if (result.ok) {
            resolve(result.data as T);
          } else {
            reject(new Error(result.message ?? result.code));
          }
        },
        reject,
      });

      this.send(frame);
    });
  }

  /**
   * Send a ClientResponse (e.g. to resolve an approval).
   *
   * @param rpcId - The RPC ID from the corresponding ServerRequest
   * @param result - The result to send back
   */
  respond(rpcId: RpcId, result: RpcResult<unknown>): void {
    const frame: ClientResponse = {
      type: 'client-response',
      rpcId,
      result,
    };
    this.send(frame);
  }

  /**
   * Register a frame event handler.
   *
   * @param event - Event name
   * @param handler - Handler function
   */
  on<K extends keyof FrameHandlers>(event: K, handler: FrameHandlers[K]): () => void {
    let set = this._handlers.get(event) as Set<FrameHandlers[K]> | undefined;
    if (!set) {
      set = new Set() as Set<FrameHandlers[K]>;
      this._handlers.set(event, set as Set<Function>);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /**
   * Emit an event to all registered handlers.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected emit(event: keyof FrameHandlers, ...args: any[]): void {
    const set = this._handlers.get(event);
    if (set) {
      for (const handler of Array.from(set)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (handler as (...args: any[]) => void)(...args);
      }
    }
  }

  /**
   * Handle an incoming ServerResponse — resolve or reject the matching pending promise.
   */
  protected handleServerResponse(frame: ServerResponse): void {
    const pending = this._pending.get(frame.rpcId.value);
    if (pending) {
      this._pending.delete(frame.rpcId.value);
      pending.resolve(frame.result);
    }
    this.emit('server-response', frame);
  }

  /**
   * Check if there are any pending requests.
   */
  get hasPending(): boolean {
    return this._pending.size > 0;
  }

  /**
   * Get the number of pending requests.
   */
  get pendingCount(): number {
    return this._pending.size;
  }

  /**
   * Clear all pending requests with an error (e.g. on disconnect).
   */
  protected clearPending(err: Error): void {
    for (const [, pending] of Array.from(this._pending.entries())) {
      pending.reject(err);
    }
    this._pending.clear();
  }

  /**
   * Abstract method — subclasses implement to send frames over the transport.
   *
   * @param frame - The frame to send
   */
  protected abstract send(frame: OutgoingFrame): void;

  /**
   * Clean up — called when the client is destroyed.
   */
  destroy(): void {
    this.clearPending(new Error('Client destroyed'));
    this._handlers.clear();
  }
}

// ─── Re-exports ────────────────────────────────────────────────────────────────

export type { ClientResponse } from '../api-protocol';

