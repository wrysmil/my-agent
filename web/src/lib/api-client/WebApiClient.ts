/**
 * WebApiClient — WebSocket-based API client using the native browser WebSocket API.
 *
 * Responsibilities:
 * - Connect to `/api/events.mux` (or configurable URL)
 * - Send ClientRequest / ClientResponse frames
 * - Receive and dispatch ServerResponse / ServerRequest / MuxFrames
 * - Handle ping/pong heartbeat
 * - Optionally request `host/describe` on connect
 */

import type { ClientResponse, OutgoingFrame } from './AbstractApiClient';
import { AbstractApiClient } from './AbstractApiClient';
import type {
  MuxFrame,
  RpcId,
  RpcResult,
  ServerRequest,
  ServerResponse,
} from '../api-protocol';

export interface WebApiClientOptions {
  /** WebSocket URL (default: '/api/events.mux') */
  url?: string;
  /** Whether to request host/describe on connect (default: true) */
  requestHostDescribe?: boolean;
  /** Heartbeat interval in ms (default: 30000) */
  heartbeatInterval?: number;
  /** Custom WebSocket constructor (useful for testing) */
  webSocketFactory?: (url: string) => WebSocketLike;
}

export type WebSocketLike = {
  readonly url: string;
  readonly readyState: number;
  close(code?: number, reason?: string): void;
  send(data: string): void;
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: WebSocketEvent) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: (event: WebSocketEvent) => void,
  ): void;
};

export interface WebSocketEvent {
  type: string;
  data?: string | ArrayBuffer;
  code?: number;
  reason?: string;
  error?: Error;
}

/** WebSocket ready state constants */
export const WS = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

export class WebApiClient extends AbstractApiClient {
  private _ws: WebSocketLike | null = null;
  private _options: Required<WebApiClientOptions>;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private _pongTimer: ReturnType<typeof setTimeout> | null = null;
  private _hostDescribeRequested = false;

  constructor(options: WebApiClientOptions = {}) {
    super();
    this._options = {
      url: options.url ?? '/api/events.mux',
      requestHostDescribe: options.requestHostDescribe ?? true,
      heartbeatInterval: options.heartbeatInterval ?? 30000,
      webSocketFactory: options.webSocketFactory ?? this._defaultWsFactory,
    };
  }

  /** Open the WebSocket connection */
  connect(): void {
    if (this._ws && this._ws.readyState === WS.OPEN) {
      return;
    }

    this._ws = this._options.webSocketFactory(this._options.url);
    this._ws.addEventListener('open', this._onOpen);
    this._ws.addEventListener('close', this._onClose);
    this._ws.addEventListener('error', this._onError);
    this._ws.addEventListener('message', this._onMessage);
  }

  /** Close the WebSocket connection */
  disconnect(code = 1000, reason = 'Normal closure'): void {
    this._stopHeartbeat();
    if (this._ws) {
      this._ws.removeEventListener('open', this._onOpen);
      this._ws.removeEventListener('close', this._onClose);
      this._ws.removeEventListener('error', this._onError);
      this._ws.removeEventListener('message', this._onMessage);

      if (this._ws.readyState === WS.OPEN || this._ws.readyState === WS.CONNECTING) {
        this._ws.close(code, reason);
      }
      this._ws = null;
    }
    this._hostDescribeRequested = false;
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this._ws !== null && this._ws.readyState === WS.OPEN;
  }

  /** Send a ping frame */
  ping(): void {
    this._sendRaw({ type: 'ping', timestamp: Date.now() });
  }

  // ─── AbstractApiClient ────────────────────────────────────────────────────────

