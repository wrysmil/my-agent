/**
 * MessageBubble 循环分组测试（v4 双布局重构）
 *
 * 设计动机：见 spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md` § 4.3。
 * 覆盖：
 *   1. 已完成 run → TraceBubble（trace 灰色气泡） + final markdown（裸节点）独立存在；
 *      GeneratingIndicator 不显示
 *   2. 进行中且无 final → TraceBubble + GeneratingIndicator，final 节点不存在
 *   3. 进行中且有 final（部分流）→ TraceBubble + final 节点，GeneratingIndicator 不显示
 *   4. 多次 run → 2 个独立 TraceBubble（`data-testid="trace-bubble"`），user bubble 不进 TraceBubble
 *   5. trace 与 final 是独立 DOM 节点（trace 不再嵌套 final）
 *   6. resetKey 透传：MessageBubble 渲染时 RunTracePanel 接收的 resetKey === message.id
 *
 * 注意：Markdown 组件是 lazy import + Suspense fallback。
 *   - 测试里要用 findByText / waitFor，等 Suspense 解析完再断言 final markdown 文本。
 *   - text 断言使用 exactText matcher，绕过 react-markdown 把中文切成多 span 的副作用。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MessageBubble } from '@/components/chat/MessageBubble';
import type { ChatMessage } from '@/features/chat/types';

// RunTracePanel spy：用 vi.mock 替换实际组件，记录最后一次调用 props，
// 让 message-bubble-cycle 测试能断言 resetKey 透传（spec §8.1 第 7 项）。
// spy 渲染为 null，避免破坏 MessageBubble 的布局依赖。
const runTracePanelSpy: (props: unknown) => void = vi.fn();
vi.mock('@/components/chat/RunTracePanel', () => ({
  RunTracePanel: (props: unknown) => {
    runTracePanelSpy(props);
    return null;
  },
}));

function makeAssistantMessage(opts: {
  hasThinking?: boolean;
  hasTool?: boolean;
  finalText?: string;
  id?: string;
}): ChatMessage {
  const blocks: ChatMessage['blocks'] = [];
  if (opts.hasThinking) {
    blocks.push({
      id: `${opts.id ?? 'm'}-t1`,
      type: 'thinking',
      status: 'done',
      thinking: '让我分析一下',
      collapsed: true,
    });
  }
  if (opts.hasTool) {
    blocks.push({
      id: `${opts.id ?? 'm'}-c1`,
      type: 'tool_call',
      status: 'done',
      toolId: 'tool-1',
      toolName: 'web_fetch',
      inputRaw: '{}',
      input: {},
    });
    blocks.push({
      id: `${opts.id ?? 'm'}-r1`,
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
      id: `${opts.id ?? 'm'}-txt`,
      type: 'text',
      status: 'done',
      text: opts.finalText,
    });
  }
  return {
    id: opts.id ?? 'm1',
    role: 'assistant',
    blocks,
  };
}

function makeUserMessage(text: string): ChatMessage {
  return {
    id: 'u1',
    role: 'user',
    blocks: [],
    text,
  };
}

describe('MessageBubble · v4 dual layout (trace bubble + bare final)', () => {
  it('已完成 run：TraceBubble + final 独立存在，无 GeneratingIndicator', async () => {
    // Arrange
    const msg = makeAssistantMessage({
      hasTool: true,
      finalText: '调研报告。',
    });

    // Act
    render(<MessageBubble message={msg} isStreaming={false} />);

    // Assert — trace-bubble 与 final-bubble 是两个独立 DOM 节点
    await waitFor(
      () => {
        expect(screen.getByTestId('trace-bubble')).toBeTruthy();
        expect(screen.getByTestId('final-bubble')).toBeTruthy();
      },
      { timeout: 5000 },
    );

    // trace 不再嵌套 final（v4 结构调整）
    const traceBubble = screen.getByTestId('trace-bubble');
    const finalBubble = screen.getByTestId('final-bubble');
    expect(traceBubble.contains(finalBubble)).toBe(false);
    expect(finalBubble.contains(traceBubble)).toBe(false);

    // 等 Suspense 解析完 Markdown（增加 timeout 以兼容 lazy import）
    await waitFor(
      () => {
        expect(screen.getByText('调研报告。')).toBeTruthy();
      },
      { timeout: 5000 },
    );

    // GeneratingIndicator 不显示
    expect(screen.queryByText('AI 仍在生成中…')).toBeNull();
  });

  it('进行中且无 final：TraceBubble + GeneratingIndicator 存在，final 节点不存在', () => {
    // Arrange
    const msg = makeAssistantMessage({
      hasTool: true,
      // 无 finalText
    });

    // Act
    render(<MessageBubble message={msg} isStreaming={true} />);

    // Assert
    expect(screen.getByTestId('trace-bubble')).toBeTruthy();
    expect(screen.queryByTestId('final-bubble')).toBeNull();

    // GeneratingIndicator 渲染（转圈 svg）
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText('AI 仍在生成中…')).toBeNull();
    expect(screen.queryByText('调研报告。')).toBeNull();
  });

  it('进行中且有 final：final 节点出现时 GeneratingIndicator 不再显示', async () => {
    // Arrange
    const msg = makeAssistantMessage({
      hasTool: true,
      finalText: '…已经写了一半',
    });

    // Act
    render(<MessageBubble message={msg} isStreaming={true} />);

    // Assert
    expect(screen.getByTestId('trace-bubble')).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.getByTestId('final-bubble')).toBeTruthy();
      },
      { timeout: 5000 },
    );
    await waitFor(
      () => {
        expect(screen.getByText('…已经写了一半')).toBeTruthy();
      },
      { timeout: 5000 },
    );

    // final 已出现 → GeneratingIndicator 不能再挂
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('多次 run：DOM 内出现 2 个独立 TraceBubble；user bubble 不进 TraceBubble', async () => {
    // Arrange
    const user = makeUserMessage('继续完成调研');
    const a1 = makeAssistantMessage({
      id: 'a1',
      hasTool: true,
      finalText: '第一轮完成。',
    });
    const a2 = makeAssistantMessage({
      id: 'a2',
      hasTool: true,
      finalText: '第二轮完成。',
    });

    // Act
    render(
      <div>
        <MessageBubble message={user} isStreaming={false} />
        <MessageBubble message={a1} isStreaming={false} />
        <MessageBubble message={a2} isStreaming={false} />
      </div>,
    );

    // Assert — 用 data-testid="trace-bubble" 查 2 个独立 trace 节点
    await waitFor(
      () => {
        expect(screen.getAllByTestId('trace-bubble')).toHaveLength(2);
      },
      { timeout: 5000 },
    );

    // user bubble 不进 TraceBubble：从 user 文本节点向上爬祖先，
    // 确认不会碰到 data-testid="trace-bubble" 的容器。
    const userBubble = screen.getByText('继续完成调研');
    let cur: Element | null = userBubble;
    let insideTrace = false;
    while (cur) {
      if (cur.getAttribute && cur.getAttribute('data-testid') === 'trace-bubble') {
        insideTrace = true;
        break;
      }
      cur = cur.parentElement;
    }
    expect(insideTrace).toBe(false);

    // 两条 assistant final 各自独立（等 Markdown 加载完）
    await waitFor(() => {
      const finals = screen.getAllByTestId('final-bubble');
      expect(finals).toHaveLength(2);
      expect(finals[0]?.textContent ?? '').toContain('第一轮完成。');
      expect(finals[1]?.textContent ?? '').toContain('第二轮完成。');
    });
  });
});

describe('MessageBubble · resetKey 透传 (spec §8.1 第 7 项)', () => {
  beforeEach(() => {
    (runTracePanelSpy as unknown as { mockClear: () => void }).mockClear();
  });

  afterEach(() => {
    (runTracePanelSpy as unknown as { mockClear: () => void }).mockClear();
  });

  it('渲染 MessageBubble → RunTracePanel 收到的 props.resetKey === message.id', async () => {
    // Arrange — 用 tool_call 让 showTrace=true，触发 RunTracePanel 调用
    const msg: ChatMessage = {
      id: 'msg-cycle-reset-42',
      role: 'assistant',
      blocks: [
        {
          id: 'msg-cycle-reset-42-c1',
          type: 'tool_call',
          status: 'done',
          toolId: 'tool-1',
          toolName: 'web_fetch',
          inputRaw: '{}',
          input: {},
        },
        {
          id: 'msg-cycle-reset-42-r1',
          type: 'tool_result',
          status: 'done',
          toolCallId: 'tool-1',
          toolName: 'web_fetch',
          content: 'result',
          isError: false,
        },
      ],
    };

    // Act
    render(<MessageBubble message={msg} isStreaming={false} />);

    // Assert — spy 至少被调用一次；最后一次调用的 props.resetKey === message.id
    await waitFor(() => {
      expect(runTracePanelSpy).toHaveBeenCalled();
    });
    const mockFn = runTracePanelSpy as unknown as {
      mock: { calls: unknown[][] };
    };
    const lastCallArgs = mockFn.mock.calls.at(-1) ?? [];
    const lastCallProps = lastCallArgs[0] as
      | { resetKey?: string }
      | undefined;
    expect(lastCallProps).toBeDefined();
    expect(lastCallProps!.resetKey).toBe('msg-cycle-reset-42');
  });
});
