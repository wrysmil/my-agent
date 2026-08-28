/**
 * Zod schemas for runtime validation of RPC messages and frames.
 *
 * Mirrors the TypeScript types in `types.ts` and `frames.ts` so that
 * incoming wire data can be validated before it enters the type system.
 */

import { z } from 'zod';
import { RpcId } from './types';

// ─── RpcId schema ─────────────────────────────────────────────────────────────

/** Validates that a wire value is a non-empty string, returns an RpcId. */
export const rpcIdSchema = z
  .string()
  .min(1)
  .transform((v) => RpcId.from(v));

// ─── RpcResult schema ─────────────────────────────────────────────────────────

export const rpcOkSchema = z.object({
  ok: z.literal(true),
  data: z.unknown(),
});

export const rpcErrSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
});

export const rpcResultSchema = z.union([rpcOkSchema, rpcErrSchema]);

// ─── Four-quadrant RPC message schemas ────────────────────────────────────────

export const clientRequestSchema = z.object({
  type: z.literal('client-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
});

export const serverResponseSchema = z.object({
  type: z.literal('server-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema,
});

export const serverRequestSchema = z.object({
  type: z.literal('server-request'),
  rpcId: rpcIdSchema,
  method: z.string(),
  payload: z.unknown(),
});

export const clientResponseSchema = z.object({
  type: z.literal('client-response'),
  rpcId: rpcIdSchema,
  result: rpcResultSchema,
});

/** Top-level RPC message schema — validates any of the four quadrants. */
export const rpcMessageSchema = z.union([
  clientRequestSchema,
  serverResponseSchema,
  serverRequestSchema,
  clientResponseSchema,
]);

// ─── Session frame schemas (25 kinds) ─────────────────────────────────────────

export const sessionMessageStartSchema = z.object({
  kind: z.literal('session/message-start'),
  sessionId: z.string(),
  model: z.string().optional(),
  usage: z.object({ inputTokens: z.number() }).optional(),
});

export const sessionContentBlockStartSchema = z.object({
  kind: z.literal('session/content-block-start'),
  sessionId: z.string(),
  index: z.number(),
  block: z.union([
    z.object({ type: z.literal('text'), text: z.literal('') }),
    z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string() }),
  ]),
});

export const sessionContentBlockDeltaSchema = z.object({
  kind: z.literal('session/content-block-delta'),
  sessionId: z.string(),
  index: z.number(),
  delta: z.union([
    z.object({ type: z.literal('text_delta'), text: z.string() }),
    z.object({ type: z.literal('input_json_delta'), partial: z.string() }),
  ]),
});

export const sessionContentBlockStopSchema = z.object({
  kind: z.literal('session/content-block-stop'),
  sessionId: z.string(),
  index: z.number(),
});

export const sessionThinkingDeltaSchema = z.object({
  kind: z.literal('session/thinking-delta'),
  sessionId: z.string(),
  delta: z.string(),
});

