import { useState } from 'react';
import { ChevronDown, Brain } from 'lucide-react';
import type { ThinkingBlock as ThinkingBlockType } from '@/features/chat/types';

/**
 * ThinkingBlock — 可折叠的模型思考内容。
 *
 * 默认折叠，用户可点击展开查看模型的推理过程。
 * 流式过程中显示"思考中..."动画。
 */
export function ThinkingBlockView({ block }: { block: ThinkingBlockType }) {
  const [collapsed, setCollapsed] = useState(block.collapsed);
  const isStreaming = block.status === 'streaming';

  return (
    <div className="my-1 rounded-md border border-border/50 bg-surface-hover/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-xs text-text-muted hover:bg-surface-hover/50 transition-colors"
      >
        <Brain className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 text-left">
          {isStreaming ? '思考中...' : '思考过程'}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${collapsed ? '' : 'rotate-180'}`}
        />
      </button>
      {!collapsed && (
        <div className="px-3 py-2 border-t border-border/30 text-xs text-text-muted/80 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">
          {block.thinking || (isStreaming ? '...' : '(无内容)')}
        </div>
      )}
    </div>
  );
}
