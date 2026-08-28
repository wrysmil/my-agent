/**
 * FixtureClient — mock API client for UI development and testing without a backend.
 *
 * Plays back a predefined sequence of frames and optionally intercepts
 * client requests to return predefined responses.
 *
 * @example
 * // Create a fixture client with predefined responses
 * const client = createFixtureClient([
 *   // Server sends an approval request after 500ms
 *   { delay: 500, frame: { type: 'server-request', ... } },
 *   // Server sends a response after 1000ms
 *   { delay: 1000, frame: { type: 'server-response', ... } },
 * ]);
 *
 * // Listen for approval requests
 * client.on('server-request', (frame) => {
 *   // Approve after user interaction
 *   client.respond(frame.rpcId, { ok: true, data: { approved: true } });
 * });
 *
 * client.start();
 */

import type { OutgoingFrame } from './AbstractApiClient';
import { AbstractApiClient } from './AbstractApiClient';
import type {
  MuxFrame,
  RpcId,
  RpcResult,
  ServerRequest,
  ServerResponse,
} from '../api-protocol';

export interface FixtureFrame {
  /** Delay in ms before emitting this frame (default: 0) */
  delay?: number;
  /** The frame to emit */
  frame: ServerRequest | ServerResponse | MuxFrame;
}

/**
 * A fixture entry that either:
 * - Emits a frame to the client (automatic response)
 * - Intercepts a client request and returns a response
 */
export interface FixtureEntry {
  /** Delay in ms before processing (for automatic frames) */
  delay?: number;
  /** The frame to emit to the client (automatic) */
  frame?: ServerRequest | ServerResponse | MuxFrame;
  /** Method to intercept (for request interception) */
  method?: string;
  /** Response to return when the method is called */
  response?: RpcResult<unknown>;
  /** Optional delay before returning the response */
  responseDelay?: number;
}

export interface FixtureClientOptions {
  /** Initial fixture sequence */
  fixtures?: FixtureEntry[];
  /** Whether to auto-start on creation (default: true) */
  autoStart?: boolean;
}

export class FixtureClient extends AbstractApiClient {
  private _fixtures: FixtureEntry[] = [];
  private _timers: ReturnType<typeof setTimeout>[] = [];
  private _running = false;
  private _requestInterceptors = new Map<string, RpcResult<unknown>>();

