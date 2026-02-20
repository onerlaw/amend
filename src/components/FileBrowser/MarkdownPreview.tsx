import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import mermaid from 'mermaid';
import type { Components } from 'react-markdown';

mermaid.initialize({ theme: 'dark', startOnLoad: false });

let mermaidIdCounter = 0;

function MermaidBlock({ source }: { source: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mermaid-${++mermaidIdCounter}`;

    mermaid
      .render(id, source)
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) {
    return (
      <pre className="bg-surface-2 rounded p-4 overflow-x-auto mb-4 text-sm font-mono text-secondary">
        {source}
      </pre>
    );
  }

  return <div ref={containerRef} className="mb-4 flex justify-center" />;
}

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold text-primary mt-6 mb-2">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold text-primary mt-6 mb-2">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-semibold text-primary mt-6 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-base font-semibold text-primary mt-6 mb-2">{children}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="text-sm font-semibold text-primary mt-6 mb-2">{children}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="text-xs font-semibold text-primary mt-6 mb-2">{children}</h6>
  ),
  p: ({ children }) => <p className="mb-4 leading-relaxed">{children}</p>,
  a: ({ href, children }) => (
    <a href={href} className="text-accent underline hover:opacity-80">
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="mb-4 pl-6 space-y-1 list-disc">{children}</ul>,
  ol: ({ children }) => <ol className="mb-4 pl-6 space-y-1 list-decimal">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-accent pl-4 text-secondary italic mb-4">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <table className="w-full border-collapse mb-4">{children}</table>
  ),
  th: ({ children }) => (
    <th className="border border-surface-3 bg-surface-2 px-3 py-1 text-left text-sm">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-surface-3 px-3 py-1 text-sm">{children}</td>
  ),
  hr: () => <hr className="border-surface-3 my-6" />,
  pre: ({ children }) => (
    <pre className="bg-surface-2 rounded p-4 overflow-x-auto mb-4 text-sm font-mono">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const isMermaid = className === 'language-mermaid';
    const isBlock = 'data-sourcepos' in props || isMermaid;

    if (isMermaid && typeof children === 'string') {
      return <MermaidBlock source={children} />;
    }

    if (!isBlock && !className) {
      return (
        <code className="bg-surface-2 text-accent font-mono text-sm px-1 rounded">
          {children}
        </code>
      );
    }

    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};

interface MarkdownPreviewProps {
  content: string;
}

export function MarkdownPreview({ content }: MarkdownPreviewProps) {
  return (
    <div className="h-full overflow-y-auto bg-surface-0 text-primary px-8 py-6">
      <div className="max-w-3xl mx-auto">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