export const sessionToolUseSchema = z.object({
  kind: z.literal('session/tool-use'),
  sessionId: z.string(),
  toolUseId: z.string(),
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const sessionToolResultSchema = z.object({
  kind: z.literal('session/tool-result'),
  sessionId: z.string(),
  toolUseId: z.string(),
  content: z.unknown(),
  isError: z.boolean().optional(),
});

export const sessionToolProgressSchema = z.object({
  kind: z.literal('session/tool-progress'),
  sessionId: z.string(),
  toolUseId: z.string(),
  progress: z.unknown(),
});

export const sessionAgentMessageSchema = z.object({
  kind: z.literal('session/agent-message'),
  sessionId: z.string(),
  agentId: z.string(),
  content: z.string(),
});

export const sessionDispatchStartedSchema = z.object({
  kind: z.literal('session/dispatch-started'),
  sessionId: z.string(),
  dispatchId: z.string(),
  agentId: z.string(),
});

export const sessionWorkerStepStartSchema = z.object({
  kind: z.literal('session/worker-step-start'),
  sessionId: z.string(),
  dispatchId: z.string(),
  workerId: z.string(),
  stepIndex: z.number(),
});

export const sessionWorkerTextDeltaSchema = z.object({
  kind: z.literal('session/worker-text-delta'),
  sessionId: z.string(),
  dispatchId: z.string(),
  workerId: z.string(),
  delta: z.string(),
});

export const sessionWorkerStepEndSchema = z.object({
  kind: z.literal('session/worker-step-end'),
  sessionId: z.string(),
  dispatchId: z.string(),
  workerId: z.string(),
  stepIndex: z.number(),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .optional(),
});

export const sessionDispatchDoneSchema = z.object({
  kind: z.literal('session/dispatch-done'),
  sessionId: z.string(),
  dispatchId: z.string(),
  result: rpcResultSchema,
});

export const sessionCompactionSchema = z.object({
  kind: z.literal('session/compaction'),
  sessionId: z.string(),
  compactedTokens: z.number(),
  remainingTokens: z.number(),
});

export const sessionContextStatusSchema = z.object({
  kind: z.literal('session/context-status'),
  sessionId: z.string(),
  usedTokens: z.number(),
  maxTokens: z.number(),
});

export const sessionRetrySchema = z.object({
  kind: z.literal('session/retry'),
  sessionId: z.string(),
  attempt: z.number(),
  maxAttempts: z.number(),
  reason: z.string().optional(),
});

export const sessionProviderFallbackSchema = z.object({
  kind: z.literal('session/provider-fallback'),
  sessionId: z.string(),
  fromProvider: z.string(),
  toProvider: z.string(),
  reason: z.string().optional(),
});

export const sessionMessageDeltaSchema = z.object({
  kind: z.literal('session/message-delta'),
  sessionId: z.string(),
  delta: z.object({
    stopReason: z.string().optional(),
    usage: z.object({ outputTokens: z.number() }).optional(),
  }),
});

export const sessionMessageStopSchema = z.object({
  kind: z.literal('session/message-stop'),
  sessionId: z.string(),
});

export const sessionErrorSchema = z.object({
  kind: z.literal('session/error'),
  sessionId: z.string(),
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});

export const sessionDoneSchema = z.object({
  kind: z.literal('session/done'),
  sessionId: z.string(),
});

export const sessionAbortedSchema = z.object({
  kind: z.literal('session/aborted'),
  sessionId: z.string(),
  reason: z.string().optional(),
});

export const sessionUsageSchema = z.object({
  kind: z.literal('session/usage'),
  sessionId: z.string(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
});

export const sessionPingSchema = z.object({
  kind: z.literal('session/ping'),
  sessionId: z.string(),
  timestamp: z.number(),
});

/** Union of all session frame schemas (25 kinds). */
export const sessionFrameSchema = z.union([
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
]);

// ─── Approval frame schemas (2 kinds) ─────────────────────────────────────────

export const approvalRequestedSchema = z.object({
  kind: z.literal('approval/requested'),
  rpcId: rpcIdSchema,
  sessionId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  input: z.record(z.string(), z.unknown()),
  description: z.string().optional(),
});

export const approvalResolvedSchema = z.object({
  kind: z.literal('approval/resolved'),
  rpcId: rpcIdSchema,
  sessionId: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});

/** Union of all approval frame schemas. */
export const approvalFrameSchema = z.union([
  approvalRequestedSchema,
  approvalResolvedSchema,
]);

// ─── Host frame schemas (5 kinds) ─────────────────────────────────────────────

export const hostDescribeSchema = z.object({
  kind: z.literal('host/describe'),
  capabilities: z.record(z.string(), z.unknown()),
});

export const hostSessionAddedSchema = z.object({
  kind: z.literal('host/session-added'),
  sessionId: z.string(),
  label: z.string().optional(),
});

export const hostSessionRemovedSchema = z.object({
  kind: z.literal('host/session-removed'),
  sessionId: z.string(),
});

export const hostSessionsSnapshotSchema = z.object({
  kind: z.literal('host/sessions-snapshot'),
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      label: z.string().optional(),
    }),
  ),
});

export const hostEventSchema = z.object({
  kind: z.literal('host/event'),
  sessionId: z.string(),
  event: z.string(),
  data: z.record(z.string(), z.unknown()),
});

/** Union of all host frame schemas. */
export const hostFrameSchema = z.union([
  hostDescribeSchema,
  hostSessionAddedSchema,
  hostSessionRemovedSchema,
  hostSessionsSnapshotSchema,
  hostEventSchema,
]);

// ─── Top-level MuxFrame schema ────────────────────────────────────────────────

/** Validates any incoming frame over the multiplexed WebSocket. */
export const muxFrameSchema = z.union([
  sessionFrameSchema,
  approvalFrameSchema,
  hostFrameSchema,
]);
