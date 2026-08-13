/**
 * MessageBubble / MessageList — role: 'agent' 渲染测试（WU-03 v3.4 完整布局）。
 *
 * 覆盖：
 *   1. isFinal=false → 绿色 agent 气泡 + 「子 Agent 回复」标签 + actorName
 *   2. isFinal=true → 「最终回答」标签
 *   3. 空 text → 不渲染空气泡
 *   4. MessageList 透传：role: 'agent' 消息经列表正常渲染
 *   5. WU-03 工作态（status='working' → 工作中… + trace 展开 + 闪烁光标）
 *   6. WU-03 完成态（done → 已完成 + trace 默认折叠）
 *   7. WU-03 折叠切换 / trace 步骤渲染 / summary 计数
 *
 * 注：Markdown 是 lazy import + Suspense fallback，文本断言须用 waitFor。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { MessageList } from '@/components/chat/MessageList';
import type { Block, ChatMessage } from '@/features/chat/types';

function makeAgentMessage(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: 'agent-1',
    role: 'agent',
    blocks: [],
    text: 'hello from coder',
    actorName: 'coder',
    isFinal: false,
    ...overrides,
  };
}

function makeUserMessage(text: string): ChatMessage {
  return { id: 'u1', role: 'user', blocks: [], text };
}

function makeAssistantMessage(id: string, text: string): ChatMessage {
  return {
    id,
    role: 'assistant',
    blocks: [{ id: `${id}-txt`, type: 'text', status: 'done', text }],
  };
}

describe('MessageBubble · role=agent 绿色气泡', () => {
  it('isFinal=false → 绿色气泡 + 「子 Agent 回复」标签 + actorName + markdown 内容', async () => {
    // Arrange / Act
    render(
      <MessageBubble message={makeAgentMessage()} isStreaming={false} />,
    );

    // Assert — agent 气泡容器存在
    expect(screen.getByTestId('agent-bubble')).toBeTruthy();
    // actorName 显示
    expect(screen.getByText('coder')).toBeTruthy();
    // 标签「子 Agent 回复」
    expect(screen.getByText('子 Agent 回复')).toBeTruthy();
    expect(screen.queryByText('最终回答')).toBeNull();
    // markdown 内容（等 Suspense 解析）
    await waitFor(
      () => {
        expect(screen.getByText('hello from coder')).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it('isFinal=true → 「最终回答」标签（不再显示「子 Agent 回复」）', async () => {
    // Arrange / Act
    render(
      <MessageBubble
        message={makeAgentMessage({ isFinal: true })}
        isStreaming={false}
      />,
    );

    // Assert
    expect(screen.getByTestId('agent-bubble')).toBeTruthy();
    expect(screen.getByText('最终回答')).toBeTruthy();
    expect(screen.queryByText('子 Agent 回复')).toBeNull();
    await waitFor(
      () => {
        expect(screen.getByText('hello from coder')).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it('空 text → 不渲染空气泡', () => {
    // Arrange / Act
    const { container } = render(
      <MessageBubble
        message={makeAgentMessage({ text: '', blocks: [] })}
        isStreaming={false}
      />,
    );

    // Assert
    expect(container.firstChild).toBeNull();
  });
});

describe('MessageBubble · role=agent v3.4 完整布局（WU-03）', () => {
  // WU-02 数据契约：agent 气泡 blocks 即内部步骤（thinking / tool_call / tool_result）
  const traceBlocks: Block[] = [
    {
      id: 'b1',
      type: 'thinking',
      status: 'done',
      thinking: '用户想要 React 旅游页面组件',
      collapsed: false,
    },
    {
      id: 'b2',
      type: 'tool_call',
      status: 'done',
      toolId: 'tc-1',
      toolName: 'write_file',
      inputRaw: '{"path":"TravelPage.jsx"}',
    },
    {
      id: 'b3',
      type: 'tool_result',
      status: 'done',
      toolCallId: 'tc-1',
      toolName: 'write_file',
      content: '已写入 53 行',
      isError: false,
    },
  ];

  it('工作态 status=working → 「工作中…」状态 + trace 默认展开 + 闪烁光标', () => {
    // Arrange / Act
    render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'working',
          blocks: [traceBlocks[0]],
          summary: '已完成 0 步 · 0 个工具',
          text: '正在处理…',
        })}
        isStreaming={false}
      />,
    );

    // Assert — 状态文本双通道
    expect(screen.getByText('工作中…')).toBeTruthy();
    expect(screen.queryByText('已完成')).toBeNull();
    // trace 默认展开（working 态）
    expect(screen.getByTestId('agent-trace')).toBeTruthy();
    // 折叠开关 aria-expanded=true
    expect(
      screen.getByRole('button', { name: /收起执行过程/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    // 闪烁光标存在
    expect(screen.getByTestId('agent-cursor')).toBeTruthy();
    // 内部步骤渲染（思考块）
    expect(screen.getByText('用户想要 React 旅游页面组件')).toBeTruthy();
  });

  it('工作态有 internal blocks、text 为空 → 仍渲染气泡（空守卫不吞）', () => {
    // Arrange / Act — WU-02 实时流：dispatch_started 创建气泡（text:''），
    // worker_step_start 先推入步骤，worker_text_delta 尚未到达
    render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'working',
          text: '',
          blocks: [traceBlocks[0]],
          summary: '已完成 0 步 · 0 个工具',
        })}
        isStreaming={false}
      />,
    );

    // Assert — 气泡不被 isEmptyAgentMessage 吞掉
    expect(screen.getByTestId('agent-bubble')).toBeTruthy();
    expect(screen.getByTestId('agent-trace')).toBeTruthy();
    expect(screen.getByText('用户想要 React 旅游页面组件')).toBeTruthy();
  });

  it('working→done 迁移：trace 自动折叠（保留用户覆盖语义）', () => {
    // Arrange — 先 working 挂载（trace 展开）
    const { rerender } = render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'working',
          blocks: [traceBlocks[0]],
          summary: '已完成 0 步 · 0 个工具',
          text: '正在处理…',
        })}
        isStreaming={false}
      />,
    );
    expect(screen.getByTestId('agent-trace')).toBeTruthy();

    // Act — 同 id 消息迁移到 done（dispatch_done 后组件实例不重挂载）
    rerender(
      <MessageBubble
        message={makeAgentMessage({
          status: 'done',
          blocks: traceBlocks,
          summary: '已完成 3 步 · 1 个工具',
        })}
        isStreaming={false}
      />,
    );

    // Assert — trace 自动折叠（spec §3：完成后默认折叠）
    expect(screen.queryByTestId('agent-trace')).toBeNull();
    expect(
      screen.getByRole('button', { name: /展开执行过程/ }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('用户手动展开后经 working→done 迁移 → 保持展开（覆盖不被自动折叠重置）', () => {
    // Arrange — 完成态挂载（默认折叠），用户手动展开
    const { rerender } = render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'done',
          blocks: traceBlocks,
          summary: '已完成 3 步 · 1 个工具',
        })}
        isStreaming={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /展开执行过程/ }));
    expect(screen.getByTestId('agent-trace')).toBeTruthy();

    // Act — 迁移 working → done（用户已覆盖，不应自动折叠）
    rerender(
      <MessageBubble
        message={makeAgentMessage({
          status: 'working',
          blocks: traceBlocks,
          summary: '已完成 3 步 · 1 个工具',
          text: '继续…',
        })}
        isStreaming={false}
      />,
    );
    rerender(
      <MessageBubble
        message={makeAgentMessage({
          status: 'done',
          blocks: traceBlocks,
          summary: '已完成 3 步 · 1 个工具',
        })}
        isStreaming={false}
      />,
    );

    // Assert — 用户展开覆盖保留
    expect(screen.getByTestId('agent-trace')).toBeTruthy();
  });

  it('完成态 status=done → 「已完成」状态 + trace 默认折叠 + 无光标', async () => {
    // Arrange / Act
    render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'done',
          isFinal: true,
          blocks: traceBlocks,
          summary: '已完成 3 步 · 1 个工具',
        })}
        isStreaming={false}
      />,
    );

    // Assert — 完成态状态文本
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.queryByText('工作中…')).toBeNull();
    // 折叠开关 aria-expanded=false（done 默认折叠）
    expect(
      screen.getByRole('button', { name: /展开执行过程/ }).getAttribute('aria-expanded'),
    ).toBe('false');
    // trace 默认隐藏
    expect(screen.queryByTestId('agent-trace')).toBeNull();
    // 无闪烁光标
    expect(screen.queryByTestId('agent-cursor')).toBeNull();
    // summary-line 显示摘要文本
    expect(screen.getByText('已完成 3 步 · 1 个工具')).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.getByText('hello from coder')).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });

  it('折叠交互：点击 summary 折叠开关可展开/收起 trace', () => {
    // Arrange
    render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'done',
          blocks: traceBlocks,
          summary: '已完成 3 步 · 1 个工具',
        })}
        isStreaming={false}
      />,
    );

    // Act — 点击展开
    fireEvent.click(screen.getByRole('button', { name: /展开执行过程/ }));
    // Assert — trace 显示
    expect(screen.getByTestId('agent-trace')).toBeTruthy();
    // 内部步骤（tool_call + tool_result）
    expect(screen.getAllByText(/write_file/).length).toBeGreaterThan(0);
    expect(screen.getByText('已写入 53 行')).toBeTruthy();
    // 折叠开关状态更新
    expect(
      screen.getByRole('button', { name: /收起执行过程/ }).getAttribute('aria-expanded'),
    ).toBe('true');

    // Act — 再次点击收起
    fireEvent.click(screen.getByRole('button', { name: /收起执行过程/ }));
    // Assert — trace 隐藏
    expect(screen.queryByTestId('agent-trace')).toBeNull();
    expect(
      screen.getByRole('button', { name: /展开执行过程/ }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('完成态无 summary → 从 blocks 推导「已完成 X 步 · Y 个工具」', () => {
    // Arrange / Act — 不传 summary，仅 3 个 done blocks（2 thinking? 实际 1 thinking+1 tool_call+1 tool_result）
    render(
      <MessageBubble
        message={makeAgentMessage({
          status: 'done',
          blocks: traceBlocks,
        })}
        isStreaming={false}
      />,
    );

    // Assert — 推导：3 个 done 步骤 · 1 个 tool_call 工具
    expect(screen.getByText('已完成 3 步 · 1 个工具')).toBeTruthy();
  });

  it('非 agent 分支不受影响：assistant 消息仍渲染 final-bubble', () => {
    // Arrange / Act
    render(
      <MessageBubble message={makeAssistantMessage('a1', '收到。')} isStreaming={false} />,
    );

    // Assert
    expect(screen.getByTestId('final-bubble')).toBeTruthy();
    expect(screen.queryByTestId('agent-bubble')).toBeNull();
  });
});

describe('MessageList · role=agent 透传', () => {
  it('agent 消息经 MessageList 正常渲染为绿色气泡（不渲染空气泡）', async () => {
    // Arrange / Act
    render(
      <MessageList
        messages={[
          makeUserMessage('继续'),
          makeAssistantMessage('a1', '收到。'),
          makeAgentMessage({ text: '这是 coder 的回复', actorName: 'coder' }),
        ]}
        status="done"
      />,
    );

    // Assert — agent 气泡出现，且内容为 agent 文本
    expect(screen.getByTestId('agent-bubble')).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.getByText('这是 coder 的回复')).toBeTruthy();
      },
      { timeout: 5000 },
    );
  });
});
