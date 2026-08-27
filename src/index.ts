#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { startAnthropicProxy } from "./anthropic-proxy.js";
import {
  installClaudeRouting,
  readClaudeUpstream,
  uninstallClaudeRouting,
} from "./claude-settings.js";
import { runCommand } from "./cli.js";
import { loadConfig } from "./config.js";
import { diagnose } from "./doctor.js";
import { isProxyOrigin, resolveRealClaude } from "./executable.js";
import { appendHistory } from "./history.js";
import {
  getLegacyRealClaude,
  installShim,
  migrateLegacyKagent,
  removeLegacyLaunchAgent,
  removeLegacyShims,
  uninstallShim,
} from "./install.js";
import { spawnClaude } from "./launch.js";
import { claudeEnvironment } from "./launcher-env.js";
import { klauxyPaths } from "./paths.js";
import { createTranslator } from "./providers.js";
import {
  installProxyService,
  PROXY_HOST,
  PROXY_PORT,
  proxyBaseUrl,
  uninstallProxyService,
  waitForProxy,
} from "./proxy-service.js";
import { installRuntime } from "./runtime-install.js";
import { reloadHint, shellScanPaths, shellTargets } from "./shell.js";
import { readState } from "./state.js";
import { createStyle } from "./tui.js";

interface Manifest {
  realClaude: string;
  entry: string;
  upstream: string;
}

function projectRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..");
}

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(join(projectRoot(), "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

async function readManifest(path: string): Promise<Manifest> {
  const value = JSON.parse(await readFile(path, "utf8")) as Partial<Manifest>;
  if (
    typeof value.realClaude !== "string" ||
    typeof value.entry !== "string" ||
    typeof value.upstream !== "string"
  ) {
    throw new Error("invalid Klauxy installation manifest; run klx install");
  }
  return value as Manifest;
}

async function runClaude(args: string[], home: string): Promise<void> {
  const paths = klauxyPaths(home);
  const manifest = await readManifest(paths.manifest);
  const baseUrl = proxyBaseUrl();
  await waitForProxy(baseUrl);
  const handle = spawnClaude(manifest.realClaude, args, {
    cwd: process.cwd(),
    env: claudeEnvironment(process.env, baseUrl),
  });
  // Claude owns the inherited TTY, so only exit status and signals need relaying.
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
    process.once(signal, () => handle.kill(signal));
  }
  await new Promise<void>((resolve) => {
    handle.onExit((code) => {
      process.exitCode = code;
      resolve();
    });
  });
}

async function runProxyDaemon(home: string): Promise<void> {
  const paths = klauxyPaths(home);
  const manifest = await readManifest(paths.manifest);
  const config = await loadConfig(paths.config);
  const proxy = await startAnthropicProxy({
    upstream: new URL(manifest.upstream),
    translator: createTranslator(config.translation),
    readEnabled: async () => (await readState(paths.state)).enabled,
    writeHistory: (entry) => appendHistory(paths.history, entry),
    listen: { host: PROXY_HOST, port: PROXY_PORT },
  });
  await new Promise<void>((resolve, reject) => {
    const shutdown = () => {
      void proxy.close().then(resolve, reject);
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  });
}

function isKlauxyProxyOrigin(value: string | undefined): boolean {
  if (!value) return false;
  return value === `http://${PROXY_HOST}:${PROXY_PORT}`;
}

async function detectUpstream(paths: ReturnType<typeof klauxyPaths>): Promise<string> {
  const persistent = proxyBaseUrl();
  const environment = process.env.ANTHROPIC_BASE_URL;
  if (
    environment &&
    environment !== persistent &&
    !isProxyOrigin(environment) &&
    !isKlauxyProxyOrigin(environment)
  )
    return environment;

  const settings = await readClaudeUpstream(paths.claudeSettings);
  if (
    settings &&
    settings !== persistent &&
    !isProxyOrigin(settings) &&
    !isKlauxyProxyOrigin(settings)
  )
    return settings;

  try {
    const existing = await readManifest(paths.manifest);
    if (
      existing.upstream !== persistent &&
      !isProxyOrigin(existing.upstream) &&
      !isKlauxyProxyOrigin(existing.upstream)
    )
      return existing.upstream;
  } catch {
    // first installation or older manifest
  }

  try {
    const legacyManifest = await getLegacyRealClaude(paths.configDir.replace("/config/klauxy", ""));
  } catch {
    // no legacy
  }

  return "https://api.anthropic.com";
}

async function main(): Promise<number | undefined> {
  const args = process.argv.slice(2);
  const home = homedir();
  if (args[0] === "__proxy-daemon") {
    await runProxyDaemon(args[1] ?? home);
    return undefined;
  }
  if (args[0] === "__wrap-claude") {
    await runClaude(args.slice(1), home);
    return undefined;
  }
  return runCommand(args, {
    home,
    output: console.log,
    style: createStyle({ tty: process.stdout.isTTY === true, env: process.env }),
    version: await readVersion(),
    reloadHint: async () => reloadHint(await shellTargets(home), home),
    prompt: async (question: string) => {
      if (!process.stdin.isTTY) return null;
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        return await rl.question(question);
      } finally {
        rl.close();
      }
    },
    install: async () => {
      const paths = klauxyPaths(home);

      // Migration: copy legacy data to canonical paths before staging new artifacts
      await migrateLegacyKagent(home);

      // Resolve real Claude: try legacy manifest first, then PATH scan
      let realClaude: string | null = null;
      try {
        realClaude = await getLegacyRealClaude(home);
      } catch {
        // no legacy manifest
      }
      if (!realClaude) {
        try {
          realClaude = await resolveRealClaude((process.env.PATH ?? "").split(":"), paths.shim);
        } catch {
          // reported downstream
        }
      }
      if (!realClaude) {
        throw new Error("could not locate the real Claude Code executable");
      }

      const root = projectRoot();
      const installedEntry = join(paths.installDir, "dist", "index.js");
      const upstream = await detectUpstream(paths);

      // Stage: install runtime, shims, manifest, plist
      if (root !== paths.installDir) await installRuntime(root, paths.installDir);
      await installShim({
        home,
        realClaude,
        node: process.execPath,
        entry: installedEntry,
        upstream,
        rcFiles: await shellTargets(home),
      });
      await installProxyService({
        path: paths.launchAgent,
        node: process.execPath,
        entry: installedEntry,
        home,
        stdout: paths.proxyLog,
        stderr: paths.proxyErrorLog,
      });

      // Health check before proceeding
      await waitForProxy();

      // Routing
      await installClaudeRouting(paths.claudeSettings, paths.claudeSettingsBackup, proxyBaseUrl());

      // Cleanup legacy artifacts only after new service is healthy
      await removeLegacyShims(home);
      await removeLegacyLaunchAgent(home);
    },
    uninstall: async () => {
      const paths = klauxyPaths(home);
      await uninstallClaudeRouting(
        paths.claudeSettings,
        paths.claudeSettingsBackup,
        proxyBaseUrl(),
      );
      await uninstallProxyService(paths.launchAgent);
      await uninstallProxyService(home);
      await uninstallShim({ home, rcFiles: await shellTargets(home) });
    },
    doctor: async () => {
      const paths = klauxyPaths(home);
      const config = await loadConfig(paths.config);
      let claude = "not found";
      try {
        claude = (await readManifest(paths.manifest)).realClaude;
      } catch {
        try {
          claude = await resolveRealClaude((process.env.PATH ?? "").split(":"), paths.shim);
        } catch {
          /* reported below */
        }
      }
      const shellDefinitions = await Promise.all(
        shellScanPaths(home).map(async (path) => {
          try {
            return await readFile(path, "utf8");
          } catch {
            return "";
          }
        }),
      );
      return diagnose({
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        claude,
        provider: config.translation.provider,
        host: config.translation.host,
        model: config.translation.model,
        timeoutMs: config.translation.timeout_ms,
        shellDefinitions,
      });
    },
  });
}

main()
  .then((code) => {
    if (typeof code === "number") process.exitCode = code;
  })
  .catch((error) => {
    console.error(["klauxy: ", error instanceof Error ? error.message : String(error)].join(""));
    process.exitCode = 1;
  });
