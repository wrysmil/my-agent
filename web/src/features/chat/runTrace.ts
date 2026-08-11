/**
 * Run Trace 纯函数派生层。
 *
 * 将 ChatMessage.blocks 派生为可直接渲染的 RunTraceViewModel。
 * 契约：`.ai-runtime-artifacts/contracts/2026-08-10-contract-run-trace.md`
 */

import type { Block, BlockStatus, ChatMessage } from '@/features/chat/types';

// ============================================================
// Types（契约 §2）
// ============================================================

export interface ThinkingTraceStep {
  id: string;
  kind: 'thinking';
  status: BlockStatus;
  /** 行标题，如「思考已完成」「正在思考」 */
  label: string;
  /** 完整 reasoning；二次展开时显示 */
  detail?: string;
}

export interface ToolTraceStep {
  id: string;
  kind: 'tool';
  status: BlockStatus;
  /** 原始工具名，如 web_fetch */
  toolName: string;
  /** 用户可读动作，如「获取网页」；未知工具回落为 toolName */
  actionLabel: string;
  /** 参数安全摘要（已截断），如查询词或域名 */
  inputPreview?: string;
  /** 结果摘要（已截断），如「11 个结果」或首行内容 */
  resultPreview?: string;
  /** 完整结果文本；二次展开时显示 */
  resultDetail?: string;
  durationMs?: number;
  isError: boolean;
}

export type TraceStep = ThinkingTraceStep | ToolTraceStep;

export type RunTraceStatus = 'running' | 'done' | 'error' | 'aborted';

export interface RunTraceViewModel {
  steps: TraceStep[];
  toolCount: number;
  completedCount: number;
  errorCount: number;
  /** 折叠态摘要行文案，见契约 §4 */
  summaryLabel: string;
  status: RunTraceStatus;
}

export interface BuildRunTraceOptions {
  /** 由 MessageList 下传，标识该消息是否为当前流式消息 */
  isStreaming: boolean;
  /** ChatMessage.streamState，用于运行中文案 */
  streamState?: ChatMessage['streamState'];
  /** ChatStatus 为 aborted 时置 true */
  aborted?: boolean;
}

// ============================================================
// 工具名映射与格式化（契约 §5）
// ============================================================

const TOOL_ACTION_LABELS: Record<string, string> = {
  web_search: '搜索网页',
  web_fetch: '获取网页',
};

export function toolActionLabel(toolName: string): string {
  return TOOL_ACTION_LABELS[toolName] ?? toolName;
}

/** 迁移自 ToolResultBlock.tsx:12-17 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** 迁移自 ToolCallBlock.tsx:11-23；空结果返回 undefined */
export function formatInputPreview(
  input?: Record<string, unknown>,
  inputRaw?: string,
): string | undefined {
  if (input && Object.keys(input).length > 0) {
    const entries = Object.entries(input).slice(0, 3);
    return entries
      .map(([k, v]) => {
        const raw =
          typeof v === 'string' ? v : JSON.stringify(v);
        const val = raw.length > 60 ? raw.slice(0, 60) + '…' : raw;
        return `${k}: ${val}`;
      })
      .join(', ');
  }
  if (inputRaw) {
    return inputRaw.length > 80 ? inputRaw.slice(0, 80) + '…' : inputRaw;
  }
  return undefined;
}

/** 迁移自 ToolResultBlock.tsx:25-28 */
function formatResultPreview(content: string): string {
  return content.replace(/\s+/g, ' ').trim().slice(0, 160);
}

function thinkingLabel(status: BlockStatus): string {
  if (status === 'streaming' || status === 'pending') return '正在思考';
  if (status === 'error') return '思考失败';
  return '思考已完成';
}

// ============================================================
// buildRunTrace / hasTraceSteps（契约 §3 / §4）
// ============================================================

