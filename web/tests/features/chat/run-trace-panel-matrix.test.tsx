/**
 * Run Trace 面板测试矩阵（spec §8 / §9）
 *
 * 覆盖：五类消息形态、历史与实时同构、a11y、响应式口径（无 overflow-x/y / max-h-）。
 * 优先经 MessageBubble 端到端接线；不改业务实现。
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { RunTracePanel } from '@/components/chat/RunTracePanel';
import type {
  RunTraceViewModel,
  ThinkingTraceStep,
  ToolTraceStep,
} from '@/features/chat/runTrace';
import { buildRunTrace } from '@/features/chat/runTrace';
import {
  assistantMessage,
  historyToolLoopBlocks,
  textBlock,
  thinking,
  toolCall,
  toolResult,
} from './runTraceFixtures';

// —— §7.2 第三组专用 helper（与 WU-02 同套 vm/tool/thinking 风格） ——
function _thinking(
  overrides: Partial<ThinkingTraceStep> & Pick<ThinkingTraceStep, 'id'>,
): ThinkingTraceStep {
  return {
    kind: 'thinking',
    status: 'done',
    label: '思考已完成',
    detail: 'reasoning…',
    ...overrides,
  };
}

function _tool(
  overrides: Partial<ToolTraceStep> & Pick<ToolTraceStep, 'id' | 'toolName'>,
): ToolTraceStep {
  return {
    kind: 'tool',
    status: 'done',
    actionLabel: overrides.actionLabel ?? overrides.toolName,
    isError: false,
    ...overrides,
  };
}

function _vm(overrides: Partial<RunTraceViewModel> = {}): RunTraceViewModel {
  return {
    steps: [],
    toolCount: 0,
    completedCount: 0,
    errorCount: 0,
    summaryLabel: '',
    status: 'done',
    ...overrides,
  };
}

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
      // Arrange — 用流中文本触发 hasFinalText=true → 默认折叠
      const user = userEvent.setup();
      const message = assistantMessage([
        thinking({ id: 't1', thinking: 'plan the answer' }),
        textBlock({ id: 'txt-1', text: 'partial answer' }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={true} />);

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
      // 左侧 StepLabel 身份文本（"思考"），由 StepLabel 独占渲染。
      expect(within(list).getByText('思考')).toBeInTheDocument();
      // button 内 firstLine：去掉「思考」前缀后剩「已完成」状态文字。
      expect(within(list).getByText('已完成')).toBeInTheDocument();
    });

    it('仅 thinking 多个相邻：一个顶层摘要入口下保留三个可独立展开的步骤', async () => {
      // Arrange — 流中 + 已有 partial text 触发 hasFinalText=true → 默认折叠
      const user = userEvent.setup();
      const message = assistantMessage([
        thinking({ id: 't1', thinking: 'first' }),
        thinking({ id: 't2', thinking: 'second' }),
        thinking({ id: 't3', thinking: 'third' }),
        textBlock({ id: 'txt-1', text: 'partial answer' }),
      ]);

      // Act
      render(<MessageBubble message={message} isStreaming={true} />);

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
      // detail 走 Markdown 渲染（不再用 <pre> 平铺）
      expect(timeline.getByText('first')).toBeTruthy();
      expect(timeline.getByText('second')).toBeTruthy();
      expect(timeline.getByText('third')).toBeTruthy();
      expect(document.querySelector('pre')).toBeNull();
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
      // Arrange — 流中 + 已有 partial text 触发 hasFinalText=true → 默认折叠
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
        textBlock({ id: 'txt', text: 'partial done' }),
      ]);

      render(<MessageBubble message={message} isStreaming={true} />);
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

describe('RunTracePanel spec §7.2 第三组 — 窄屏 / 错误 a11y / 键盘 / pill', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('窄屏 360px 工具行不出现横向滚动：scrollWidth ≈ clientWidth（误差 ≤1）', () => {
    // Arrange — 视口 mock 到 360，渲染包含长 url pill 的工具行
    vi.stubGlobal('innerWidth', 360);
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });

    const longUrl = 'https://example.com/very/long/path/' + 'x'.repeat(40);
    const trace = _vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      toolCount: 1,
      completedCount: 0,
      steps: [
        _tool({
          id: 'tc-narrow',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'streaming',
          inputPreview: 'example.com',
          keyParams: [
            { key: 'url', value: 'example.com/very/long/path/…', fullValue: longUrl },
            { key: 'query', value: '平潭岛', fullValue: '平潭岛' },
          ],
        }),
      ],
    });

    // Act — 真实容器宽度 360px
    const { container } = render(
      <div style={{ width: 360, padding: 0 }}>
        <RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />
      </div>,
    );

    // Assert — 流式无 text 时自动展开 → tool 行 card 已渲染（无 resultDetail 时为 div，有则 button）
    const toolRow = container.querySelector(
      'ol > li > button, ol > li > div',
    ) as HTMLElement | null;
    expect(toolRow).not.toBeNull();
    expect(Math.abs(toolRow!.scrollWidth - toolRow!.clientWidth)).toBeLessThanOrEqual(
      1,
    );
  });

  it('错误态：工具行按钮带 aria-label="查看 ${toolName} 结果"，状态位文本为 text-danger 类', () => {
    // Arrange — 工具失败 → 错误默认展开
    const trace = _vm({
      status: 'error',
      errorCount: 1,
      summaryLabel: '完成，但有 1 个步骤失败',
      toolCount: 1,
      completedCount: 0,
      steps: [
        _tool({
          id: 'tc-err',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'error',
          isError: true,
          resultPreview: '请求失败',
          resultDetail: 'stack trace here',
        }),
      ],
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />,
    );

    // Assert — 工具行按钮 aria-label 含 toolName + 动宾「查看 ${toolName} 结果」
    const errButton = container.querySelector(
      'ol > li button.border-danger\\/40.bg-danger-bg',
    ) as HTMLButtonElement | null;
    expect(errButton).not.toBeNull();
    expect(errButton!.getAttribute('aria-label')).toBe('查看 web_fetch 结果');

    // Assert — 状态位（meta = '失败'）在 text-danger span 内
    // StepLabel 错误态身份文本同样是 text-danger（absolute left-3），
    // 必须落在错误按钮子树内以排除身份文本节点。
    const dangerMeta = errButton!.querySelector(
      'span.text-danger.tabular-nums',
    ) as HTMLElement | null;
    expect(dangerMeta).not.toBeNull();
    expect(dangerMeta!.textContent).toBe('失败');
  });

  it('键盘 Enter 切换展开：focus 工具行按钮 → Enter → <pre> 出现 resultDetail 文本', async () => {
    // Arrange — done 状态 + resultDetail，但未自动展开
    const user = userEvent.setup();
    const detailBody = 'resultDetail body for keyboard Enter toggle';
    const trace = _vm({
      status: 'done',
      summaryLabel: '已完成 1 个步骤 · 1 个工具',
      toolCount: 1,
      completedCount: 1,
      steps: [
        _tool({
          id: 'tc-kbd',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'done',
          resultPreview: '1 个网页',
          resultDetail: detailBody,
        }),
      ],
    });

    // 默认折叠场景（isStreaming=true && hasFinalText=true）：summary 收起，timeline 未挂载
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />,
    );

    // 先展开顶层摘要，timeline 才挂载
    const summary = screen.getByRole('button', { name: /已完成 1 个步骤/ });
    await user.click(summary);

    const toolBtn = container.querySelector(
      'ol > li button',
    ) as HTMLButtonElement | null;
    expect(toolBtn).not.toBeNull();
    expect(toolBtn!.getAttribute('aria-expanded')).toBe('false');

    // Act — focus + Enter
    toolBtn!.focus();
    await user.keyboard('{Enter}');

    // Assert — aria-expanded=true，<pre> 含 resultDetail
    expect(toolBtn!.getAttribute('aria-expanded')).toBe('true');
    const pre = container.querySelector('ol > li pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toContain(detailBody);
  });

  it('pill 渲染：tool 行带 url / query 时，DOM 中存在 font-mono + bg-primary/10 + title 属性的 span', () => {
    // Arrange — 自动展开（流式 + 无 text）
    const fullUrl = 'https://example.com/foo/bar';
    const trace = _vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      toolCount: 1,
      completedCount: 0,
      steps: [
        _tool({
          id: 'tc-pill',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'streaming',
          inputPreview: 'example.com/foo/bar',
          keyParams: [
            { key: 'url', value: 'example.com/foo/bar', fullValue: fullUrl },
            { key: 'query', value: '平潭岛', fullValue: '平潭岛' },
          ],
        }),
      ],
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />,
    );

    // Assert — pill 同时具备 font-mono、bg-primary/10、title 属性
    const pills = Array.from(
      container.querySelectorAll('span.font-mono.bg-primary\\/10'),
    ) as HTMLElement[];
    expect(pills.length).toBeGreaterThanOrEqual(1);

    const urlPill = pills.find((p) => p.getAttribute('title') === fullUrl);
    expect(urlPill).toBeDefined();
    expect(urlPill!.className).toContain('font-mono');
    expect(urlPill!.className).toContain('bg-primary/10');
    expect(urlPill!.getAttribute('title')).toBe(fullUrl);

    const queryPill = pills.find((p) => p.getAttribute('title') === '平潭岛');
    expect(queryPill).toBeDefined();
    expect(queryPill!.textContent).toBe('平潭岛');
  });
});

/**
 * spec §8.2 第二批：360 px 窄屏 / 多步骤身份文本 / 暗色模式。
 *
 * 设计前提（spec §4.1）：
 *  - 每个 <li> 左侧 64px 容纳 StepLabel（最长 10 字符 mono）+ 右上徽章。
 *  - 暗色模式依赖全局 `dark` class 切换 token；组件本身不引入硬编码颜色。
 */
