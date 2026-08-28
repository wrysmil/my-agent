/**
 * ProgressIndicator — 流式进度反馈组件。
 *
 * 设计：
 * - 工具执行动画（转圈 + 工具名）
 * - thinking 波浪效果
 * - Token 流绿色闪烁光标
 *
 * 用法：
 * ```tsx
 * <ProgressIndicator
 *   type="tool"
 *   toolName="ReadFile"
 *   progress={50}
 * />
 *
 * <ProgressIndicator type="thinking" />
 *
 * <ProgressIndicator type="token" />
 * ```
 */

import { Loader2 } from 'lucide-react';

export type ProgressType = 'tool' | 'thinking' | 'token';

export interface ProgressIndicatorProps {
  /** 进度类型 */
  type: ProgressType;
  /** 工具名称（type=tool 时） */
  toolName?: string;
  /** 进度百分比（type=tool 时） */
  progress?: number;
  className?: string;
}

// ─── Tool Progress ─────────────────────────────────────────────────────────────

function ToolProgress({
  toolName,
  progress,
  className = '',
}: {
  toolName?: string;
  progress?: number;
  className?: string;
}) {
  const displayProgress = progress ?? 0;
  const isComplete = displayProgress >= 100;

  return (
    <div
      className={`flex items-center gap-2.5 ${className}`}
      role="status"
      aria-live="polite"
      aria-label={isComplete ? '工具执行完成' : `执行中: ${toolName}`}
    >
      <Loader2
        size={14}
        className={`shrink-0 ${isComplete ? 'text-green-600' : 'animate-spin text-primary'}`}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs text-text-muted mb-1">
          <span className="truncate">{toolName ?? '执行中…'}</span>
          {progress !== undefined && (
            <span className="shrink-0 tabular-nums">{displayProgress}%</span>
          )}
        </div>
        <div className="h-1 rounded-full bg-surface-hover overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isComplete ? 'bg-green-500' : 'bg-primary'
            }`}
            style={{ width: `${Math.min(100, displayProgress)}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Thinking Progress ─────────────────────────────────────────────────────────

/**
 * 波浪效果动画的 thinking 指示器。
 * 使用 CSS 动画模拟波浪/脉冲效果。
 */
const THINKING_CSS = `
@keyframes thinking-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}
.thinking-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  animation: thinking-pulse 1.4s ease-in-out infinite;
}
.thinking-dot:nth-child(2) { animation-delay: 0.2s; }
.thinking-dot:nth-child(3) { animation-delay: 0.4s; }
`;

function ThinkingProgress({ className = '' }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-2 ${className}`}
      role="status"
      aria-live="polite"
      aria-label="AI 正在思考"
    >
      <style>{THINKING_CSS}</style>
      <div className="flex items-center gap-1 text-text-muted">
        <span className="thinking-dot" />
        <span className="thinking-dot" />
        <span className="thinking-dot" />
      </div>
      <span className="text-xs text-text-muted">思考中…</span>
    </div>
  );
}

// ─── Token Progress ───────────────────────────────────────────────────────────

/**
 * Token 流绿色闪烁光标。
 * 配合 markdown 输出使用，表示正在流式接收文本。
 */
const TOKEN_CURSOR_CSS = `
@keyframes token-cursor-blink {
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0; }
}
.token-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: #0e9f6e;
  vertical-align: text-bottom;
  margin-left: 1px;
  animation: token-cursor-blink 0.8s ease-in-out infinite;
}
`;

function TokenProgress({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline ${className}`}
      role="status"
      aria-live="polite"
      aria-label="正在输出"
    >
      <style>{TOKEN_CURSOR_CSS}</style>
      <span className="token-cursor" />
    </span>
  );
}

// ─── Main Export ───────────────────────────────────────────────────────────────

export function ProgressIndicator({
  type,
  toolName,
  progress,
  className = '',
}: ProgressIndicatorProps) {
  switch (type) {
    case 'tool':
      return (
        <ToolProgress toolName={toolName} progress={progress} className={className} />
      );
    case 'thinking':
      return <ThinkingProgress className={className} />;
    case 'token':
      return <TokenProgress className={className} />;
    default:
      return null;
  }
}
