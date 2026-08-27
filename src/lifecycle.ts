import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { installClaudeRouting, uninstallClaudeRouting } from "./claude-settings.js";
import { loadConfig } from "./config.js";
import { type DoctorResult, diagnose } from "./doctor.js";
import { resolveRealClaude } from "./executable.js";
import {
  getLegacyRealClaude,
  installShim,
  migrateLegacyKagent,
  removeLegacyLaunchAgent,
  removeLegacyShims,
  uninstallShim,
} from "./install.js";
import { klauxyPaths } from "./paths.js";
import {
  installProxyService,
  proxyBaseUrl,
  uninstallProxyService,
  waitForProxy,
} from "./proxy-service.js";
import { installRuntime } from "./runtime-install.js";
import { shellScanPaths, shellTargets } from "./shell.js";

/**
 * Ambient values the lifecycle steps need.
 *
 * Passed in rather than read from `process` directly so install, uninstall, and
 * doctor can be exercised without a real Claude installation or LaunchAgent.
 */
export interface Environment {
  home: string;
  /** Directory holding the running Klauxy build, staged into installDir. */
  projectRoot: string;
  node: string;
  path: string;
  platform: NodeJS.Platform;
  arch: string;
  nodeVersion: string;
  detectUpstream(): Promise<string>;
  readRealClaude(manifestPath: string): Promise<string>;
}

/** Locates the real Claude binary, preferring a recorded path over a PATH scan. */
async function findRealClaude(environment: Environment): Promise<string> {
  const paths = klauxyPaths(environment.home);
  try {
    const legacy = await getLegacyRealClaude(environment.home);
    if (legacy) return legacy;
  } catch {
    // No legacy manifest; fall through to the PATH scan.
  }
  try {
    return await resolveRealClaude(environment.path.split(":"), paths.shim);
  } catch {
    throw new Error("could not locate the real Claude Code executable");
  }
}

export async function install(environment: Environment): Promise<void> {
  const paths = klauxyPaths(environment.home);

  // Copy legacy data to canonical paths before staging anything new, so a
  // failure part way through never loses history or config.
  await migrateLegacyKagent(environment.home);

  const realClaude = await findRealClaude(environment);
  const installedEntry = join(paths.installDir, "dist", "index.js");
  const upstream = await environment.detectUpstream();

  if (environment.projectRoot !== paths.installDir) {
    await installRuntime(environment.projectRoot, paths.installDir);
  }
  await installShim({
    home: environment.home,
    realClaude,
    node: environment.node,
    entry: installedEntry,
    upstream,
    rcFiles: await shellTargets(environment.home),
  });
  await installProxyService({
    path: paths.serviceFile,
    node: environment.node,
    entry: installedEntry,
    home: environment.home,
    stdout: paths.proxyLog,
    stderr: paths.proxyErrorLog,
    platform: environment.platform,
  });

  // Only route Claude through the proxy once it answers, and only remove legacy
  // artifacts once the new service is proven healthy.
  await waitForProxy();
  await installClaudeRouting(paths.claudeSettings, paths.claudeSettingsBackup, proxyBaseUrl());
  await removeLegacyShims(environment.home);
  await removeLegacyLaunchAgent(environment.home);
}

export async function uninstall(environment: Environment): Promise<void> {
  const paths = klauxyPaths(environment.home);
  await uninstallClaudeRouting(paths.claudeSettings, paths.claudeSettingsBackup, proxyBaseUrl());
  await uninstallProxyService(paths.serviceFile, environment.platform);
  await uninstallShim({ home: environment.home, rcFiles: await shellTargets(environment.home) });
}

export async function doctor(environment: Environment): Promise<DoctorResult> {
  const paths = klauxyPaths(environment.home);
  const config = await loadConfig(paths.config);

  let claude = "not found";
  try {
    claude = await environment.readRealClaude(paths.manifest);
  } catch {
    try {
      claude = await resolveRealClaude(environment.path.split(":"), paths.shim);
    } catch {
      // Reported as a failing check below.
    }
  }

  const shellDefinitions = await Promise.all(
    shellScanPaths(environment.home).map(async (path) => {
      try {
        return await readFile(path, "utf8");
      } catch {
        return "";
      }
    }),
  );

  return diagnose({
    platform: environment.platform,
    arch: environment.arch,
    nodeVersion: environment.nodeVersion,
    claude,
    provider: config.translation.provider,
    host: config.translation.host,
    model: config.translation.model,
    timeoutMs: config.translation.timeout_ms,
    shellDefinitions,
  });
}
