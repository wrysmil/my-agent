/**
 * api-client — unified public API for the client-side RPC communication layer.
 *
 * Usage:
 *   import { WebApiClient, ConnectionController, createConnectionController } from '@/lib/api-client';
 *
 * For testing without a backend:
 *   import { FixtureClient, createFixtureClient } from '@/lib/api-client';
 */

import { AbstractApiClient } from './AbstractApiClient';
import { FixtureClient, createFixtureClient, approvalRequested, hostDescribe, sessionsSnapshot, sessionMessageStart, methodResponse } from './FixtureClient';
import { PendingManager, type PendingApproval, type PendingEvent } from './PendingManager';
import { WebApiClient, createWebSocketMock, WS } from './WebApiClient';
import {
  ConnectionController,
  createConnectionController,
  type HostCapabilities,
  type SessionInfo,
  type ConnectionState,
} from './ConnectionController';

// ─── Core classes ─────────────────────────────────────────────────────────────

export { AbstractApiClient };
export { ConnectionController };
export { FixtureClient };
export { PendingManager };
export { WebApiClient };

// ─── Factory functions ─────────────────────────────────────────────────────────

export { createConnectionController };
export { createFixtureClient };

// ─── Fixture helpers ───────────────────────────────────────────────────────────

export { approvalRequested };
export { hostDescribe };
export { sessionsSnapshot };
export { sessionMessageStart };
export { methodResponse };

// ─── Types ─────────────────────────────────────────────────────────────────────

export type { OutgoingFrame } from './AbstractApiClient';
export type { FrameHandlers } from './AbstractApiClient';

export type {
  WebApiClientOptions,
  WebSocketLike,
  WebSocketEvent,
} from './WebApiClient';

export type {
  HostCapabilities,
  SessionInfo,
  ConnectionState,
  ConnectionControllerOptions,
} from './ConnectionController';

export type {
  PendingApproval,
  PendingApprovalResolve,
  PendingEvent,
  PendingManagerOptions,
} from './PendingManager';

export type {
  FixtureFrame,
  FixtureEntry,
  FixtureClientOptions,
} from './FixtureClient';

// ─── Constants ────────────────────────────────────────────────────────────────

/** WebSocket ready state constants (mirrors native WebSocket) */
export { WS };

// Re-export commonly used types from api-protocol for convenience
export type {
  RpcId,
  RpcOk,
  RpcErr,
  RpcResult,
  ClientRequest,
  ServerResponse,
  ServerRequest,
  ClientResponse,
  RpcMessage,
  MuxFrame,
  SessionFrame,
  ApprovalFrame,
  ApprovalRequested,
  ApprovalResolved,
  HostFrame,
  HostDescribe,
} from '../api-protocol';

// Re-export schema validators
export {
  rpcIdSchema,
  rpcOkSchema,
  rpcErrSchema,
  rpcResultSchema,
  clientRequestSchema,
  serverResponseSchema,
  serverRequestSchema,
  clientResponseSchema,
  rpcMessageSchema,
  muxFrameSchema,
  sessionFrameSchema,
  approvalFrameSchema,
  approvalRequestedSchema,
  approvalResolvedSchema,
  hostFrameSchema,
  hostDescribeSchema,
} from '../api-protocol';
