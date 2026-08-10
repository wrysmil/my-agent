/**
 * runTrace 纯函数派生层单元测试（WU-01）。
 *
 * 覆盖：call/result 配对、孤儿 result、thinking 合并、text 过滤、
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

    it('[buildRunTrace] [合并相邻 thinking 并累加 mergedCount] [连续 thinking]', () => {
      // Arrange
      const blocks: Block[] = [
        thinking({ id: 't1', thinking: 'first', status: 'done' }),
        thinking({ id: 't2', thinking: 'second', status: 'done' }),
        thinking({ id: 't3', thinking: 'third', status: 'streaming' }),
      ];

      // Act
      const vm = buildRunTrace(blocks, { isStreaming: true, streamState: 'thinking' });

      // Assert
      expect(vm.steps).toHaveLength(1);
      const step = vm.steps[0];
      expect(step.kind).toBe('thinking');
      if (step.kind !== 'thinking') return;
      expect(step.mergedCount).toBe(3);
      expect(step.detail).toBe('first\nsecond\nthird');
      expect(step.status).toBe('streaming');
      expect(step.label).toBe('正在思考');
    });

    it('[buildRunTrace] [被工具隔开的 thinking 不合并] [thinking-tool-thinking]', () => {
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
        expect(vm.steps[0].mergedCount).toBe(1);
        expect(vm.steps[0].detail).toBe('before');
        expect(vm.steps[0].label).toBe('思考已完成');
      }
      if (vm.steps[2].kind === 'thinking') {
        expect(vm.steps[2].mergedCount).toBe(1);
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
