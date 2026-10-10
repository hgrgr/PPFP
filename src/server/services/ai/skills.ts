/**
 * Advisor skills: the user's own and ones imported from the community. The catalog is the
 * investing slice of skills.sh, ranked by installs (its public search, the one the skills CLI
 * uses); a skill's text is read from its GitHub repository. Both are cached for an hour.
 */
import 'server-only';
import { AGENT_ORDER, type AgentKind } from '@/domain/ai';
import { CATALOG_TERMS, parseSkillMd, pickSkillPath, rankCatalog, skillFolderFiles, skillSlug, SKILL_LIMITS, type CatalogEntry } from '@/domain/ai-skills';
import { prisma } from '../../db';
import { UserError } from '../portfolios';
import { noteCall, outcomeOf } from '../api-usage';

const HOUR = 3_600_000;
const g = globalThis as unknown as { ppfpSkillCache?: Map<string, { at: number; value: unknown }> };
const cache = (g.ppfpSkillCache ??= new Map());

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value as T;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** GitHub (API and raw files) or the skills.sh directory, for the usage page */
const serviceOf = (url: string) => (new URL(url).hostname.endsWith('skills.sh') ? 'skills.sh' : 'github');

async function tracked(url: string, init: RequestInit): Promise<Response> {
  try {
    const res = await fetch(url, init);
    noteCall(null, serviceOf(url), outcomeOf(res.status), res.headers);
    return res;
  } catch (e) {
    noteCall(null, serviceOf(url), 'error');
    throw e;
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await tracked(url, { headers: { accept: 'application/json', 'user-agent': 'PPFP (personal portfolio app)' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (res.status === 403 || res.status === 429) throw new UserError('잠시 요청이 많아 막혔습니다. 몇 분 뒤에 다시 시도하세요.');
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.json();
}

async function getText(url: string): Promise<string> {
  const res = await tracked(url, { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} ${res.status}`);
  return res.text();
}

// ---------------------------------------------------------------- the user's skills

export interface SkillView {
  id: string;
  name: string;
  description: string;
  instructions: string;
  agents: AgentKind[];
  enabled: boolean;
  source: string;
  sourceId: string | null;
  sourceUrl: string | null;
  license: string | null;
  installs: number | null;
  resources: string[];
  skipped: string[];
  updatedAt: string;
}

const agentsOf = (v: string[]) => v.filter((a): a is AgentKind => (AGENT_ORDER as string[]).includes(a));

export async function listSkills(userId: string): Promise<SkillView[]> {
  const rows = await prisma.aiSkill.findMany({ where: { userId }, orderBy: [{ enabled: 'desc' }, { name: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    instructions: r.instructions,
    agents: agentsOf(r.agents),
    enabled: r.enabled,
    source: r.source,
    sourceId: r.sourceId,
    sourceUrl: r.sourceUrl,
    license: r.license,
    installs: r.installs,
    resources: (Array.isArray(r.resources) ? (r.resources as { path?: string }[]) : []).map((x) => String(x.path ?? '')),
    skipped: Array.isArray(r.skipped) ? (r.skipped as string[]) : [],
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Skills an agent has, for its instructions. */
export async function skillsFor(userId: string, agent: AgentKind) {
  return prisma.aiSkill.findMany({ where: { userId, enabled: true, agents: { has: agent } }, orderBy: { name: 'asc' }, select: { name: true, description: true } });
}

/** What use_skill returns: the instructions, or one of the skill's reference files. */
export async function readSkill(userId: string, name: string, file?: string): Promise<{ name: string; instructions?: string; file?: string; content?: string; files: string[] }> {
  const s = await prisma.aiSkill.findFirst({ where: { userId, enabled: true, name: skillSlug(name) } });
  if (!s) throw new UserError(`'${name}' 스킬이 없습니다. 설치된 스킬 목록의 이름을 그대로 쓰세요.`);
  const resources = Array.isArray(s.resources) ? (s.resources as { path: string; content: string }[]) : [];
  const files = resources.map((r) => r.path);
  if (file) {
    const r = resources.find((x) => x.path === file || x.path.endsWith(`/${file}`));
    if (!r) throw new UserError(`'${file}' 파일이 이 스킬에 없습니다. 있는 파일: ${files.join(', ') || '없음'}`);
    return { name: s.name, file: r.path, content: r.content, files };
  }
  return { name: s.name, instructions: s.instructions, files };
}

function cleanAgents(v: unknown): AgentKind[] {
  return Array.isArray(v) ? [...new Set(agentsOf(v.map(String)))] : [];
}

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
  agents: string[];
  enabled?: boolean;
}

function validate(input: SkillInput) {
  const name = skillSlug(input.name);
  if (!name) throw new UserError('스킬 이름을 입력하세요.');
  const description = input.description.trim();
  if (!description) throw new UserError('언제 쓰는 스킬인지 설명을 입력하세요. 에이전트는 이 설명을 보고 스킬을 고릅니다.');
  if (description.length > SKILL_LIMITS.description) throw new UserError(`설명은 ${SKILL_LIMITS.description.toLocaleString('ko-KR')}자까지입니다.`);
  const instructions = input.instructions.trim();
  if (!instructions) throw new UserError('지침을 입력하세요.');
  if (instructions.length > SKILL_LIMITS.instructions) throw new UserError(`지침은 ${SKILL_LIMITS.instructions.toLocaleString('ko-KR')}자까지입니다.`);
  return { name, description, instructions, agents: cleanAgents(input.agents) };
}

/** Creates (no id) or updates a skill. Returns its id. */
export async function saveSkill(userId: string, id: string | null, input: SkillInput): Promise<string> {
  const v = validate(input);
  const clash = await prisma.aiSkill.findFirst({ where: { userId, name: v.name, ...(id ? { NOT: { id } } : {}) } });
  if (clash) throw new UserError(`'${v.name}' 이름의 스킬이 이미 있습니다. 다른 이름을 쓰세요.`);
  if (id) {
    const r = await prisma.aiSkill.updateMany({ where: { id, userId }, data: { ...v, ...(input.enabled === undefined ? {} : { enabled: input.enabled }) } });
    if (!r.count) throw new UserError('스킬을 찾을 수 없습니다.');
    return id;
  }
  return (await prisma.aiSkill.create({ data: { userId, ...v, enabled: input.enabled ?? true } })).id;
}

export async function updateSkillUse(userId: string, id: string, input: { enabled?: boolean; agents?: string[] }) {
  const r = await prisma.aiSkill.updateMany({
    where: { id, userId },
    data: { ...(input.enabled === undefined ? {} : { enabled: input.enabled }), ...(input.agents ? { agents: cleanAgents(input.agents) } : {}) },
  });
  if (!r.count) throw new UserError('스킬을 찾을 수 없습니다.');
}

export async function deleteSkill(userId: string, id: string) {
  const r = await prisma.aiSkill.deleteMany({ where: { id, userId } });
  if (!r.count) throw new UserError('스킬을 찾을 수 없습니다.');
}

// ---------------------------------------------------------------- community

export async function communityCatalog(): Promise<{ items: CatalogEntry[]; fetchedAt: string }> {
  return cached('catalog', HOUR, async () => {
    const results = await Promise.all(
      CATALOG_TERMS.map((q) => getJson(`https://skills.sh/api/search?${new URLSearchParams({ q, limit: '100' })}`).catch((e) => (console.error('[skills] search', q, e instanceof Error ? e.message : e), null))),
    );
    const items = rankCatalog(results.filter(Boolean));
    if (!items.length) throw new UserError('커뮤니티 스킬 목록을 받지 못했습니다. 잠시 후 다시 시도하세요.');
    return { items, fetchedAt: new Date().toISOString() };
  });
}

const ID = /^[\w.-]+\/[\w.-]+\/[\w.:-]+$/;

/** Every file path in a repository's default branch. */
async function repoFiles(source: string): Promise<string[]> {
  return cached(`tree:${source}`, HOUR, async () => {
    const body = (await getJson(`https://api.github.com/repos/${source}/git/trees/HEAD?recursive=1`)) as { tree?: { path: string; type: string }[] };
    if (!Array.isArray(body.tree)) throw new UserError('GitHub에서 이 스킬의 저장소를 읽지 못했습니다.');
    return body.tree.filter((t) => t.type === 'blob').map((t) => t.path);
  });
}

export interface CommunitySkill {
  id: string;
  source: string;
  path: string;
  url: string;
  installs: number | null;
  name: string;
  description: string;
  license: string | null;
  instructions: string;
  resources: { path: string; content: string }[];
  skipped: string[];
}

/** A community skill's full text, read from GitHub. */
export async function communitySkill(id: string): Promise<CommunitySkill> {
  if (!ID.test(id)) throw new UserError('잘못된 스킬입니다.');
  const [owner, repo, skillId] = id.split('/');
  const source = `${owner}/${repo}`;
  return cached(`skill:${id}`, HOUR, async () => {
    const paths = await repoFiles(source);
    const path = pickSkillPath(paths, skillId);
    if (!path) throw new UserError('저장소에서 이 스킬의 SKILL.md를 찾지 못했습니다.');
    const raw = (p: string) => getText(`https://raw.githubusercontent.com/${source}/HEAD/${p.split('/').map(encodeURIComponent).join('/')}`);
    const parsed = parseSkillMd(await raw(path));
    const { docs, skipped } = skillFolderFiles(paths, path);
    const dir = path.slice(0, -'SKILL.md'.length);
    const resources = [];
    for (const d of docs) resources.push({ path: d.slice(dir.length), content: (await raw(d)).slice(0, SKILL_LIMITS.resource) });
    const listed = (await communityCatalog().catch(() => null))?.items.find((x) => x.id === id);
    return {
      id,
      source,
      path,
      url: `https://github.com/${source}/blob/HEAD/${path}`,
      installs: listed?.installs ?? null,
      name: parsed.name,
      description: parsed.description,
      license: parsed.license,
      instructions: parsed.instructions.slice(0, SKILL_LIMITS.instructions),
      resources,
      skipped,
    };
  });
}

/** Imports a community skill (or refreshes one imported before) for the chosen agents. */
export async function installCommunitySkill(userId: string, id: string, agents: string[]): Promise<string> {
  const c = await communitySkill(id);
  const data = {
    description: (c.description || `${c.name} (${c.source})`).slice(0, SKILL_LIMITS.description),
    instructions: c.instructions,
    resources: c.resources,
    agents: cleanAgents(agents),
    source: 'skills.sh',
    sourceId: c.id,
    sourcePath: c.path,
    sourceUrl: c.url,
    license: c.license,
    installs: c.installs,
    skipped: c.skipped,
  };
  const had = await prisma.aiSkill.findFirst({ where: { userId, sourceId: id } });
  if (had) {
    await prisma.aiSkill.update({ where: { id: had.id }, data });
    return had.id;
  }
  let name = c.name;
  for (let n = 2; await prisma.aiSkill.findFirst({ where: { userId, name } }); n++) name = `${c.name}-${n}`;
  return (await prisma.aiSkill.create({ data: { userId, name, ...data } })).id;
}

/** Reads an imported skill again from its repository, keeping which agents use it. */
export async function refreshSkill(userId: string, id: string): Promise<string> {
  const s = await prisma.aiSkill.findFirst({ where: { id, userId } });
  if (!s?.sourceId) throw new UserError('커뮤니티에서 가져온 스킬만 다시 가져올 수 있습니다.');
  cache.delete(`skill:${s.sourceId}`);
  cache.delete(`tree:${s.sourceId.split('/').slice(0, 2).join('/')}`);
  return installCommunitySkill(userId, s.sourceId, s.agents);
}
