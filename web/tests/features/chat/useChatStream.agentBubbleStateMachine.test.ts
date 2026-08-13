/**
 * WU-02 agent 气泡状态机单元测试。
 *
 * 覆盖 8 个事件序列：
 *   1. dispatch_started → 创建 role:'agent' 气泡（status working，插在 assistant 之后）
 *   2. worker_step_start → 内部步骤（thinking / tool_call）实时展开
 *   3. worker_text_delta → 文本 typewriter 追加
 *   4. worker_step_end → 步骤 finalize（含 tool_result 摘要 / isError）
 *   5. dispatch_done → 关闭气泡 + mainResume（旧 assistant 标 done，新建收尾气泡，后续事件路由到新气泡）
 *   6. agent_message → 收尾（标 done / isFinal；与流式文本去重）
 *   7. hand_off_to → dispatch_done 不触发新气泡，agent_message 标最终回答
 *   8. 并发双 actor → 气泡按 (runId, actorId) 隔离路由
 *
 * 采用真实 `parseSseStream`（不 mock）——同时验证 `KNOWN_EVENTS` 已包含 5 个新事件。
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseSseStream } from '../../../src/lib/sse';
import { useChatRuntimeStore } from '../../../src/features/chat/chatRuntimeStore';
import { useChatStream } from '../../../src/features/chat/useChatStream';
import type { ChatMessage } from '../../../src/features/chat/types';

// ============================================================
// 辅助
// ============================================================

let seqCounter = 0;

/** 构造带 P0 envelope 的 SSE 帧（真实 parseSseStream 解析） */
function sseFrame(
  event: string,
  data: Record<string, unknown>,
  runId = 'run-a',
): string {
  seqCounter += 1;
  const payload = {
    sessionId: 'A',
    runId,
    streamId: 'stream-a',
    seq: seqCounter,
    event,
    data,
  };
  return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

function historyResponse(): Response {
  return new Response(
    JSON.stringify({ ok: true, data: { sessionId: 'A', revision: 0, messages: [] } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** POST 返回真实 SSE 流；parseSseStream 逐帧解析（KNOWN_EVENTS 过滤未知事件） */
function sseResponse(frames: string[]): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const frame of frames) controller.enqueue(enc.encode(frame));
        controller.close();
      },
    }),
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );
}

