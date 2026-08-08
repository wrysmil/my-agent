import { useState } from 'react';
import { ChevronDown, CheckCircle2, XCircle } from 'lucide-react';
import type { ToolResultBlock as ToolResultBlockType } from '@/features/chat/types';

/**
 * ToolResultBlock — 工具执行结果展示组件。
 *
 * 默认折叠，点击可展开/收起。
 * 参考 Orkas 的 stream-process-line.is-expandable 模式。
 */

function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

export function ToolResultBlockView({ block }: { block: ToolResultBlockType }) {
  const [expanded, setExpanded] = useState(false);
  const hasContent = block.content && block.content.length > 0;
  const duration = formatDuration(block.durationMs);
  const isError = block.isError;

  // 截断预览（前 160 字符）
  const preview = hasContent
    ? block.content.replace(/\s+/g, ' ').trim().slice(0, 160)
    : '';

  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => hasContent && setExpanded(!expanded)}
        className={`flex items-center gap-1.5 w-full px-2.5 py-1 rounded text-xs transition-colors ${
          hasContent
            ? 'cursor-pointer hover:bg-surface-hover/50'
            : 'cursor-default'
        } ${
          isError ? 'text-danger/80' : 'text-text-muted/70'
        }`}
      >
        {isError ? (
          <XCircle className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-green-500" />
        )}
        <span className="flex-1 text-left truncate">
          {block.toolName || '工具执行'}
          {isError ? ' — 失败' : ' — 完成'}
          {preview && !expanded && (
            <span className="ml-1 text-text-muted/40">: {preview}</span>
          )}
        </span>
        {duration && (
          <span className="text-text-muted/40 shrink-0">{duration}</span>
        )}
        {hasContent && (
          <ChevronDown
            className={`w-3 h-3 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          />
        )}
      </button>
      {expanded && hasContent && (
        <pre className={`mt-0.5 mx-2.5 px-2.5 py-2 rounded text-xs font-mono leading-relaxed max-h-80 overflow-auto whitespace-pre-wrap break-all ${
          isError
            ? 'bg-danger/5 border border-danger/10 text-danger/80'
            : 'bg-surface-hover/20 border border-border/30 text-text-muted/80'
        }`}>
          {block.content}
        </pre>
      )}
    </div>
  );
}
