import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

export function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        urlTransform={(url) => /^https?:/.test(url) ? url : 'about:blank'}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
