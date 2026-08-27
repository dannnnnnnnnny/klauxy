import { mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnClaude } from "./launch.js";

async function workdir(): Promise<string> {
  // macOS resolves /var through a symlink, so compare against the real path.
  return realpath(await mkdtemp(join(tmpdir(), "klauxy-launch-")));
}

function exitOf(handle: { onExit(cb: (code: number) => void): void }): Promise<number> {
  return new Promise((resolve) => handle.onExit(resolve));
}

describe("launching the real Claude process", () => {
  it("preserves cwd, argv, and the injected proxy environment", async () => {
    const cwd = await workdir();
    const marker = join(cwd, "out.txt");
    const handle = spawnClaude(
      "/bin/sh",
      ["-c", 'printf "%s|%s|%s" "$1" "$ANTHROPIC_BASE_URL" "$PWD" > "$2"', "sh", "hello", marker],
      { cwd, env: { ...process.env, ANTHROPIC_BASE_URL: "http://127.0.0.1:18789" } },
    );

    expect(await exitOf(handle)).toBe(0);
    expect(await readFile(marker, "utf8")).toBe(["hello|http://127.0.0.1:18789|", cwd].join(""));
  });

  it("propagates the child exit code", async () => {
    const handle = spawnClaude("/bin/sh", ["-c", "exit 7"], {
      cwd: await workdir(),
      env: process.env,
    });
    expect(await exitOf(handle)).toBe(7);
  });

  it("reports a non-zero code when the child is signalled", async () => {
    const handle = spawnClaude("/bin/sh", ["-c", "sleep 30"], {
      cwd: await workdir(),
      env: process.env,
    });
    const exit = exitOf(handle);
    handle.kill("SIGTERM");
    expect(await exit).toBe(1);
  });

  it("defaults to SIGTERM when no signal is given", async () => {
    const handle = spawnClaude("/bin/sh", ["-c", "sleep 30"], {
      cwd: await workdir(),
      env: process.env,
    });
    const exit = exitOf(handle);
    handle.kill();

    expect(await exit).toBe(1);
  });
});
