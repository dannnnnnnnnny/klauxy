import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { LEGACY_KAGENT_HEALTH, LEGACY_KAGENT_PROXY } from "./paths.js";

export type IsShimPredicate = (candidate: string) => Promise<boolean>;

function defaultIsShim(newShimPath: string): (candidate: string) => Promise<boolean> {
  return async (candidate: string) => {
    try {
      const resolvedCandidate = await realpath(candidate);
      const resolvedShim = await realpath(newShimPath);
      if (resolvedCandidate === resolvedShim) return true;
    } catch {
      if (candidate === newShimPath) return true;
    }
    return false;
  };
}

export async function resolveRealClaude(
  pathDirs: string[],
  shimPath: string,
  isShim?: IsShimPredicate,
): Promise<string> {
  const predicate = isShim ?? defaultIsShim(shimPath);

  for (const directory of pathDirs) {
    const candidate = join(directory, "claude");
    try {
      await access(candidate, constants.X_OK);
      if (await predicate(candidate)) continue;
      return candidate;
    } catch {
      // Missing, non-executable, or broken PATH entries are skipped.
    }
  }
  throw new Error("could not locate the real Claude Code executable");
}

export function isProxyOrigin(value: string | undefined): boolean {
  if (!value) return false;
  return value.startsWith(LEGACY_KAGENT_PROXY) || value.startsWith("http://127.0.0.1:18789");
}

export function isHealthEndpoint(value: string | undefined): boolean {
  if (!value) return false;
  return value.endsWith(LEGACY_KAGENT_HEALTH) || value.endsWith("/__klauxy/health");
}
