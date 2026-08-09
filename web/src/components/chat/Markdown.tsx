import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github.css';

export function Markdown({ text, compact }: { text: string; compact?: boolean }) {
  // `compact` 用于折叠型次要区域（如思考过程），字号与间距更小、字色偏 muted。
  const wrapperClass = compact ? 'prose prose-compact max-w-none' : 'prose prose-sm max-w-none';

  return (
    <div className={wrapperClass}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize, rehypeHighlight]}
        urlTransform={(url) => /^https?:/.test(url) ? url : 'about:blank'}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
