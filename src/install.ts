import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type HistoryEntry, readHistory } from "./history.js";
import { klauxyPaths, legacyKagentPaths } from "./paths.js";

const START = "# >>> klauxy >>>";
const END = "# <<< klauxy <<<";
const BLOCK_PATTERN = /\n?# >>> klauxy >>>[\s\S]*?# <<< klauxy <<<\n?/g;

const LEGACY_START = "# >>> kagent >>>";
const LEGACY_END = "# <<< kagent <<<";
const LEGACY_BLOCK_PATTERN = /\n?# >>> kagent >>>[\s\S]*?# <<< kagent <<<\n?/g;

async function atomicWrite(path: string, content: string, mode = 0o600): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = [path, ".tmp-", process.pid, "-", Date.now()].join("");
  await writeFile(temporary, content, { encoding: "utf8", mode });
  await rename(temporary, path);
}

function shellQuote(value: string): string {
  return ["'", value.replaceAll("'", "'\"'\"'"), "'"].join("");
}

function commandShimContent(node: string, entry: string): string {
  return [
    "#!/bin/sh",
    ["exec ", shellQuote(node), " ", shellQuote(entry), ' "$@"'].join(""),
    "",
  ].join("\n");
}

export interface InstallOptions {
  home: string;
  realClaude: string;
  node: string;
  entry: string;
  upstream: string;
  rcFiles: string[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function copyFile(src: string, dest: string): Promise<void> {
  const content = await readFile(src);
  await mkdir(dirname(dest), { recursive: true, mode: 0o700 });
  await writeFile(dest, content, { mode: 0o600 });
}

function mergeHistory(canonical: HistoryEntry[], legacy: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>();
  const merged: HistoryEntry[] = [];
  for (const entry of [...canonical, ...legacy]) {
    const key = entry.timestamp + entry.original + entry.sent;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  merged.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return merged.slice(-100);
}

async function writeHistoryEntries(path: string, entries: HistoryEntry[]): Promise<void> {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  const content = entries.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(temporary, content.length === 0 ? "" : `${content}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function readLegacyManifest(path: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  } catch {
    /* corrupted */
  }
  return null;
}

export async function migrateLegacyKagent(home: string): Promise<void> {
  const canonical = klauxyPaths(home);
  const legacy = legacyKagentPaths(home);

  const configExists = await fileExists(legacy.config);
  const stateExists = await fileExists(legacy.state);
  const historyExists = await fileExists(legacy.history);
  const backupExists = await fileExists(legacy.claudeSettingsBackup);
  const manifestExists = await fileExists(legacy.manifest);

  if (!configExists && !stateExists && !historyExists && !backupExists && !manifestExists) {
    return;
  }

  await mkdir(canonical.configDir, { recursive: true, mode: 0o700 });

  if (configExists && !(await fileExists(canonical.config))) {
    await copyFile(legacy.config, canonical.config);
  }
  if (stateExists && !(await fileExists(canonical.state))) {
    await copyFile(legacy.state, canonical.state);
  }
  if (backupExists && !(await fileExists(canonical.claudeSettingsBackup))) {
    await copyFile(legacy.claudeSettingsBackup, canonical.claudeSettingsBackup);
  }

  if (historyExists) {
    const canonicalEntries = (await fileExists(canonical.history))
      ? await readHistory(canonical.history)
      : [];
    const legacyEntries = await readHistory(legacy.history);
    const merged = mergeHistory(canonicalEntries, legacyEntries);
    await writeHistoryEntries(canonical.history, merged);
  }
}

export async function getLegacyRealClaude(home: string): Promise<string | null> {
  const legacy = legacyKagentPaths(home);
  const manifest = await readLegacyManifest(legacy.manifest);
  if (manifest && typeof manifest.realClaude === "string") {
    return manifest.realClaude;
  }
  return null;
}

async function writeAllShims(options: InstallOptions): Promise<void> {
  const paths = klauxyPaths(options.home);
  const shim = [
    "#!/bin/sh",
    ["exec ", shellQuote(options.node), " ", shellQuote(options.entry), ' __wrap-claude "$@"'].join(
      "",
    ),
    "",
  ].join("\n");
  await atomicWrite(paths.shim, shim, 0o755);
  await chmod(paths.shim, 0o755);

  const commandShim = commandShimContent(options.node, options.entry);

  await atomicWrite(paths.shortCommandShim, commandShim, 0o755);
  await chmod(paths.shortCommandShim, 0o755);
  await atomicWrite(paths.globalShortCommandShim, commandShim, 0o755);
  await chmod(paths.globalShortCommandShim, 0o755);

  await atomicWrite(paths.brandedCommandShim, commandShim, 0o755);
  await chmod(paths.brandedCommandShim, 0o755);
  await atomicWrite(paths.globalBrandedCommandShim, commandShim, 0o755);
  await chmod(paths.globalBrandedCommandShim, 0o755);
}

async function writeManifest(options: InstallOptions): Promise<void> {
  const paths = klauxyPaths(options.home);
  await atomicWrite(
    paths.manifest,
    [
      JSON.stringify(
        {
          schema: 1,
          realClaude: options.realClaude,
          entry: options.entry,
          upstream: options.upstream,
        },
        null,
        2,
      ),
      "\n",
    ].join(""),
  );
}

async function writeRcBlock(options: InstallOptions): Promise<void> {
  const paths = klauxyPaths(options.home);
  const block = [START, ['export PATH="', paths.binDir, ':$PATH"'].join(""), END].join("\n");
  for (const rcFile of options.rcFiles) {
    let current = "";
    try {
      current = await readFile(rcFile, "utf8");
    } catch {
      /* new rc file */
    }
    const cleaned = current
      .replace(BLOCK_PATTERN, "")
      .replace(LEGACY_BLOCK_PATTERN, "")
      .replace(/\n*$/, "\n");
    await atomicWrite(rcFile, [cleaned, block, "\n"].join(""));
  }
}

export async function installShim(options: InstallOptions): Promise<void> {
  await writeAllShims(options);
  await writeManifest(options);
  await writeRcBlock(options);
}

export async function removeLegacyShims(home: string): Promise<void> {
  const legacy = legacyKagentPaths(home);
  await rm(legacy.commandShim, { force: true });
  await rm(legacy.globalCommandShim, { force: true });
  await rm(legacy.shim, { force: true });
  await rm(legacy.binDir, { recursive: true, force: true });
  await rm(legacy.installDir, { recursive: true, force: true });
}

export async function removeLegacyLaunchAgent(home: string): Promise<void> {
  const legacy = legacyKagentPaths(home);
  await rm(legacy.launchAgent, { force: true });
}

export async function uninstallShim(options: { home: string; rcFiles: string[] }): Promise<void> {
  const paths = klauxyPaths(options.home);
  await rm(paths.shim, { force: true });
  await rm(paths.shortCommandShim, { force: true });
  await rm(paths.globalShortCommandShim, { force: true });
  await rm(paths.brandedCommandShim, { force: true });
  await rm(paths.globalBrandedCommandShim, { force: true });
  await rm(paths.manifest, { force: true });
  await rm(paths.installDir, { recursive: true, force: true });
  for (const rcFile of options.rcFiles) {
    try {
      const current = await readFile(rcFile, "utf8");
      const cleaned = current.replace(BLOCK_PATTERN, "").replace(LEGACY_BLOCK_PATTERN, "");
      await atomicWrite(
        rcFile,
        cleaned.length > 0 && !cleaned.endsWith("\n") ? [cleaned, "\n"].join("") : cleaned,
      );
    } catch {
      /* absent rc file */
    }
  }
  await removeLegacyShims(options.home);
  await removeLegacyLaunchAgent(options.home);
}
