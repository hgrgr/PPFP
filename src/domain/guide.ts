/**
 * Showing docs/user-guide.md inside the app: heading anchors that match GitHub's (so the
 * guide's own #links work), and links and images pointed where they live when served.
 */
const REPO = 'https://github.com/hgrgr/PPFP/blob/main';

/** GitHub's heading id: lower case, punctuation dropped (letters of any script kept), spaces to hyphens. */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** Gives repeated headings -1, -2 … as GitHub does. */
export function slugger() {
  const seen = new Map<string, number>();
  return (text: string) => {
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Where a link in the guide goes in the app: anchors stay, repo files go to GitHub. */
export function guideHref(href: string): { href: string; external: boolean } {
  if (href.startsWith('#')) return { href, external: false };
  if (/^[a-z]+:/i.test(href)) return { href, external: true };
  // Relative to docs/: ../README.md#x → the repository's README on GitHub
  const path = href.startsWith('../') ? href.slice(3) : `docs/${href}`;
  return { href: `${REPO}/${path}`, external: true };
}

/** images/x.webp → /guide/images/x.webp (copied into public/ at build) */
export const guideImage = (src: string) => (src.startsWith('images/') ? `/guide/${src}` : src);

/**
 * The guide writes some images as HTML (<img src alt width>) to size them; the app renders
 * Markdown only, so those become Markdown images (the width moves to the title, see the page).
 */
export function htmlImagesToMarkdown(md: string): string {
  return md.replace(/<img\s+([^>]*?)\/?>/g, (tag, attrs: string) => {
    const attr = (name: string) => attrs.match(new RegExp(`${name}="([^"]*)"`))?.[1];
    const src = attr('src');
    if (!src) return tag;
    const width = attr('width');
    return `![${attr('alt') ?? ''}](${src}${width ? ` "w=${width}"` : ''})`;
  });
}
