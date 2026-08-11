/**
 * MessageBubble 循环分组测试
 *
 * 覆盖：
 *   1. 已完成 run → CycleCard 渲染含 trace + final，无 GeneratingIndicator
 *   2. 进行中且无 final → CycleCard 渲染含 GeneratingIndicator
 *   3. 进行中且有 final（部分流）→ CycleCard 渲染含 final，**无** GeneratingIndicator
 *   4. 多次 run → 2 个独立 CycleCard，user bubble 不进 CycleCard
 *   5. resetKey 透传：MessageBubble 渲染时 RunTracePanel 接收的 resetKey === message.id
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

describe('MessageBubble · cycle grouping', () => {
  it('已完成 run：CycleCard 渲染含 trace + final，无 GeneratingIndicator', async () => {
    // Arrange
    const msg = makeAssistantMessage({
      hasTool: true,
      finalText: '调研报告。',
    });

    // Act
    render(<MessageBubble message={msg} isStreaming={false} />);

    // Assert
    expect(screen.queryByText('AI 仍在生成中…')).toBeNull();
    // 等 Suspense 解析完 Markdown
    await waitFor(() => {
      expect(screen.getByText('调研报告。')).toBeTruthy();
    });
  });

  it('进行中且无 final：含 GeneratingIndicator，final 区不存在', () => {
    // Arrange
    const msg = makeAssistantMessage({
      hasTool: true,
      // 无 finalText
    });

    // Act
    render(<MessageBubble message={msg} isStreaming={true} />);

    // Assert
    expect(screen.getByText('AI 仍在生成中…')).toBeTruthy();
    expect(screen.queryByText('调研报告。')).toBeNull();
  });

  it('进行中且有 final：final 出现时 GeneratingIndicator 不再显示', async () => {
    // Arrange
    const msg = makeAssistantMessage({
      hasTool: true,
      finalText: '…已经写了一半',
    });

    // Act
    render(<MessageBubble message={msg} isStreaming={true} />);

    // Assert
    await waitFor(() => {
      expect(screen.getByText('…已经写了一半')).toBeTruthy();
    });
    // final 已出现 → 不应该再有「还在生成」提示
    expect(screen.queryByText('AI 仍在生成中…')).toBeNull();
  });

  it('多次 run：DOM 内出现 2 个 CycleCard；user bubble 不进 CycleCard', async () => {
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
    const { container } = render(
      <div>
        <MessageBubble message={user} isStreaming={false} />
        <MessageBubble message={a1} isStreaming={false} />
        <MessageBubble message={a2} isStreaming={false} />
      </div>,
    );

    // Assert
    // CycleCard 容器特征：relative mt-3 rounded-xl border border-border/80
    const cards = container.querySelectorAll(
      'div.relative.mt-3.rounded-xl.border.border-border\\/80',
    );
    expect(cards.length).toBe(2);

    // user bubble 不进 CycleCard：从 user 文本节点向上爬祖先，
    // 确认不会碰到带 rounded-xl + border-border/80 的容器。
    const userBubble = screen.getByText('继续完成调研');
    let cur: Element | null = userBubble;
    let insideCycle = false;
    while (cur) {
      if (cur.classList && cur.classList.contains('rounded-xl') &&
          cur.classList.contains('border-border/80')) {
        insideCycle = true;
        break;
      }
      cur = cur.parentElement;
    }
    expect(insideCycle).toBe(false);

    // 两条 assistant final 各自独立（等 Markdown 加载完，用 cards[i].textContent 比对）
    await waitFor(() => {
      expect(cards[0]?.textContent ?? '').toContain('第一轮完成。');
      expect(cards[1]?.textContent ?? '').toContain('第二轮完成。');
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