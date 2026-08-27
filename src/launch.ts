import { type ChildProcess, spawn } from "node:child_process";

export interface ChildHandle {
  proc: ChildProcess;
  kill(signal?: NodeJS.Signals): void;
  onExit(callback: (code: number) => void): void;
}

export interface SpawnOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Launches the real Claude Code process with inherited stdio.
 *
 * Klauxy does not read or rewrite terminal traffic: translation happens inside
 * the HTTP proxy, so the child needs no pseudo-terminal of its own. Inheriting
 * this process's stdio hands Claude the real TTY directly, which preserves raw
 * mode, resize handling, and signal delivery without a relay in between.
 */
export function spawnClaude(file: string, args: string[], options: SpawnOptions): ChildHandle {
  const proc = spawn(file, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: "inherit",
  });
  return {
    proc,
    kill: (signal) => {
      proc.kill(signal);
    },
    onExit: (callback) => {
      proc.on("exit", (code, signal) => {
        callback(code ?? (signal === undefined || signal === null ? 0 : 1));
      });
    },
  };
}
