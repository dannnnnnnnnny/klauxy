import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { LEGACY_KAGENT_PROXY_LABEL } from "./paths.js";

export const PROXY_HOST = "127.0.0.1";
export const PROXY_PORT = 18789;
export const PROXY_LABEL = "com.klauxy.proxy";

const execFileAsync = promisify(execFile);

export function proxyBaseUrl(
  address: { host: string; port: number } = { host: PROXY_HOST, port: PROXY_PORT },
): string {
  return `http://${address.host}:${address.port}`;
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgentPlist(options: {
  node: string;
  entry: string;
  home: string;
  stdout: string;
  stderr: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${PROXY_LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(options.node)}</string><string>${xml(options.entry)}</string><string>__proxy-daemon</string><string>${xml(options.home)}</string></array>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(options.home)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${xml(options.stdout)}</string>
<key>StandardErrorPath</key><string>${xml(options.stderr)}</string>
</dict></plist>
`;
}

function domain(): string {
  return `gui/${process.getuid?.() ?? 0}`;
}

async function ignoreFailure(command: string, args: string[]): Promise<void> {
  try {
    await execFileAsync(command, args);
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
}): Promise<void> {
  await mkdir(dirname(options.path), { recursive: true, mode: 0o700 });
  await mkdir(dirname(options.stdout), { recursive: true, mode: 0o700 });
  await writeFile(options.path, launchAgentPlist(options), { mode: 0o600 });
  await ignoreFailure("launchctl", ["bootout", `${domain()}/${PROXY_LABEL}`]);
  await retryCommand(
    async () => {
      await execFileAsync("launchctl", ["bootstrap", domain(), options.path]);
    },
    () => new Promise((resolve) => setTimeout(resolve, 250)),
    20,
  );
  await execFileAsync("launchctl", ["kickstart", "-k", `${domain()}/${PROXY_LABEL}`]);
}

export async function uninstallProxyService(path: string): Promise<void> {
  await ignoreFailure("launchctl", ["bootout", `${domain()}/${PROXY_LABEL}`]);
  await rm(path, { force: true });
}

export async function uninstallLegacyProxyService(home: string): Promise<void> {
  const label = LEGACY_KAGENT_PROXY_LABEL;
  await ignoreFailure("launchctl", ["bootout", `${domain()}/${label}`]);
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
