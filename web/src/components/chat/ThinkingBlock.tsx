import { useState, lazy, Suspense } from 'react';
import { ChevronDown, Brain } from 'lucide-react';
import type { ThinkingBlock as ThinkingBlockType } from '@/features/chat/types';

/**
 * ThinkingBlock — 可折叠的模型思考内容。
 *
 * 默认折叠，用户可点击展开查看模型的推理过程。
 * 流式过程中显示"思考中..."动画。
 *
 * 思考内容使用 Markdown 渲染（`compact` 模式）—— 模型推理常含代码块、列表等结构。
 * Markdown 走 lazy + Suspense，避免默认折叠态下载 markdown 渲染器；
 * 用户首次展开时会短暂看到 fallback（与正文一致）。
 */
const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })));

function MarkdownFallback() {
  return <div className="animate-pulse h-3 w-1/2 bg-surface-hover rounded my-0.5" />;
}

export function ThinkingBlockView({ block }: { block: ThinkingBlockType }) {
  const [collapsed, setCollapsed] = useState(block.collapsed);
  const isStreaming = block.status === 'streaming';
  const text = block.thinking || (isStreaming ? '...' : '(无内容)');

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
        <div className="px-3 py-2 border-t border-border/30 max-h-48 overflow-y-auto">
          <Suspense fallback={<MarkdownFallback />}>
            <Markdown text={text} compact />
          </Suspense>
        </div>
      )}
    </div>
  );
}