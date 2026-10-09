/**
 * Which AI companies the advisor can run on, the models offered for each, and which
 * model each agent uses. Claude runs on the Messages API with web search; the others
 * run on their OpenAI-compatible Chat Completions endpoints, without web search.
 * Pure; keys and calls live in server/services/ai.
 */
import { AI_MODEL, type AgentKind } from './ai';

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'xai' | 'deepseek';

export interface ProviderInfo {
  name: string;
  /** Environment variable for the server's default key */
  env: string;
  keyPattern: RegExp;
  keyPlaceholder: string;
  consoleUrl: string;
  /** Chat Completions base URL (not for Claude) */
  baseUrl?: string;
  /** Offered in the model picker; any other model id the key can use also works */
  models: { id: string; label: string }[];
  webSearch: boolean;
}

export const PROVIDER_ORDER: ProviderId[] = ['anthropic', 'openai', 'gemini', 'xai', 'deepseek'];

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    name: 'Claude (Anthropic)',
    env: 'ANTHROPIC_API_KEY',
    keyPattern: /^sk-ant-[\w-]{20,}$/,
    keyPlaceholder: 'sk-ant-…',
    consoleUrl: 'https://console.anthropic.com/settings/keys',
    models: [
      { id: AI_MODEL, label: 'Claude Opus 5.5 (기본)' },
      { id: 'claude-fable-5-1', label: 'Claude Fable 5.1 (가장 뛰어남, 비쌈)' },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (빠름)' },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (가장 저렴)' },
    ],
    webSearch: true,
  },
  openai: {
    name: 'ChatGPT (OpenAI)',
    env: 'OPENAI_API_KEY',
    keyPattern: /^sk-[\w-]{20,}$/,
    keyPlaceholder: 'sk-…',
    consoleUrl: 'https://platform.openai.com/api-keys',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      { id: 'gpt-6-astra', label: 'GPT-6 Astra' },
      { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna (저렴)' },
    ],
    webSearch: false,
  },
  gemini: {
    name: 'Gemini (Google)',
    env: 'GEMINI_API_KEY',
    keyPattern: /^[\w-]{30,}$/,
    keyPlaceholder: 'AIza…',
    consoleUrl: 'https://aistudio.google.com/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: [
      { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro (미리보기)' },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash' },
      { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (저렴)' },
    ],
    webSearch: false,
  },
  xai: {
    name: 'Grok (xAI)',
    env: 'XAI_API_KEY',
    keyPattern: /^xai-[\w-]{20,}$/,
    keyPlaceholder: 'xai-…',
    consoleUrl: 'https://console.x.ai',
    baseUrl: 'https://api.x.ai/v1',
    models: [
      { id: 'grok-4.7', label: 'Grok 4.7' },
      { id: 'grok-4.6', label: 'Grok 4.6' },
    ],
    webSearch: false,
  },
  deepseek: {
    name: 'DeepSeek',
    env: 'DEEPSEEK_API_KEY',
    keyPattern: /^sk-[\w-]{20,}$/,
    keyPlaceholder: 'sk-…',
    consoleUrl: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com/v1',
    models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash (저렴)' },
    ],
    webSearch: false,
  },
};

export const isProvider = (v: unknown): v is ProviderId => typeof v === 'string' && (PROVIDER_ORDER as string[]).includes(v);

/** A model id as providers write them: letters, digits and - . _ : / */
export const isModelId = (v: string) => /^[\w][\w.:/-]{0,99}$/.test(v);

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

export const DEFAULT_CHOICE: ModelChoice = { provider: 'anthropic', model: AI_MODEL };

/** "Claude (Anthropic) · claude-opus-5-5" */
export const choiceLabel = (c: ModelChoice) => {
  const known = PROVIDERS[c.provider].models.find((m) => m.id === c.model);
  return `${PROVIDERS[c.provider].name} · ${known ? known.label.replace(/\s*\(.*\)$/, '') : c.model}`;
};

/** Labels of what each agent answers with, for the chat footer. */
export const modelLabels = <K extends string>(m: Record<K, ModelChoice | null>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v ? choiceLabel(v as ModelChoice) : null])) as Record<K, string | null>;

/** Stored per-agent choices, read defensively: `{ MANAGER: { provider, model }, … }` */
export function readAgentModels(raw: unknown): Partial<Record<AgentKind, ModelChoice>> {
  const out: Partial<Record<AgentKind, ModelChoice>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [agent, v] of Object.entries(raw as Record<string, unknown>)) {
    const c = v as { provider?: unknown; model?: unknown } | null;
    if (c && isProvider(c.provider) && typeof c.model === 'string' && isModelId(c.model)) out[agent as AgentKind] = { provider: c.provider, model: c.model };
  }
  return out;
}

/**
 * The model a new conversation with `agent` uses: the user's pick if its company has a
 * key, otherwise Claude when it has one, otherwise the first company with a key.
 */
export function modelFor(agent: AgentKind, picks: Partial<Record<AgentKind, ModelChoice>>, hasKey: (p: ProviderId) => boolean): ModelChoice | null {
  const pick = picks[agent];
  if (pick && hasKey(pick.provider)) return pick;
  if (hasKey('anthropic')) return DEFAULT_CHOICE;
  const p = PROVIDER_ORDER.find(hasKey);
  return p ? { provider: p, model: PROVIDERS[p].models[0].id } : null;
}

// ---------------------------------------------------------------- Claude model details

/** Models the web search / fetch tools with dynamic filtering run on; others get the basic tools. */
export const claudeHasDynamicWebTools = (model: string) => /^claude-(opus|sonnet)-/.test(model);

/** Models that accept server-side refusal fallbacks (`fallbacks: "default"`). */
export const claudeHasFallbacks = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);
