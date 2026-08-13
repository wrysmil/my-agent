/**
 * agent_message SSE 处理（WU-03）单元测试。
 *
 * 覆盖：
 * - `insertAgentMessage` 纯函数：锚定 run 最后一条 assistant 插入 / 多 agent 保持到达顺序 / 无 assistant 追加末尾
 * - hook 分发：agent_message → 创建 role: 'agent' 消息；tool_use / tool_result 记录 actor 字段
 *
 * 注：真实 `parseSseStream` 的 KNOWN_EVENTS 未含 `agent_message`（见 WU-03 阻塞项），
 * 本文件 mock `@/lib/sse` 让事件直达 hook 分发层，聚焦数据层语义。
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSseStream } from '../../../src/lib/sse';
import { useChatRuntimeStore } from '../../../src/features/chat/chatRuntimeStore';
import {
  insertAgentMessage,
  useChatStream,
} from '../../../src/features/chat/useChatStream';
import type { ChatMessage } from '../../../src/features/chat/types';

vi.mock('../../../src/lib/sse', () => ({
  parseSseStream: vi.fn(),
}));

// ============================================================
// 辅助
// ============================================================

type EnvelopeEvent = { event: string; data: Record<string, unknown> };

/** 测试内事件 seq 递增计数器；hook 按 seq 去重，必须逐帧唯一。 */
let seqCounter = 0;

/** 构造带 P0 envelope 的 SSE 事件（data 即信封对象） */
function envelope(
  event: string,
  data: Record<string, unknown>,
  runId = 'run-a',
): EnvelopeEvent {
  seqCounter += 1;
  return {
    event,
    data: {
      sessionId: 'A',
      runId,
      streamId: 'stream-a',
      seq: seqCounter,
      event,
      data,
    },
  };
}

function agentEvent(
  partial: Partial<{
    actorId: string;
    actorName: string;
    actorKind: string;
    text: string;
    isFinal: boolean;
  }>,
): EnvelopeEvent {
  return envelope('agent_message', {
    type: 'agent_message',
    actorId: 'coder-id',
    actorName: 'coder',
    actorKind: 'agent',
    text: 'hello from coder',
    isFinal: false,
    ...partial,
  });
}

function userMessage(id: string, runId: string): ChatMessage {
  return { id, role: 'user', blocks: [], text: 'question', runId };
}

function assistantMessage(id: string, runId: string): ChatMessage {
  return { id, role: 'assistant', blocks: [], runId };
}

function agentMessage(id: string, runId: string, text: string): ChatMessage {
  return { id, role: 'agent', blocks: [], text, runId };
}

