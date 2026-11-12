/**
 * A small Markdown renderer for bios and messages.
 *
 * It builds React elements directly and never uses innerHTML (except highlight.js output, which
 * escapes the source), so user content cannot inject HTML or script. Supported syntax:
 *   blocks:  # / ## / ### headings, -# subtext, > quotes, - * and 1. lists, ```lang fenced code
 *            (syntax highlighted), paragraphs
 *   inline:  **bold**, *italic* / _italic_, __underline__, ~~strike~~, `code`, ||spoiler||,
 *            [label](https://url), bare and <suppressed> links, @mentions, @everyone / @here,
 *            <#channel>, <t:unix:style> timestamps, aether.chat message links (open in-app)
 */
import { openJoinDialog } from './joinBus';
import { parseInviteCode } from './invites';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';
import type { Channel, ServerRole } from '../types/db';
import { parseMessageLink } from './messageLinks';
import { openExternal } from './platform';

const CodeBlock = lazy(() => import('./CodeBlock'));

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
  const goTo = useUiStore((s) => s.goTo);
  const internal = parseMessageLink(href);
  const invite = /aether\.chat\/inv\/|aether\.chat-releases\/inv\//.test(href) ? parseInviteCode(href) : null;
  return (
    <a
      href={href}
      title={internal ? 'Jump to message' : invite ? 'Join server' : href}
      onClick={(e) => {
        e.preventDefault();
        if (internal) goTo(internal);
        else if (invite) openJoinDialog(invite);
        else void openExternal(href);
      }}
    >
      {children}
    </a>
  );
}

function ChannelMention({ id }: { id: string }) {
  const qc = useQueryClient();
  const goTo = useUiStore((s) => s.goTo);
  let channel: Channel | undefined;
  for (const [, list] of qc.getQueriesData<Channel[]>({ queryKey: ['channels'] })) {
    channel = list?.find((c) => c.id === id);
    if (channel) break;
  }
  return (
    <span
      className="ae-mention cursor-pointer"
      onClick={() => channel && goTo({ serverId: channel.server_id, scopeId: channel.id })}
      title={channel ? `#${channel.name}` : 'Unknown channel'}
    >
      #{channel?.name ?? 'unknown-channel'}
    </span>
  );
}

function RoleMention({ id }: { id: string }) {
  const qc = useQueryClient();
  let role: ServerRole | undefined;
  for (const [, list] of qc.getQueriesData<ServerRole[]>({ queryKey: ['roles'] })) {
    role = list?.find((r) => r.id === id);
    if (role) break;
  }
  const color = role?.color ?? 'var(--ae-accent)';
  return (
    <span
      className="rounded px-0.5 font-medium"
      style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}
      title={role ? `@${role.name}` : 'Unknown role'}
    >
      @{role?.name ?? 'deleted-role'}
    </span>
  );
}

const TIME_STYLES: Record<string, Intl.DateTimeFormatOptions> = {
  t: { timeStyle: 'short' },
  T: { timeStyle: 'medium' },
  d: { dateStyle: 'short' },
  D: { dateStyle: 'long' },
  f: { dateStyle: 'long', timeStyle: 'short' },
  F: { dateStyle: 'full', timeStyle: 'short' },
};

function relative(date: Date): string {
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const diff = (date.getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60 ? [diff, 'second'] : abs < 3600 ? [diff / 60, 'minute'] : abs < 86400 ? [diff / 3600, 'hour']
      : abs < 2_592_000 ? [diff / 86400, 'day'] : abs < 31_536_000 ? [diff / 2_592_000, 'month'] : [diff / 31_536_000, 'year'];
  return rtf.format(Math.round(value), unit);
}

function Timestamp({ unix, style }: { unix: number; style: string }) {
  const date = new Date(unix * 1000);
  const [, tick] = useState(0);
  useEffect(() => {
    if (style !== 'R') return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [style]);
  if (Number.isNaN(date.getTime())) return <>{`<t:${unix}>`}</>;
  const text = style === 'R' ? relative(date) : date.toLocaleString(undefined, TIME_STYLES[style] ?? TIME_STYLES.f);
  return (
    <span className="ae-timestamp" title={date.toLocaleString(undefined, TIME_STYLES.F)}>
      {text}
    </span>
  );
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const INLINE_RULES: InlineRule[] = [
  { re: /`([^`\n]+)`/, render: (m, k) => <code key={k}>{m[1]}</code> },
  { re: /<t:(-?\d{1,13})(?::([tTdDfFR]))?>/, render: (m, k) => <Timestamp key={k} unix={Number(m[1])} style={m[2] ?? 'f'} /> },
  { re: new RegExp(`<#(${UUID})>`, 'i'), render: (m, k) => <ChannelMention key={k} id={m[1]} /> },
  { re: new RegExp(`<@&(${UUID})>`, 'i'), render: (m, k) => <RoleMention key={k} id={m[1]} /> },
  { re: /<(https?:\/\/[^>\s]+)>/, render: (m, k) => <Link key={k} href={m[1]}>{m[1]}</Link> },
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
      <span key={k} className={`ae-mention ${m[1] === 'everyone' || m[1] === 'here' ? 'ae-mention-everyone' : ''}`}>
        @{m[1]}
      </span>
    ),
  },
  {
    re: /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/,
    render: (m, k) => {
      const internal = parseMessageLink(m[0]);
      return (
        <Link key={k} href={m[0]}>
          {internal ? 'message link' : m[0]}
        </Link>
      );
    },
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

const SPECIAL_LINE = /^(```|#{1,3}\s|-#\s|>\s?|\s*([-*]|\d+\.)\s+)/;

/** Renders a Markdown document into React elements. */
export function renderMarkdown(source: string): ReactNode {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let b = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Single-line ```code```
    const oneLine = /^```(.+?)```\s*$/.exec(line);
    if (oneLine) {
      blocks.push(
        <pre key={b++}>
          <code>{oneLine[1]}</code>
        </pre>,
      );
      i++;
      continue;
    }

    // Fenced code block (optional language after the fence)
    const fence = /^```([\w+#.-]*)\s*$/.exec(line) ?? (line.startsWith('```') ? (['```', ''] as unknown as RegExpExecArray) : null);
    if (fence) {
      const lang = fence[1] ? fence[1].toLowerCase() : null;
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++; // skip the closing fence (or run off the end if it is unterminated)
      const code = body.join('\n');
      blocks.push(
        <Suspense
          key={b++}
          fallback={
            <pre>
              <code>{code}</code>
            </pre>
          }
        >
          <CodeBlock code={code} lang={lang} />
        </Suspense>,
      );
      continue;
    }

    // Subtext
    if (/^-#\s/.test(line)) {
      blocks.push(
        <p key={b} className="ae-subtext">
          {renderInline(line.replace(/^-#\s+/, ''), `s${b++}`)}
        </p>,
      );
      i++;
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
    while (i < lines.length && lines[i].trim() !== '' && !SPECIAL_LINE.test(lines[i])) para.push(lines[i++]);
    if (para.length === 0) para.push(lines[i++]); // safety: never loop without progress
    blocks.push(<p key={b}>{renderLines(para, `p${b++}`)}</p>);
  }
  return blocks;
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  return <div className={`ae-md space-y-1 break-words ${className}`}>{renderMarkdown(source)}</div>;
}
