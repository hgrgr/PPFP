/**
 * What each outside service costs and how it limits calls, and how to read the rate-limit
 * headers services send back. Pure; the counting lives in server/services/api-usage.
 */
import { BROKERS, type BrokerId } from '@/lib/brokers';
import { PROVIDERS, type ProviderId } from './ai-providers';

export type ServiceGroup = 'ai' | 'data' | 'broker';

export interface ServiceInfo {
  name: string;
  group: ServiceGroup;
  /** How it bills */
  billing: string;
  /** How it limits calls */
  limit: string;
  /** Where to see the real usage, bill and limits */
  console?: string;
}

const AI_LIMIT: Record<ProviderId, { limit: string; console: string }> = {
  anthropic: { limit: '조직 등급(Tier)마다 분당 요청 수·입력 토큰·출력 토큰 한도가 있습니다.', console: 'https://console.anthropic.com/settings/limits' },
  openai: { limit: '사용 등급(Tier)마다 분당 요청 수·토큰 한도가 있습니다.', console: 'https://platform.openai.com/settings/organization/limits' },
  gemini: { limit: '무료·유료 등급마다 분당 요청 수와 하루 요청 수 한도가 있습니다.', console: 'https://aistudio.google.com/usage' },
  xai: { limit: '팀 등급마다 분당 요청 수·토큰 한도가 있습니다.', console: 'https://console.x.ai' },
  deepseek: { limit: '고정 한도 없이 서버 사정에 따라 느려질 수 있습니다.', console: 'https://platform.deepseek.com/usage' },
};

export function serviceInfo(service: string): ServiceInfo {
  if (service in PROVIDERS) {
    const id = service as ProviderId;
    return { name: PROVIDERS[id].name, group: 'ai', billing: '쓴 토큰만큼 과금 (모델마다 단가가 다름). 앱의 금액은 토큰 수로 계산한 추정치입니다.', ...AI_LIMIT[id] };
  }
  if (service.startsWith('broker:')) {
    const b = BROKERS[service.slice(7) as BrokerId];
    return {
      name: b?.label ?? service.slice(7),
      group: 'broker',
      billing: '무료 (계좌가 있으면 Open API를 쓸 수 있음)',
      limit: '초당 호출 수 제한이 있습니다. 앱은 호출 사이에 간격을 두고, 막히면 잠시 뒤 다시 시도합니다.',
      console: b?.portal,
    };
  }
  switch (service) {
    case 'kakao-book':
      return { name: '카카오 책 검색', group: 'data', billing: '무료', limit: '앱(REST API 키)마다 하루 호출 쿼터가 있습니다.', console: 'https://developers.kakao.com/console/app' };
    case 'kakao-local':
      return { name: '카카오 지도 검색', group: 'data', billing: '무료', limit: '앱(REST API 키)마다 하루 호출 쿼터가 있습니다. 카카오맵 사용 설정이 켜져 있어야 합니다.', console: 'https://developers.kakao.com/console/app' };
    case 'vworld':
      return { name: '브이월드 토지이용계획', group: 'data', billing: '무료 (공간정보 오픈플랫폼)', limit: '인증키마다 하루 호출 한도가 있습니다. 부동산 알림이 몇 시간에 한 번 아파트마다 한 번 부릅니다.', console: 'https://www.vworld.kr/dev/v4dv_2ddataguide_s001.do' };
    case 'molit':
      return { name: '국토교통부 실거래가', group: 'data', billing: '무료 (공공데이터포털)', limit: '개발계정은 하루 10,000회입니다. 앱은 넉 달이 지난 자료를 7일, 최근 넉 달은 6시간 저장해 두고 씁니다.', console: 'https://www.data.go.kr/data/15126468/openapi.do' };
    case 'openlibrary':
      return { name: 'Open Library', group: 'data', billing: '무료, 키 없음', limit: '정해진 한도는 없고 과도한 호출을 삼가 달라고 안내합니다.', console: 'https://openlibrary.org/developers/api' };
    case 'github':
      return { name: 'GitHub (스킬 파일)', group: 'data', billing: '무료', limit: '로그인 없이 쓰는 API는 IP마다 시간당 60회입니다.', console: 'https://docs.github.com/rest/using-the-rest-api/rate-limits-for-the-rest-api' };
    case 'skills.sh':
      return { name: 'skills.sh (공개 스킬 목록)', group: 'data', billing: '무료', limit: '공개 목록이라 키가 필요 없습니다. 앱은 목록을 하루 동안 저장해 두고 씁니다.', console: 'https://skills.sh' };
    default:
      return { name: service, group: 'data', billing: '—', limit: '—' };
  }
}

