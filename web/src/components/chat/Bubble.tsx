/**
 * Bubble — 聊天气泡统一容器。
 *
 * 设计原则：
 * 1. 统一对齐规则：user 右对齐，assistant/agent 左对齐
 * 2. 统一间距：mb-4，与父级 gap
 * 3. 统一响应式：max-w-[80%] user / max-w-[720px] assistant
 *
 * 用法：
 * ```tsx
 * <Bubble role="user">
 *   <UserBubbleContent message={message} />
 * </Bubble>
 *
 * <Bubble role="assistant">
 *   <TraceBubble>...</TraceBubble>
 *   <Markdown>...</Markdown>
 * </Bubble>
 * ```
 */

import type { ReactNode } from 'react';

export type BubbleRole = 'user' | 'assistant' | 'agent';

export interface BubbleProps {
  role: BubbleRole;
  children: ReactNode;
  className?: string;
  /** 复制按钮等操作的回调 */
  onCopy?: () => void;
  copied?: boolean;
}

const roleToAlignment: Record<BubbleRole, string> = {
  user: 'justify-end',
  assistant: 'items-start',
  agent: 'items-start',
};

const roleToMaxWidth: Record<BubbleRole, string> = {
  user: 'max-w-[80%]',
  assistant: 'max-w-[720px]',
  agent: 'max-w-[640px]',
};

export function Bubble({
  role,
  children,
  className = '',
  onCopy,
  copied = false,
}: BubbleProps) {
  const hasCopy = onCopy !== undefined;

  return (
    <div
      className={`flex group relative mb-4 ${roleToAlignment[role]}`}
    >
      <div
        className={`flex flex-col items-stretch min-w-0 flex-1 ${roleToMaxWidth[role]} ${className}`}
      >
        {children}
      </div>

      {hasCopy && (
        <button
          onClick={onCopy}
          className="ml-2 mt-1 self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover shrink-0"
          aria-label="复制消息"
        >
          {copied ? (
            <CheckIcon size={14} />
          ) : (
            <CopyIcon size={14} />
          )}
        </button>
      )}
    </div>
  );
}

// ─── Re-exports ────────────────────────────────────────────────────────────────

export { UserBubble } from './UserBubble';
export { AssistantBubble } from './AssistantBubble';
export { AgentBubble } from './AgentBubble';
export { TraceBubble } from './TraceBubble';
export { GeneratingIndicator } from './GeneratingIndicator';

// ─── Icons (inline to avoid extra import overhead) ────────────────────────────

import { Copy, Check } from 'lucide-react';

function CopyIcon({ size }: { size: number }) {
  return <Copy size={size} />;
}

function CheckIcon({ size }: { size: number }) {
  return <Check size={size} />;
}
