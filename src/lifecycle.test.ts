import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor, type Environment } from "./lifecycle.js";
import { klauxyPaths } from "./paths.js";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "klauxy-lifecycle-"));
}

function environment(root: string, overrides: Partial<Environment> = {}): Environment {
  return {
    home: root,
    projectRoot: join(root, "src-build"),
    node: process.execPath,
    path: "/nonexistent-bin",
    platform: "darwin",
    arch: "arm64",
    nodeVersion: "v22.0.0",
    detectUpstream: async () => "https://api.anthropic.com",
    readRealClaude: async () => {
      throw new Error("no manifest");
    },
    ...overrides,
  };
}

describe("doctor", () => {
  it("reads the Claude path recorded at install time", async () => {
    const root = await home();

    const result = await doctor(
      environment(root, { readRealClaude: async () => "/opt/claude/bin/claude" }),
    );

    expect(result.lines.join("\n")).toContain("/opt/claude/bin/claude");
  });

  it("reports a missing Claude without throwing", async () => {
    const root = await home();

    const result = await doctor(environment(root));

    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("not found");
  });

  it("uses the configured provider rather than assuming oMLX", async () => {
    const root = await home();
    const paths = klauxyPaths(root, "darwin");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.config, '[translation]\nprovider = "ollama"\n', "utf8");

    const result = await doctor(environment(root));

    expect(result.lines.join("\n")).toContain("Ollama");
  });

  it("warns when a shell alias would shadow the shim", async () => {
    const root = await home();
    await writeFile(join(root, ".zshrc"), "alias claude='/other/claude'\n", "utf8");

    const result = await doctor(environment(root));

    expect(result.lines.join("\n")).toContain("alias/function named claude");
  });

  it("scans a fish config too", async () => {
    const root = await home();
    await mkdir(join(root, ".config", "fish"), { recursive: true });
    await writeFile(
      join(root, ".config", "fish", "config.fish"),
      "alias claude=/other/claude\n",
      "utf8",
    );

    const result = await doctor(environment(root));

    expect(result.lines.join("\n")).toContain("alias/function named claude");
  });

  it("reports the platform it was given, not the host platform", async () => {
    const root = await home();

    const linux = await doctor(environment(root, { platform: "linux", arch: "x64" }));

    expect(linux.lines[0]).toContain("linux/x64");
  });
});

describe("install failure handling", () => {
  it("reports a clear error when Claude cannot be located", async () => {
    const root = await home();
    const { install } = await import("./lifecycle.js");

    await expect(install(environment(root))).rejects.toThrow(
      "could not locate the real Claude Code executable",
    );
  });

  it("leaves no shim behind when it cannot find Claude", async () => {
    const root = await home();
    const { install } = await import("./lifecycle.js");

    await install(environment(root)).catch(() => {});

    await expect(readFile(klauxyPaths(root, "darwin").shim, "utf8")).rejects.toThrow();
  });
});
