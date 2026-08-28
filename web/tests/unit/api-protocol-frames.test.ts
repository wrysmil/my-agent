/**
 * Unit tests for api-protocol frames.
 * Coverage: All 27 SSE event types mapped to frame types, MuxFrame union
 */

import { describe, expect, it } from 'vitest';
import { RpcId } from '../../src/lib/api-protocol/types';
import {
  type SessionFrame,
  type MuxFrame,
  type ApprovalFrame,
  type HostFrame,
} from '../../src/lib/api-protocol/frames';

describe('SessionFrame - All 27 SSE events mapped', () => {
  // Original SSE events from KNOWN_EVENTS (27 types)
  const sseEventTypes = [
    'message_start',
    'content_block_start',
    'content_block_delta',
    'content_block_stop',
    'thinking_delta',
    'tool_use',
    'tool_result',
    'tool_progress',
    'agent_message',
    'dispatch_started',
    'worker_step_start',
    'worker_text_delta',
    'worker_step_end',
    'dispatch_done',
    'compaction',
    'context_status',
    'retry',
    'provider_fallback',
    'message_delta',
    'message_stop',
    'error',
    'done',
    'aborted',
    'usage',
    'ping',
    'session/event',
    'session/subscribed',
  ];

  it('has 27 SSE event types documented', () => {
    // This documents the expected coverage
    expect(sseEventTypes.length).toBe(27);
  });

  it('can construct message_start frame', () => {
    const frame: SessionFrame = {
      kind: 'session/message-start',
      sessionId: 'sess-123',
      model: 'claude-3-5-sonnet',
      usage: { inputTokens: 100 },
    };
    expect(frame.kind).toBe('session/message-start');
    expect(frame.sessionId).toBe('sess-123');
  });

  it('can construct content_block_start frame', () => {
    const frame: SessionFrame = {
      kind: 'session/content-block-start',
      sessionId: 'sess-123',
      index: 0,
      block: { type: 'text', text: '' },
    };
    expect(frame.kind).toBe('session/content-block-start');
    expect(frame.index).toBe(0);
  });

  it('can construct content_block_delta frame', () => {
    const frame: SessionFrame = {
      kind: 'session/content-block-delta',
      sessionId: 'sess-123',
      index: 0,
      delta: { type: 'text_delta', text: 'Hello' },
    };
    expect(frame.kind).toBe('session/content-block-delta');
    expect((frame.delta as { type: string; text: string }).text).toBe('Hello');
  });

  it('can construct content_block_stop frame', () => {
    const frame: SessionFrame = {
      kind: 'session/content-block-stop',
      sessionId: 'sess-123',
      index: 0,
    };
    expect(frame.kind).toBe('session/content-block-stop');
  });

  it('can construct thinking_delta frame', () => {
    const frame: SessionFrame = {
      kind: 'session/thinking-delta',
      sessionId: 'sess-123',
      delta: 'Let me think...',
    };
    expect(frame.kind).toBe('session/thinking-delta');
  });

  it('can construct tool_use frame', () => {
    const frame: SessionFrame = {
      kind: 'session/tool-use',
      sessionId: 'sess-123',
      toolUseId: 'tool-1',
      name: 'ReadFile',
      input: { path: '/test.txt' },
    };
    expect(frame.kind).toBe('session/tool-use');
    expect(frame.name).toBe('ReadFile');
  });

  it('can construct tool_result frame', () => {
    const frame: SessionFrame = {
      kind: 'session/tool-result',
      sessionId: 'sess-123',
      toolUseId: 'tool-1',
      content: 'file contents',
      isError: false,
    };
    expect(frame.kind).toBe('session/tool-result');
    expect(frame.isError).toBe(false);
  });

  it('can construct tool_progress frame', () => {
    const frame: SessionFrame = {
      kind: 'session/tool-progress',
      sessionId: 'sess-123',
      toolUseId: 'tool-1',
      progress: { percent: 50 },
    };
    expect(frame.kind).toBe('session/tool-progress');
  });

  it('can construct agent_message frame', () => {
    const frame: SessionFrame = {
      kind: 'session/agent-message',
      sessionId: 'sess-123',
      agentId: 'agent-1',
      content: 'Sub-agent completed',
    };
    expect(frame.kind).toBe('session/agent-message');
  });

  it('can construct dispatch_started frame', () => {
    const frame: SessionFrame = {
      kind: 'session/dispatch-started',
      sessionId: 'sess-123',
      runId: 'run-1',
    };
    expect(frame.kind).toBe('session/dispatch-started');
  });

  it('can construct worker_step_start frame', () => {
    const frame: SessionFrame = {
      kind: 'session/worker-step-start',
      sessionId: 'sess-123',
      runId: 'run-1',
      stepId: 'step-1',
      stepName: 'ReadFile',
    };
    expect(frame.kind).toBe('session/worker-step-start');
  });

  it('can construct worker_text_delta frame', () => {
    const frame: SessionFrame = {
      kind: 'session/worker-text-delta',
      sessionId: 'sess-123',
      runId: 'run-1',
      stepId: 'step-1',
      delta: 'Reading file...',
    };
    expect(frame.kind).toBe('session/worker-text-delta');
  });

  it('can construct worker_step_end frame', () => {
    const frame: SessionFrame = {
      kind: 'session/worker-step-end',
      sessionId: 'sess-123',
      runId: 'run-1',
      stepId: 'step-1',
      status: 'done',
    };
    expect(frame.kind).toBe('session/worker-step-end');
  });

  it('can construct dispatch_done frame', () => {
    const frame: SessionFrame = {
      kind: 'session/dispatch-done',
      sessionId: 'sess-123',
      runId: 'run-1',
      status: 'completed',
    };
    expect(frame.kind).toBe('session/dispatch-done');
  });

  it('can construct compaction frame', () => {
    const frame: SessionFrame = {
      kind: 'session/compaction',
      sessionId: 'sess-123',
      contextUsed: 50000,
      contextLimit: 200000,
    };
    expect(frame.kind).toBe('session/compaction');
  });

  it('can construct context_status frame', () => {
    const frame: SessionFrame = {
      kind: 'session/context-status',
      sessionId: 'sess-123',
      used: 10000,
      limit: 200000,
    };
    expect(frame.kind).toBe('session/context-status');
  });

  it('can construct retry frame', () => {
    const frame: SessionFrame = {
      kind: 'session/retry',
      sessionId: 'sess-123',
      attempt: 1,
      maxAttempts: 3,
      reason: 'rate-limited',
    };
    expect(frame.kind).toBe('session/retry');
  });

  it('can construct provider_fallback frame', () => {
    const frame: SessionFrame = {
      kind: 'session/provider-fallback',
      sessionId: 'sess-123',
      from: 'claude-3-5-sonnet',
      to: 'claude-3-haiku',
    };
    expect(frame.kind).toBe('session/provider-fallback');
  });

  it('can construct message_delta frame', () => {
    const frame: SessionFrame = {
      kind: 'session/message-delta',
      sessionId: 'sess-123',
      delta: { type: 'text_delta', text: 'Final answer' },
    };
    expect(frame.kind).toBe('session/message-delta');
  });

  it('can construct message_stop frame', () => {
    const frame: SessionFrame = {
      kind: 'session/message-stop',
      sessionId: 'sess-123',
    };
    expect(frame.kind).toBe('session/message-stop');
  });

  it('can construct error frame', () => {
    const frame: SessionFrame = {
      kind: 'session/error',
      sessionId: 'sess-123',
      code: 'internal-error',
      message: 'Something went wrong',
    };
    expect(frame.kind).toBe('session/error');
  });

  it('can construct done frame', () => {
    const frame: SessionFrame = {
      kind: 'session/done',
      sessionId: 'sess-123',
    };
    expect(frame.kind).toBe('session/done');
  });

  it('can construct aborted frame', () => {
    const frame: SessionFrame = {
      kind: 'session/aborted',
      sessionId: 'sess-123',
      reason: 'user-cancelled',
    };
    expect(frame.kind).toBe('session/aborted');
  });

  it('can construct usage frame', () => {
    const frame: SessionFrame = {
      kind: 'session/usage',
      sessionId: 'sess-123',
      inputTokens: 1000,
      outputTokens: 500,
    };
    expect(frame.kind).toBe('session/usage');
  });

  it('can construct ping frame', () => {
    const frame: SessionFrame = {
      kind: 'session/ping',
      sessionId: 'sess-123',
    };
    expect(frame.kind).toBe('session/ping');
  });

  it('can construct session/event frame', () => {
    const frame: SessionFrame = {
      kind: 'session/event',
      sessionId: 'sess-123',
      event: 'custom-event',
      data: { foo: 'bar' },
    };
    expect(frame.kind).toBe('session/event');
  });

  it('can construct session/subscribed frame', () => {
    const frame: SessionFrame = {
      kind: 'session/subscribed',
      sessionId: 'sess-123',
      lastSeq: 42,
    };
    expect(frame.kind).toBe('session/subscribed');
  });
});

