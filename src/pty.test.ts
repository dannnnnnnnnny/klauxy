import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { spawnPty } from "./pty.js";

describe("PTY process wrapper", () => {
  it("preserves cwd, argv, environment, output, and exit code", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "kagent-pty-"));
    const handle = spawnPty(
      "/bin/sh",
      ["-c", 'printf \'%s|%s|%s\' "$1" "$KLAUXY" "$PWD"; exit 7', "sh", "hello"],
      { cwd, cols: 80, rows: 24, env: { ...process.env, KLAUXY: "1" } },
    );
    let output = "";
    handle.onData((data) => {
      output += data;
    });
    const code = await new Promise<number>((resolve) => handle.onExit(resolve));
    expect(output).toContain(["hello|1|", cwd].join(""));
    expect(code).toBe(7);
  });
});