function mockFetchWithFrames(frames: string[]) {
  vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
    const url = String(input);
    if (url.endsWith('/history')) {
      return Promise.resolve(historyResponse());
    }
    if (init?.method === 'POST') {
      return Promise.resolve(sseResponse(frames));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

function messagesOf(sessionId: string): ChatMessage[] {
  return useChatRuntimeStore.getState().getSession(sessionId)?.messages ?? [];
}

function dispatchStarted(actorId: string, overrides: Record<string, unknown> = {}) {
  return sseFrame('dispatch_started', {
    type: 'dispatch_started',
    actorId,
    actorName: actorId === 'coder-a' ? 'coderA' : 'coder',
    toolName: 'dispatch_to',
    toolId: `tc-${actorId}`,
    isFinal: false,
    ...overrides,
  });
}

function stepStart(actorId: string, kind: string, label: string, stepId: string) {
  return sseFrame('worker_step_start', {
    type: 'worker_step_start',
    actorId,
    kind,
    label,
    stepId,
  });
}

function textDelta(actorId: string, text: string, stepId = 's-txt') {
  return sseFrame('worker_text_delta', {
    type: 'worker_text_delta',
    actorId,
    text,
    stepId,
  });
}

function stepEnd(actorId: string, stepId: string, summary: string, isError = false) {
  return sseFrame('worker_step_end', {
    type: 'worker_step_end',
    actorId,
    stepId,
    summary,
    isError,
  });
}

function dispatchDone(actorId: string, toolName = 'dispatch_to') {
  return sseFrame('dispatch_done', { type: 'dispatch_done', actorId, toolName });
}

function agentMessage(actorId: string, text: string, isFinal = false) {
  return sseFrame('agent_message', {
    type: 'agent_message',
    actorId,
    actorName: 'coder',
    actorKind: 'agent',
    text,
    isFinal,
  });
}

function runStream(frames: string[]) {
  mockFetchWithFrames(frames);

  const { result } = renderHook(() => useChatStream('A'));
  return result;
}

async function sendAndSettle(result: { current: ReturnType<typeof useChatStream> }) {
  await waitFor(() => expect(result.current.historyLoaded).toBe(true));
  act(() => {
    void result.current.send('question');
  });
}

// ============================================================
// KNOWN_EVENTS：5 个新事件可被真实 parseSseStream 解析
// ============================================================

describe('KNOWN_EVENTS 新事件解析', () => {
  it('解析 dispatch_started / worker_step_start / worker_text_delta / worker_step_end / dispatch_done', async () => {
    const frames = [
      'event: dispatch_started\ndata: {"actorId":"c"}\n\n',
      'event: worker_step_start\ndata: {"actorId":"c"}\n\n',
      'event: worker_text_delta\ndata: {"actorId":"c","text":"x"}\n\n',
      'event: worker_step_end\ndata: {"actorId":"c"}\n\n',
      'event: dispatch_done\ndata: {"actorId":"c"}\n\n',
    ];
    const events: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    for await (const ev of parseSseStream(stream)) events.push(ev.event);
    expect(events).toEqual([
      'dispatch_started',
      'worker_step_start',
      'worker_text_delta',
      'worker_step_end',
      'dispatch_done',
    ]);
  });
});

// ============================================================
// 状态机事件序列
// ============================================================

describe('useChatStream agent 气泡状态机', () => {
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
        .mockReturnValueOnce('run-a')
        // dispatch_done → mainResume 新建主 Agent 气泡的 runId
        .mockReturnValueOnce('run-b'),
    });
    seqCounter = 0;
  });

  it('[dispatch_started] [创建 role:agent 气泡] [status working · 插在 assistant 之后]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(1);
    });
    const messages = messagesOf('A');
    const agentMsg = messages.find((m) => m.role === 'agent')!;
    expect(agentMsg).toMatchObject({
      role: 'agent',
      actorId: 'coder-id',
      actorName: 'coder',
      toolName: 'dispatch_to',
      toolId: 'tc-coder-id',
      isFinal: false,
      status: 'working',
      text: '',
      runId: 'run-a',
    });
    const assistantIdx = messages.findIndex((m) => m.role === 'assistant');
    const agentIdx = messages.findIndex((m) => m.role === 'agent');
    expect(agentIdx).toBe(assistantIdx + 1);
  });

  it('[worker_step_start] [thinking + tool 步骤实时展开] [streaming + stepId]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      stepStart('coder-id', 'thinking', '分析任务', 's-th-1'),
      stepStart('coder-id', 'tool', '读取文件', 's-tool-1'),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsg = messagesOf('A').find((m) => m.role === 'agent');
      expect(agentMsg?.blocks).toHaveLength(2);
    });
    const agentMsg = messagesOf('A').find((m) => m.role === 'agent')!;
    expect(agentMsg.blocks[0]).toMatchObject({
      type: 'thinking',
      status: 'streaming',
      thinking: '分析任务',
      stepId: 's-th-1',
    });
    expect(agentMsg.blocks[1]).toMatchObject({
      type: 'tool_call',
      status: 'streaming',
      toolName: '读取文件',
      toolId: 's-tool-1',
      stepId: 's-tool-1',
    });
    expect(agentMsg.summary).toContain('0 个工具');
  });

  it('[worker_text_delta] [typewriter 文本逐段追加]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      textDelta('coder-id', 'hello '),
      textDelta('coder-id', 'world'),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsg = messagesOf('A').find((m) => m.role === 'agent');
      expect(agentMsg?.text).toBe('hello world');
    });
  });

  it('[worker_step_end] [步骤 finalize + tool_result 摘要 + isError 标错]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      stepStart('coder-id', 'tool', '写入文件', 's-tool-1'),
      stepEnd('coder-id', 's-tool-1', '已写入 53 行'),
      stepStart('coder-id', 'tool', '运行命令', 's-tool-2'),
      stepEnd('coder-id', 's-tool-2', '命令失败', true),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsg = messagesOf('A').find((m) => m.role === 'agent');
      expect(
        agentMsg?.blocks.find((b) => b.type === 'tool_result'),
      ).toBeDefined();
    });
    const agentMsg = messagesOf('A').find((m) => m.role === 'agent')!;
    const okCall = agentMsg.blocks.find((b) => b.type === 'tool_call' && b.toolId === 's-tool-1');
    const okResult = agentMsg.blocks.find((b) => b.type === 'tool_result' && b.toolCallId === 's-tool-1');
    expect(okCall?.status).toBe('done');
    expect(okResult).toMatchObject({ content: '已写入 53 行', isError: false, status: 'done' });
    const errCall = agentMsg.blocks.find((b) => b.type === 'tool_call' && b.toolId === 's-tool-2');
    const errResult = agentMsg.blocks.find((b) => b.type === 'tool_result' && b.toolCallId === 's-tool-2');
    expect(errCall?.status).toBe('error');
    expect(errResult).toMatchObject({ content: '命令失败', isError: true, status: 'error' });
  });

  it('[dispatch_done] [关闭气泡 + mainResume] [旧 assistant done · 新气泡收尾 · 后续文本路由到新气泡]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      textDelta('coder-id', 'coder 的回复'),
      dispatchDone('coder-id', 'dispatch_to'),
      sseFrame('content_block_delta', {
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: '主 Agent 收尾' },
      }),
      sseFrame('message_stop', { type: 'message_stop' }),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const assistants = messagesOf('A').filter((m) => m.role === 'assistant');
      expect(assistants).toHaveLength(2);
    });
    const messages = messagesOf('A');
    const assistants = messages.filter((m) => m.role === 'assistant');
    // 旧气泡（等待态）标 done
    expect(assistants[0].streamState).toBe('done');
    // 新气泡：dispatch_done 时 generating，message_stop 终态路由到恢复气泡后标 done
    expect(assistants[1].streamState).toBe('done');
    // 后续 text_delta 路由到新气泡（最后一条 assistant）
    const resumeText = assistants[1].blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    expect(resumeText).toBe('主 Agent 收尾');
    // 旧气泡不接收后续文本
    expect(assistants[0].blocks.filter((b) => b.type === 'text')).toHaveLength(0);
  });

  it('[agent_message] [收尾已有气泡] [标 done + isFinal · 与流式文本去重]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      textDelta('coder-id', '完整回复内容'),
      agentMessage('coder-id', '完整回复内容', false),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(1);
    });
    const agentMsg = messagesOf('A').find((m) => m.role === 'agent')!;
    expect(agentMsg.status).toBe('done');
    expect(agentMsg.isFinal).toBe(false);
    // 最终文本与流式文本一致时不重复拼接
    expect(agentMsg.text).toBe('完整回复内容');
  });

  it('[agent_message] [无 dispatch_started 时新建气泡] [兼容路径]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      agentMessage('coder-id', '纯 agent 回复', true),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(1);
    });
    const agentMsg = messagesOf('A').find((m) => m.role === 'agent')!;
    expect(agentMsg).toMatchObject({
      text: '纯 agent 回复',
      isFinal: true,
      status: 'done',
      actorId: 'coder-id',
    });
  });

  it('[hand_off_to] [dispatch_done 不触发 mainResume] [agent_message 标最终回答]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id', { toolName: 'hand_off_to', isFinal: true }),
      textDelta('coder-id', 'hand off 回答'),
      dispatchDone('coder-id', 'hand_off_to'),
      agentMessage('coder-id', 'hand off 回答', true),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsg = messagesOf('A').find((m) => m.role === 'agent');
      expect(agentMsg?.status).toBe('done');
    });
    const messages = messagesOf('A');
    // 主 Agent 仅一条 assistant（不新建收尾气泡）
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    const agentMsg = messages.find((m) => m.role === 'agent')!;
    expect(agentMsg.isFinal).toBe(true);
    expect(agentMsg.status).toBe('done');
    expect(agentMsg.text).toBe('hand off 回答');
  });

  it('[并发双 actor] [气泡按 (runId, actorId) 隔离] [文本与步骤互不串位]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-a'),
      dispatchStarted('coder-b'),
      textDelta('coder-a', 'A-文本'),
      textDelta('coder-b', 'B-文本'),
      stepStart('coder-a', 'tool', 'A-工具', 's-a-1'),
      stepStart('coder-b', 'thinking', 'B-思考', 's-b-1'),
      stepEnd('coder-a', 's-a-1', 'A-结果'),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(2);
    });
    const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
    const actorA = agentMsgs.find((m) => m.actorId === 'coder-a')!;
    const actorB = agentMsgs.find((m) => m.actorId === 'coder-b')!;
    expect(actorA.text).toBe('A-文本');
    expect(actorB.text).toBe('B-文本');
    expect(actorA.blocks.filter((b) => b.type === 'tool_call')).toHaveLength(1);
    expect(actorA.blocks.find((b) => b.type === 'tool_result')?.content).toBe('A-结果');
    expect(actorB.blocks.filter((b) => b.type === 'thinking')).toHaveLength(1);
    // 两个气泡均位于 assistant 之后，且按创建顺序排列
    const assistantIdx = messagesOf('A').findIndex((m) => m.role === 'assistant');
    expect(messagesOf('A').slice(assistantIdx + 1).filter((m) => m.role === 'agent').map((m) => m.actorId))
      .toEqual(['coder-a', 'coder-b']);
  });

  it('[同名 agent 二次派发] [事件路由到最后一条活动气泡] [不污染已关闭旧气泡]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      textDelta('coder-id', '第一轮文本'),
      dispatchDone('coder-id', 'dispatch_to'),
      dispatchStarted('coder-id'),
      textDelta('coder-id', '第二轮文本'),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(2);
    });
    const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
    expect(agentMsgs[0]).toMatchObject({ status: 'done', text: '第一轮文本' });
    expect(agentMsgs[1]).toMatchObject({ status: 'working', text: '第二轮文本' });
  });

  it('[agent_message 前缀去重] [流式文本为最终文本前缀时以最终文本为准]', async () => {
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      textDelta('coder-id', 'abc'),
      agentMessage('coder-id', 'abcde', true),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsg = messagesOf('A').find((m) => m.role === 'agent');
      expect(agentMsg?.status).toBe('done');
    });
    const agentMsg = messagesOf('A').find((m) => m.role === 'agent')!;
    expect(agentMsg.text).toBe('abcde');
    expect(agentMsg.isFinal).toBe(true);
  });

  it('[dispatch_started 稳定 id] [tool_use 先到] [气泡 id = hist-agent-${tool_use id}]', async () => {
    // Arrange — tool_use 帧（真实 tool_use id）先于 dispatch_started 到达，
    // 气泡 id 应与历史重建（rebuildDispatchAgentMessages）同构，供 merge 按 identity 命中
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'assistant-a', stream_id: 'stream-a' },
      }),
      sseFrame('tool_use', {
        type: 'tool_use',
        id: 'tu-real-1',
        name: 'dispatch_to',
        input: { to: 'coder', task: '写 travel.html' },
      }),
      dispatchStarted('coder-id'),
      sseFrame('done', { ok: true }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const agentMsgs = messagesOf('A').filter((m) => m.role === 'agent');
      expect(agentMsgs).toHaveLength(1);
    });
    const agentMsg = messagesOf('A').find((m) => m.role === 'agent')!;
    expect(agentMsg.id).toBe('hist-agent-tu-real-1');
    // 原有字段契约不变
    expect(agentMsg).toMatchObject({
      role: 'agent',
      actorId: 'coder-id',
      toolName: 'dispatch_to',
      status: 'working',
    });
  });

  it('[dispatch_done + done.messageId] [等待气泡 messageId 清空 · 合成收尾气泡持有 done.messageId]', async () => {
    // Arrange — dispatch_to 后 dispatch_done 新建合成收尾气泡；done 事件携带
    // messageId（= persisted 终态 assistant 行 id）。等待气泡不应再持有该 messageId，
    // 否则 merge 时 persisted 终态行会按 identity 误命中等待气泡 → 收尾文本双份。
    const result = runStream([
      sseFrame('message_start', {
        message: { id: 'asst-final', stream_id: 'stream-a' },
      }),
      dispatchStarted('coder-id'),
      dispatchDone('coder-id', 'dispatch_to'),
      sseFrame('done', { ok: true, messageId: 'asst-final', persistedRevision: 10 }),
    ]);
    await sendAndSettle(result);

    await waitFor(() => {
      const assistants = messagesOf('A').filter((m) => m.role === 'assistant');
      expect(assistants).toHaveLength(2);
    });
    const assistants = messagesOf('A').filter((m) => m.role === 'assistant');
    // 等待气泡不再持有终态 messageId
    expect(assistants[0].messageId).toBeUndefined();
    // 合成收尾气泡持有 done.messageId → merge 时与 persisted 终态行按 identity 匹配
    expect(assistants[1].messageId).toBe('asst-final');
  });
});