  protected send(frame: OutgoingFrame): void {
    if (!this._ws || this._ws.readyState !== WS.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this._sendRaw(frame);
  }

  // ─── Internal ────────────────────────────────────────────────────────────────

  private _defaultWsFactory = (url: string): WebSocketLike => {
    // Use native WebSocket in browser environment
    const ws = new WebSocket(url);
    return {
      url: ws.url,
      get readyState() { return ws.readyState; },
      close: (code?: number, reason?: string) => ws.close(code, reason),
      send: (data: string) => ws.send(data),
      addEventListener: (type: string, listener: (event: Event) => void) => {
        ws.addEventListener(type, listener as EventListener);
      },
      removeEventListener: (type: string, listener: (event: Event) => void) => {
        ws.removeEventListener(type, listener as EventListener);
      },
    };
  };

  private _onOpen = (): void => {
    this.emit('open');
    this._startHeartbeat();

    // Request host/describe if not yet received
    if (this._options.requestHostDescribe && !this._hostDescribeRequested) {
      this._hostDescribeRequested = true;
      this.callUnary('host/describe', {}).catch(() => {
        // Ignore - host/describe is optional
      });
    }
  };

  private _onClose = (event: WebSocketEvent): void => {
    this._stopHeartbeat();
    this.clearPending(new Error(`WebSocket closed: ${event.code ?? 'unknown'} ${event.reason ?? ''}`));
    this.emit('close', event.code ?? 1006, event.reason ?? 'Abnormal closure');
    this._ws = null;
    this._hostDescribeRequested = false;
  };

  private _onError = (event: WebSocketEvent): void => {
    this.emit('error', event.error ?? new Error('WebSocket error'));
  };

  private _onMessage = (event: WebSocketEvent): void => {
    if (typeof event.data !== 'string') return;

    let data: unknown;
    try {
      data = JSON.parse(event.data);
    } catch {
      return; // Ignore non-JSON messages
    }

    // Handle pong response
    if (this._isPong(data)) {
      this._clearPongTimer();
      return;
    }

    // Dispatch based on message type
    if (this._isServerResponse(data)) {
      this.handleServerResponse(data as ServerResponse);
    } else if (this._isServerRequest(data)) {
      this.emit('server-request', data as ServerRequest);
    } else if (this._isMuxFrame(data)) {
      this.emit('mux-frame', data as MuxFrame);
    }
  };

  private _sendRaw(frame: unknown): void {
    if (this._ws && this._ws.readyState === WS.OPEN) {
      this._ws.send(JSON.stringify(frame));
    }
  }

  private _startHeartbeat(): void {
    this._stopHeartbeat();
    this._heartbeatTimer = setInterval(() => {
      if (this.isConnected) {
        this.ping();
        // Set a timeout to detect missing pong
        this._pongTimer = setTimeout(() => {
          // No pong received within timeout, connection may be dead
          this.disconnect(1006, 'Heartbeat timeout');
        }, 5000);
      }
    }, this._options.heartbeatInterval);
  }

  private _stopHeartbeat(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._clearPongTimer();
  }

  private _clearPongTimer(): void {
    if (this._pongTimer !== null) {
      clearTimeout(this._pongTimer);
      this._pongTimer = null;
    }
  }

  // ─── Type guards ─────────────────────────────────────────────────────────────

  private _isServerResponse(data: unknown): data is { type: 'server-response' } {
    return typeof data === 'object' && data !== null && (data as { type?: string }).type === 'server-response';
  }

  private _isServerRequest(data: unknown): data is { type: 'server-request' } {
    return typeof data === 'object' && data !== null && (data as { type?: string }).type === 'server-request';
  }

  private _isMuxFrame(data: unknown): data is { kind: string } {
    if (typeof data !== 'object' || data === null) return false;
    const d = data as { type?: string; kind?: string };
    // Exclude RPC message types - only true MuxFrames
    return d.kind !== undefined && d.type === undefined;
  }

  private _isPong(data: unknown): data is { type: 'pong'; timestamp: number } {
    return typeof data === 'object' && data !== null && (data as { type?: string }).type === 'pong';
  }

  destroy(): void {
    this.disconnect(1000, 'Client destroyed');
    super.destroy();
  }
}

// ─── WebSocket mock factory ────────────────────────────────────────────────────

export type MessageHandler = (data: string) => void;

/**
 * Creates a mock WebSocket-like object for testing.
 *
 * @param options.initialState - Initial readyState (default: CONNECTING)
 * @param options.onSend - Callback when data is sent
 * @param options.autoOpen - Auto-open after delay (default: true, 50ms)
 * @returns Mock WebSocketLike object
 *
 * @example
 * const mock = createWebSocketMock({
 *   onSend: (data) => console.log('Sent:', data),
 * });
 * mock.simulateMessage({ type: 'server-response', ... });
 */
export function createWebSocketMock(options: {
  initialState?: number;
  onSend?: (data: string) => void;
  autoOpen?: boolean;
  openDelay?: number;
} = {}): WebSocketLike & {
  /** Simulate receiving a message */
  simulateMessage(data: unknown): void;
  /** Simulate connection open */
  simulateOpen(): void;
  /** Simulate connection close */
  simulateClose(code?: number, reason?: string): void;
  /** Simulate error */
  simulateError(error?: Error): void;
} {
  let readyState = options.initialState ?? WS.CONNECTING;
  const handlers: Partial<Record<string, Set<(event: WebSocketEvent) => void>>> = {
    open: new Set(),
    close: new Set(),
    error: new Set(),
    message: new Set(),
  };

  const mock: ReturnType<typeof createWebSocketMock> = {
    url: 'ws://localhost/mock',
    get readyState() { return readyState; },

    close(code?: number, reason?: string) {
      if (readyState === WS.CLOSED) return;
      readyState = WS.CLOSING;
      const event: WebSocketEvent = { type: 'close', code: code ?? 1000, reason: reason ?? '' };
      handlers.close?.forEach(h => h(event));
      readyState = WS.CLOSED;
    },

    send(data: string) {
      if (readyState !== WS.OPEN) {
        throw new Error(`Cannot send on closed WebSocket (state: ${readyState})`);
      }
      options.onSend?.(data);
    },

    addEventListener(type: string, listener: (event: WebSocketEvent) => void) {
      handlers[type]?.add(listener);
    },

    removeEventListener(type: string, listener: (event: WebSocketEvent) => void) {
      handlers[type]?.delete(listener);
    },

    simulateMessage(data: unknown) {
      if (readyState !== WS.OPEN) return;
      const event: WebSocketEvent = { type: 'message', data: JSON.stringify(data) };
      handlers.message?.forEach(h => h(event));
    },

    simulateOpen() {
      if (readyState !== WS.CONNECTING) return;
      readyState = WS.OPEN;
      const event: WebSocketEvent = { type: 'open' };
      handlers.open?.forEach(h => h(event));
    },

    simulateClose(code = 1000, reason = 'Normal closure') {
      if (readyState === WS.CLOSED) return;
      readyState = WS.CLOSING;
      const event: WebSocketEvent = { type: 'close', code, reason };
      handlers.close?.forEach(h => h(event));
      readyState = WS.CLOSED;
    },

    simulateError(error = new Error('Mock error')) {
      const event: WebSocketEvent = { type: 'error', error };
      handlers.error?.forEach(h => h(event));
    },
  };

  // Auto-open after delay
  if (options.autoOpen ?? true) {
    setTimeout(() => mock.simulateOpen(), options.openDelay ?? 50);
  }

  return mock;
}

// ─── Exports ──────────────────────────────────────────────────────────────────

export type { RpcId, RpcResult };
export type { ClientResponse };