  constructor(options: FixtureClientOptions = {}) {
    super();

    if (options.fixtures) {
      this._fixtures = [...options.fixtures];
    }

    // Build interceptors map
    for (const fixture of this._fixtures) {
      if (fixture.method) {
        this._requestInterceptors.set(fixture.method, fixture.response ?? { ok: true, data: null });
      }
    }

    if (options.autoStart ?? true) {
      this.start();
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  /** Start processing fixture sequence */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._scheduleFixtures();
    this.emit('open');
  }

  /** Stop processing and clear pending timers */
  stop(): void {
    this._running = false;
    for (const timer of this._timers) {
      clearTimeout(timer);
    }
    this._timers = [];
  }

  /** Add fixtures to the end of the sequence */
  pushFixtures(...entries: FixtureEntry[]): void {
    this._fixtures.push(...entries);
    if (this._running) {
      this._scheduleFixtures();
    }
  }

  /** Clear all fixtures */
  clearFixtures(): void {
    this._fixtures = [];
    this._requestInterceptors.clear();
  }

  /** Simulate receiving a frame (for testing) */
  injectFrame(frame: ServerRequest | ServerResponse | MuxFrame, delay = 0): void {
    const timer = setTimeout(() => {
      if (!this._running) return;
      if (this._isServerResponse(frame)) {
        this.handleServerResponse(frame as ServerResponse);
      } else if (this._isServerRequest(frame)) {
        this.emit('server-request', frame as ServerRequest);
      } else {
        this.emit('mux-frame', frame as MuxFrame);
      }
    }, delay);

    if (!this._running) {
      clearTimeout(timer);
    } else {
      this._timers.push(timer);
    }
  }

  /** Check if client is running */
  get isRunning(): boolean {
    return this._running;
  }

  // ─── AbstractApiClient ───────────────────────────────────────────────────────

  protected send(frame: OutgoingFrame): void {
    // Intercept client requests
    if (frame.type === 'client-request') {
      const response = this._requestInterceptors.get(frame.method);

      if (response) {
        // Schedule response
        const delay = this._getResponseDelay(frame.method);
        const timer = setTimeout(() => {
          if (this._running) {
            const serverResponse: ServerResponse = {
              type: 'server-response',
              rpcId: frame.rpcId,
              result: response,
            };
            this.handleServerResponse(serverResponse);
          }
        }, delay);

        if (!this._running) {
          clearTimeout(timer);
        } else {
          this._timers.push(timer);
        }
      } else {
        // No interceptor found - reject with error
        console.warn(`FixtureClient: No response registered for method "${frame.method}"`);
        const serverResponse: ServerResponse = {
          type: 'server-response',
          rpcId: frame.rpcId,
          result: {
            ok: false,
            code: 'method-not-found',
            message: `No fixture response for method "${frame.method}"`,
          },
        };
        this.handleServerResponse(serverResponse);
      }
    }

    // Log client responses (for debugging)
    if (frame.type === 'client-response') {
      console.debug(`FixtureClient: client-response`, frame);
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _scheduleFixtures(): void {
    let baseDelay = 0;

    for (const fixture of this._fixtures) {
      const delay = fixture.delay ?? 0;
      baseDelay += delay;

      if (fixture.frame) {
        const timer = setTimeout(() => {
          if (!this._running) return;
          this._injectFixtureFrame(fixture.frame!);
        }, baseDelay);

        this._timers.push(timer);
      } else if (fixture.method && fixture.response !== undefined) {
        // Request interceptor already registered in constructor
      }
    }

    // Clean up processed fixtures
    this._fixtures = [];
  }

  private _injectFixtureFrame(frame: ServerRequest | ServerResponse | MuxFrame): void {
    if (this._isServerResponse(frame)) {
      this.handleServerResponse(frame as ServerResponse);
    } else if (this._isServerRequest(frame)) {
      this.emit('server-request', frame as ServerRequest);
    } else {
      this.emit('mux-frame', frame as MuxFrame);
    }
  }

  private _isServerResponse(frame: unknown): frame is { type: 'server-response' } {
    return typeof frame === 'object' && frame !== null && (frame as { type?: string }).type === 'server-response';
  }

  private _isServerRequest(frame: unknown): frame is { type: 'server-request' } {
    return typeof frame === 'object' && frame !== null && (frame as { type?: string }).type === 'server-request';
  }

  private _getResponseDelay(method: string): number {
    for (const fixture of this._fixtures) {
      if (fixture.method === method && fixture.responseDelay !== undefined) {
        return fixture.responseDelay;
      }
    }
    return 100; // Default delay
  }

  destroy(): void {
    this.stop();
    super.destroy();
  }
}

// ─── Factory function ──────────────────────────────────────────────────────────

export function createFixtureClient(fixtures?: FixtureEntry[], options?: Omit<FixtureClientOptions, 'fixtures'>): FixtureClient {
  return new FixtureClient({ ...options, fixtures });
}

// ─── Predefined fixture builders ───────────────────────────────────────────────

/** Create an approval/requested frame fixture */
export function approvalRequested(
  rpcId: RpcId,
  sessionId: string,
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  description?: string,
): FixtureEntry {
  return {
    frame: {
      kind: 'approval/requested',
      rpcId,
      sessionId,
      toolUseId,
      toolName,
      input,
      description,
    },
  };
}

/** Create a host/describe frame fixture */
export function hostDescribe(capabilities: Record<string, unknown>): FixtureEntry {
  return {
    frame: {
      kind: 'host/describe',
      capabilities,
    },
  };
}

/** Create a host/sessions-snapshot frame fixture */
export function sessionsSnapshot(
  sessions: Array<{ sessionId: string; label?: string }>,
): FixtureEntry {
  return {
    frame: {
      kind: 'host/sessions-snapshot',
      sessions,
    },
  };
}

/** Create a session/message-start frame fixture */
export function sessionMessageStart(
  sessionId: string,
  model?: string,
  inputTokens?: number,
): FixtureEntry {
  return {
    frame: {
      kind: 'session/message-start',
      sessionId,
      model,
      usage: inputTokens !== undefined ? { inputTokens } : undefined,
    },
  };
}

/** Create a method response fixture */
export function methodResponse(
  method: string,
  response: RpcResult<unknown>,
  responseDelay?: number,
): FixtureEntry {
  return { method, response, responseDelay };
}
