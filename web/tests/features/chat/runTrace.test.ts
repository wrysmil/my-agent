/**
 * runTrace 纯函数派生层单元测试（WU-01）。
 *
 * 覆盖：call/result 配对、孤儿 result、thinking 独立派生、text 过滤、
 * 契约 §4 摘要文案 7 分支、hasTraceSteps、工具名映射与格式化迁移。
 */

import { describe, it, expect } from 'vitest';
import type { Block, ThinkingBlock, ToolCallBlock, ToolResultBlock, TextBlock } from '@/features/chat/types';
import {
  buildRunTrace,
  hasTraceSteps,
  toolActionLabel,
  formatDuration,
  formatInputPreview,
  extractKeyParams,
  stripWorkerEnvelope,
  type KeyParam,
  type RunTraceViewModel,
} from '@/features/chat/runTrace';

function thinking(
  partial: Partial<ThinkingBlock> & Pick<ThinkingBlock, 'id' | 'thinking'>,
): ThinkingBlock {
  return {
    type: 'thinking',
    status: 'done',
    collapsed: true,
    ...partial,
  };
}

function toolCall(
  partial: Partial<ToolCallBlock> & Pick<ToolCallBlock, 'id' | 'toolId' | 'toolName'>,
): ToolCallBlock {
  return {
    type: 'tool_call',
    status: 'done',
    inputRaw: '',
    ...partial,
  };
}

function toolResult(
  partial: Partial<ToolResultBlock> & Pick<ToolResultBlock, 'id' | 'toolCallId' | 'toolName'>,
): ToolResultBlock {
  return {
    type: 'tool_result',
    status: 'done',
    content: '',
    isError: false,
    ...partial,
  };
}

function textBlock(partial: Partial<TextBlock> & Pick<TextBlock, 'id' | 'text'>): TextBlock {
  return {
    type: 'text',
    status: 'done',
    ...partial,
  };
}

