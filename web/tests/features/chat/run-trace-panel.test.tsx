/**
 * RunTracePanel 组件测试
 *
 * 覆盖：默认展开策略、userOverride、空 trace、独立思考步骤、键盘与无障碍。
 */
import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RunTracePanel } from '@/components/chat/RunTracePanel';
import type {
  RunTraceViewModel,
  ThinkingTraceStep,
  ToolTraceStep,
} from '@/features/chat/runTrace';

function thinking(
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

function tool(
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

function vm(overrides: Partial<RunTraceViewModel> = {}): RunTraceViewModel {
  return {
    steps: [
      thinking({ id: 't1', detail: 'a' }),
      tool({
        id: 'tc1',
        toolName: 'web_fetch',
        actionLabel: '获取网页',
        inputPreview: 'example.com',
        resultPreview: '1 个网页',
        resultDetail: '{"ok":true}',
      }),
    ],
    toolCount: 1,
    completedCount: 2,
    errorCount: 0,
    summaryLabel: '已完成 2 个步骤 · 1 个工具',
    status: 'done',
    ...overrides,
  };
}

describe('RunTracePanel', () => {
  it('摘要按钮：多个 thinking 步骤仍只有一个顶层入口', () => {
    // Arrange
    const trace = vm({
      steps: [
        thinking({ id: 't1', detail: 'one' }),
        thinking({ id: 't2', detail: 'two' }),
        thinking({ id: 't3', detail: 'three' }),
        tool({ id: 'tc1', toolName: 'web_search', actionLabel: '搜索网页' }),
      ],
      toolCount: 1,
      completedCount: 4,
      summaryLabel: '已完成 4 个步骤 · 1 个工具',
    });

    // Act — 用 isStreaming=true && hasFinalText=true 触发「默认折叠」（spec §4.2）
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />);

    // Assert
    const expandButtons = screen.getAllByRole('button', { expanded: false });
    const summaryButtons = expandButtons.filter((btn) =>
      btn.hasAttribute('aria-controls'),
    );
    expect(summaryButtons).toHaveLength(1);
    expect(summaryButtons[0]).toHaveAttribute('aria-expanded', 'false');
  });

  it('独立思考块：连续三个 thinking 可分别展开且具有视觉区分类', async () => {
    // Arrange
    const user = userEvent.setup();
    const trace = vm({
      steps: [
        thinking({ id: 't1', detail: 'first detail' }),
        thinking({ id: 't2', detail: 'second detail' }),
        thinking({ id: 't3', detail: 'third detail' }),
      ],
      toolCount: 0,
      completedCount: 3,
      summaryLabel: '已完成 3 个步骤 · 0 个工具',
    });

    // Act — 用 isStreaming=true && hasFinalText=true 触发默认折叠
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />,
    );
    await user.click(screen.getByRole('button', { name: /已完成 3 个步骤/ }));
    const thinkingButtons = screen.getAllByRole('button', { name: '查看思考过程' });
    await user.click(thinkingButtons[0]);
    await user.click(thinkingButtons[2]);

    // Assert
    expect(thinkingButtons).toHaveLength(3);
    expect(thinkingButtons[0]).toHaveAttribute('aria-expanded', 'true');
    expect(thinkingButtons[1]).toHaveAttribute('aria-expanded', 'false');
    expect(thinkingButtons[2]).toHaveAttribute('aria-expanded', 'true');
    // detail 文本出现在展开区（Markdown 渲染；不再要求 tagName=PRE）
    expect(screen.getByText('first detail')).toBeTruthy();
    expect(screen.getByText('third detail')).toBeTruthy();

    const thinkingRows = container.querySelectorAll('[data-trace-step="thinking"]');
    expect(thinkingRows).toHaveLength(3);
    thinkingRows.forEach((row) => {
      // thinking 行已统一进 TraceRowCard（spec §6.4 移除紫框）
      expect(row.className).not.toContain('bg-primary/5');
      expect(row.className).not.toContain('border-primary/45');
    });

    // 三个 thinking 共享同一卡片样式（统一信息卡 spec §4.1；容器为 bg-white）
    const unifiedCards = container.querySelectorAll(
      'ol li button.border-border.bg-white, ol li div.border-border.bg-white',
    );
    expect(unifiedCards.length).toBeGreaterThanOrEqual(3);

    const panel = container.querySelector('[data-run-trace]');
    expect(panel?.className).toContain('bg-white');
    expect(panel?.className).toContain('border-border/80');
  });

  it('默认展开：运行中且无最终 text 时 timeline 可见', () => {
    // Arrange
    const trace = vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      steps: [
        thinking({ id: 't1', status: 'done' }),
        tool({
          id: 'tc1',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'streaming',
        }),
      ],
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />);

    // Assert
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('默认折叠：isStreaming=true && hasFinalText=true && errorCount=0 时不挂载 timeline', async () => {
    // Arrange — spec §4.2：仅当「运行中已结束 final 等待下一轮」时才折叠
    const user = userEvent.setup();
    const trace = vm({ status: 'done' });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />,
    );

    // Assert
    const summary = screen.getByRole('button', { expanded: false });
    expect(summary).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(container.querySelector('[data-trace-step]')).not.toBeInTheDocument();

    await user.click(summary);

    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(container.querySelector('[data-trace-step]')).toBeInTheDocument();
  });

  it('用户手动折叠后：props 变为完成态仍保持折叠（不被自动策略覆盖）', async () => {
    // Arrange
    const user = userEvent.setup();
    const streaming = vm({
      status: 'running',
      summaryLabel: '正在思考',
    });
    const { rerender } = render(
      <RunTracePanel trace={streaming} isStreaming={true} hasFinalText={false} />,
    );
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();

    // Act — 用户手动折叠
    await user.click(screen.getByRole('button', { expanded: true }));
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();

    // Act — 变为完成态
    rerender(
      <RunTracePanel
        trace={vm({ status: 'done', summaryLabel: '已完成 2 个步骤 · 1 个工具' })}
        isStreaming={false}
        hasFinalText={true}
      />,
    );

    // Assert — 仍折叠
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('错误默认展开：无最终 text 且 errorCount>0 时展开，摘要含失败文案与错误图标标签', () => {
    // Arrange
    const trace = vm({
      status: 'error',
      errorCount: 1,
      summaryLabel: '完成，但有 1 个步骤失败',
      steps: [
        tool({
          id: 'tc1',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'error',
          isError: true,
          resultPreview: '请求失败',
        }),
      ],
      toolCount: 1,
      completedCount: 0,
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />);

    // Assert
    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.getByText('完成，但有 1 个步骤失败')).toBeInTheDocument();
    expect(screen.getByLabelText(/失败|错误/)).toBeInTheDocument();
  });

  it('中止摘要：vm.status 为 aborted 时展示 summaryLabel', () => {
    // Arrange
    const trace = vm({
      status: 'aborted',
      summaryLabel: '已停止 · 保留 2 个步骤',
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />);

    // Assert
    expect(screen.getByText('已停止 · 保留 2 个步骤')).toBeInTheDocument();
  });

  it('空 trace：完全不渲染容器', () => {
    // Arrange
    const empty = vm({
      steps: [],
      toolCount: 0,
      completedCount: 0,
      errorCount: 0,
      summaryLabel: '已完成 0 个步骤 · 0 个工具',
      status: 'done',
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={empty} isStreaming={false} hasFinalText={true} />,
    );

    // Assert
    expect(container.firstChild).toBeNull();
  });

  it('合并步骤：一对 call/result 在 timeline 中只占一个 li', () => {
    // Arrange — 派生层已合并，组件只渲染 steps 数组
    const trace = vm({
      steps: [
        tool({
          id: 'merged-1',
          toolName: 'web_search',
          actionLabel: '搜索网页',
          inputPreview: '平潭',
          resultPreview: '11 个结果',
          resultDetail: 'hit1\nhit2',
        }),
      ],
      toolCount: 1,
      completedCount: 1,
      summaryLabel: '已完成 1 个步骤 · 1 个工具',
    });

    // Act
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />);

    // Assert
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('键盘：聚焦摘要按钮后 Enter 可切换 aria-expanded', async () => {
    // Arrange — 默认折叠场景需要 isStreaming=true && hasFinalText=true
    const user = userEvent.setup();
    render(
      <RunTracePanel trace={vm()} isStreaming={true} hasFinalText={true} />,
    );
    const summary = screen.getByRole('button', { expanded: false });
    summary.focus();

    // Act
    await user.keyboard('{Enter}');

    // Assert
    expect(summary).toHaveAttribute('aria-expanded', 'true');

    // Act
    await user.keyboard(' ');

    // Assert
    expect(summary).toHaveAttribute('aria-expanded', 'false');
  });

  it('无嵌套滚动：面板 className 不含 overflow-y 与 max-h-', () => {
    // Arrange / Act
    const { container } = render(
      <RunTracePanel trace={vm()} isStreaming={true} hasFinalText={false} />,
    );

    // Assert
    const root = container.querySelector('[data-run-trace]');
    expect(root).not.toBeNull();
    const withForbidden = Array.from(container.querySelectorAll('[class]')).filter(
      (el) => {
        const c = el.className;
        if (typeof c !== 'string') return false;
        return /\boverflow-y(?:-|\b)/.test(c) || /\bmax-h-/.test(c);
      },
    );
    expect(withForbidden).toHaveLength(0);
  });

  it('流式 thinking：行内不挂 reasoning 预览，避免 CoT 被 live region 播报', () => {
    const secret = 'SECRET_CHAIN_OF_THOUGHT_TOKEN_STREAM';
    const trace = vm({
      status: 'running',
      summaryLabel: '正在思考',
      steps: [
        thinking({
          id: 't-stream',
          status: 'streaming',
          label: '正在思考',
          detail: secret,
        }),
      ],
      toolCount: 0,
      completedCount: 0,
    });

    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />);

    expect(screen.getByRole('button', { expanded: true })).toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(screen.getAllByText('正在思考').length).toBeGreaterThanOrEqual(1);
  });

  it('v3.1 thinking 步骤：默认不暴露 reasoning 全文；仅展开后才显示', async () => {
    const user = userEvent.setup();
    const detail = 'completed reasoning body for AT gate';
    const trace = vm({
      steps: [thinking({ id: 't1', status: 'done', detail, label: '思考已完成' })],
      toolCount: 0,
      completedCount: 1,
      summaryLabel: '已完成 1 个步骤 · 0 个工具',
    });

    // 默认折叠：isStreaming=true && hasFinalText=true
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />);
    await user.click(screen.getByRole('button', { name: /已完成 1 个步骤/ }));

    // Assert — 默认状态下 reasoning 全文不暴露在 step 行（v3.1 行高 36px 不允许 preview）
    expect(screen.queryByText(detail)).toBeNull();

    // Act — 展开 thinking 详情
    await user.click(screen.getByRole('button', { name: '查看思考过程' }));

    // Assert — 展开后 detail 暴露
    expect(screen.getByText(detail)).toBeInTheDocument();
  });
});

describe('RunTracePanel spec §7.2 第二组 — 视觉改造', () => {
  it('工具行展开后渲染 pill：title=fullValue，className 含 bg-primary/10 / border-primary/20', async () => {
    // Arrange
    const user = userEvent.setup();
    const url = 'https://example.com/foo/bar';
    const trace = vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      steps: [
        tool({
          id: 'tc-pill',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'streaming',
          inputPreview: 'example.com/foo/bar',
          keyParams: [
            { key: 'url', value: 'example.com/foo/bar', fullValue: url },
          ],
        }),
      ],
      toolCount: 1,
      completedCount: 0,
    });

    // Act — 默认折叠；先点 step 卡片展开
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />,
    );
    await user.click(screen.getByRole('button', { name: /查看 web_fetch 结果/ }));

    // Assert — pill 出现在 detail 区（v3.1 默认折叠）
    const pills = container.querySelectorAll(
      'span.font-mono.bg-primary\\/10',
    );
    expect(pills.length).toBeGreaterThanOrEqual(1);
    const pill = pills[0]!;
    expect(pill.getAttribute('title')).toBe(url);
    expect(pill.className).toContain('border-primary/20');
    expect(pill.className).toContain('bg-primary/10');
    expect(pill.textContent).toBe('example.com/foo/bar');
  });

  it('错误态整行带 border-danger/40 bg-danger-bg；状态位文本显示「失败」', () => {
    // Arrange
    const trace = vm({
      status: 'error',
      errorCount: 1,
      summaryLabel: '完成，但有 1 个步骤失败',
      steps: [
        tool({
          id: 'tc-err',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'error',
          isError: true,
          resultPreview: '请求失败',
          resultDetail: 'stack trace here',
        }),
      ],
      toolCount: 1,
      completedCount: 0,
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />,
    );

    // Assert — 错误按钮整体带 danger 边框与背景
    const errorBtn = container.querySelector(
      'li button.border-danger\\/40.bg-danger-bg',
    );
    expect(errorBtn).not.toBeNull();
    expect(errorBtn!.className).toContain('border-danger/40');
    expect(errorBtn!.className).toContain('bg-danger-bg');

    // Assert — 状态位文本（meta = '失败'）在按钮内可定位
    // v3.1：颜色编码已移除，meta 用 text-danger 标记状态
    const metaSpan = errorBtn!.querySelector(
      'span.text-danger.tabular-nums',
    ) as HTMLElement | null;
    expect(metaSpan).not.toBeNull();
    expect(metaSpan!.textContent).toBe('失败');
  });

  it('窄屏（< 360px）下工具行不出现横向滚动：scrollWidth === clientWidth', () => {
    // Arrange
    const longUrl = 'https://example.com/very/long/path/' + 'x'.repeat(40);
    const trace = vm({
      status: 'running',
      summaryLabel: '正在执行 获取网页',
      steps: [
        tool({
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
      toolCount: 1,
      completedCount: 0,
    });

    // Act — 真实宽度 360px
    const { container } = render(
      <div style={{ width: 360, padding: 0 }}>
        <RunTracePanel trace={trace} isStreaming={true} hasFinalText={false} />
      </div>,
    );

    // Assert — RunTracePanel 根、timeline <li> 与 pill 父按钮均无横向溢出
    const panel = container.querySelector('[data-run-trace]') as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.scrollWidth).toBe(panel.clientWidth);

    const listItems = container.querySelectorAll('ol > li');
    listItems.forEach((li) => {
      const el = li as HTMLElement;
      expect(el.scrollWidth).toBe(el.clientWidth);
    });
  });

  it('thinking 行不再带 bg-primary/5 / border-primary/45 紫框', () => {
    // Arrange
    const trace = vm({
      status: 'done',
      steps: [
        thinking({ id: 't-no-purple', detail: 'reason body' }),
      ],
      toolCount: 0,
      completedCount: 1,
      summaryLabel: '已完成 1 个步骤 · 0 个工具',
    });

    // Act — 默认折叠场景（isStreaming=true && hasFinalText=true）
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />,
    );

    // Assert — 折叠态 DOM 不含紫框类
    const collapsedClassNames = Array.from(container.querySelectorAll('[class]'))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === 'string')
      .join(' ');
    expect(collapsedClassNames).not.toMatch(/\bbg-primary\/5\b/);
    expect(collapsedClassNames).not.toMatch(/\bborder-primary\/45\b/);

    // 展开 summary 让 thinking 行渲染
    const summary = screen.getByRole('button', { name: /已完成 1 个步骤/ });
    act(() => {
      summary.click();
    });

    // Assert — 展开后 DOM 内任何 element 的 className 仍不再含紫框类
    const expandedClassNames = Array.from(container.querySelectorAll('[class]'))
      .map((el) => el.className)
      .filter((c): c is string => typeof c === 'string')
      .join(' ');
    expect(expandedClassNames).not.toMatch(/\bbg-primary\/5\b/);
    expect(expandedClassNames).not.toMatch(/\bborder-primary\/45\b/);

    // thinking 行的承载卡片应改为统一信息卡（含 border-border + bg-white）
    const li = container.querySelector('ol > li');
    expect(li).not.toBeNull();
    const innerHtml = li!.innerHTML;
    expect(innerHtml).toMatch(/\bborder-border\b/);
    expect(innerHtml).toMatch(/\bbg-white\b/);
  });

  it('thinking 步骤展开后用 Markdown 渲染 detail（不再用 <pre> 平铺）', async () => {
    // Arrange
    const user = userEvent.setup();
    // 含 markdown 语法的 detail：列表 + 行内代码 + 链接 + 加粗
    const detail =
      '- 调研 [GitHub](https://github.com) 上的开源项目\n- 跑通 `npm test`\n\n核心结论：**Ollama + Jan** 最稳。';
    const trace = vm({
      steps: [
        thinking({ id: 't-md', detail }),
      ],
      toolCount: 0,
      completedCount: 1,
      summaryLabel: '已完成 1 个步骤 · 0 个工具',
    });

    // Act — 默认折叠场景（isStreaming=true && hasFinalText=true）
    render(<RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />);
    // 先点 summary 展开 panel
    await user.click(screen.getByRole('button', { name: /已完成 1 个步骤/ }));
    // 再点 thinking 按钮展开 thinking detail
    const thinkingBtn = screen.getByRole('button', { name: '查看思考过程' });
    await user.click(thinkingBtn);

    // Assert
    // <pre> 已不再渲染 detail（改 Markdown 渲染）
    expect(document.querySelector('pre')).toBeNull();
    // Markdown 列表 / 行内代码 / 加粗存在
    expect(screen.getByText('GitHub')).toBeTruthy();
    expect(screen.getByText('npm test')).toBeTruthy();
    expect(screen.getByText(/Ollama \+ Jan/)).toBeTruthy();
    // link 真实渲染为 <a href>
    const link = screen.getByText('GitHub').closest('a');
    expect(link?.getAttribute('href')).toBe('https://github.com');
  });
});

/**
 * spec §8.1 第二批：左侧时间线节点身份文本 + 右上徽章 + 默认展开策略 + resetKey。
 *
 * 设计前提（spec §4.1 / §4.2 / §4.3）：
 *  - StepLabel 替换 StepNode：tool 节点显示 toolName，thinking 节点显示「思考」；
 *    超长截断到 10 字符并设置 title 为全文。
 *  - 默认展开：`errorCount>0` / `isStreaming && !hasFinalText` / `!isStreaming && errorCount===0`。
 *    默认折叠：仅 `isStreaming && hasFinalText && errorCount===0`。
 *  - resetKey 变化 → 强制重置 userOverride / expanded / openStepIds。
 */
describe('RunTracePanel spec §8.1 — 节点身份 / 徽章 / 默认展开 / resetKey', () => {
  it('§8.1.1 节点身份文本：tool 节点显示 actionLabel；thinking 节点显示「思考」', () => {
    // Arrange
    const trace = vm({
      steps: [
        thinking({ id: 't1', detail: 'reasoning' }),
        tool({ id: 'tc1', toolName: 'write_file', actionLabel: '写文件' }),
      ],
      toolCount: 1,
      completedCount: 2,
      summaryLabel: '已完成 2 个步骤 · 1 个工具',
    });

    // Act
    render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />,
    );

    // Assert — 节点身份文本：tool 显示中文 actionLabel，thinking 显示「思考」
    expect(screen.getByText('写文件')).toBeInTheDocument();
    expect(screen.getAllByText('思考').length).toBeGreaterThanOrEqual(1);
  });

  it('§8.1.1 v3.1 不截断：toolName 长名字走自然宽度（whitespace-nowrap，不硬切）', () => {
    // Arrange — actionLabel 14 字符（中文）
    const trace = vm({
      steps: [
        tool({
          id: 'tc-long',
          toolName: 'execute_long_command',
          actionLabel: '执行 shell 命令',
        }),
      ],
      toolCount: 1,
      completedCount: 1,
      summaryLabel: '已完成 1 个步骤 · 1 个工具',
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />,
    );

    // Assert — 渲染完整 actionLabel（无截断）
    expect(screen.getByText('执行 shell 命令')).toBeInTheDocument();
    // 身份文本 span 不再是 font-mono
    const identitySpan = container.querySelector('span.text-text.whitespace-nowrap');
    expect(identitySpan).not.toBeNull();
    expect(identitySpan!.textContent).toBe('执行 shell 命令');
  });

  it('§8.1.2 v3.1 无右上徽章：step 卡片不含 ✓/⚠/spinner 圆点徽章', () => {
    // Arrange
    const trace = vm({
      steps: [
        thinking({ id: 't-done', detail: 'reasoned' }),
        tool({ id: 'tc-done', toolName: 'web_search', actionLabel: '搜索' }),
        tool({
          id: 'tc-run',
          toolName: 'web_fetch',
          actionLabel: '获取',
          status: 'streaming',
        }),
        tool({
          id: 'tc-err',
          toolName: 'web_fetch',
          actionLabel: '获取',
          status: 'error',
          isError: true,
        }),
      ],
      toolCount: 3,
      completedCount: 2,
      errorCount: 1,
      summaryLabel: '完成，但有 1 个步骤失败',
      status: 'error',
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={false} />,
    );

    // Assert — 不存在 bg-surface 圆点徽章（v3.1 全部移除）
    const surfaceBadges = container.querySelectorAll('span.bg-surface.rounded-full');
    expect(surfaceBadges).toHaveLength(0);
    // 也不应有 h-3 w-3 徽章
    const size3Badges = container.querySelectorAll('span.h-3.w-3');
    expect(size3Badges).toHaveLength(0);
  });

  it('§8.1.3 v3.1 <li> 取消 pl-[112px]：简化为 flex 容器，由 step-card 内 before: 虚线承担', () => {
    // Arrange
    const trace = vm({
      steps: [
        thinking({ id: 't1', detail: 'a' }),
        tool({ id: 'tc1', toolName: 'web_fetch', actionLabel: '获取' }),
      ],
    });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />,
    );

    // Assert
    const items = Array.from(
      container.querySelectorAll('ol > li'),
    ) as HTMLElement[];
    expect(items.length).toBeGreaterThanOrEqual(1);
    items.forEach((li) => {
      expect(li.className).not.toContain('pl-[72px]');
      expect(li.className).not.toContain('pl-[112px]');
      expect(li.className).not.toContain('pl-[34px]');
    });
    // step-card button 含 before: 虚线伪元素
    const stepCard = container.querySelector('button[class*="before:border-dashed"]');
    expect(stepCard).not.toBeNull();
  });

  it('§8.1.4 默认展开：isStreaming=false + errorCount=0 时 timeline 容器 hidden=false', () => {
    // Arrange — spec §4.2 修订：已完成无错误 → 默认展开
    const trace = vm({ status: 'done' });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={false} hasFinalText={true} />,
    );

    // Assert — 顶层摘要按钮 aria-expanded=true
    expect(
      screen.getByRole('button', { expanded: true }),
    ).toBeInTheDocument();
    // 内部 timeline 容器 hidden=false
    const timelineEl = container.querySelector('[id^="_r_"], [id]');
    const timelineDiv = container.querySelector(
      '[data-run-trace] > div:not([data-run-trace])',
    ) as HTMLElement | null;
    expect(timelineDiv).not.toBeNull();
    expect(timelineDiv!.hasAttribute('hidden')).toBe(false);
    // timeline <ol> 实际挂载
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('§8.1.5 默认折叠：仅 isStreaming=true && hasFinalText=true && errorCount=0 时折叠', () => {
    // Arrange
    const trace = vm({ status: 'done', errorCount: 0 });

    // Act
    const { container } = render(
      <RunTracePanel trace={trace} isStreaming={true} hasFinalText={true} />,
    );

    // Assert — 顶层摘要按钮 aria-expanded=false，timeline 隐藏
    expect(
      screen.getByRole('button', { expanded: false }),
    ).toBeInTheDocument();
    const timelineDiv = container.querySelector(
      '[data-run-trace] > div:not([data-run-trace])',
    ) as HTMLElement | null;
    expect(timelineDiv).not.toBeNull();
    expect(timelineDiv!.hasAttribute('hidden')).toBe(true);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('§8.1.6 userOverride：手动点折叠后，effect 不会自动拉回展开', async () => {
    // Arrange — 流中无 final 时默认展开
    const user = userEvent.setup();
    const trace = vm({ status: 'done' });
    const { rerender } = render(
      <RunTracePanel
        trace={trace}
        isStreaming={true}
        hasFinalText={false}
        resetKey="rk-1"
      />,
    );
    expect(
      screen.getByRole('button', { expanded: true }),
    ).toBeInTheDocument();

    // Act — 用户手动折叠
    await user.click(screen.getByRole('button', { expanded: true }));
    expect(
      screen.getByRole('button', { expanded: false }),
    ).toBeInTheDocument();

    // Act — rerender props 让 effect 再跑一次（hasFinalText 切换不会触发 default-expand）
    rerender(
      <RunTracePanel
        trace={trace}
        isStreaming={true}
        hasFinalText={true}
        resetKey="rk-1"
      />,
    );

    // Assert — 仍折叠（userOverride 阻断自动展开）
    expect(
      screen.getByRole('button', { expanded: false }),
    ).toBeInTheDocument();

    // Act — 变回 hasFinalText=false（应自动展开），但 userOverride 仍阻断
    rerender(
      <RunTracePanel
        trace={trace}
        isStreaming={true}
        hasFinalText={false}
        resetKey="rk-1"
      />,
    );

    // Assert — 仍保持折叠，effect 未把状态拉回
    expect(
      screen.getByRole('button', { expanded: false }),
    ).toBeInTheDocument();
  });

  it('§8.1.7 resetKey 变化：openStepIds / userOverride / expanded 被重置', async () => {
    // Arrange — 流中无 final 时默认展开，便于操作 step 详情
    const user = userEvent.setup();
    const trace = vm({
      steps: [
        tool({
          id: 'tc1',
          toolName: 'web_fetch',
          actionLabel: '获取网页',
          status: 'done',
          resultDetail: 'r1',
        }),
      ],
      toolCount: 1,
      completedCount: 1,
    });
    const { rerender } = render(
      <RunTracePanel
        trace={trace}
        isStreaming={true}
        hasFinalText={false}
        resetKey="msg-1"
      />,
    );

    const summaryBtn = () =>
      screen.getAllByRole('button').find((b) => b.hasAttribute('aria-controls'))!;

    // Act — 展开步骤详情：点工具行 button
    const stepBtn = screen.getByRole('button', { name: /查看 web_fetch 结果/ });
    await user.click(stepBtn);
    expect(stepBtn).toHaveAttribute('aria-expanded', 'true');

    // Act — 折叠顶层摘要（建立 userOverride）
    expect(summaryBtn()).toHaveAttribute('aria-expanded', 'true');
    await user.click(summaryBtn());
    expect(summaryBtn()).toHaveAttribute('aria-expanded', 'false');

    // Act — 切换 resetKey：rerender 时换 key → spec §4.3 effect 重置三个状态
    rerender(
      <RunTracePanel
        trace={trace}
        isStreaming={true}
        hasFinalText={false}
        resetKey="msg-2"
      />,
    );

    // Assert — 重置后：
    //   1) expanded 按新状态重算（isStreaming=true && !hasFinalText → 展开）
    expect(summaryBtn()).toHaveAttribute('aria-expanded', 'true');
    //   2) openStepIds 被清空 → 工具行 button 的 aria-expanded=false
    const stepBtnAfter = screen.getByRole('button', {
      name: /查看 web_fetch 结果/,
    });
    expect(stepBtnAfter).toHaveAttribute('aria-expanded', 'false');
  });
});