function historyResponse(): Response {
  return new Response(
    JSON.stringify({ ok: true, data: { sessionId: 'A', revision: 0, messages: [] } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function emptySseResponse(): Response {
  return new Response(
    new ReadableStream({ start(controller) { controller.close(); } }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function messagesOf(sessionId: string): ChatMessage[] {
  return useChatRuntimeStore.getState().getSession(sessionId)?.messages ?? [];
}

// ============================================================
// insertAgentMessage 纯函数
// ============================================================

describe('insertAgentMessage', () => {
  it('[insertAgentMessage] [插在 run 最后一条 assistant 之后] [跨 run 不串位]', () => {
    const msgs = [
      userMessage('u1', 'run-a'),
      assistantMessage('a1', 'run-a'),
      userMessage('u2', 'run-b'),
      assistantMessage('a2', 'run-b'),
    ];
    const agent = agentMessage('g1', 'run-a', 'hello');

    const next = insertAgentMessage(msgs, 'run-a', agent);

    expect(next).toHaveLength(5);
    expect(next[2]).toBe(agent);
    expect(next.map((m) => m.id)).toEqual(['u1', 'a1', 'g1', 'u2', 'a2']);
    // 不可变：原数组不被修改
    expect(msgs).toHaveLength(4);
  });

  it('[insertAgentMessage] [多个 agent_message 保持到达顺序] [连续插入]', () => {
    let msgs = [userMessage('u1', 'run-a'), assistantMessage('a1', 'run-a')];
    msgs = insertAgentMessage(msgs, 'run-a', agentMessage('g1', 'run-a', 'first'));
    msgs = insertAgentMessage(msgs, 'run-a', agentMessage('g2', 'run-a', 'second'));

    expect(
      msgs.filter((m) => m.role === 'agent').map((m) => m.text),
    ).toEqual(['first', 'second']);
  });

  it('[insertAgentMessage] [无 assistant 时追加末尾] [仅 user + agent]', () => {
    const msgs = [userMessage('u1', 'run-a')];
    const next = insertAgentMessage(msgs, 'run-a', agentMessage('g1', 'run-a', 'x'));

    expect(next[next.length - 1]?.role).toBe('agent');
    expect(next).toHaveLength(2);
  });
});

// ============================================================
// hook 分发
// ============================================================

describe('useChatStream agent_message 分发', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatRuntimeStore.setState({
      sessions: {},
      runs: {},
      _accessOrder: [],
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce('client-a')
        .mockReturnValueOnce('run-a'),
    });
    seqCounter = 0;
  });

  function mockFetchWithEvents(events: EnvelopeEvent[]) {
    vi.mocked(parseSseStream).mockImplementation(async function* () {
      for (const evt of events) yield evt;
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.endsWith('/history')) {
        return Promise.resolve(historyResponse());
      }
      if (init?.method === 'POST') {
        return Promise.resolve(emptySseResponse());
      }
      throw new Error(`Unexpected request: ${url}`);
    });
  }

  it('[agent_message] [创建 role:agent 消息并插在 assistant 之后] [actorName/isFinal/runId]', async () => {
    mockFetchWithEvents([
      envelope('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      agentEvent({ actorName: 'coder', text: 'hello from coder', isFinal: false }),
      envelope('done', { ok: true }),
    ]);

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => {
      void result.current.send('question');
    });

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(1);
    });
    const messages = messagesOf('A');
    const agentMsgs = messages.filter((m) => m.role === 'agent');
    expect(agentMsgs[0]).toMatchObject({
      role: 'agent',
      text: 'hello from coder',
      actorName: 'coder',
      isFinal: false,
      runId: 'run-a',
    });
    const assistantIdx = messages.findIndex((m) => m.role === 'assistant');
    const agentIdx = messages.findIndex((m) => m.role === 'agent');
    expect(agentIdx).toBe(assistantIdx + 1);
  });

  it('[agent_message] [多个事件按到达顺序依次插入] [first then second]', async () => {
    mockFetchWithEvents([
      envelope('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      agentEvent({ text: 'first reply' }),
      agentEvent({ text: 'second reply' }),
      envelope('done', { ok: true }),
    ]);

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => {
      void result.current.send('question');
    });

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs.map((m) => m.text)).toEqual(['first reply', 'second reply']);
    });
    // 全部位于 assistant 之后
    const roles = messagesOf('A').map((m) => m.role);
    const assistantIdx = roles.lastIndexOf('assistant');
    expect(roles.slice(assistantIdx + 1).every((r) => r === 'agent')).toBe(true);
  });

  it('[agent_message] [无 assistant 时追加到末尾] [agent 成为最后一条]', async () => {
    mockFetchWithEvents([
      agentEvent({ text: 'early reply' }),
      envelope('done', { ok: true }),
    ]);

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => {
      void result.current.send('question');
    });

    await waitFor(() => {
      const messages = messagesOf('A');
      expect(messages[messages.length - 1]).toMatchObject({
        role: 'agent',
        text: 'early reply',
      });
    });
  });

  it('[tool_use / tool_result] [actor_name/actor_kind 写入 tool block] [run_worker]', async () => {
    mockFetchWithEvents([
      envelope('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      envelope('tool_use', {
        type: 'tool_use',
        id: 'tool-1',
        name: 'run_worker',
        input: { task: 'write spec' },
        actor_name: 'coder',
        actor_kind: 'agent',
      }),
      envelope('tool_result', {
        type: 'tool_result',
        tool_use_id: 'tool-1',
        tool_name: 'run_worker',
        content: '<worker-result from="coder">\nok\n</worker-result>',
        is_error: false,
        actor_name: 'coder',
        actor_kind: 'agent',
      }),
      envelope('done', { ok: true }),
    ]);

    const { result } = renderHook(() => useChatStream('A'));
    await waitFor(() => expect(result.current.historyLoaded).toBe(true));
    act(() => {
      void result.current.send('question');
    });

    await waitFor(() => {
      const assistant = messagesOf('A').find((m) => m.role === 'assistant');
      const callBlock = assistant?.blocks.find((b) => b.type === 'tool_call');
      expect(callBlock).toMatchObject({ toolName: 'run_worker', actorName: 'coder', actorKind: 'agent' });
    });
    const assistant = messagesOf('A').find((m) => m.role === 'assistant');
    const resultBlock = assistant?.blocks.find((b) => b.type === 'tool_result');
    expect(resultBlock).toMatchObject({ toolName: 'run_worker', actorName: 'coder', actorKind: 'agent' });
  });
});
