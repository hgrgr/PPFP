/**
 * Finds a book's author, publisher and year from its title. 카카오 책 검색 (with the user's
 * or the server's REST API key) covers Korean books; Open Library, which needs no key,
 * covers books in English.
 */
import 'server-only';
import { dedupeHits, isKorean, parseKakao, parseOpenLibrary, type BookHit } from '@/domain/book-search';
import { UserError } from './portfolios';
import { clearServiceKey, serviceKey, setServiceKey } from './api-keys';
import { noteCall, outcomeOf } from './api-usage';

export interface BookSearch {
  hits: BookHit[];
  /** A Korean title was searched without a 카카오 key */
  needsKey: boolean;
}

async function getJson(userId: string, service: string, url: string, headers: Record<string, string> = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: 'application/json', ...headers }, cache: 'no-store', signal: AbortSignal.timeout(8_000) });
  } catch (e) {
    noteCall(userId, service, 'error');
    throw e;
  }
  noteCall(userId, service, outcomeOf(res.status), res.headers);
  if (res.status === 401 || res.status === 403) throw new UserError('카카오 REST API 키가 올바르지 않습니다. 연동 · 설정에서 확인하세요.');
  if (!res.ok) throw new Error(`book search ${new URL(url).hostname} ${res.status}`);
  return res.json();
}

export async function searchBooks(userId: string, query: string): Promise<BookSearch> {
  const q = query.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (q.length < 2) throw new UserError('책 제목을 두 글자 이상 입력하세요.');
  const kakao = await serviceKey(userId, 'kakao', 'KAKAO_REST_API_KEY');
  const hits: BookHit[] = [];
  try {
    if (kakao) {
      const body = await getJson(userId, 'kakao-book', `https://dapi.kakao.com/v3/search/book?${new URLSearchParams({ query: q, size: '10' })}`, { authorization: `KakaoAK ${kakao.key}` });
      hits.push(...parseKakao(body));
    }
    if (!hits.length && !isKorean(q)) {
      const params = new URLSearchParams({ q, limit: '10', fields: 'title,author_name,publisher,first_publish_year,isbn' });
      hits.push(...parseOpenLibrary(await getJson(userId, 'openlibrary', `https://openlibrary.org/search.json?${params}`, { 'user-agent': 'PPFP (personal portfolio app)' })));
    }
  } catch (e) {
    if (e instanceof UserError) throw e;
    console.error('[books] search failed', e instanceof Error ? e.message : e);
    throw new UserError('책 정보를 찾지 못했습니다. 잠시 후 다시 시도하세요.');
  }
  return { hits: dedupeHits(hits), needsKey: !kakao && isKorean(q) };
}

export async function saveBookSearchKey(userId: string, input: { key?: string; clear?: boolean }) {
  const key = input.key?.trim();
  if (key) {
    if (!/^[0-9a-f]{32}$/i.test(key)) throw new UserError('카카오 REST API 키는 32자리 영문·숫자입니다.');
    await setServiceKey(userId, 'kakao', key);
  } else if (input.clear) await clearServiceKey(userId, 'kakao');
}
