/**
 * Frame types for the multiplexed WebSocket protocol.
 *
 * All 27 legacy SSE events are mapped into three discriminated-union families:
 *
 *   SessionFrame  — streaming content & lifecycle (25 event kinds)
 *   ApprovalFrame — human-in-the-loop approval flow (2 kinds)
 *   HostFrame     — host / session management (5 kinds)
 *
 *   MuxFrame = SessionFrame | ApprovalFrame | HostFrame
 */

import type { RpcId, RpcResult } from './types';

// ─── Session frames (25 kinds) ────────────────────────────────────────────────

export interface SessionMessageStart {
  kind: 'session/message-start';
  sessionId: string;
  model?: string;
  usage?: { inputTokens: number };
}

export interface SessionContentBlockStart {
  kind: 'session/content-block-start';
  sessionId: string;
  index: number;
  block: { type: 'text'; text: '' } | { type: 'tool_use'; id: string; name: string };
}

export interface SessionContentBlockDelta {
  kind: 'session/content-block-delta';
  sessionId: string;
  index: number;
  delta: { type: 'text_delta'; text: string } | { type: 'input_json_delta'; partial: string };
}

export interface SessionContentBlockStop {
  kind: 'session/content-block-stop';
  sessionId: string;
  index: number;
}

export interface SessionThinkingDelta {
  kind: 'session/thinking-delta';
  sessionId: string;
  delta: string;
}

export interface SessionToolUse {
  kind: 'session/tool-use';
  sessionId: string;
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
}

export interface SessionToolResult {
  kind: 'session/tool-result';
  sessionId: string;
  toolUseId: string;
  content: unknown;
  isError?: boolean;
}

export interface SessionToolProgress {
  kind: 'session/tool-progress';
  sessionId: string;
  toolUseId: string;
  progress: unknown;
}

export interface SessionAgentMessage {
  kind: 'session/agent-message';
  sessionId: string;
  agentId: string;
  content: string;
}

export interface SessionDispatchStarted {
  kind: 'session/dispatch-started';
  sessionId: string;
  dispatchId: string;
  agentId: string;
}

export interface SessionWorkerStepStart {
  kind: 'session/worker-step-start';
  sessionId: string;
  dispatchId: string;
  workerId: string;
  stepIndex: number;
}

export interface SessionWorkerTextDelta {
  kind: 'session/worker-text-delta';
  sessionId: string;
  dispatchId: string;
  workerId: string;
  delta: string;
}

export interface SessionWorkerStepEnd {
  kind: 'session/worker-step-end';
  sessionId: string;
  dispatchId: string;
  workerId: string;
  stepIndex: number;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface SessionDispatchDone {
  kind: 'session/dispatch-done';
  sessionId: string;
  dispatchId: string;
  result: RpcResult<unknown>;
}

export interface SessionCompaction {
  kind: 'session/compaction';
  sessionId: string;
  compactedTokens: number;
  remainingTokens: number;
}

export interface SessionContextStatus {
  kind: 'session/context-status';
  sessionId: string;
  usedTokens: number;
  maxTokens: number;
}

export interface SessionRetry {
  kind: 'session/retry';
  sessionId: string;
  attempt: number;
  maxAttempts: number;
  reason?: string;
}

export interface SessionProviderFallback {
  kind: 'session/provider-fallback';
  sessionId: string;
  fromProvider: string;
  toProvider: string;
  reason?: string;
}

export interface SessionMessageDelta {
  kind: 'session/message-delta';
  sessionId: string;
  delta: { stopReason?: string; usage?: { outputTokens: number } };
}

export interface SessionMessageStop {
  kind: 'session/message-stop';
  sessionId: string;
}

export interface SessionError {
  kind: 'session/error';
  sessionId: string;
  code: string;
  message: string;
  details?: unknown;
}

export interface SessionDone {
  kind: 'session/done';
  sessionId: string;
}

export interface SessionAborted {
  kind: 'session/aborted';
  sessionId: string;
  reason?: string;
}

export interface SessionUsage {
  kind: 'session/usage';
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface SessionPing {
  kind: 'session/ping';
  sessionId: string;
  timestamp: number;
}

/** Discriminated union of all session frames (25 kinds). */
export type SessionFrame =
  | SessionMessageStart
  | SessionContentBlockStart
  | SessionContentBlockDelta
  | SessionContentBlockStop
  | SessionThinkingDelta
  | SessionToolUse
  | SessionToolResult
  | SessionToolProgress
  | SessionAgentMessage
  | SessionDispatchStarted
  | SessionWorkerStepStart
  | SessionWorkerTextDelta
  | SessionWorkerStepEnd
  | SessionDispatchDone
  | SessionCompaction
  | SessionContextStatus
  | SessionRetry
  | SessionProviderFallback
  | SessionMessageDelta
  | SessionMessageStop
  | SessionError
  | SessionDone
  | SessionAborted
  | SessionUsage
  | SessionPing;

// ─── Approval frames (2 kinds) ────────────────────────────────────────────────

export interface ApprovalRequested {
  kind: 'approval/requested';
  rpcId: RpcId;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  /** Optional human-readable description of what the tool will do. */
  description?: string;
}

export interface ApprovalResolved {
  kind: 'approval/resolved';
  rpcId: RpcId;
  sessionId: string;
  approved: boolean;
  /** Optional reason provided by the approver. */
  reason?: string;
}

/** Discriminated union of all approval frames. */
export type ApprovalFrame = ApprovalRequested | ApprovalResolved;

// ─── Host frames (5 kinds) ────────────────────────────────────────────────────

export interface HostDescribe {
  kind: 'host/describe';
  /** Host-reported capabilities (model list, tool list, etc.). */
  capabilities: Record<string, unknown>;
}

export interface HostSessionAdded {
  kind: 'host/session-added';
  sessionId: string;
  label?: string;
}

export interface HostSessionRemoved {
  kind: 'host/session-removed';
  sessionId: string;
}

export interface HostSessionsSnapshot {
  kind: 'host/sessions-snapshot';
  sessions: Array<{ sessionId: string; label?: string }>;
}

export interface HostEvent {
  kind: 'host/event';
  sessionId: string;
  event: string;
  data: Record<string, unknown>;
}

/** Discriminated union of all host frames. */
export type HostFrame =
  | HostDescribe
  | HostSessionAdded
  | HostSessionRemoved
  | HostSessionsSnapshot
  | HostEvent;

// ─── Top-level frame union ────────────────────────────────────────────────────

/** Any frame that can arrive over the multiplexed WebSocket. */
export type MuxFrame = SessionFrame | ApprovalFrame | HostFrame;