describe('buildRunTrace', () => {
  describe('步骤派生', () => {
    it('[buildRunTrace] [将 call/result 合并为一步] [toolCallId 命中 toolId]', () => {
      // Arrange
      const blocks: Block[] = [
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_search',
          input: { query: '平潭岛' },
          status: 'done',
        }),
        toolResult({
          id: 'r1',
          toolCallId: 'call-1',
          toolName: 'web_search',
          content: 'result A\nline2',
          durationMs: 1200,
          status: 'done',
        }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: false });

      // Assert
      expect(vm.steps).toHaveLength(1);
      const step = vm.steps[0];
      expect(step.kind).toBe('tool');
      if (step.kind !== 'tool') return;
      expect(step.toolName).toBe('web_search');
      expect(step.actionLabel).toBe('搜索网页');
      expect(step.inputPreview).toBe('query: 平潭岛');
      expect(step.resultDetail).toBe('result A\nline2');
      expect(step.resultPreview).toBe('result A line2');
      expect(step.durationMs).toBe(1200);
      expect(step.isError).toBe(false);
      expect(step.status).toBe('done');
      expect(vm.toolCount).toBe(1);
      expect(vm.completedCount).toBe(1);
      expect(vm.errorCount).toBe(0);
    });

    it('[buildRunTrace] [孤儿 result 仍单独成步] [toolCallId 未命中]', () => {
      // Arrange
      const blocks: Block[] = [
        toolResult({
          id: 'orphan',
          toolCallId: 'missing-call',
          toolName: 'web_fetch',
          content: 'orphan body',
          isError: false,
          status: 'done',
        }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: false });

      // Assert
      expect(vm.steps).toHaveLength(1);
      const step = vm.steps[0];
      expect(step.kind).toBe('tool');
      if (step.kind !== 'tool') return;
      expect(step.id).toBe('orphan');
      expect(step.toolName).toBe('web_fetch');
      expect(step.actionLabel).toBe('获取网页');
      expect(step.resultPreview).toBe('orphan body');
      expect(step.resultDetail).toBe('orphan body');
      expect(vm.toolCount).toBe(1);
    });

    it('[buildRunTrace] [连续 thinking 分别派生且字段不串联] [连续三个 thinking]', () => {
      // Arrange
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'first', status: 'done' }),
        thinking({ id: 't2', thinking: 'second', status: 'done' }),
        thinking({ id: 't3', thinking: 'third', status: 'streaming' }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: true, streamState: 'thinking' });

      // Assert
      expect(vm.steps).toHaveLength(3);
      expect(vm.steps).toEqual([
        {
          id: 't1',
          kind: 'thinking',
          status: 'done',
          label: '思考已完成',
          detail: 'first',
        },
        {
          id: 't2',
          kind: 'thinking',
          status: 'done',
          label: '思考已完成',
          detail: 'second',
        },
        {
          id: 't3',
          kind: 'thinking',
          status: 'streaming',
          label: '正在思考',
          detail: 'third',
        },
      ]);
    });

    it('[buildRunTrace] [工具两侧 thinking 仍分别派生] [thinking-tool-thinking]', () => {
      // Arrange
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'before', status: 'done' }),
        toolCall({ id: 'c1', toolId: 'call-1', toolName: 'web_search', status: 'done' }),
        toolResult({
          id: 'r1',
          toolCallId: 'call-1',
          toolName: 'web_search',
          content: 'ok',
          status: 'done',
        }),
        thinking({ id: 't2', thinking: 'after', status: 'done' }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: false });

      // Assert
      expect(vm.steps).toHaveLength(3);
      expect(vm.steps[0].kind).toBe('thinking');
      expect(vm.steps[1].kind).toBe('tool');
      expect(vm.steps[2].kind).toBe('thinking');
      if (vm.steps[0].kind === 'thinking') {
        expect(vm.steps[0].detail).toBe('before');
        expect(vm.steps[0].label).toBe('思考已完成');
      }
      if (vm.steps[2].kind === 'thinking') {
        expect(vm.steps[2].detail).toBe('after');
      }
    });

    it('[buildRunTrace] [text block 不进入 steps] [含 text 与 thinking]', () => {
      // Arrange
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'reason', status: 'done' }),
        textBlock({ id: 'txt', text: '最终回答' }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: false });

      // Assert
      expect(vm.steps).toHaveLength(1);
      expect(vm.steps[0].kind).toBe('thinking');
      expect(vm.steps.every((s) => s.kind !== 'thinking' || s.detail !== '最终回答')).toBe(true);
    });
  });

  describe('摘要文案（契约 §4）', () => {
    it('[buildRunTrace] [summaryLabel 为 正在思考] [isStreaming 且 streamState=thinking]', () => {
      const blocks: Block[] = [thinking({ id: 't1', thinking: 'x', status: 'streaming' })];
      const vm = buildRunTrace(blocks, { isStreaming: true, streamState: 'thinking' });
      expect(vm.summaryLabel).toBe('正在思考');
      expect(vm.status).toBe('running');
    });

    it('[buildRunTrace] [summaryLabel 为 正在执行 actionLabel] [存在 streaming 工具步骤]', () => {
      const blocks: Block[] = [
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_fetch',
          status: 'streaming',
        }),
      ];
      const vm = buildRunTrace(blocks, { isStreaming: true, streamState: 'tool_executing' });
      expect(vm.summaryLabel).toBe('正在执行 获取网页');
      expect(vm.status).toBe('running');
    });

    it('[buildRunTrace] [summaryLabel 为 正在整理回答] [isStreaming 且 streamState=generating]', () => {
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'done reason', status: 'done' }),
        textBlock({ id: 'txt', text: 'partial' }),
      ];
      const vm = buildRunTrace(blocks, { isStreaming: true, streamState: 'generating' });
      expect(vm.summaryLabel).toBe('正在整理回答');
      expect(vm.status).toBe('running');
    });

    it('[buildRunTrace] [summaryLabel 为 正在准备] [isStreaming 且无 step]', () => {
      const vm = buildRunTrace([], { isStreaming: true });
      expect(vm.summaryLabel).toBe('正在准备');
      expect(vm.status).toBe('running');
      expect(vm.steps).toHaveLength(0);
    });

    it('[buildRunTrace] [summaryLabel 回落为正在执行] [isStreaming 且 streamState 未定义且末步工具已 done]', () => {
      // Arrange：tool_call 已 done、尚无 tool_result，无 streaming 工具步
      const blocks: Block[] = [
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_search',
          status: 'done',
        }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: true });

      // Assert
      expect(vm.status).toBe('running');
      expect(vm.summaryLabel).toBe('正在执行 搜索网页');
      expect(vm.summaryLabel).not.toContain('已完成');
    });

    it('[buildRunTrace] [summaryLabel 为正在执行] [streamState=tool_executing 且工具 status=done]', () => {
      // Arrange
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'plan', status: 'done' }),
        toolCall({
          id: 'c1',
          toolId: 'call-1',
          toolName: 'web_fetch',
          status: 'done',
        }),
      ];

      // Act
      const vm = buildRunTrace(blocks, {
        isStreaming: true,
        streamState: 'tool_executing',
      });

      // Assert：不要求工具 status===streaming，取最后一个工具步骤的 actionLabel
      expect(vm.status).toBe('running');
      expect(vm.summaryLabel).toBe('正在执行 获取网页');
      expect(vm.summaryLabel).not.toContain('已完成');
    });

    it('[buildRunTrace] [summaryLabel 回落为正在思考] [isStreaming 且 streamState 未定义且末步为 thinking]', () => {
      // Arrange：仅有已完成的 thinking，无 streaming 工具
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'reason', status: 'done' }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: true });

      // Assert
      expect(vm.status).toBe('running');
      expect(vm.summaryLabel).toBe('正在思考');
      expect(vm.summaryLabel).not.toContain('已完成');
    });

    it('[buildRunTrace] [summaryLabel 为已停止文案] [aborted]', () => {
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'a', status: 'done' }),
        toolCall({ id: 'c1', toolId: 'call-1', toolName: 'web_search', status: 'done' }),
      ];
      const vm = buildRunTrace(blocks, { isStreaming: false, aborted: true });
      expect(vm.summaryLabel).toBe('已停止 · 保留 2 个步骤');
      expect(vm.status).toBe('aborted');
    });

    it('[buildRunTrace] [summaryLabel 为失败文案] [errorCount > 0]', () => {
      const blocks: Block[] = [
        toolCall({ id: 'c1', toolId: 'call-1', toolName: 'web_search', status: 'done' }),
        toolResult({
          id: 'r1',
          toolCallId: 'call-1',
          toolName: 'web_search',
          content: 'boom',
          isError: true,
          status: 'error',
        }),
      ];
      const vm = buildRunTrace(blocks, { isStreaming: false });
      expect(vm.errorCount).toBe(1);
      expect(vm.summaryLabel).toBe('完成，但有 1 个步骤失败');
      expect(vm.status).toBe('error');
    });

    it('[buildRunTrace] [summaryLabel 为已完成文案] [非流式无错误]', () => {
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'a', status: 'done' }),
        toolCall({ id: 'c1', toolId: 'call-1', toolName: 'web_search', status: 'done' }),
        toolResult({
          id: 'r1',
          toolCallId: 'call-1',
          toolName: 'web_search',
          content: 'ok',
          status: 'done',
        }),
        thinking({ id: 't2', thinking: 'b', status: 'done' }),
      ];
      const vm = buildRunTrace(blocks, { isStreaming: false });
      expect(vm.summaryLabel).toBe('已完成 3 个步骤 · 1 个工具');
      expect(vm.status).toBe('done');
      expect(vm.toolCount).toBe(1);
      expect(vm.steps).toHaveLength(3);
    });
  });
});

