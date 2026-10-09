/**
 * Journal and note bodies (BlockNote blocks) <-> Markdown, for import and export.
 * Headings, paragraphs, lists (nested), checklists, quotes, code, tables, images and inline
 * bold / italic / strike / code / links go both ways. Blocks Markdown has no word for (graphs,
 * stock charts) travel as a ```ppfp-block fence holding the block's JSON, so a round trip
 * keeps them. Pure.
 */

type Styles = { bold?: true; italic?: true; strike?: true; code?: true };
interface Inline {
  type: string;
  text?: string;
  styles?: Styles;
  href?: string;
  content?: Inline[] | string;
}
export interface Block {
  type: string;
  props?: Record<string, unknown>;
  content?: string | Inline[] | { type: 'tableContent'; headerRows?: number; rows: { cells: unknown[] }[] };
  children?: Block[];
}

const CUSTOM_FENCE = 'ppfp-block';

// ---------------------------------------------------------------- blocks -> markdown

function esc(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function inlineMd(content: unknown): string {
  if (typeof content === 'string') return esc(content);
  if (!Array.isArray(content)) return '';
  return (content as Inline[])
    .map((n) => {
      if (n.type === 'link') return `[${inlineMd(n.content)}](${n.href ?? ''})`;
      let t = n.text ?? '';
      if (!t) return '';
      const s = n.styles ?? {};
      if (s.code) return '`' + t.replace(/`/g, "'") + '`';
      t = esc(t);
      // Markers hug the words: move edge spaces outside
      const lead = t.match(/^\s*/)![0];
      const trail = t.match(/\s*$/)![0];
      let core = t.trim();
      if (!core) return t;
      if (s.bold) core = `**${core}**`;
      if (s.italic) core = `*${core}*`;
      if (s.strike) core = `~~${core}~~`;
      return lead + core + trail;
    })
    .join('');
}

function cellText(cell: unknown): string {
  const c = cell && typeof cell === 'object' && !Array.isArray(cell) && 'content' in (cell as object) ? (cell as { content: unknown }).content : cell;
  return inlineMd(c).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function blockMd(b: Block, depth: number, n: number): string[] {
  const pad = '  '.repeat(depth);
  const text = inlineMd(b.content);
  const kids = (b.children ?? []).flatMap((c, i) => blockMd(c, depth + 1, i + 1));
  switch (b.type) {
    case 'heading':
      return [`${'#'.repeat(Math.min(3, Math.max(1, Number(b.props?.level ?? 1))))} ${text}`, ...kids];
    case 'bulletListItem':
      return [`${pad}- ${text}`, ...kids];
    case 'numberedListItem':
      return [`${pad}${n}. ${text}`, ...kids];
    case 'checkListItem':
      return [`${pad}- [${b.props?.checked ? 'x' : ' '}] ${text}`, ...kids];
    case 'quote':
      return [text.split('\n').map((l) => `${pad}> ${l}`).join('\n'), ...kids];
    case 'codeBlock': {
      const raw = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? b.content.map((x) => x.text ?? '').join('') : '';
      return ['```' + String(b.props?.language ?? '').replace(/[^\w+-]/g, ''), raw, '```', ...kids];
    }
    case 'table': {
      const rows = b.content && !Array.isArray(b.content) && typeof b.content === 'object' ? b.content.rows : [];
      if (!rows.length) return kids;
      const lines = rows.map((r) => `| ${r.cells.map(cellText).join(' | ')} |`);
      lines.splice(1, 0, `| ${rows[0].cells.map(() => '---').join(' | ')} |`);
      return [lines.join('\n'), ...kids];
    }
    case 'image': {
      const url = String(b.props?.url ?? '');
      return url ? [`${pad}![${String(b.props?.caption ?? b.props?.name ?? '').replace(/[[\]]/g, '')}](${url})`, ...kids] : kids;
    }
    case 'paragraph':
      return [pad + text, ...kids];
    default:
      return ['```' + CUSTOM_FENCE, JSON.stringify(b), '```'];
  }
}

/** Markdown for a document. Lists stay together; other blocks are separated by a blank line. */
export function blocksToMarkdown(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  const out: string[] = [];
  let prevList = false;
  let n = 0;
  for (const raw of blocks as Block[]) {
    if (!raw || typeof raw !== 'object') continue;
    const list = /ListItem$/.test(raw.type);
    n = raw.type === 'numberedListItem' ? n + 1 : 0;
    const lines = blockMd(raw, 0, n);
    if (raw.type === 'paragraph' && !lines.join('').trim() && !raw.children?.length) {
      prevList = false;
      continue;
    }
    if (out.length && !(list && prevList)) out.push('');
    out.push(...lines);
    prevList = list;
  }
  return out.join('\n').trim();
}

// ---------------------------------------------------------------- markdown -> blocks

/** **bold**, *italic*, ~~strike~~, `code`, [text](url) -> inline content. */
export function parseInline(text: string): Inline[] | string {
  const out: Inline[] = [];
  let styled = false;
  const push = (t: string, styles: Styles = {}) => {
    if (!t) return;
    const last = out.at(-1);
    if (last && last.type === 'text' && JSON.stringify(last.styles ?? {}) === JSON.stringify(styles)) last.text += t;
    else out.push({ type: 'text', text: t, styles });
  };
  const re = /\\([\\`*_[\]~])|`([^`]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|_(.+?)_|\[([^\]]*)\]\(([^)\s]+)\)/g;
  let at = 0;
  for (let m; (m = re.exec(text)); ) {
    push(text.slice(at, m.index));
    at = m.index + m[0].length;
    if (m[1]) push(m[1]);
    else if (m[2] !== undefined) (push(m[2], { code: true }), (styled = true));
    else if (m[3] !== undefined) (pushNested(m[3], { bold: true }), (styled = true));
    else if (m[4] !== undefined) (pushNested(m[4], { strike: true }), (styled = true));
    else if (m[5] !== undefined || m[6] !== undefined) (pushNested(m[5] ?? m[6], { italic: true }), (styled = true));
    else if (m[8] !== undefined) {
      out.push({ type: 'link', href: m[8], content: [{ type: 'text', text: m[7] || m[8], styles: {} }] });
      styled = true;
    }
  }
  push(text.slice(at));
  return styled ? out : out.map((x) => x.text ?? '').join('');

  function pushNested(inner: string, styles: Styles) {
    const parsed = parseInline(inner);
    if (typeof parsed === 'string') return push(parsed, styles);
    for (const p of parsed) {
      if (p.type === 'text') push(p.text ?? '', { ...p.styles, ...styles });
      else out.push(p);
    }
  }
}

interface Line {
  indent: number;
  text: string;
}

/** A Markdown document -> blocks. Unknown syntax stays as paragraph text. */
export function markdownToBlocks(md: string): Block[] {
  const lines: Line[] = md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => {
      const expanded = l.replace(/\t/g, '  ');
      return { indent: expanded.match(/^ */)![0].length, text: expanded.trim() };
    });
  const root: Block[] = [];
  // Open list items by indent, so deeper items nest as children
  const stack: { indent: number; block: Block }[] = [];
  const place = (b: Block, indent: number, listItem: boolean) => {
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const parent = stack.at(-1);
    if (parent && indent > parent.indent) (parent.block.children ??= []).push(b);
    else {
      stack.length = 0;
      root.push(b);
    }
    if (listItem) stack.push({ indent, block: b });
  };

  for (let i = 0; i < lines.length; i++) {
    const { indent, text } = lines[i];
    if (!text) {
      continue;
    }
    const fence = text.match(/^```\s*([\w+-]*)\s*$/);
    if (fence) {
      const body: string[] = [];
      while (i + 1 < lines.length && !/^```\s*$/.test(lines[i + 1].text)) body.push(lines[++i].text === '' ? '' : ' '.repeat(Math.max(0, lines[i].indent - indent)) + lines[i].text);
      i++;
      if (fence[1] === CUSTOM_FENCE) {
        try {
          const b = JSON.parse(body.join('\n'));
          if (b && typeof b === 'object' && typeof b.type === 'string') {
            place(b as Block, 0, false);
            continue;
          }
        } catch {
          // not valid: keep it as code
        }
      }
      place({ type: 'codeBlock', props: { language: fence[1] || 'text' }, content: body.join('\n') }, 0, false);
      continue;
    }
    const heading = text.match(/^(#{1,6})\s+(.*)$/);
    if (heading && indent < 2) {
      place({ type: 'heading', props: { level: Math.min(3, heading[1].length) }, content: parseInline(heading[2]) }, 0, false);
      continue;
    }
    if (/^\|.*\|$/.test(text) && indent < 2) {
      const rows: string[] = [text];
      while (i + 1 < lines.length && /^\|.*\|$/.test(lines[i + 1].text)) rows.push(lines[++i].text);
      const cells = rows
        .filter((r) => !/^\|(\s*:?-{2,}:?\s*\|)+$/.test(r))
        .map((r) =>
          r
            .slice(1, -1)
            .split(/(?<!\\)\|/)
            .map((c) => c.trim().replace(/\\\|/g, '|')),
        );
      const width = Math.max(...cells.map((c) => c.length));
      place({ type: 'table', content: { type: 'tableContent', headerRows: 1, rows: cells.map((c) => ({ cells: Array.from({ length: width }, (_, k) => toCell(c[k] ?? '')) })) } } as Block, 0, false);
      continue;
    }
    const image = text.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (image) {
      place({ type: 'image', props: { url: image[2], caption: image[1] } }, indent, false);
      continue;
    }
    const check = text.match(/^[-*+]\s+\[([ xX])\]\s*(.*)$/);
    if (check) {
      place({ type: 'checkListItem', props: { checked: check[1] !== ' ' }, content: parseInline(check[2]) }, indent, true);
      continue;
    }
    const bullet = text.match(/^[-*+•]\s+(.*)$/);
    if (bullet) {
      place({ type: 'bulletListItem', content: parseInline(bullet[1]) }, indent, true);
      continue;
    }
    const numbered = text.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      place({ type: 'numberedListItem', content: parseInline(numbered[1]) }, indent, true);
      continue;
    }
    if (text.startsWith('>')) {
      const quoted = [text.replace(/^>\s?/, '')];
      while (i + 1 < lines.length && lines[i + 1].text.startsWith('>')) quoted.push(lines[++i].text.replace(/^>\s?/, ''));
      place({ type: 'quote', content: parseInline(quoted.join('\n')) }, 0, false);
      continue;
    }
    // A paragraph runs until a blank line or another kind of block
    const para = [text];
    while (i + 1 < lines.length && lines[i + 1].text && !/^(#{1,6}\s|[-*+•]\s|\d+[.)]\s|>|```|\|.*\||!\[)/.test(lines[i + 1].text)) para.push(lines[++i].text);
    place({ type: 'paragraph', content: parseInline(para.join('\n')) }, indent, false);
  }
  return root;
}

/** A cell as the editor accepts it: text or inline content. */
const toCell = (text: string) => parseInline(text);
