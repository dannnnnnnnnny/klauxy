#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { runCommand } from "./cli.js";
import { doctor, type Environment, install, uninstall } from "./lifecycle.js";
import { detectUpstream, readManifest } from "./manifest.js";
import { klauxyPaths } from "./paths.js";
import { runClaude, runProxyDaemon } from "./runtime.js";
import { reloadHint, shellTargets } from "./shell.js";
import { createStyle } from "./tui.js";

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

/** Ambient values the lifecycle steps need, gathered from this process. */
function environmentFor(home: string): Environment {
  return {
    home,
    projectRoot: projectRoot(),
    node: process.execPath,
    path: process.env.PATH ?? "",
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    detectUpstream: () => detectUpstream(klauxyPaths(home)),
    readRealClaude: async (manifestPath: string) => (await readManifest(manifestPath)).realClaude,
  };
}

async function askOnTerminal(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function main(): Promise<number | undefined> {
  const args = process.argv.slice(2);
  const home = homedir();

  // Internal entry points invoked by the shims, not user-facing commands.
  if (args[0] === "__proxy-daemon") {
    await runProxyDaemon(args[1] ?? home);
    return undefined;
  }
  if (args[0] === "__wrap-claude") {
    return runClaude(args.slice(1), home);
  }

  const environment = environmentFor(home);
  return runCommand(args, {
    home,
    output: console.log,
    style: createStyle({ tty: process.stdout.isTTY === true, env: process.env }),
    columns: process.stdout.columns,
    version: await readVersion(),
    reloadHint: async () => reloadHint(await shellTargets(home), home),
    prompt: askOnTerminal,
    install: () => install(environment),
    uninstall: () => uninstall(environment),
    doctor: () => doctor(environment),
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
