import { useState, lazy, Suspense } from 'react';
import { Copy, Check } from 'lucide-react';

const Markdown = lazy(() => import('./Markdown').then(m => ({ default: m.Markdown })));

function MarkdownFallback() {
  return <div className="animate-pulse h-4 w-3/4 bg-surface-hover rounded" />;
}

export function MessageBubble({ role, text }: { role: 'user' | 'assistant'; text: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };
  return (
    <div className={`flex ${role === 'user' ? 'justify-end' : 'justify-start'} group relative mb-4`}>
      <div className={`max-w-[80%] rounded-lg px-4 py-2 ${
        role === 'user'
          ? 'bg-surface-hover text-text'
          : 'bg-surface border border-border'
      }`}>
        {role === 'assistant' ? (
          <Suspense fallback={<MarkdownFallback />}>
            <Markdown text={text} />
          </Suspense>
        ) : (
          <div className="whitespace-pre-wrap">{text}</div>
        )}
      </div>
      <button
        onClick={onCopy}
        className="ml-2 self-end opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-surface-hover"
        aria-label="复制消息"
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}
