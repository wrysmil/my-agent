import { Wrench, Loader2 } from 'lucide-react';
import type { ToolCallBlock as ToolCallBlockType } from '@/features/chat/types';

/**
 * ToolCallBlock — 工具调用展示组件。
 *
 * 显示工具名称和参数。流式过程中显示加载动画。
 * 参考 Orkas 的 stream-process-line + kind-tool 模式。
 */

function formatInputPreview(input?: Record<string, unknown>, inputRaw?: string): string {
  if (input && Object.keys(input).length > 0) {
    const entries = Object.entries(input).slice(0, 3);
    return entries.map(([k, v]) => {
      const val = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v);
      return `${k}: ${val}`;
    }).join(', ');
  }
  if (inputRaw) {
    return inputRaw.length > 80 ? inputRaw.slice(0, 80) + '…' : inputRaw;
  }
  return '';
}

export function ToolCallBlockView({ block }: { block: ToolCallBlockType }) {
  const isStreaming = block.status === 'streaming';
  const preview = formatInputPreview(block.input, block.inputRaw);

  return (
    <div className="flex items-start gap-2 my-1 px-2.5 py-1.5 rounded-md bg-surface-hover/30 border border-border/30 text-xs">
      {isStreaming ? (
        <Loader2 className="w-3.5 h-3.5 shrink-0 mt-px animate-spin text-accent-fg" />
      ) : (
        <Wrench className="w-3.5 h-3.5 shrink-0 mt-px text-text-muted" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-text-muted">{block.toolName || '工具调用'}</span>
        {preview && (
          <span className="ml-1.5 text-text-muted/60 break-all">{preview}</span>
        )}
        {isStreaming && !preview && (
          <span className="ml-1.5 text-text-muted/40">接收参数中...</span>
        )}
      </div>
    </div>
  );
}
