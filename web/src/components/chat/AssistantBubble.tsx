/**
 * AssistantBubble — Assistant 消息气泡。
 *
 * v4 双布局（spec `.ai-runtime-artifacts/specs/2026-08-11-run-trace-dual-layout-spec.md` § 4.3）：
 *   三个独立 DOM 节点（不再共享单气泡容器）：
 *     1. TraceBubble（灰色气泡，仅包 trace）
 *     2. final markdown 裸内容节点（无边框/无背景/无气泡）
 *     3. GeneratingIndicator（仅 isStreaming && !hasFinalText 时显示）
 *
 * 设计：
 * - 左对齐，无背景气泡
 * - max-w-[720px]
 * - 复制按钮在右侧（group hover 显示）
 * - trace 区域通过 children 传入，由外部组合 TraceBubble + RunTracePanel
 */

import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Copy, Check } from 'lucide-react';
import { GeneratingIndicator } from './GeneratingIndicator';
import type { TextBlock } from '@/features/chat/types';

const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })));

function MarkdownFallback() {
  return <div className="animate-pulse h-4 w-3/4 bg-surface-hover rounded" />;
}

export interface AssistantBubbleProps {
  /** 文本块数组 */
  textBlocks: TextBlock[];
  /** 当前是否在流式输出 */
  isStreaming: boolean;
  /** 该消息是否已产出最终 text */
  hasFinalText: boolean;
  /** 消息 ID（用于 key） */
  messageId: string;
  /** trace 区域内容（通常是 TraceBubble + RunTracePanel） */
  traceContent?: ReactNode;
  className?: string;
}

export function AssistantBubble({
  textBlocks,
  isStreaming,
  hasFinalText,
  messageId,
  traceContent,
  className = '',
}: AssistantBubbleProps) {
  const [copied, setCopied] = useState(false);

  const showTrace = traceContent !== undefined;
  const showGeneratingIndicator = isStreaming && !hasFinalText;

  const textContent = textBlocks.map((b) => b.text).join('\n');

  const onCopy = async () => {
    if (!textContent) return;
    try {
      await navigator.clipboard.writeText(textContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className={`flex group relative ${className}`}>
      <div className="flex flex-col items-stretch min-w-0 flex-1 max-w-[720px]">
        {/* Trace 面板 */}
        {showTrace && (
          <div key={`${messageId}-trace`}>
            {traceContent}
          </div>
        )}

        {/* Final markdown 内容 */}
        {textBlocks.length > 0 && (
          <div
            key={`${messageId}-final`}
            data-testid="final-bubble"
            className="w-full max-w-[720px] self-start"
          >
            <Suspense fallback={<MarkdownFallback />}>
              <div className="prose prose-sm max-w-none break-words">
                <Markdown text={textContent} />
              </div>
            </Suspense>
          </div>
        )}

        {/* 生成指示器 */}
        {showGeneratingIndicator && (
          <div key={`${messageId}-gen`} data-testid="gen" className="self-start">
            <GeneratingIndicator />
          </div>
        )}
      </div>

      {/* 复制按钮 */}
      {textContent && (
        <button
          onClick={onCopy}
          className="ml-2 mt-1 self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover shrink-0"
          aria-label="复制消息"
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
    </div>
  );
}
