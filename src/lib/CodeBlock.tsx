/** Highlighted code block with a language label and copy button (loaded lazily with highlight.js). */
import { useMemo, useState } from 'react';
import { highlight } from './highlight';

export default function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  const [copied, setCopied] = useState(false);

  return (
    <div className="group relative">
      <pre>
        {html ? (
          // highlight.js output: source text is HTML-escaped by the library.
          <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{code}</code>
        )}
      </pre>
      <div className="absolute top-1.5 right-2 flex items-center gap-2 text-[10px] text-ae-muted opacity-0 group-hover:opacity-100">
        {lang && <span className="uppercase">{lang}</span>}
        <button
          type="button"
          className="rounded bg-ae-surface px-1.5 py-0.5 hover:text-ae-text"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}
