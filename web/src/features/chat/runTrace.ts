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
  /** 关键参数 pill 渲染数据；按 KEY_PARAM_ORDER 顺序取前 KEY_PARAM_MAX 项 */
  keyParams?: KeyParam[];
  durationMs?: number;
  isError: boolean;
  /** 执行该工具的子 Agent 身份（WU-03；tool_call 优先，tool_result 兜底） */
  actorName?: string;
  actorKind?: string;
}

/** 关键参数 pill 数据；value 为渲染短文本，fullValue 用于 title 提示 */
export interface KeyParam {
  key: 'url' | 'filePath' | 'query' | 'command' | 'path';
  value: string;
  fullValue: string;
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
  list_files: '列出文件',
  search_files: '搜索文件',
  read_file: '读取文件',
  grep_files: '搜索内容',
  write_file: '写入文件',
  edit_file: '编辑文件',
  bash: '执行命令',
  ask_user_question: '询问用户',
  run_worker: '派生子 Agent',
  dispatch_to: '派发子 Agent',
  hand_off_to: '移交子 Agent',
};

/**
 * 调度工具名集合 —— 这些工具本身不进入 trace 派生（它们是「派发动作」，
 * 真正的子 Agent 内部步骤会带自己的 actorName 进入 trace）。
 *
 * 仍然保留在 TOOL_ACTION_LABELS 里是为了历史路径下的回放降级（如果未来
 * 暂态打开让调度工具可见，仍有可读名）。
 */
const DISPATCH_TOOL_NAMES: ReadonlySet<string> = new Set([
  'run_worker',
  'dispatch_to',
  'hand_off_to',
]);

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

// ============================================================
// worker XML 信封剥离（WU-03 §4.4；与后端 unwrapWorkerPayload 语义等价）
// ============================================================

const WORKER_RESULT_RE = /<worker-result[^>]*>([\s\S]*?)<\/worker-result>/;
const WORKER_ERROR_RE = /<worker-error[^>]*>([\s\S]*?)<\/worker-error>/;

/**
 * 从 `<worker-result>` / `<worker-error>` XML 信封中取出纯文本并反转义 XML 实体。
 * 未命中信封时原样返回。
 */
export function stripWorkerEnvelope(text: string): string {
  const match = WORKER_RESULT_RE.exec(text) ?? WORKER_ERROR_RE.exec(text);
  if (!match) return text;
  return unescapeXml(match[1].trim());
}

/** 反转义 XML 实体。`&amp;` 必须最后替换，避免 `&amp;lt;` 被二次错误解码。 */
function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
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
  /**
   * 调度工具的 toolCallId 集合 —— 第一遍扫描 tool_call 时记录。
   * toolCallId 可能来自 JSONL history（tool_result 的 toolName 字段缺失，
   * 不能仅靠 block.toolName 判断），所以提前索引更可靠。
   */
  const dispatchToolCallIds = new Set<string>();

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
      // 调度工具本尊不入 trace —— 它们是「派发动作」而不是「结果展示」，
      // 用户在 trace 里看到的是子 Agent 内部的步骤（思考 / stat_file 等），
      // 而不是「派发子 Agent」这一行。
      if (DISPATCH_TOOL_NAMES.has(block.toolName)) {
        if (block.toolId) dispatchToolCallIds.add(block.toolId);
        continue;
      }
      const step: ToolTraceStep = {
        id: block.id,
        kind: 'tool',
        status: block.status,
        toolName: block.toolName,
        actionLabel: toolActionLabel(block.toolName),
        inputPreview: formatInputPreview(block.input, block.inputRaw),
        keyParams: extractKeyParams(block.input),
        isError: block.status === 'error',
        ...(block.actorName !== undefined ? { actorName: block.actorName } : {}),
        ...(block.actorKind !== undefined ? { actorKind: block.actorKind } : {}),
      };
      toolIndex.set(block.toolId, steps.length);
      steps.push(step);
      continue;
    }

    if (block.type === 'tool_result') {
      // 任何满足以下条件之一都跳过：
      //   1. block.toolName 本身就是 dispatch（流式 SSE 路径，tool_result 自带 toolName）
      //   2. 对应 tool_use 已被识别为 dispatch（history 路径兜底，tool_result 的
      //      toolName 字段常常缺失，但能通过 toolCallId 反查到 tool_use）
      if (
        DISPATCH_TOOL_NAMES.has(block.toolName) ||
        (block.toolCallId !== undefined &&
          dispatchToolCallIds.has(block.toolCallId))
      ) {
        continue;
      }
      const existingIdx = toolIndex.get(block.toolCallId);
      const preview = block.content ? formatResultPreview(block.content) : undefined;
      const detail = block.content || '';

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
          // tool_call 优先，tool_result 兜底
          if (block.actorName !== undefined && existing.actorName === undefined) {
            existing.actorName = block.actorName;
          }
          if (block.actorKind !== undefined && existing.actorKind === undefined) {
            existing.actorKind = block.actorKind;
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
          ...(block.actorName !== undefined ? { actorName: block.actorName } : {}),
          ...(block.actorKind !== undefined ? { actorKind: block.actorKind } : {}),
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

// ============================================================
// KeyParam 提取（spec §5）
// ============================================================

const KEY_PARAM_ORDER = ['url', 'filePath', 'query', 'command', 'path'] as const;
const KEY_PARAM_MAX = 2;

/** 从 input 中按固定顺序抽取关键参数，最多 KEY_PARAM_MAX 项；非字符串值 JSON.stringify 入 fullValue */
export function extractKeyParams(input?: Record<string, unknown>): KeyParam[] {
  if (!input) return [];
  const out: KeyParam[] = [];
  for (const key of KEY_PARAM_ORDER) {
    const raw = input[key];
    if (raw == null) continue;
    const full = typeof raw === 'string' ? raw : JSON.stringify(raw);
    out.push({ key, value: shortenKeyParam(key, full), fullValue: full });
    if (out.length >= KEY_PARAM_MAX) break;
  }
  return out;
}

function shortenKeyParam(key: KeyParam['key'], full: string): string {
  if (key === 'url') {
    try {
      const u = new URL(full);
      const path = u.pathname.length > 24 ? u.pathname.slice(0, 24) + '…' : u.pathname;
      return `${u.hostname}${path}`;
    } catch {
      return full.length > 40 ? full.slice(0, 40) + '…' : full;
    }
  }
  if (key === 'filePath' || key === 'path') {
    const parts = full.split(/[\\/]/);
    const last = parts[parts.length - 1] || full;
    return last.length > 32 ? last.slice(0, 32) + '…' : last;
  }
  // query / command
  return full.length > 40 ? full.slice(0, 40) + '…' : full;
}
