import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import CodeBlock from './CodeBlock.jsx';
import DiffCard from './DiffCard.jsx';
import { segmentContent } from '../utils/helpers.js';

const components = {
  // fenced blocks go through <pre><code>; inline code stays inline
  pre: ({ children }) => <>{children}</>,
  code({ className, children, ...props }) {
    const match = /language-([\w+#.-]+)/.exec(className || '');
    const text = String(children).replace(/\n$/, '');
    const isBlock = match || text.includes('\n');
    if (!isBlock) {
      return (
        <code className="rounded bg-gray-200/70 px-1.5 py-0.5 font-mono text-[0.85em] before:content-none after:content-none dark:bg-white/10" {...props}>
          {children}
        </code>
      );
    }
    const lang = (match?.[1] || 'text').replace(/^(before|after)-/, '');
    return <CodeBlock code={text} lang={lang} />;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400">
      {children}
    </a>
  ),
  img: ({ src, alt }) => <img src={src} alt={alt || ''} className="rounded-xl" loading="lazy" />,
};

function Markdown({ content }) {
  const segments = segmentContent(content);
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert sm:prose-base prose-p:leading-relaxed prose-pre:p-0">
      {segments.map((s, i) =>
        s.type === 'diff' ? (
          <DiffCard key={i} lang={s.lang} before={s.before} after={s.after} />
        ) : (
          <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={components}>
            {s.text}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}

export default memo(Markdown);
