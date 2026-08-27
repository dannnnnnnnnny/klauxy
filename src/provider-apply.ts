import { applyProvider, type Config, loadConfig, setConfigValue } from "./config.js";
import type { ProviderId } from "./providers.js";

export interface ProviderChoice {
  provider: ProviderId;
  /** Explicit override; when absent the provider's default is used. */
  host?: string;
  model?: string;
}

export interface AppliedProvider {
  provider: ProviderId;
  host: string;
  model: string;
}

/**
 * Resolves what a provider switch should end up with, without touching disk.
 *
 * Switching retargets host and model to the new provider's defaults, but only
 * when the current values still match the previous provider's defaults. A value
 * the user set explicitly is preserved, and an explicit override always wins.
 */
export function resolveChoice(current: Config, choice: ProviderChoice): AppliedProvider {
  const next = structuredClone(current);
  applyProvider(next, choice.provider);
  return {
    provider: choice.provider,
    host: choice.host ?? next.translation.host,
    model: choice.model ?? next.translation.model,
  };
}

/**
 * Persists a provider choice.
 *
 * Writes each key through `setConfigValue` so the file keeps its TOML shape and
 * unrelated settings survive.
 */
export async function applyChoice(
  configPath: string,
  choice: ProviderChoice,
): Promise<AppliedProvider> {
  const resolved = resolveChoice(await loadConfig(configPath), choice);
  await setConfigValue(configPath, "translation.provider", resolved.provider);
  await setConfigValue(configPath, "translation.host", resolved.host);
  await setConfigValue(configPath, "translation.model", resolved.model);
  return resolved;
}