export function buildRunTrace(
  blocks: Block[],
  options: BuildRunTraceOptions,
): RunTraceViewModel {
  const steps: TraceStep[] = [];
  const toolIndex = new Map<string, number>();

  for (const block of blocks) {
    if (block.type === 'text') continue;

    if (block.type === 'thinking') {
      steps.push({
        id: block.id,
        kind: 'thinking',
        status: block.status,
        label: thinkingLabel(block.status),
        detail: block.thinking || undefined,
      });
      continue;
    }

    if (block.type === 'tool_call') {
      const step: ToolTraceStep = {
        id: block.id,
        kind: 'tool',
        status: block.status,
        toolName: block.toolName,
        actionLabel: toolActionLabel(block.toolName),
        inputPreview: formatInputPreview(block.input, block.inputRaw),
        isError: block.status === 'error',
      };
      toolIndex.set(block.toolId, steps.length);
      steps.push(step);
      continue;
    }

    if (block.type === 'tool_result') {
      const existingIdx = toolIndex.get(block.toolCallId);
      const preview = block.content ? formatResultPreview(block.content) : undefined;
      const detail = block.content || undefined;

      if (existingIdx !== undefined) {
        const existing = steps[existingIdx];
        if (existing.kind === 'tool') {
          existing.status = block.status;
          existing.isError = block.isError;
          existing.durationMs = block.durationMs;
          existing.resultPreview = preview;
          existing.resultDetail = detail;
          if (block.toolName) {
            existing.toolName = block.toolName;
            existing.actionLabel = toolActionLabel(block.toolName);
          }
        }
      } else {
        const step: ToolTraceStep = {
          id: block.id,
          kind: 'tool',
          status: block.status,
          toolName: block.toolName,
          actionLabel: toolActionLabel(block.toolName),
          resultPreview: preview,
          resultDetail: detail,
          durationMs: block.durationMs,
          isError: block.isError,
        };
        steps.push(step);
      }
    }
  }

  const toolCount = steps.filter((s) => s.kind === 'tool').length;
  const completedCount = steps.filter((s) => s.status === 'done').length;
  const errorCount = steps.filter((s) =>
    s.kind === 'tool' ? s.isError || s.status === 'error' : s.status === 'error',
  ).length;

  const summaryLabel = buildSummaryLabel(steps, options, toolCount, errorCount);
  const status = resolveStatus(options, errorCount);

  return {
    steps,
    toolCount,
    completedCount,
    errorCount,
    summaryLabel,
    status,
  };
}

function buildSummaryLabel(
  steps: TraceStep[],
  options: BuildRunTraceOptions,
  toolCount: number,
  errorCount: number,
): string {
  const { isStreaming, streamState, aborted } = options;

  if (isStreaming && streamState === 'thinking') {
    return '正在思考';
  }

  if (isStreaming) {
    const streamingTool = [...steps]
      .reverse()
      .find((s): s is ToolTraceStep => s.kind === 'tool' && s.status === 'streaming');
    if (streamingTool) {
      return `正在执行 ${streamingTool.actionLabel}`;
    }
  }

  if (isStreaming && streamState === 'generating') {
    return '正在整理回答';
  }

  if (isStreaming && steps.length === 0) {
    return '正在准备';
  }

  // streamState=tool_executing：取最后一个工具步骤，不要求 status===streaming
  if (isStreaming && streamState === 'tool_executing') {
    const lastTool = [...steps].reverse().find((s): s is ToolTraceStep => s.kind === 'tool');
    if (lastTool) {
      return `正在执行 ${lastTool.actionLabel}`;
    }
    return '正在思考';
  }

  // isStreaming 回落：禁止流式中出现「已完成…」
  if (isStreaming) {
    const last = steps[steps.length - 1];
    if (last?.kind === 'tool') {
      return `正在执行 ${last.actionLabel}`;
    }
    return '正在思考';
  }

  if (aborted) {
    return `已停止 · 保留 ${steps.length} 个步骤`;
  }

  if (errorCount > 0) {
    return `完成，但有 ${errorCount} 个步骤失败`;
  }

  return `已完成 ${steps.length} 个步骤 · ${toolCount} 个工具`;
}

function resolveStatus(options: BuildRunTraceOptions, errorCount: number): RunTraceStatus {
  if (options.isStreaming) return 'running';
  if (options.aborted) return 'aborted';
  if (errorCount > 0) return 'error';
  return 'done';
}

/** 无任何 trace step 时为 false，调用方据此完全不渲染面板 */
export function hasTraceSteps(vm: RunTraceViewModel): boolean {
  return vm.steps.length > 0;
}