export interface RateWindow {
  /** requests, tokens, input tokens, output tokens */
  kind: string;
  limit: number | null;
  remaining: number | null;
  /** ISO instant, when known */
  reset: string | null;
}

const KIND_LABEL: Record<string, string> = { requests: '요청', tokens: '토큰', 'input-tokens': '입력 토큰', 'output-tokens': '출력 토큰', calls: '호출' };

/** "1s", "6m0s", "20ms" (OpenAI style) → milliseconds */
function durationMs(v: string): number | null {
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  let total = 0;
  let any = false;
  for (const m of v.matchAll(re)) {
    any = true;
    const n = Number(m[1]);
    total += m[2] === 'ms' ? n : m[2] === 's' ? n * 1000 : m[2] === 'm' ? n * 60_000 : n * 3_600_000;
  }
  return any ? total : null;
}

function resetAt(v: string | undefined, seenAt: Date): string | null {
  if (!v) return null;
  if (/^\d{9,11}$/.test(v)) return new Date(Number(v) * 1000).toISOString(); // epoch seconds (GitHub)
  const iso = Date.parse(v);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(v)) return new Date(iso).toISOString(); // Anthropic
  const ms = durationMs(v);
  return ms === null ? null : new Date(seenAt.getTime() + ms).toISOString();
}

/**
 * Read rate-limit headers in the styles services use:
 * Anthropic `anthropic-ratelimit-requests-remaining`, OpenAI-compatible `x-ratelimit-remaining-requests`,
 * GitHub `x-ratelimit-remaining`.
 */
export function parseRateLimits(headers: Record<string, string>, seenAt: Date): RateWindow[] {
  const byKind = new Map<string, { limit?: string; remaining?: string; reset?: string }>();
  const put = (kind: string, field: 'limit' | 'remaining' | 'reset', v: string) => {
    const w = byKind.get(kind) ?? {};
    w[field] = v;
    byKind.set(kind, w);
  };
  for (const [k, v] of Object.entries(headers)) {
    let m = /^anthropic-ratelimit-(requests|tokens|input-tokens|output-tokens)-(limit|remaining|reset)$/.exec(k);
    if (m) {
      put(m[1], m[2] as 'limit', v);
      continue;
    }
    m = /^x-ratelimit-(limit|remaining|reset)-(requests|tokens)$/.exec(k);
    if (m) {
      put(m[2], m[1] as 'limit', v);
      continue;
    }
    m = /^x-ratelimit-(limit|remaining|reset)$/.exec(k);
    if (m) put('calls', m[1] as 'limit', v);
  }
  const num = (v?: string) => (v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  return [...byKind.entries()]
    .map(([kind, w]) => ({ kind: KIND_LABEL[kind] ?? kind, limit: num(w.limit), remaining: num(w.remaining), reset: resetAt(w.reset, seenAt) }))
    .filter((w) => w.limit !== null || w.remaining !== null);
}

/** Month-end spend if the rest of the month goes like the days so far (KST). */
export function projectMonth(spent: number, now = new Date()): number {
  const k = new Date(now.getTime() + 9 * 3_600_000);
  const days = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = (k.getUTCDate() - 1 + (k.getUTCHours() * 60 + k.getUTCMinutes()) / 1440) || 1 / 24;
  return (spent / elapsed) * days;
}