describe('hasTraceSteps', () => {
  it('[hasTraceSteps] [返回 false] [空 steps]', () => {
    const vm: RunTraceViewModel = {
      steps: [],
      toolCount: 0,
      completedCount: 0,
      errorCount: 0,
      summaryLabel: '正在准备',
      status: 'running',
    };
    expect(hasTraceSteps(vm)).toBe(false);
  });

  it('[hasTraceSteps] [返回 true] [存在 steps]', () => {
    const vm = buildRunTrace(
      [thinking({ id: 't1', thinking: 'x', status: 'done' })],
      { isStreaming: false },
    );
    expect(hasTraceSteps(vm)).toBe(true);
  });
});

describe('toolActionLabel / formatDuration / formatInputPreview', () => {
  it('[toolActionLabel] [映射为中文动作] [web_search / web_fetch]', () => {
    expect(toolActionLabel('web_search')).toBe('搜索网页');
    expect(toolActionLabel('web_fetch')).toBe('获取网页');
  });

  it('[toolActionLabel] [回落原名] [未知工具]', () => {
    expect(toolActionLabel('run_python')).toBe('run_python');
  });

  it('[toolActionLabel] [子 Agent 工具映射中文] [run_worker / dispatch_to / hand_off_to]', () => {
    expect(toolActionLabel('run_worker')).toBe('派生子 Agent');
    expect(toolActionLabel('dispatch_to')).toBe('派发子 Agent');
    expect(toolActionLabel('hand_off_to')).toBe('移交子 Agent');
  });

  it('[formatDuration] [按阈值格式化] [ms / s / m]', () => {
    expect(formatDuration(350)).toBe('350ms');
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(65000)).toBe('1m 5s');
  });

  it('[formatInputPreview] [最多 3 项且字符串 60 截断] [input 对象]', () => {
    const long = 'a'.repeat(70);
    const preview = formatInputPreview({
      a: '1',
      b: '2',
      c: '3',
      d: '4',
      long,
    });
    expect(preview).toBe(`a: 1, b: 2, c: 3`);
    expect(formatInputPreview({ q: long })).toBe(`q: ${'a'.repeat(60)}…`);
  });

  it('[formatInputPreview] [inputRaw 80 截断] [无 input 对象]', () => {
    const raw = 'x'.repeat(100);
    expect(formatInputPreview(undefined, raw)).toBe(`${'x'.repeat(80)}…`);
  });

  it('[formatInputPreview] [返回 undefined] [无 input 且无 inputRaw]', () => {
    expect(formatInputPreview(undefined, undefined)).toBeUndefined();
    expect(formatInputPreview(undefined, '')).toBeUndefined();
  });

  it('[buildRunTrace] [结果摘要压缩空白后取前 160 字符] [长 content]', () => {
    const content = `line1\n\n   line2  ${'z'.repeat(200)}`;
    const blocks: Block[] = [
      toolCall({ id: 'c1', toolId: 'call-1', toolName: 'web_fetch', status: 'done' }),
      toolResult({
        id: 'r1',
        toolCallId: 'call-1',
        toolName: 'web_fetch',
        content,
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    const step = vm.steps[0];
    expect(step.kind).toBe('tool');
    if (step.kind !== 'tool') return;
    const expected = content.replace(/\s+/g, ' ').trim().slice(0, 160);
    expect(step.resultPreview).toBe(expected);
    expect(step.resultPreview!.length).toBe(160);
    expect(step.resultDetail).toBe(content);
  });
});

describe('extractKeyParams / keyParams', () => {
  it('[extractKeyParams] [空 input 返回空数组]', () => {
    expect(extractKeyParams(undefined)).toEqual([]);
    expect(extractKeyParams({})).toEqual([]);
  });

  it('[extractKeyParams] [5 个 key 按 url>filePath>query>command>path 顺序且封顶 2]', () => {
    const out = extractKeyParams({
      url: 'https://example.com/abc',
      filePath: '/tmp/data.json',
      query: '平潭岛',
      command: 'ls -la',
      path: '/etc/conf',
    });
    expect(out).toHaveLength(2);
    expect(out.map((k: KeyParam) => k.key)).toEqual(['url', 'filePath']);
    expect(out[0]?.fullValue).toBe('https://example.com/abc');
    expect(out[1]?.fullValue).toBe('/tmp/data.json');
  });

  it('[extractKeyParams] [非字符串值 JSON.stringify 写入 fullValue 且 value 取其截断]', () => {
    const out = extractKeyParams({ url: { a: 1 } });
    expect(out).toHaveLength(1);
    expect(out[0]?.key).toBe('url');
    expect(out[0]?.fullValue).toBe('{"a":1}');
    expect(typeof out[0]?.value).toBe('string');
  });

  it('[extractKeyParams] [截断规则:url 取 host+path(path 24)、filePath/path 取 basename(32)、query/command 取 40]', () => {
    const longPath = '/' + 'a'.repeat(40) + '/inner';
    const longFile = '/very/deep/dir/' + 'x'.repeat(40) + '.json';
    const longQuery = 'q'.repeat(60);
    const longCmd = 'c'.repeat(60);
    const out = extractKeyParams({
      url: `https://example.com${longPath}`,
      filePath: longFile,
      query: longQuery,
      command: longCmd,
      path: longFile,
    });
    const urlP = out.find((k) => k.key === 'url');
    const fileP = out.find((k) => k.key === 'filePath');
    // url: hostname + pathname 前 24 字符 + '…'
    expect(urlP?.value.startsWith('example.com')).toBe(true);
    expect(urlP?.value.endsWith('…')).toBe(true);
    expect(urlP?.value.length).toBeLessThanOrEqual('example.com'.length + 25);
    // filePath: 取最后一段，超过 32 截断
    expect(fileP?.value.endsWith('…')).toBe(true);
    expect(fileP?.value.length).toBeLessThanOrEqual(33);
  });

  it('[extractKeyParams] [非 URL 字符串按 40 截断回落]', () => {
    const junk = 'not a url :: ' + 'z'.repeat(50);
    const out = extractKeyParams({ url: junk });
    expect(out).toHaveLength(1);
    expect(out[0]?.value).toBe(junk.slice(0, 40) + '…');
    expect(out[0]?.fullValue).toBe(junk);
  });

  it('[buildRunTrace] [tool_call 段带 keyParams 且跳过空值] [同时存在 url+query]', () => {
    const blocks: Block[] = [
      toolCall({
        id: 'c1',
        toolId: 'call-1',
        toolName: 'web_search',
        input: { url: 'https://example.com/foo/bar', query: '平潭岛' },
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    const step = vm.steps[0];
    expect(step.kind).toBe('tool');
    if (step.kind !== 'tool') return;
    expect(step.keyParams).toBeDefined();
    expect(step.keyParams).toHaveLength(2);
    expect(step.keyParams![0]?.key).toBe('url');
    expect(step.keyParams![0]?.fullValue).toBe('https://example.com/foo/bar');
    expect(step.keyParams![1]?.key).toBe('query');
    // inputPreview 仍保留（fallback 语义）
    expect(step.inputPreview).toBeDefined();
  });
});

describe('stripWorkerEnvelope（WU-03）', () => {
  it('[stripWorkerEnvelope] [剥离成功信封] [<worker-result> 标签 + 内部文本]', () => {
    const payload = '<worker-result from="coder">\nhello world\n</worker-result>';
    expect(stripWorkerEnvelope(payload)).toBe('hello world');
  });

  it('[stripWorkerEnvelope] [剥离错误信封] [<worker-error aborted> 标签]', () => {
    const payload =
      '<worker-error from="coder" aborted="true">\nWorker aborted.\n</worker-error>';
    expect(stripWorkerEnvelope(payload)).toBe('Worker aborted.');
  });

  it('[stripWorkerEnvelope] [XML 实体反转义] [&lt;/&gt;/&quot;/&apos; 解码且 &amp; 最后替换]', () => {
    const payload =
      '<worker-result from="coder">\n&lt;div&gt; &quot;q&quot; &apos;a&apos; &amp;amp; &amp;lt;x&amp;gt;\n</worker-result>';
    // 单遍反转义：简单实体解码为原文；&amp;amp; → &amp;；&amp;lt;x&amp;gt; → &lt;x&gt;
    // （若 &amp; 先于 &lt; 替换，&amp;lt; 会被二次解码成 <，即错误语义）
    expect(stripWorkerEnvelope(payload)).toBe(
      '<div> "q" \'a\' &amp; &lt;x&gt;',
    );
  });

  it('[stripWorkerEnvelope] [非信封原样返回] [普通文本]', () => {
    const plain = 'no envelope here';
    expect(stripWorkerEnvelope(plain)).toBe(plain);
  });

  it('[stripWorkerEnvelope] [空字符串返回空] [无内容]', () => {
    expect(stripWorkerEnvelope('')).toBe('');
  });
});

describe('buildRunTrace actor / dispatch 简短确认（WU-03）', () => {
  // 新契约：调度工具（run_worker / dispatch_to / hand_off_to）本身不入 trace。
  // 子 Agent 内部步骤（思考 / stat_file 等）会带 actorName 进入 trace。
  // 下面三个测试覆盖「调度工具本尊不进 trace」。
  it('[buildRunTrace] [run_worker 不进 trace] [整段被过滤]', () => {
    const blocks: Block[] = [
      toolCall({
        id: 'c1',
        toolId: 'call-1',
        toolName: 'run_worker',
        actorName: 'coder',
        actorKind: 'agent',
        status: 'done',
      }),
      toolResult({
        id: 'r1',
        toolCallId: 'call-1',
        toolName: 'run_worker',
        content: '<worker-result from="coder">\nok\n</worker-result>',
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    expect(vm.steps).toHaveLength(0);
  });

  it('[buildRunTrace] [dispatch_to 不进 trace] [整段被过滤]', () => {
    const blocks: Block[] = [
      toolCall({ id: 'c1', toolId: 'call-1', toolName: 'dispatch_to', status: 'done' }),
      toolResult({
        id: 'r1',
        toolCallId: 'call-1',
        toolName: 'dispatch_to',
        content: 'some long body',
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    expect(vm.steps).toHaveLength(0);
  });

  it('[buildRunTrace] [hand_off_to 不进 trace] [整段被过滤]', () => {
    const blocks: Block[] = [
      toolCall({ id: 'c1', toolId: 'call-1', toolName: 'hand_off_to', status: 'done' }),
      toolResult({
        id: 'r1',
        toolCallId: 'call-1',
        toolName: 'hand_off_to',
        content: 'some hand off content',
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    expect(vm.steps).toHaveLength(0);
  });

  // 子 Agent 内部步骤（例如 stat_file、write_file）会带 actorName 进入 trace，
  // 即使外层是 run_worker / dispatch_to 派发出来的。
  it('[buildRunTrace] [调度工具被过滤但子 Agent 内部步骤保留] [混合 blocks]', () => {
    const blocks: Block[] = [
      toolCall({
        id: 'outer',
        toolId: 'call-outer',
        toolName: 'dispatch_to',
        status: 'done',
      }),
      toolCall({
        id: 'inner1',
        toolId: 'call-inner1',
        toolName: 'stat_file',
        actorName: 'coder',
        actorKind: 'agent',
        input: { path: 'foo.ts' },
        status: 'done',
      }),
      toolCall({
        id: 'inner2',
        toolId: 'call-inner2',
        toolName: 'read_file',
        actorName: 'coder',
        actorKind: 'agent',
        input: { path: 'bar.ts' },
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    expect(vm.steps).toHaveLength(2);
    const toolSteps = vm.steps.filter((s) => s.kind === 'tool');
    expect(toolSteps).toHaveLength(2);
    for (const step of toolSteps) {
      if (step.kind !== 'tool') continue;
      expect(step.actorName).toBe('coder');
      expect(step.actorKind).toBe('agent');
    }
  });

  // 真实场景回归：JSONL history 回放时，tool_result row 的 content blocks
  // 不带 name 字段（parseHistoryBlocks 用 cb.name ?? ''），但 tool_use 行带。
  // 派生时必须通过 toolCallId 反查父 tool_call 才能识别 dispatch 工具，
  // 否则会推一个 toolName=''、actionLabel=''、meta='已完成' 的孤儿 step，
  // 并把整段 XML 信封正文作为 resultDetail 展开（用户截图 §「已完成」回归）。
  it('[buildRunTrace] [dispatch_to history 路径] [tool_result toolName 缺，靠 toolCallId 反查]', () => {
    const blocks: Block[] = [
      toolCall({ id: 'c1', toolId: 'call-1', toolName: 'dispatch_to', status: 'done' }),
      toolResult({
        id: 'r1',
        toolCallId: 'call-1',
        toolName: '', // history 路径常见：JSONL tool_result 没有 name
        content:
          '## 💬 Coder 说：\n\n<worker-result from="Coder">\n完整 coder 输出\n</worker-result>',
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    expect(vm.steps).toHaveLength(0);
  });

  it('[buildRunTrace] [run_worker history 路径] [tool_result toolName 缺，靠 toolCallId 反查]', () => {
    const blocks: Block[] = [
      toolCall({ id: 'c1', toolId: 'call-1', toolName: 'run_worker', status: 'done' }),
      toolResult({
        id: 'r1',
        toolCallId: 'call-1',
        toolName: '',
        content: '<worker-result from="coder">\nok\n</worker-result>',
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    expect(vm.steps).toHaveLength(0);
  });

  it('[buildRunTrace] [history 路径混合] [dispatch_to 被过滤 + 子 Agent stat_file 保留]', () => {
    const blocks: Block[] = [
      toolCall({ id: 'outer', toolId: 'call-outer', toolName: 'dispatch_to', status: 'done' }),
      toolResult({
        id: 'outer-r',
        toolCallId: 'call-outer',
        toolName: '',
        content: '## 💬 Coder 说：\n<worker-result from="Coder">\n...\n</worker-result>',
        status: 'done',
      }),
      toolCall({
        id: 'inner1',
        toolId: 'call-inner1',
        toolName: 'stat_file',
        actorName: 'coder',
        actorKind: 'agent',
        input: { path: 'foo.ts' },
        status: 'done',
      }),
    ];
    const vm = buildRunTrace(blocks, { isStreaming: false });
    // dispatch_to 的 tool_call + tool_result 都应被过滤，只剩 stat_file
    expect(vm.steps).toHaveLength(1);
    const toolStep = vm.steps[0];
    expect(toolStep.kind).toBe('tool');
    if (toolStep.kind !== 'tool') return;
    expect(toolStep.toolName).toBe('stat_file');
    expect(toolStep.actorName).toBe('coder');
  });
});
