/**
 * Run Trace 面板测试矩阵（spec §8 / §9）
 *
 * 覆盖：五类消息形态、历史与实时同构、a11y、响应式口径（无 overflow-x/y / max-h-）。
 * 优先经 MessageBubble 端到端接线；不改业务实现。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { buildRunTrace } from '@/features/chat/runTrace';
import {
  assistantMessage,
  historyToolLoopBlocks,
  textBlock,
  thinking,
  toolCall,
  toolResult,
} from './runTraceFixtures';

function summaryExpandButtons() {
  return screen.getAllByRole('button').filter((btn) => btn.hasAttribute('aria-controls'));
}

function assertNoNestedScrollClasses(className: string) {
  expect(className).not.toMatch(/\boverflow-x(?:-|\b)/);
  expect(className).not.toMatch(/\boverflow-y(?:-|\b)/);
  expect(className).not.toMatch(/\bmax-h-/);
}

describe('RunTrace panel matrix (spec §8 / §9)', () => {
  describe('五类消息形态', () => {
    it('无工具仅 thinking：一个顶层摘要按钮，展开后 timeline 含 thinking 行', async () => {
      // Arrange
      const user = userEvent.setup();
      const message = assistantMessage([
        thinking({ id: 't1', thinking: 'plan the answer' }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={false} />);

      // Assert — 单一顶层入口
      const summaries = summaryExpandButtons();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toHaveAttribute('aria-expanded', 'false');
      expect(document.querySelectorAll('[data-run-trace]')).toHaveLength(1);

      // Act — 展开看 timeline
      await user.click(summaries[0]);

      // Assert
      expect(summaries[0]).toHaveAttribute('aria-expanded', 'true');
      const list = screen.getByRole('list');
      expect(within(list).getAllByRole('listitem')).toHaveLength(1);
      expect(within(list).getByText('思考已完成')).toBeInTheDocument();
    });

    it('仅 thinking 多个相邻：一个顶层摘要入口下保留三个可独立展开的步骤', async () => {
      // Arrange
      const user = userEvent.setup();
      const message = assistantMessage([
        thinking({ id: 't1', thinking: 'first' }),
        thinking({ id: 't2', thinking: 'second' }),
        thinking({ id: 't3', thinking: 'third' }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={false} />);

      // Assert
      expect(summaryExpandButtons()).toHaveLength(1);
      expect(document.querySelectorAll('[data-run-trace]')).toHaveLength(1);

      // Act — 展开顶层 timeline，再分别展开三个 thinking 详情
      await user.click(summaryExpandButtons()[0]);
      const timeline = within(screen.getByRole('list'));
      const thinkingSteps = timeline.getAllByRole('button', {
        name: '查看思考过程',
      });
      await user.click(thinkingSteps[0]);
      await user.click(thinkingSteps[1]);
      await user.click(thinkingSteps[2]);

      // Assert — 三个 thinking 保持独立，且各自按钮对应各自详情
      expect(timeline.getAllByRole('listitem')).toHaveLength(3);
      expect(thinkingSteps).toHaveLength(3);
      thinkingSteps.forEach((step) => {
        expect(step).toHaveAttribute('aria-expanded', 'true');
      });
      expect(timeline.getByText('first').tagName).toBe('PRE');
      expect(timeline.getByText('second').tagName).toBe('PRE');
      expect(timeline.getByText('third').tagName).toBe('PRE');
    });

    it('仅最终 text：不渲染 data-run-trace 面板', async () => {
      // Arrange
      const message = assistantMessage([
        textBlock({ id: 'txt-1', text: 'plain reply without tools' }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={false} />);

      // Assert
      expect(document.querySelector('[data-run-trace]')).toBeNull();
      expect(screen.queryByRole('button', { expanded: true })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument();
      expect(
        await screen.findByText('plain reply without tools', undefined, {
          timeout: 3_000,
        }),
      ).toBeInTheDocument();
    });

    it('工具失败：摘要含失败语义，图标与文字双通道可断言', () => {
      // Arrange — 无最终 text + errorCount>0 → 默认展开
      const message = assistantMessage([
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_fetch',
          inputRaw: '{"url":"https://fail.example"}',
          input: { url: 'https://fail.example' },
        }),
        toolResult({
          id: 'r1',
          toolCallId: 'call-1',
          toolName: 'web_fetch',
          content: 'request failed',
          isError: true,
          status: 'error',
        }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={false} />);

      // Assert — 文字通道（摘要）
      expect(screen.getByText('完成，但有 1 个步骤失败')).toBeInTheDocument();

      // Assert — 图标通道
      expect(screen.getByLabelText('失败')).toBeInTheDocument();

      // Assert — timeline 工具行失败文案（错误默认展开）
      expect(summaryExpandButtons()[0]).toHaveAttribute('aria-expanded', 'true');
      expect(within(screen.getByRole('list')).getByText('失败')).toBeInTheDocument();
    });

    it('abort：摘要含已停止类文案', () => {
      // Arrange
      const message = assistantMessage([
        thinking({ id: 't1', thinking: 'interrupted' }),
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_search',
          status: 'done',
        }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={false} aborted />);

      // Assert
      expect(screen.getByText(/已停止/)).toBeInTheDocument();
      expect(screen.getByLabelText('已停止')).toBeInTheDocument();
      const vm = buildRunTrace(message.blocks, { isStreaming: false, aborted: true });
      expect(vm.status).toBe('aborted');
    });
  });

  describe('历史与实时同构', () => {
    it('同一 blocks 序列经 buildRunTrace 后 MessageBubble 仅一个 data-run-trace，最终 Markdown 在面板外', async () => {
      // Arrange — isolation 同构：thinking → tool_call → tool_result → text
      const blocks = historyToolLoopBlocks();
      const vm = buildRunTrace(blocks, { isStreaming: false });
      expect(vm.steps.length).toBeGreaterThan(0);
      expect(vm.steps.every((s) => s.kind !== 'tool' || s.toolName)).toBe(true);

      const message = assistantMessage(blocks);

      // Act
      const { container } = render(
        <MessageBubble message={message} isStreaming={false} />,
      );

      // Assert — 单一面板
      const panels = container.querySelectorAll('[data-run-trace]');
      expect(panels).toHaveLength(1);

      // Assert — 最终文本在面板外可见
      const finalText = await screen.findByText('final answer from history');
      expect(finalText).toBeInTheDocument();
      expect(panels[0].contains(finalText)).toBe(false);
    });
  });

  describe('a11y', () => {
    it('摘要按钮有 aria-expanded；步骤详情按钮有具体 aria-label；Enter 可切换展开', async () => {
      // Arrange
      const user = userEvent.setup();
      const message = assistantMessage([
        thinking({ id: 't1', thinking: 'reason about fetch' }),
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_fetch',
          inputRaw: '{"url":"https://example.com"}',
          input: { url: 'https://example.com' },
        }),
        toolResult({
          id: 'r1',
          toolCallId: 'call-1',
          toolName: 'web_fetch',
          content: '{"ok":true}',
        }),
        textBlock({ id: 'txt', text: 'done' }),
      ]);

      render(<MessageBubble message={message} isStreaming={false} />);
      const summary = summaryExpandButtons()[0];

      // Assert — 摘要 a11y
      expect(summary).toHaveAttribute('aria-expanded', 'false');
      expect(summary).toHaveAttribute('aria-controls');

      // Act — 键盘 Enter 展开
      summary.focus();
      await user.keyboard('{Enter}');

      // Assert
      expect(summary).toHaveAttribute('aria-expanded', 'true');

      // Assert — 步骤详情具体标签（思考 / web_fetch）
      expect(screen.getByRole('button', { name: /思考/ })).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /查看 web_fetch 结果/ }),
      ).toBeInTheDocument();

      // Act — Enter 再收起
      await user.keyboard('{Enter}');
      expect(summary).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('响应式口径', () => {
    it.each([320, 768, 1024] as const)(
      '容器宽度 %i：data-run-trace className 不含 overflow-x / overflow-y / max-h-',
      (width) => {
        // Arrange
        const message = assistantMessage(historyToolLoopBlocks());

        // Act
        const { container } = render(
          <div style={{ width }}>
            <MessageBubble message={message} isStreaming={false} />
          </div>,
        );

        // Assert — 不做像素快照；只校验禁止嵌套滚动的 class 口径
        const root = container.querySelector('[data-run-trace]');
        expect(root).not.toBeNull();
        const className =
          typeof root!.className === 'string' ? root!.className : String(root!.className);
        assertNoNestedScrollClasses(className);
      },
    );
  });
});
