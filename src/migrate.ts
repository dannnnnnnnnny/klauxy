import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type HistoryEntry, readHistory } from "./history.js";
import { klauxyPaths, legacyKagentPaths } from "./paths.js";

/**
 * One-time migration from the pre-rename KAgent layout.
 *
 * Kept separate from install so the rename path can be deleted in one piece
 * once no KAgent installations remain in the wild.
 */

const HISTORY_LIMIT = 100;

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(source: string, destination: string): Promise<void> {
  const content = await readFile(source);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(destination, content, { mode: 0o600 });
}

/** Merges two history logs, dropping duplicates and keeping the newest entries. */
export function mergeHistory(canonical: HistoryEntry[], legacy: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>();
  const merged: HistoryEntry[] = [];
  for (const entry of [...canonical, ...legacy]) {
    const key = [entry.timestamp, entry.original, entry.sent].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(entry);
  }
  merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return merged.slice(-HISTORY_LIMIT);
}

async function writeHistoryEntries(path: string, entries: HistoryEntry[]): Promise<void> {
  const temporary = [path, ".tmp-", process.pid, "-", Date.now()].join("");
  const body = entries.map((entry) => JSON.stringify(entry)).join("\n");
  await writeFile(temporary, body.length === 0 ? "" : [body, "\n"].join(""), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function readLegacyManifest(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>;
  } catch {
    // Corrupted or absent; treated as no legacy manifest.
  }
  return null;
}

/**
 * Copies legacy config, state, and history to the canonical paths.
 *
 * Existing canonical files always win, so running this twice is safe and an
 * interrupted migration never overwrites newer data.
 */
export async function migrateLegacyKagent(home: string): Promise<void> {
  const canonical = klauxyPaths(home);
  const legacy = legacyKagentPaths(home);

  const present = await Promise.all(
    [legacy.config, legacy.state, legacy.history, legacy.claudeSettingsBackup, legacy.manifest].map(
      fileExists,
    ),
  );
  if (!present.some(Boolean)) return;

  await mkdir(canonical.configDir, { recursive: true, mode: 0o700 });

  for (const [source, destination] of [
    [legacy.config, canonical.config],
    [legacy.state, canonical.state],
    [legacy.claudeSettingsBackup, canonical.claudeSettingsBackup],
  ] as const) {
    if ((await fileExists(source)) && !(await fileExists(destination))) {
      await copyFile(source, destination);
    }
  }

  if (await fileExists(legacy.history)) {
    const existing = (await fileExists(canonical.history))
      ? await readHistory(canonical.history)
      : [];
    await writeHistoryEntries(
      canonical.history,
      mergeHistory(existing, await readHistory(legacy.history)),
    );
  }
}

/** Real Claude path recorded by a previous KAgent install, if any. */
export async function getLegacyRealClaude(home: string): Promise<string | null> {
  const manifest = await readLegacyManifest(legacyKagentPaths(home).manifest);
  return manifest && typeof manifest.realClaude === "string" ? manifest.realClaude : null;
}