describe('ApprovalFrame', () => {
  it('can construct approval/requested frame', () => {
    const frame: ApprovalFrame = {
      kind: 'approval/requested',
      rpcId: RpcId.mint(),
      id: 'approval-1',
      tool: 'Bash',
      payload: { command: 'rm -rf /' },
    };
    expect(frame.kind).toBe('approval/requested');
    expect(frame.tool).toBe('Bash');
  });

  it('can construct approval/resolved frame', () => {
    const frame: ApprovalFrame = {
      kind: 'approval/resolved',
      rpcId: RpcId.mint(),
      id: 'approval-1',
      outcome: 'allow',
    };
    expect(frame.kind).toBe('approval/resolved');
    expect(frame.outcome).toBe('allow');
  });
});

describe('HostFrame', () => {
  it('can construct host/describe frame', () => {
    const frame: HostFrame = {
      kind: 'host/describe',
      capabilities: ['approval', 'streaming'],
    };
    expect(frame.kind).toBe('host/describe');
    expect(frame.capabilities).toContain('approval');
  });

  it('can construct host/session-added frame', () => {
    const frame: HostFrame = {
      kind: 'host/session-added',
      sessionId: 'sess-new',
    };
    expect(frame.kind).toBe('host/session-added');
  });

  it('can construct host/session-removed frame', () => {
    const frame: HostFrame = {
      kind: 'host/session-removed',
      sessionId: 'sess-removed',
    };
    expect(frame.kind).toBe('host/session-removed');
  });
});

