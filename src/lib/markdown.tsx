/**
 * A small, dependency-free Markdown renderer for bios and messages.
 *
 * It builds React elements directly and never uses innerHTML, so user content cannot inject HTML or
 * script. Supported syntax:
 *   blocks:  # / ## / ### headings, > quotes, - * and 1. lists, ``` fenced code, paragraphs
 *   inline:  **bold**, *italic* / _italic_, __underline__, ~~strike~~, `code`, ||spoiler||,
 *            [label](https://url), bare https:// links
 */
import { Fragment, useState, type ReactNode } from 'react';
import { openExternal } from './platform';

interface InlineRule {
  re: RegExp;
  render: (m: RegExpExecArray, key: string) => ReactNode;
}

function Spoiler({ children }: { children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="ae-spoiler" data-revealed={revealed} onClick={() => setRevealed(true)}>
      {children}
    </span>
  );
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      title={href}
      onClick={(e) => {
        e.preventDefault();
        void openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

const INLINE_RULES: InlineRule[] = [
  { re: /`([^`\n]+)`/, render: (m, k) => <code key={k}>{m[1]}</code> },
  { re: /\*\*([\s\S]+?)\*\*/, render: (m, k) => <strong key={k}>{renderInline(m[1], k)}</strong> },
  { re: /__([\s\S]+?)__/, render: (m, k) => <u key={k}>{renderInline(m[1], k)}</u> },
  { re: /~~([\s\S]+?)~~/, render: (m, k) => <s key={k}>{renderInline(m[1], k)}</s> },
  { re: /\|\|([\s\S]+?)\|\|/, render: (m, k) => <Spoiler key={k}>{renderInline(m[1], k)}</Spoiler> },
  { re: /\*([^*\n]+)\*|\b_([^_\n]+)_\b/, render: (m, k) => <em key={k}>{renderInline(m[1] ?? m[2], k)}</em> },
  {
    re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/,
    render: (m, k) => (
      <Link key={k} href={m[2]}>
        {renderInline(m[1], k)}
      </Link>
    ),
  },
  {
    re: /(?<![\w@])@([A-Za-z0-9_.]{2,32})/,
    render: (m, k) => (
      <span key={k} className="ae-mention">
        @{m[1]}
      </span>
    ),
  },
  {
    re: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/,
    render: (m, k) => (
      <Link key={k} href={m[0]}>
        {m[0]}
      </Link>
    ),
  },
];

/** Renders inline markup. Repeatedly takes the earliest match among all rules. */
export function renderInline(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let n = 0;
  while (rest.length > 0) {
    let best: { m: RegExpExecArray; rule: InlineRule } | null = null;
    for (const rule of INLINE_RULES) {
      const m = rule.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) best = { m, rule };
    }
    if (!best) {
      out.push(rest);
      break;
    }
    if (best.m.index > 0) out.push(rest.slice(0, best.m.index));
    out.push(best.rule.render(best.m, `${keyPrefix}.${n++}`));
    rest = rest.slice(best.m.index + best.m[0].length);
  }
  return out;
}

function renderLines(lines: string[], key: string): ReactNode {
  return lines.map((line, i) => (
    <Fragment key={`${key}.${i}`}>
      {i > 0 && <br />}
      {renderInline(line, `${key}.${i}`)}
    </Fragment>
  ));
}

/** Renders a Markdown document into React elements. */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++; // skip the closing fence (or run off the end if it is unterminated)
      blocks.push(
        <pre key={b++}>
          <code>{body.join('\n')}</code>
        </pre>,
      );
      continue;
    }

    // Heading
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2], `h${b}`);
      blocks.push(level === 1 ? <h1 key={b++}>{content}</h1> : level === 2 ? <h2 key={b++}>{content}</h2> : <h3 key={b++}>{content}</h3>);
      i++;
      continue;
    }

    // Block quote
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(<blockquote key={b}>{renderLines(body, `q${b++}`)}</blockquote>);
      continue;
    }

    // Unordered or ordered list
    const listMatch = /^\s*([-*]|\d+\.)\s+/.exec(line);
    if (listMatch) {
      const ordered = /\d/.test(listMatch[1]);
      const pattern = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/;
      const items: ReactNode[] = [];
      while (i < lines.length && pattern.test(lines[i])) {
        items.push(<li key={items.length}>{renderInline(lines[i].replace(pattern, ''), `l${b}.${items.length}`)}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={b++}>{items}</ol> : <ul key={b++}>{items}</ul>);
      continue;
    }

    // Blank line separates paragraphs
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: consecutive non-special lines
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].startsWith('```') &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*([-*]|\d+\.)\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={b}>{renderLines(para, `p${b++}`)}</p>);
  }
  return blocks;
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  return <div className={`ae-md space-y-1 break-words ${className}`}>{renderMarkdown(source)}</div>;
}
