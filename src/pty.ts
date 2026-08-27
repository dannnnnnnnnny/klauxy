import type { IPty } from "node-pty";
import * as nodePty from "node-pty";

export interface PtyHandle {
  proc: IPty;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
}

export interface PtyOptions {
  cwd: string;
  cols: number;
  rows: number;
  env: NodeJS.ProcessEnv;
}

export function spawnPty(file: string, args: string[], options: PtyOptions): PtyHandle {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.env)) {
    if (value !== undefined) env[key] = value;
  }
  const proc = nodePty.spawn(file, args, {
    name: "xterm-256color",
    cwd: options.cwd,
    cols: options.cols,
    rows: options.rows,
    env,
  });
  return {
    proc,
    write: (data) => proc.write(data),
    resize: (cols, rows) => proc.resize(cols, rows),
    kill: (signal) => proc.kill(signal),
    onData: (callback) => {
      proc.onData(callback);
    },
    onExit: (callback) => {
      proc.onExit(({ exitCode }) => callback(exitCode));
    },
  };
}
