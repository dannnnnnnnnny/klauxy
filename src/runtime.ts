import { startAnthropicProxy } from "./anthropic-proxy.js";
import { loadConfig } from "./config.js";
import { appendHistory } from "./history.js";
import { spawnClaude } from "./launch.js";
import { claudeEnvironment } from "./launcher-env.js";
import { readManifest } from "./manifest.js";
import { klauxyPaths } from "./paths.js";
import { createTranslator } from "./providers.js";
import { PROXY_HOST, PROXY_PORT, proxyBaseUrl, waitForProxy } from "./proxy-service.js";
import { readState } from "./state.js";

/**
 * The two internal entry points the shims invoke.
 *
 * Separate from the CLI because neither is a user-facing command: the shim calls
 * `__wrap-claude` and the supervisor calls `__proxy-daemon`.
 */

/**
 * Runs the real Claude with translation routed through the local proxy.
 *
 * Claude inherits this process's stdio, so it owns the TTY directly and only
 * exit status and signals need relaying.
 */
export async function runClaude(args: string[], home: string): Promise<number> {
  const paths = klauxyPaths(home);
  const manifest = await readManifest(paths.manifest);
  const baseUrl = proxyBaseUrl();
  await waitForProxy(baseUrl);

  const handle = spawnClaude(manifest.realClaude, args, {
    cwd: process.cwd(),
    env: claudeEnvironment(process.env, baseUrl),
  });
  for (const signal of ["SIGTERM", "SIGHUP", "SIGINT"] as const) {
    process.once(signal, () => handle.kill(signal));
  }
  return new Promise<number>((resolve) => handle.onExit(resolve));
}

/**
 * Serves the translation proxy until the supervisor stops it.
 *
 * Enabled state and config are read per request rather than captured at startup,
 * so `klx on`/`klx off` and config edits apply to running Claude sessions.
 */
export async function runProxyDaemon(home: string): Promise<void> {
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
