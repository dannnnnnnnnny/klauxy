import { chmod, readFile, rm } from "node:fs/promises";
import { atomicWrite } from "./fs-atomic.js";
import { klauxyPaths, legacyKagentPaths } from "./paths.js";
import type { ShellTarget } from "./shell.js";

// Re-exported so callers keep a single import for install-time concerns while
// the legacy rename path lives in its own module.
export { getLegacyRealClaude, migrateLegacyKagent } from "./migrate.js";

const START = "# >>> klauxy >>>";
const END = "# <<< klauxy <<<";
const BLOCK_PATTERN = /\n?# >>> klauxy >>>[\s\S]*?# <<< klauxy <<<\n?/g;

const LEGACY_BLOCK_PATTERN = /\n?# >>> kagent >>>[\s\S]*?# <<< kagent <<<\n?/g;

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
  rcFiles: ShellTarget[];
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
  for (const target of options.rcFiles) {
    // fish has no `export VAR=value`; it uses fish_add_path instead.
    const line =
      target.syntax === "fish"
        ? ["fish_add_path -p ", paths.binDir].join("")
        : ['export PATH="', paths.binDir, ':$PATH"'].join("");
    const block = [START, line, END].join("\n");
    let current = "";
    try {
      current = await readFile(target.path, "utf8");
    } catch {
      /* new rc file */
    }
    const cleaned = current
      .replace(BLOCK_PATTERN, "")
      .replace(LEGACY_BLOCK_PATTERN, "")
      .replace(/\n*$/, "\n");
    await atomicWrite(target.path, [cleaned, block, "\n"].join(""));
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

export async function uninstallShim(options: {
  home: string;
  rcFiles: ShellTarget[];
}): Promise<void> {
  const paths = klauxyPaths(options.home);
  await rm(paths.shim, { force: true });
  await rm(paths.shortCommandShim, { force: true });
  await rm(paths.globalShortCommandShim, { force: true });
  await rm(paths.brandedCommandShim, { force: true });
  await rm(paths.globalBrandedCommandShim, { force: true });
  await rm(paths.manifest, { force: true });
  await rm(paths.installDir, { recursive: true, force: true });
  for (const target of options.rcFiles) {
    try {
      const current = await readFile(target.path, "utf8");
      const cleaned = current.replace(BLOCK_PATTERN, "").replace(LEGACY_BLOCK_PATTERN, "");
      await atomicWrite(
        target.path,
        cleaned.length > 0 && !cleaned.endsWith("\n") ? [cleaned, "\n"].join("") : cleaned,
      );
    } catch {
      /* absent rc file */
    }
  }
  await removeLegacyShims(options.home);
  await removeLegacyLaunchAgent(options.home);
}
