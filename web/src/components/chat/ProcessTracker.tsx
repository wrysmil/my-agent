import { useState } from 'react';
import { ChevronDown, ListChecks } from 'lucide-react';
import { ToolCallBlockView } from './ToolCallBlock';
import { ToolResultBlockView } from './ToolResultBlock';
import type { Block } from '@/features/chat/types';

/**
 * ProcessTracker — 可折叠的过程追踪面板。
 *
 * 参考 Orkas 的 .stream-process <details> 组件。
 * 汇总展示所有工具调用和结果，默认展开。
 */
export function ProcessTracker({ blocks }: { blocks: Block[] }) {
  const [open, setOpen] = useState(true);

  const toolBlocks = blocks.filter(
    (b) => b.type === 'tool_call' || b.type === 'tool_result'
  );

  if (toolBlocks.length === 0) return null;

  const toolCount = blocks.filter((b) => b.type === 'tool_call').length;
  const doneCount = blocks.filter(
    (b) => b.type === 'tool_call' && b.status === 'done'
  ).length;

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      className="my-2 border-l-2 border-border pl-2.5"
    >
      <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs text-text-muted/70 py-0.5 select-none hover:text-text-muted transition-colors">
        <ChevronDown
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
        />
        <ListChecks className="w-3.5 h-3.5 shrink-0" />
        <span>过程信息</span>
        <span className="text-text-muted/40">
          ({doneCount}/{toolCount} 个工具)
        </span>
      </summary>
      <div className="mt-1 space-y-0.5 max-h-[300px] overflow-y-auto">
        {toolBlocks.map((block) => {
          if (block.type === 'tool_call') {
            return <ToolCallBlockView key={block.id} block={block} />;
          }
          if (block.type === 'tool_result') {
            return <ToolResultBlockView key={block.id} block={block} />;
          }
          return null;
        })}
      </div>
    </details>
  );
}
