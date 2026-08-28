/**
 * ConnectionController — manages the full connection lifecycle.
 *
 * Three-step handshake:
 * 1. HTTP GET /api/host.describe — fetch host capabilities
 * 2. HTTP GET /api/sessions — fetch available sessions
 * 3. WebSocket connect /api/events.mux — establish real-time channel
 *
 * Features:
 * - Exponential backoff reconnection (base=500ms, factor=2, max=10s)
 * - Generation counter (increments on each connect attempt)
 * - Cleanup on destroy
 */

import { WebApiClient, type WebApiClientOptions } from './WebApiClient';

export interface HostCapabilities {
  /** Host-reported capabilities (model list, tool list, etc.) */
  [key: string]: unknown;
}

export interface SessionInfo {
  sessionId: string;
  label?: string;
}

export interface ConnectionState {
  /** Current connection generation (increments on each connect attempt) */
  generation: number;
  /** Whether we're currently connected */
  connected: boolean;
  /** Host capabilities (null until handshake completes) */
  hostCapabilities: HostCapabilities | null;
  /** Available sessions (null until handshake completes) */
  sessions: SessionInfo[];
  /** Connection error (null when connected or idle) */
  error: Error | null;
  /** Current reconnect attempt count */
  reconnectAttempts: number;
}

export interface ConnectionControllerOptions {
  /** HTTP base URL (default: '') */
  httpBaseUrl?: string;
  /** WebSocket URL suffix (default: '/api/events.mux') */
  wsUrl?: string;
  /** Custom WebSocket factory */
  webSocketFactory?: WebApiClientOptions['webSocketFactory'];
  /** Whether to auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Maximum reconnect attempts (default: Infinity) */
  maxReconnectAttempts?: number;
  /** Callback when connection state changes */
  onStateChange?: (state: ConnectionState) => void;
  /** Callback when host capabilities are received */
  onCapabilities?: (capabilities: HostCapabilities) => void;
  /** Callback when sessions list is received */
  onSessions?: (sessions: SessionInfo[]) => void;
  /** Callback when WebSocket is opened */
  onOpen?: () => void;
  /** Callback when WebSocket is closed */
  onClose?: (code: number, reason: string) => void;
  /** Callback on connection error */
  onError?: (error: Error) => void;
}

/** Backoff configuration */
const BACKOFF_BASE = 500; // ms
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX = 10000; // ms

export class ConnectionController {
  private _ws: WebApiClient;
  private _options: Omit<ConnectionControllerOptions, 'onStateChange' | 'onCapabilities' | 'onSessions' | 'onOpen' | 'onClose' | 'onError'> & {
    onStateChange?: ConnectionControllerOptions['onStateChange'];
    onCapabilities?: ConnectionControllerOptions['onCapabilities'];
    onSessions?: ConnectionControllerOptions['onSessions'];
    onOpen?: ConnectionControllerOptions['onOpen'];
    onClose?: ConnectionControllerOptions['onClose'];
    onError?: ConnectionControllerOptions['onError'];
  };
  private _state: ConnectionState;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  constructor(options: ConnectionControllerOptions = {}) {
    this._options = {
      httpBaseUrl: options.httpBaseUrl ?? '',
      wsUrl: options.wsUrl ?? '/api/events.mux',
      webSocketFactory: options.webSocketFactory,
      autoReconnect: options.autoReconnect ?? true,
      maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
      onStateChange: options.onStateChange,
      onCapabilities: options.onCapabilities,
      onSessions: options.onSessions,
      onOpen: options.onOpen,
      onClose: options.onClose,
      onError: options.onError,
    };

    this._state = {
      generation: 0,
      connected: false,
      hostCapabilities: null,
      sessions: [],
      error: null,
      reconnectAttempts: 0,
    };

    // Create WebSocket client with generation tracking
    const wsOptions: WebApiClientOptions = {
      url: `${this._options.httpBaseUrl}${this._options.wsUrl}`,
      requestHostDescribe: false, // We handle this manually in the handshake
    };

    if (this._options.webSocketFactory) {
      wsOptions.webSocketFactory = this._options.webSocketFactory;
    }

    this._ws = new WebApiClient(wsOptions);
    this._ws.on('open', this._onWsOpen);
    this._ws.on('close', this._onWsClose);
    this._ws.on('error', this._onWsError);
    this._ws.on('mux-frame', this._onMuxFrame);
  }

  /** Current connection state (read-only) */
  get state(): Readonly<ConnectionState> {
    return this._state;
  }

