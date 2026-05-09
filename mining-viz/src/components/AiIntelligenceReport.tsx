import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="text-base font-black uppercase tracking-wide text-white mt-0 mb-4 pb-2 border-b border-white/10">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 mb-3 border-l-2 border-amber-500/70 pl-3 text-sm font-black uppercase tracking-widest text-amber-400/95 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-[13px] font-bold text-slate-100 mt-5 mb-2">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="text-xs font-bold text-slate-200 mt-4 mb-1.5">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-[13px] text-slate-300/95 leading-relaxed mb-3 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 list-outside list-disc space-y-2 pl-5 text-[13px] text-slate-300/95 marker:text-amber-500/80">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 list-outside list-decimal space-y-2 pl-5 text-[13px] text-slate-300/95 marker:text-amber-500/80">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed pl-1">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
  em: ({ children }) => <em className="text-slate-400 not-italic">{children}</em>,
  hr: () => <hr className="my-6 border-0 border-t border-white/10" />,
  blockquote: ({ children }) => (
    <blockquote className="my-4 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3 text-[13px] text-slate-300/90 leading-relaxed">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-amber-400/90 underline decoration-amber-500/30 underline-offset-2 hover:text-amber-300"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950/40">
      <table className="w-full min-w-[280px] border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.06]">{children}</thead>,
  tbody: ({ children }) => <tbody className="divide-y divide-white/5">{children}</tbody>,
  tr: ({ children }) => <tr className="hover:bg-white/[0.02] transition-colors">{children}</tr>,
  th: ({ children }) => (
    <th className="px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-400 whitespace-nowrap">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2.5 text-slate-300/95 align-top">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code
          className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-mono text-amber-200/90"
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className={cn('font-mono text-[11px] text-slate-300', className)} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-xl border border-white/10 bg-slate-950 p-4 text-[11px] leading-relaxed">
      {children}
    </pre>
  ),
};

interface AiIntelligenceReportProps {
  content: string;
  className?: string;
}

export function AiIntelligenceReport({ content, className }: AiIntelligenceReportProps) {
  const trimmed = content?.trim() ?? '';
  if (!trimmed) return null;

  return (
    <div
      className={cn(
        'intelligence-report max-w-none [&_ul_li_p]:mb-1 [&_ol_li_p]:mb-1 [&_li>ul]:mt-2 [&_li>ol]:mt-2',
        className
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {trimmed}
      </ReactMarkdown>
    </div>
  );
}
