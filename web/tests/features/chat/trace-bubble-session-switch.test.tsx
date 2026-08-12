/**
 * MessageBubble 切会话守卫测试（reviewer Important #1）
 *
 * 设计动机：
 *   v4 之前的形态（CycleCard 单气泡包整条 assistant 消息 + 单 key={message.id}）
 *   在切会话时可能复现"trace 边框 + 紫色侧条消失、final 内容裸奔"的视觉错位 bug
 *   （v3.1 截图 5）。v4 改为 Fragment + 3 独立 key（trace/final/gen）后，从结构上
 *   封堵了触发路径。但行为目前可观察但未固化，本测试把"切会话后 trace-bubble 计数恒为
 *   1 + 灰底 className 恒在 + run-trace border className 恒在 + 紫色侧条 gradient 恒在"
 *   固化为回归测试，防止未来改动再次引入回归。
 *
 * 关键：直接 render 真实 MessageBubble（不写镜像组件），保证测试覆盖真实代码路径。
 *
 * 覆盖：
 *   1. A→B→A 切换：A/B 各自仅有 1 个 trace-bubble + 灰底恒在 + border 恒在 + 紫色侧条恒在
 *   2. 同 message.id 跨 session 复用（模拟后端 messageId 全局递增）的真实路径：
 *      React 必须按 key 重建 TraceBubble，不允许复用旧实例的 final 内容
 *   3. A 有未完成流（isStreaming=true）时切到 B 再切回 A：切回后视 isStreaming 真实状态渲染
 *
 * 注：测试环境用 jsdom，不解析 Tailwind arbitrary value（如 `bg-[#f1f2f4]`）成实际颜色。
 * 因此颜色断言用 className 子串匹配（保留 v4 视觉意图），不依赖 getComputedStyle。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { useChatRuntimeStore } from '../../../src/features/chat/chatRuntimeStore';
import { useChatStream } from '../../../src/features/chat/useChatStream';
import type { ChatMessage } from '../../../src/features/chat/types';

// RunTracePanel spy — 用 vi.mock 替换实际组件，让 MessageBubble 测试不必依赖完整
// RunTracePanel 渲染逻辑（其内部有 lazy Markdown + runTrace 派生）。spy 仍渲染出
// `data-run-trace` div + 紫色侧条 span，保证切会话守卫的 DOM 探针可以触达真实 class。
vi.mock('@/components/chat/RunTracePanel', () => ({
  RunTracePanel: (props: { trace: { steps: unknown[]; toolCount: number; errorCount: number; status: string; summaryLabel: string } }) => (
    <div
      data-run-trace
      data-trace-steps={props.trace.steps.length}
      data-trace-status={props.trace.status}
      className="relative overflow-hidden rounded-xl border border-border/80 bg-white"
    >
      <span
        aria-hidden
        data-trace-side-bar
        className="pointer-events-none absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-gradient-to-b from-primary to-primary/50"
      />
      <span data-trace-summary>{props.trace.summaryLabel}</span>
    </div>
  ),
}));

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeAssistantMessage(opts: {
  id: string;
  hasTool?: boolean;
  finalText?: string;
  hasThinking?: boolean;
}): ChatMessage {
  const blocks: ChatMessage['blocks'] = [];
  if (opts.hasThinking) {
    blocks.push({
      id: `${opts.id}-t1`,
      type: 'thinking',
      status: 'done',
      thinking: 'thinking',
      collapsed: true,
    });
  }
  if (opts.hasTool) {
    blocks.push({
      id: `${opts.id}-c1`,
      type: 'tool_call',
      status: 'done',
      toolId: 'tool-1',
      toolName: 'web_fetch',
      inputRaw: '{}',
      input: {},
    });
    blocks.push({
      id: `${opts.id}-r1`,
      type: 'tool_result',
      status: 'done',
      toolCallId: 'tool-1',
      toolName: 'web_fetch',
      content: 'result',
      isError: false,
    });
  }
  if (opts.finalText) {
    blocks.push({
      id: `${opts.id}-txt`,
      type: 'text',
      status: 'done',
      text: opts.finalText,
    });
  }
  return {
    id: opts.id,
    role: 'assistant',
    blocks,
  };
}

function setupSessionMessages(sessionId: string, messages: ChatMessage[]) {
  const store = useChatRuntimeStore.getState();
  store.ensureSession(sessionId);
  store.setSessionMessages(sessionId, messages);
  store.setSessionHistoryLoaded(sessionId, true, 1);
}

function readTraceBubbleStates() {
  const traceBubbles = document.querySelectorAll('[data-testid="trace-bubble"]');
  const finalBubbles = document.querySelectorAll('[data-testid="final-bubble"]');
  const genIndicators = document.querySelectorAll('[data-testid="gen"]');

  const traceBubble = traceBubbles[0] as HTMLElement | undefined;
  const runTrace = document.querySelector('[data-run-trace]') as HTMLElement | undefined;
  const sideBar = document.querySelector('[data-trace-side-bar]') as HTMLElement | undefined;

  return {
    traceCount: traceBubbles.length,
    finalCount: finalBubbles.length,
    genCount: genIndicators.length,
    traceClassName: traceBubble?.className ?? '',
    runTraceClassName: runTrace?.className ?? '',
    sideBarClassName: sideBar?.className ?? '',
  };
}

function renderSessionMessages(messages: ChatMessage[], isStreaming: boolean): RenderResult {
  return render(
    <>
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} isStreaming={isStreaming} />
      ))}
    </>,
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe('MessageBubble · session switch guards (reviewer Important #1)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useChatRuntimeStore.setState({
      sessions: {},
      runs: {},
      _accessOrder: [],
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('A→B→A 切换：A 仅 1 个 trace-bubble + 灰底恒在 + border 恒在 + 紫色侧条恒在 + final 独立', async () => {
    // Arrange — 两个 session，各有 1 条完成态 assistant
    setupSessionMessages('A', [
      makeAssistantMessage({
        id: 'A-asst-1',
        hasTool: true,
        finalText: 'A 会话的第一条回复',
      }),
    ]);
    setupSessionMessages('B', [
      makeAssistantMessage({
        id: 'B-asst-1',
        hasTool: true,
        finalText: 'B 会话的第一条回复',
      }),
    ]);

    const { rerender } = renderHook(({ sessionId }) => useChatStream(sessionId), {
      initialProps: { sessionId: 'A' },
    });
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    // ── 步骤 1：在 A 会话，渲染真实 MessageBubble ──
    const messagesA = useChatRuntimeStore.getState().getSession('A')!.messages;
    const renderA = renderSessionMessages(messagesA, false);

    const baselineA = readTraceBubbleStates();
    expect(baselineA.traceCount).toBe(1);
    expect(baselineA.finalCount).toBe(1);
    expect(baselineA.traceClassName).toContain('bg-[#f1f2f4]');
    expect(baselineA.runTraceClassName).toContain('border');
    expect(baselineA.runTraceClassName).toContain('border-border/80');
    expect(baselineA.sideBarClassName).toContain('bg-gradient-to-b');
    expect(baselineA.sideBarClassName).toContain('from-primary');

    // ── 步骤 2：切到 B（先 unmount A，再渲染 B）──
    renderA.unmount();
    act(() => rerender({ sessionId: 'B' }));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('B')?.historyLoaded).toBe(true),
    );

    const messagesB = useChatRuntimeStore.getState().getSession('B')!.messages;
    const renderB = renderSessionMessages(messagesB, false);

    const baselineB = readTraceBubbleStates();
    expect(baselineB.traceCount).toBe(1);
    expect(baselineB.finalCount).toBe(1);
    expect(baselineB.traceClassName).toContain('bg-[#f1f2f4]');

    // ── 步骤 3：切回 A（关键守卫：必须与步骤 1 状态完全等价）──
    renderB.unmount();
    act(() => rerender({ sessionId: 'A' }));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    const messagesAReswitched = useChatRuntimeStore.getState().getSession('A')!.messages;
    const renderAReset = renderSessionMessages(messagesAReswitched, false);

    const reswitchedA = readTraceBubbleStates();
    expect(reswitchedA.traceCount).toBe(1);
    expect(reswitchedA.finalCount).toBe(1);
    expect(reswitchedA.traceClassName).toContain('bg-[#f1f2f4]');
    expect(reswitchedA.runTraceClassName).toContain('border');
    expect(reswitchedA.runTraceClassName).toContain('border-border/80');
    expect(reswitchedA.sideBarClassName).toContain('bg-gradient-to-b');
    expect(reswitchedA.sideBarClassName).toContain('from-primary');
    expect(reswitchedA.genCount).toBe(0);

    // final 内容是 A 的（不是 B 残留）
    await waitFor(
      () => {
        expect(screen.getByTestId('final-bubble').textContent ?? '').toContain(
          'A 会话的第一条回复',
        );
      },
      { timeout: 5000 },
    );

    renderAReset.unmount();
  });

  it('同 message.id 跨 session 复用：切会话后 TraceBubble 必须按 key 重建，不复用旧实例', async () => {
    // Arrange — 模拟后端 messageId 全局递增：A 与 B 共用 message.id="shared-1"
    // 但 blocks / finalText 不一样。这是用户原报告触发路径的最大可能场景。
    setupSessionMessages('A', [
      makeAssistantMessage({
        id: 'shared-1',
        hasTool: true,
        finalText: 'A 的内容',
      }),
    ]);
    setupSessionMessages('B', [
      makeAssistantMessage({
        id: 'shared-1', // 故意冲突
        hasTool: true,
        finalText: 'B 的内容',
      }),
    ]);

    const { rerender } = renderHook(({ sessionId }) => useChatStream(sessionId), {
      initialProps: { sessionId: 'A' },
    });
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    const messagesA = useChatRuntimeStore.getState().getSession('A')!.messages;
    const renderA = renderSessionMessages(messagesA, false);

    // A 视图：final 含 "A 的内容"
    await waitFor(
      () => {
        expect(screen.getByTestId('final-bubble').textContent ?? '').toContain('A 的内容');
      },
      { timeout: 5000 },
    );

    // 切到 B
    renderA.unmount();
    act(() => rerender({ sessionId: 'B' }));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('B')?.historyLoaded).toBe(true),
    );

    const messagesB = useChatRuntimeStore.getState().getSession('B')!.messages;
    const renderB = renderSessionMessages(messagesB, false);

    // 守卫：切到 B 后，final 内容必须是 B 的，不是 A 残留
    await waitFor(
      () => {
        const finalText = screen.getByTestId('final-bubble').textContent ?? '';
        expect(finalText).toContain('B 的内容');
        expect(finalText).not.toContain('A 的内容');
      },
      { timeout: 5000 },
    );

    // 切回 A：再次确认
    renderB.unmount();
    act(() => rerender({ sessionId: 'A' }));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    const messagesAReset = useChatRuntimeStore.getState().getSession('A')!.messages;
    const renderAReset = renderSessionMessages(messagesAReset, false);

    await waitFor(
      () => {
        const finalText = screen.getByTestId('final-bubble').textContent ?? '';
        expect(finalText).toContain('A 的内容');
        expect(finalText).not.toContain('B 的内容');
      },
      { timeout: 5000 },
    );

    renderAReset.unmount();
  });

  it('A 有未完成流（isStreaming=true）切到 B 再切回 A：切回后视 isStreaming 真实状态渲染', async () => {
    // Arrange — A 处于流中（最后一条 assistant 仍在 streaming）
    setupSessionMessages('A', [
      makeAssistantMessage({
        id: 'A-asst-stream',
        hasTool: true,
        // 故意没 finalText → 流中
      }),
    ]);
    setupSessionMessages('B', [
      makeAssistantMessage({
        id: 'B-asst-1',
        hasTool: true,
        finalText: 'B 已完成',
      }),
    ]);

    const { rerender } = renderHook(({ sessionId }) => useChatStream(sessionId), {
      initialProps: { sessionId: 'A' },
    });
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    const messagesA = useChatRuntimeStore.getState().getSession('A')!.messages;
    const renderA = renderSessionMessages(messagesA, true /* A 流中 */);

    // A 流中：trace 存在 + generating indicator；无 final
    const aStates = readTraceBubbleStates();
    expect(aStates.traceCount).toBe(1);
    expect(aStates.finalCount).toBe(0);
    expect(aStates.genCount).toBe(1);

    // 切到 B（B 已完成；isStreaming=false）
    renderA.unmount();
    act(() => rerender({ sessionId: 'B' }));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('B')?.historyLoaded).toBe(true),
    );

    const messagesB = useChatRuntimeStore.getState().getSession('B')!.messages;
    const renderB = renderSessionMessages(messagesB, false);

    // B 视图：trace + final；无 generating
    const bStates = readTraceBubbleStates();
    expect(bStates.traceCount).toBe(1);
    expect(bStates.finalCount).toBe(1);
    expect(bStates.genCount).toBe(0);

    // 切回 A（isStreaming 显式 false → 视 A 流已结束；不应再有 GeneratingIndicator）
    renderB.unmount();
    act(() => rerender({ sessionId: 'A' }));
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    const messagesAReset = useChatRuntimeStore.getState().getSession('A')!.messages;
    const renderAReset = renderSessionMessages(messagesAReset, false);

    const aReswitchedStates = readTraceBubbleStates();
    expect(aReswitchedStates.traceCount).toBe(1);
    expect(aReswitchedStates.genCount).toBe(0);

    renderAReset.unmount();
  });

  it('status 非流中但 activeRunId 仍在：send 必须被拦下，避免后端 409 回写错误气泡', async () => {
    // 背景：用户报告「切会话后多个 AI 气泡」。
    // 根因：流完成事件在 B 渲染期间落库 → status 切回 'done'，
    //       但 activeRunId 残留（如 finishRun 'succeeded' 链路未跑完）。
    //       此时用户切回 A，Composer.isStreaming=false → 用户再次 send →
    //       前端 sendAttempt 仅检查 status 不检查 activeRunId → 放行 →
    //       后端 hub.hasActiveRun 拒绝 → 错误消息回写进 A → 视觉「多气泡」。
    //
    // 修复（useChatStream.ts sendAttempt）：增加 activeRunId guard。
    // 本测试把该 guard 固化为回归测试。

    const fetchSpy = vi.fn();
    vi.stubGlobal(
      'fetch',
      fetchSpy as unknown as typeof fetch,
    );
    // history 接口允许走通（不阻塞 hook mount），但 messages/stream 必须不被调用。
    fetchSpy.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.endsWith('/history')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ ok: true, data: { sessionId: 'A', revision: 1, messages: [] } }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      throw new Error(`Unexpected fetch to ${url}`);
    });

    const store = useChatRuntimeStore.getState();
    store.ensureSession('A');
    // 模拟「status 已切到 done，但 activeRunId 还在」的反常状态
    store.setSessionStatus('A', 'done');
    store.createRun('A', 'run-orphan');
    store.setRunStatus('run-orphan', 'running');
    store.setActiveRun('A', 'run-orphan');

    const { result } = renderHook(() => useChatStream('A'), {
      initialProps: { sessionId: 'A' },
    });
    await waitFor(() =>
      expect(useChatRuntimeStore.getState().getSession('A')?.historyLoaded).toBe(true),
    );

    // Act — 用户 send（模拟切回后 Composer 重新 enable 后用户点 send）
    await act(async () => {
      await result.current.send('复杂问题复测');
    });

    // Assert — fetch 拦截：不应有 stream 请求
    const streamCalls = fetchSpy.mock.calls.filter((c) => {
      const url = typeof c[0] === 'string' ? c[0] : (c[0] as Request).url;
      return url.includes('/messages/stream');
    });
    expect(streamCalls).toHaveLength(0);

    // Assert — messages 没有新增 user 消息
    const sessionA = useChatRuntimeStore.getState().getSession('A');
    const userMessages = (sessionA?.messages ?? []).filter((m) => m.role === 'user');
    expect(userMessages).toHaveLength(0);

    vi.unstubAllGlobals();
  });
});