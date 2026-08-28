/**
 * api-protocol — unified re-export.
 *
 * Usage:
 *   import { RpcId, type MuxFrame, muxFrameSchema } from '@/lib/api-protocol';
 */

// Core types
export {
  RpcId,
  type RpcOk,
  type RpcErr,
  type RpcResult,
  type ClientRequest,
  type ServerResponse,
  type ServerRequest,
  type ClientResponse,
  type RpcMessage,
} from './types';

// Frame types
export type {
  // Session (25)
  SessionMessageStart,
  SessionContentBlockStart,
  SessionContentBlockDelta,
  SessionContentBlockStop,
  SessionThinkingDelta,
  SessionToolUse,
  SessionToolResult,
  SessionToolProgress,
  SessionAgentMessage,
  SessionDispatchStarted,
  SessionWorkerStepStart,
  SessionWorkerTextDelta,
  SessionWorkerStepEnd,
  SessionDispatchDone,
  SessionCompaction,
  SessionContextStatus,
  SessionRetry,
  SessionProviderFallback,
  SessionMessageDelta,
  SessionMessageStop,
  SessionError,
  SessionDone,
  SessionAborted,
  SessionUsage,
  SessionPing,
  SessionFrame,
  // Approval (2)
  ApprovalRequested,
  ApprovalResolved,
  ApprovalFrame,
  // Host (5)
  HostDescribe,
  HostSessionAdded,
  HostSessionRemoved,
  HostSessionsSnapshot,
  HostEvent,
  HostFrame,
  // Top-level
  MuxFrame,
} from './frames';

// Zod schemas
export {
  // RpcId
  rpcIdSchema,
  // RpcResult
  rpcOkSchema,
  rpcErrSchema,
  rpcResultSchema,
  // Four-quadrant
  clientRequestSchema,
  serverResponseSchema,
  serverRequestSchema,
  clientResponseSchema,
  rpcMessageSchema,
  // Session frames
  sessionMessageStartSchema,
  sessionContentBlockStartSchema,
  sessionContentBlockDeltaSchema,
  sessionContentBlockStopSchema,
  sessionThinkingDeltaSchema,
  sessionToolUseSchema,
  sessionToolResultSchema,
  sessionToolProgressSchema,
  sessionAgentMessageSchema,
  sessionDispatchStartedSchema,
  sessionWorkerStepStartSchema,
  sessionWorkerTextDeltaSchema,
  sessionWorkerStepEndSchema,
  sessionDispatchDoneSchema,
  sessionCompactionSchema,
  sessionContextStatusSchema,
  sessionRetrySchema,
  sessionProviderFallbackSchema,
  sessionMessageDeltaSchema,
  sessionMessageStopSchema,
  sessionErrorSchema,
  sessionDoneSchema,
  sessionAbortedSchema,
  sessionUsageSchema,
  sessionPingSchema,
  sessionFrameSchema,
  // Approval frames
  approvalRequestedSchema,
  approvalResolvedSchema,
  approvalFrameSchema,
  // Host frames
  hostDescribeSchema,
  hostSessionAddedSchema,
  hostSessionRemovedSchema,
  hostSessionsSnapshotSchema,
  hostEventSchema,
  hostFrameSchema,
  // Top-level
  muxFrameSchema,
} from './schema';
