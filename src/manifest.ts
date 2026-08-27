import { readFile } from "node:fs/promises";
import { readClaudeUpstream } from "./claude-settings.js";
import { isProxyOrigin } from "./executable.js";
import type { KlauxyPaths } from "./paths.js";
import { PROXY_HOST, PROXY_PORT, proxyBaseUrl } from "./proxy-service.js";

/** What `klx install` records so later runs can find Claude and the upstream. */
export interface Manifest {
  realClaude: string;
  entry: string;
  upstream: string;
}

export const DEFAULT_UPSTREAM = "https://api.anthropic.com";

export async function readManifest(path: string): Promise<Manifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // Reached by the shims and the daemon, so name the fix rather than leaking
    // an ENOENT with an internal path.
    throw new Error("Klauxy is not installed yet; run: klx setup");
  }

  let value: Partial<Manifest>;
  try {
    value = JSON.parse(raw) as Partial<Manifest>;
  } catch {
    throw new Error("Klauxy installation manifest is corrupted; run: klx install");
  }

  if (
    typeof value.realClaude !== "string" ||
    typeof value.entry !== "string" ||
    typeof value.upstream !== "string"
  ) {
    throw new Error("Klauxy installation manifest is incomplete; run: klx install");
  }
  return value as Manifest;
}

/** True when the value points back at Klauxy's own proxy. */
function isSelf(value: string | undefined): boolean {
  if (!value) return false;
  return (
    value === proxyBaseUrl() ||
    value === `http://${PROXY_HOST}:${PROXY_PORT}` ||
    isProxyOrigin(value)
  );
}

export interface UpstreamSources {
  /** `ANTHROPIC_BASE_URL` from the environment, if set. */
  environment: string | undefined;
  claudeSettings: string | undefined;
  manifest: string | undefined;
}

/**
 * Chooses the real Anthropic endpoint to forward to.
 *
 * Any candidate that resolves to Klauxy's own proxy is rejected, since adopting
 * it would make the proxy forward to itself and loop. Ordering prefers the most
 * explicit signal: an env var the user set, then Claude's own settings, then
 * whatever a previous install recorded.
 */
export function chooseUpstream(sources: UpstreamSources): string {
  for (const candidate of [sources.environment, sources.claudeSettings, sources.manifest]) {
    if (candidate !== undefined && candidate.length > 0 && !isSelf(candidate)) return candidate;
  }
  return DEFAULT_UPSTREAM;
}

/** Gathers the candidates from disk and environment, then picks one. */
export async function detectUpstream(
  paths: KlauxyPaths,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  let recorded: string | undefined;
  try {
    recorded = (await readManifest(paths.manifest)).upstream;
  } catch {
    // First install, or a manifest written by an older version.
  }
  return chooseUpstream({
    environment: env.ANTHROPIC_BASE_URL,
    claudeSettings: (await readClaudeUpstream(paths.claudeSettings)) ?? undefined,
    manifest: recorded,
  });
}