describe('MuxFrame union', () => {
  it('SessionFrame is assignable to MuxFrame', () => {
    const sessionFrame: MuxFrame = {
      kind: 'session/message-start',
      sessionId: 'sess-123',
    };
    expect(sessionFrame.kind).toBe('session/message-start');
  });

  it('ApprovalFrame is assignable to MuxFrame', () => {
    const approvalFrame: MuxFrame = {
      kind: 'approval/requested',
      rpcId: RpcId.mint(),
      id: '1',
      tool: 'bash',
      payload: {},
    };
    expect(approvalFrame.kind).toBe('approval/requested');
  });

  it('HostFrame is assignable to MuxFrame', () => {
    const hostFrame: MuxFrame = {
      kind: 'host/describe',
      capabilities: [],
    };
    expect(hostFrame.kind).toBe('host/describe');
  });

  it('MuxFrame can be narrowed with switch', () => {
    function getFrameCategory(frame: MuxFrame): string {
      if (frame.kind.startsWith('session/')) return 'session';
      if (frame.kind.startsWith('approval/')) return 'approval';
      if (frame.kind.startsWith('host/')) return 'host';
      return 'unknown';
    }

    expect(getFrameCategory({ kind: 'session/message-start', sessionId: 's' })).toBe('session');
    expect(getFrameCategory({ kind: 'approval/requested', rpcId: RpcId.mint(), id: '1', tool: 'x', payload: {} })).toBe('approval');
    expect(getFrameCategory({ kind: 'host/describe', capabilities: [] })).toBe('host');
  });
});
