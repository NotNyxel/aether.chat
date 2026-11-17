/** What's new page: renders CHANGELOG.md (bundled at build time) as simple, safe HTML. */
import './site';
import changelog from '../../CHANGELOG.md?raw';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Inline markdown: **bold**, `code`, [text](https://link).
const inline = (s: string) =>
  esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');

function render(md: string, maxVersions: number): string {
  const out: string[] = [];
  let versions = 0;
  let list = false;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (list) out.push('</ul>');
    list = false;
  };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h2 = /^## \[([^\]]+)\](?: - (.+))?$/.exec(line);
    if (h2) {
      flushPara();
      closeList();
      if (++versions > maxVersions) break;
      out.push(`<h2 id="v${esc(h2[1]!)}">${esc(h2[1]!)}${h2[2] ? ` <span class="small">${esc(h2[2])}</span>` : ''}</h2>`);
      continue;
    }
    if (versions === 0) continue; // skip the intro
    const h3 = /^### (.+)$/.exec(line);
    if (h3) {
      flushPara();
      closeList();
      out.push(`<h3>${inline(h3[1]!)}</h3>`);
      continue;
    }
    const li = /^- (.+)$/.exec(line);
    if (li) {
      flushPara();
      if (!list) out.push('<ul>');
      list = true;
      out.push(`<li>${inline(li[1]!)}`);
      continue;
    }
    if (/^\s{2,}\S/.test(line) && list) {
      // Continuation of the last list item.
      out[out.length - 1] += ` ${inline(line.trim())}`;
      continue;
    }
    if (!line.trim()) {
      flushPara();
      continue;
    }
    closeList();
    para.push(line.trim());
  }
  flushPara();
  closeList();
  return out.join('\n');
}

const el = document.getElementById('changelog');
if (el) {
  el.innerHTML = render(changelog, 12);
  const more = document.createElement('p');
  more.innerHTML = 'Older versions are on the <a href="https://github.com/NotNyxel/aether.chat/blob/main/CHANGELOG.md">full changelog</a>.';
  el.appendChild(more);
}
