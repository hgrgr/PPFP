/**
 * Book lookup by title: turns 카카오 책 검색 and Open Library answers into one shape so a
 * book note can fill in its author, publisher and year. Pure; the service does the calls.
 */

export interface BookHit {
  title: string;
  authors: string[];
  publisher: string | null;
  year: number | null;
  isbn: string | null;
  source: 'kakao' | 'openlibrary';
}

/** Has Hangul: Open Library knows almost no Korean books, so such queries need 카카오. */
export const isKorean = (q: string) => /[ㄱ-ㆎ가-힣]/.test(q);

const year = (v: unknown): number | null => {
  const m = typeof v === 'string' ? v.match(/^(\d{4})/) : typeof v === 'number' ? [String(v), String(v)] : null;
  const y = m ? Number(m[1]) : NaN;
  return Number.isInteger(y) && y >= 1000 && y <= 3000 ? y : null;
};

const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null);
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim()) : []);

/** 카카오 책 검색 (dapi.kakao.com/v3/search/book). `isbn` is "ISBN10 ISBN13"; the 13-digit one is kept. */
export function parseKakao(body: unknown): BookHit[] {
  const docs = (body as { documents?: unknown })?.documents;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((d: Record<string, unknown>) => {
    const title = text(d.title, 200);
    if (!title) return [];
    const isbns = typeof d.isbn === 'string' ? d.isbn.split(/\s+/).filter(Boolean) : [];
    return [{ title, authors: strings(d.authors).slice(0, 5), publisher: text(d.publisher, 100), year: year(d.datetime), isbn: isbns.find((x) => x.length === 13) ?? isbns[0] ?? null, source: 'kakao' as const }];
  });
}

/** Open Library search.json. A work lists every edition's publisher; the first is shown. */
export function parseOpenLibrary(body: unknown): BookHit[] {
  const docs = (body as { docs?: unknown })?.docs;
  if (!Array.isArray(docs)) return [];
  return docs.flatMap((d: Record<string, unknown>) => {
    const title = text(d.title, 200);
    if (!title) return [];
    const isbn = strings(d.isbn).find((x) => x.length === 13) ?? null;
    return [{ title, authors: strings(d.author_name).slice(0, 5), publisher: strings(d.publisher)[0]?.slice(0, 100) ?? null, year: year(d.first_publish_year), isbn, source: 'openlibrary' as const }];
  });
}

/** Same book listed twice (another printing, another format): keep the first. */
export function dedupeHits(hits: BookHit[], max = 8): BookHit[] {
  const seen = new Set<string>();
  const out: BookHit[] = [];
  for (const h of hits) {
    const k = h.isbn ?? `${h.title.replace(/\s+/g, '').toLowerCase()}|${h.authors[0] ?? ''}|${h.publisher ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(h);
    if (out.length >= max) break;
  }
  return out;
}

/** "벤저민 그레이엄 · 국일증권경제연구소 · 2020" */
export const hitLine = (h: BookHit) => [h.authors.join(', '), h.publisher, h.year].filter(Boolean).join(' · ');
