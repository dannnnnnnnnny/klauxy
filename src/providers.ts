import { ChatTranslator, DEFAULT_CHAT_PATH } from "./chat-translator.js";
import type { Translator } from "./pipeline.js";

export type ProviderId = "omlx" | "ollama" | "opencode";

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  description: string;
  defaultHost: string;
  defaultModel: string;
  chatPath: string;
  modelsPath: string;
  extraBody?: Record<string, unknown>;
  setupHint: string;
  /**
   * Environment variable holding this provider's API key, when it needs one.
   * Keys are never written to config.toml so they stay out of shared dotfiles
   * and out of `klx config get` output.
   */
  apiKeyEnv?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderDefinition> = {
  omlx: {
    id: "omlx",
    label: "oMLX",
    description: "Local Apple-silicon MLX server (fastest on Mac)",
    defaultHost: "http://127.0.0.1:8010",
    defaultModel: "Qwen3-8B-4bit",
    chatPath: DEFAULT_CHAT_PATH,
    modelsPath: "/v1/models",
    extraBody: { chat_template_kwargs: { enable_thinking: false } },
    setupHint: "Start the oMLX app, then load a model such as Qwen3-8B-4bit.",
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    description: "Local Ollama server with OpenAI-compatible API",
    defaultHost: "http://127.0.0.1:11434",
    defaultModel: "qwen2.5:7b",
    chatPath: DEFAULT_CHAT_PATH,
    modelsPath: "/v1/models",
    setupHint: "Run: ollama serve, then: ollama pull qwen2.5:7b",
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    description: "OpenCode Go server with OpenAI-compatible API",
    defaultHost: "http://127.0.0.1:4096",
    defaultModel: "qwen2.5:7b",
    chatPath: DEFAULT_CHAT_PATH,
    modelsPath: "/v1/models",
    apiKeyEnv: "OPENCODE_API_KEY",
    setupHint: "Start the OpenCode server, then confirm its host and model id.",
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDERS) as ProviderId[];

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(PROVIDERS, value);
}

export function providerDefinition(id: ProviderId): ProviderDefinition {
  return PROVIDERS[id];
}

export interface TranslatorSettings {
  provider: ProviderId;
  host: string;
  model: string;
  timeout_ms: number;
  max_tokens: number;
  system_prompt: string;
}

/**
 * Reads a provider's API key from the environment.
 *
 * Keys deliberately live in the environment rather than config.toml: the config
 * file is printed by `klx config get` and is easy to commit by accident.
 */
export function providerApiKey(
  id: ProviderId,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const name = providerDefinition(id).apiKeyEnv;
  if (name === undefined) return undefined;
  const value = env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

export function createTranslator(settings: TranslatorSettings): Translator {
  const definition = providerDefinition(settings.provider);
  const key = providerApiKey(settings.provider);
  return new ChatTranslator({
    host: settings.host,
    model: settings.model,
    timeout_ms: settings.timeout_ms,
    max_tokens: settings.max_tokens,
    system_prompt: settings.system_prompt,
    chat_path: definition.chatPath,
    label: definition.label,
    ...(key === undefined ? {} : { api_key: key }),
    ...(definition.extraBody === undefined ? {} : { extra_body: definition.extraBody }),
  });
}

export function modelsEndpoint(id: ProviderId, host: string): string {
  return [host.replace(/\/$/, ""), providerDefinition(id).modelsPath].join("");
}

export interface ProbeResult {
  reachable: boolean;
  models: string[];
  error?: string;
}

export async function probeProvider(
  id: ProviderId,
  host: string,
  timeoutMs: number,
): Promise<ProbeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const key = providerApiKey(id);
    const response = await fetch(modelsEndpoint(id, host), {
      signal: controller.signal,
      ...(key === undefined ? {} : { headers: { authorization: ["Bearer ", key].join("") } }),
    });
    if (!response.ok) throw new Error(["HTTP ", response.status].join(""));
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> };
    const models =
      body.data?.flatMap((item) => (typeof item.id === "string" ? [item.id] : [])) ?? [];
    return { reachable: true, models };
  } catch (error) {
    return {
      reachable: false,
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