describe('RunTracePanel spec §8.2 — 窄屏 / 多步骤 / 暗色模式', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('dark');
  });

  it('§8.2.1 360 px 窄屏：节点身份文本 + keyParam pill 不溢出，无 scrollWidth > clientWidth', () => {
    // Arrange — 长 toolName + 长 url pill，验证横向不溢出
    vi.stubGlobal('innerWidth', 360);
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });

    const longUrl = 'https://example.com/very/long/path/' + 'x'.repeat(40);
    const trace = _vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      toolCount: 1,
      completedCount: 0,
      steps: [
        _tool({
          id: 'tc-narrow-360',
          toolName: 'super_long_tool',
          actionLabel: '获取网页',
          status: 'streaming',
          inputPreview: 'example.com',
          keyParams: [
            { key: 'url', value: 'example.com/very/long/path/…', fullValue: longUrl },
            { key: 'query', value: '平潭岛', fullValue: '平潭岛' },
          ],
        }),
      ],
    });

    // Act — 真实容器宽度 360px
    const { container } = render(
      <div style={{ width: 360, padding: 0 }}>
        <RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />
      </div>,
    );

    // Assert — RunTracePanel 根无横向溢出
    const panel = container.querySelector('[data-run-trace]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.scrollWidth).toBe(panel.clientWidth);

    // Assert — 每个 <li> 无横向溢出
    const listItems = container.querySelectorAll('ol > li');
    listItems.forEach((li) => {
      const el = li as HTMLElement;
      expect(el.scrollWidth).toBe(el.clientWidth);
    });

    // Assert — pill + StepLabel 身份文本都存在
    expect(screen.getByText('super_long')).toBeInTheDocument();
    const pills = container.querySelectorAll('span.font-mono.bg-primary\\/10');
    expect(pills.length).toBeGreaterThanOrEqual(1);
  });

  it('§8.2.2 多步骤：3+ 步骤时各节点身份文本并列可见', () => {
    // Arrange
    const trace = _vm({
      steps: [
        _tool({ id: 's1', toolName: 'web_search', actionLabel: '搜索网页' }),
        _thinking({ id: 't1', detail: 'reason one' }),
        _tool({ id: 's2', toolName: 'web_fetch', actionLabel: '获取网页' }),
        _thinking({ id: 't2', detail: 'reason two' }),
      ],
      toolCount: 2,
      completedCount: 4,
      summaryLabel: '已完成 4 个步骤 · 2 个工具',
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />,
    );

    // Assert — 4 个 <li> 都在 timeline 内
    const items = container.querySelectorAll('ol > li');
    expect(items).toHaveLength(4);

    // Assert — 节点身份文本并列可见（spec §4.1：tool 显示 toolName，thinking 显示「思考」）
    const withinList = within(screen.getByRole('list'));
    expect(withinList.getAllByText('web_search').length).toBeGreaterThanOrEqual(1);
    expect(withinList.getAllByText('web_fetch').length).toBeGreaterThanOrEqual(1);
    // thinking 节点：使用 getAllByText 收集所有「思考」实例（每个 thinking 行一个）
    const thinkingIdentityTexts = container.querySelectorAll(
      'span.font-mono[title="思考"]',
    );
    expect(thinkingIdentityTexts.length).toBe(2);
  });

  it('§8.2.3 暗色模式：document.documentElement 含 dark class 时，徽章 / 文本 token 类仍存在', () => {
    // Arrange — 启用暗色模式
    document.documentElement.classList.add('dark');

    const trace = _vm({
      status: 'error',
      errorCount: 1,
      summaryLabel: '完成，但有 1 个步骤失败',
      toolCount: 1,
      completedCount: 0,
      steps: [
        _tool({
          id: 'tc-dark',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'error',
          isError: true,
          resultDetail: 'dark mode body',
        }),
      ],
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />,
    );

    // Assert — token 类（text-danger / bg-danger-bg / bg-surface）仍生效
    // 暗色模式由全局 token 接管颜色值；这里只断言「类名在 dark 下未丢失」。
    const errorBtn = container.querySelector(
      'ol > li button.border-danger\\/40.bg-danger-bg',
    ) as HTMLElement | null;
    expect(errorBtn).not.toBeNull();
    expect(errorBtn!.className).toContain('border-danger/40');
    expect(errorBtn!.className).toContain('bg-danger-bg');

    // 错误徽章：StepLabel 右侧 bg-surface text-danger 类保留
    const errorBadge = container.querySelector('span.bg-surface.text-danger');
    expect(errorBadge).not.toBeNull();
    // 内部 AlertCircle 图标存在
    expect(errorBadge!.querySelector('.lucide-circle-alert')).not.toBeNull();

    // 节点身份文本 token 类（text-danger）保留
    const identitySpan = container.querySelector(
      'span.font-mono[title="web_fetch"]',
    );
    expect(identitySpan).not.toBeNull();
    expect(identitySpan!.className).toContain('text-danger');
    expect(identitySpan!.className).toContain('font-mono');

    // 暗色标记已注入（避免静默跳过断言）
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
