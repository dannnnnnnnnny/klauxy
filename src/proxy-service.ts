import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { LEGACY_KAGENT_PROXY_LABEL } from "./paths.js";
import { supervisorFor } from "./supervisors.js";

// Definitions and their activation commands live in supervisors.ts; these are
// re-exported so callers keep importing service concerns from one place.
export { launchd, PROXY_LABEL, SYSTEMD_UNIT, systemd } from "./supervisors.js";

export const PROXY_HOST = "127.0.0.1";
export const PROXY_PORT = 18789;

const execFileAsync = promisify(execFile);

/**
 * Runs one supervisor command.
 *
 * Injectable so install and uninstall can be verified without registering a real
 * LaunchAgent or systemd unit on the machine running the tests.
 */
export type RunCommand = (command: string, args: string[]) => Promise<void>;

const runCommand: RunCommand = async (command, args) => {
  await execFileAsync(command, args);
};

function uid(): number {
  return process.getuid?.() ?? 0;
}

function domain(): string {
  return `gui/${uid()}`;
}

export function proxyBaseUrl(
  address: { host: string; port: number } = { host: PROXY_HOST, port: PROXY_PORT },
): string {
  return `http://${address.host}:${address.port}`;
}

async function ignoreFailure(run: RunCommand, command: string, args: string[]): Promise<void> {
  try {
    await run(command, args);
  } catch {
    // bootout is idempotent: a missing prior service is expected.
  }
}

export async function retryCommand(
  execute: () => Promise<void>,
  wait: () => Promise<void>,
  attempts: number,
): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await execute();
      return;
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await wait();
    }
  }
  throw lastError;
}

export async function installProxyService(options: {
  path: string;
  node: string;
  entry: string;
  home: string;
  stdout: string;
  stderr: string;
  platform?: NodeJS.Platform;
  /** Overrides command execution; used by tests. */
  run?: RunCommand;
  /** Delay between activation retries; shortened by tests. */
  retryDelayMs?: number;
}): Promise<void> {
  await mkdir(dirname(options.path), { recursive: true, mode: 0o700 });
  await mkdir(dirname(options.stdout), { recursive: true, mode: 0o700 });

  const platform = options.platform ?? process.platform;
  const supervisor = supervisorFor(platform);
  if (supervisor === undefined) {
    throw new Error(`Klauxy cannot supervise a background service on ${platform}`);
  }
  const run = options.run ?? runCommand;
  const delayMs = options.retryDelayMs ?? 250;

  await writeFile(options.path, supervisor.definition(options), { mode: 0o600 });

  // Clear any previous registration first so activation is idempotent.
  for (const step of supervisor.deactivate(uid())) {
    await ignoreFailure(run, step.command, step.args);
  }

  const [first, ...rest] = supervisor.activate(options.path, uid());
  if (first !== undefined) {
    // The first activation step races the supervisor releasing the old service,
    // so it is the one worth retrying.
    await retryCommand(
      async () => {
        await run(first.command, first.args);
      },
      () => new Promise((resolve) => setTimeout(resolve, delayMs)),
      20,
    );
  }
  for (const step of rest) {
    await run(step.command, step.args);
  }
}

export async function uninstallProxyService(
  path: string,
  platform: NodeJS.Platform = process.platform,
  run: RunCommand | undefined = runCommand,
): Promise<void> {
  const supervisor = supervisorFor(platform);
  for (const step of supervisor?.deactivate(uid()) ?? []) {
    await ignoreFailure(run ?? runCommand, step.command, step.args);
  }
  await rm(path, { force: true });
}

export async function uninstallLegacyProxyService(
  home: string,
  run: RunCommand = runCommand,
): Promise<void> {
  const label = LEGACY_KAGENT_PROXY_LABEL;
  await ignoreFailure(run, "launchctl", ["bootout", `${domain()}/${label}`]);
  const plistPath = `${home}/Library/LaunchAgents/com.kagent.proxy.plist`;
  await rm(plistPath, { force: true });
}

export async function waitForProxy(url = proxyBaseUrl(), timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/__klauxy/health`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `persistent proxy is unavailable: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}