  /** The WebSocket client (for sending requests) */
  get client(): WebApiClient {
    return this._ws;
  }

  /** Start the connection handshake */
  async connect(): Promise<void> {
    if (this._destroyed) {
      throw new Error('ConnectionController already destroyed');
    }

    // Increment generation
    this._state.generation++;
    this._state.error = null;
    this._setState();

    try {
      // Step 1: Fetch host capabilities
      const capabilities = await this._fetchHostDescribe();
      this._state.hostCapabilities = capabilities;
      this._options.onCapabilities?.(capabilities);
      this._setState();

      // Step 2: Fetch sessions
      const sessions = await this._fetchSessions();
      this._state.sessions = sessions;
      this._options.onSessions?.(sessions);
      this._setState();

      // Step 3: Connect WebSocket
      this._ws.connect();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._state.error = error;
      this._setState();
      this._options.onError?.(error);

      // Start reconnection if enabled
      if (this._options.autoReconnect) {
        this._scheduleReconnect();
      }
    }
  }

  /** Disconnect and stop reconnection attempts */
  disconnect(): void {
    this._cancelReconnect();
    this._ws.disconnect(1000, 'User disconnected');
    this._state.connected = false;
    this._state.reconnectAttempts = 0;
    this._setState();
  }

  /** Destroy the controller and clean up resources */
  destroy(): void {
    this._destroyed = true;
    this._cancelReconnect();
    this._ws.destroy();
    this._state = {
      generation: this._state.generation,
      connected: false,
      hostCapabilities: null,
      sessions: [],
      error: null,
      reconnectAttempts: 0,
    };
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _setState(): void {
    this._options.onStateChange?.(this._state);
  }

  private async _fetchHostDescribe(): Promise<HostCapabilities> {
    const url = `${this._options.httpBaseUrl}/api/host.describe`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch host.describe: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return (data.capabilities ?? data) as HostCapabilities;
  }

  private async _fetchSessions(): Promise<SessionInfo[]> {
    const url = `${this._options.httpBaseUrl}/api/sessions`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch sessions: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    // Handle both wrapped { sessions: [...] } and direct array formats
    if (Array.isArray(data)) {
      return data;
    }
    if (data.sessions && Array.isArray(data.sessions)) {
      return data.sessions;
    }
    return [];
  }

  private _onWsOpen = (): void => {
    this._state.connected = true;
    this._state.reconnectAttempts = 0;
    this._state.error = null;
    this._setState();
    this._options.onOpen?.();
  };

  private _onWsClose = (code: number, reason: string): void => {
    this._state.connected = false;
    this._setState();
    this._options.onClose?.(code, reason);

    // Schedule reconnection if enabled
    if (this._options.autoReconnect && !this._destroyed) {
      this._scheduleReconnect();
    }
  };

  private _onWsError = (error: Error): void => {
    this._state.error = error;
    this._setState();
    this._options.onError?.(error);
  };

  private _onMuxFrame = (frame: import('../api-protocol').MuxFrame): void => {
    // Handle host/describe response from WebSocket (in case server pushes it)
    if (frame.kind === 'host/describe') {
      this._state.hostCapabilities = (frame as import('../api-protocol').HostDescribe).capabilities;
      this._options.onCapabilities?.((frame as import('../api-protocol').HostDescribe).capabilities);
      this._setState();
    }

    // Handle sessions snapshot
    if (frame.kind === 'host/sessions-snapshot') {
      this._state.sessions = (frame as import('../api-protocol').HostSessionsSnapshot).sessions;
      this._options.onSessions?.((frame as import('../api-protocol').HostSessionsSnapshot).sessions);
      this._setState();
    }
  };

  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    const maxAttempts = this._options.maxReconnectAttempts ?? Infinity;
    if (this._state.reconnectAttempts >= maxAttempts) {
      this._state.error = new Error('Max reconnect attempts reached');
      this._setState();
      return;
    }

    // Calculate backoff delay
    const delay = Math.min(
      BACKOFF_BASE * Math.pow(BACKOFF_FACTOR, this._state.reconnectAttempts),
      BACKOFF_MAX,
    );

    this._state.reconnectAttempts++;
    this._setState();

    this._reconnectTimer = setTimeout(() => {
      if (!this._destroyed) {
        this.connect();
      }
    }, delay);
  }

  private _cancelReconnect(): void {
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

// ─── Factory function ──────────────────────────────────────────────────────────

export function createConnectionController(options?: ConnectionControllerOptions): ConnectionController {
  return new ConnectionController(options);
}
