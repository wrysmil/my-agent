/**
 * UserBubble — 用户消息气泡。
 *
 * 设计：
 * - 右对齐，蓝色主题
 * - max-w-[80%]，响应式
 * - 纯文本内容，不支持 markdown
 */

import { Copy, Check } from 'lucide-react';
import { useState } from 'react';

export interface UserBubbleProps {
  /** 用户消息文本 */
  text: string;
  className?: string;
}

export function UserBubble({ text, className = '' }: UserBubbleProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <div className={`flex group relative ${className}`}>
      <div className="max-w-[80%] min-w-0 bg-blue-50 text-blue-950 px-4 py-3 rounded-2xl rounded-br-md shadow-sm dark:bg-blue-900/30 dark:text-blue-100">
        <div className="whitespace-pre-wrap break-words">{text}</div>
      </div>

      <button
        onClick={onCopy}
        className="ml-2 self-start opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover shrink-0"
        aria-label="复制消息"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
