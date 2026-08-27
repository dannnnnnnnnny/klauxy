import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { doctor, type Environment, install, uninstall } from "./lifecycle.js";
import { klauxyPaths } from "./paths.js";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "klauxy-lifecycle-"));
}

function makeEnvironment(root: string, overrides: Partial<Environment> = {}): Environment {
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
      makeEnvironment(root, { readRealClaude: async () => "/opt/claude/bin/claude" }),
    );

    expect(result.lines.join("\n")).toContain("/opt/claude/bin/claude");
  });

  it("reports a missing Claude without throwing", async () => {
    const root = await home();

    const result = await doctor(makeEnvironment(root));

    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("not found");
  });

  it("uses the configured provider rather than assuming oMLX", async () => {
    const root = await home();
    const paths = klauxyPaths(root, "darwin");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.config, '[translation]\nprovider = "ollama"\n', "utf8");

    const result = await doctor(makeEnvironment(root));

    expect(result.lines.join("\n")).toContain("Ollama");
  });

  it("warns when a shell alias would shadow the shim", async () => {
    const root = await home();
    await writeFile(join(root, ".zshrc"), "alias claude='/other/claude'\n", "utf8");

    const result = await doctor(makeEnvironment(root));

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

    const result = await doctor(makeEnvironment(root));

    expect(result.lines.join("\n")).toContain("alias/function named claude");
  });

  it("reports the platform it was given, not the host platform", async () => {
    const root = await home();

    const linux = await doctor(makeEnvironment(root, { platform: "linux", arch: "x64" }));

    expect(linux.lines[0]).toContain("linux/x64");
  });
});

describe("install failure handling", () => {
  it("reports a clear error when Claude cannot be located", async () => {
    const root = await home();
    const { install } = await import("./lifecycle.js");

    await expect(install(makeEnvironment(root))).rejects.toThrow(
      "could not locate the real Claude Code executable",
    );
  });

  it("leaves no shim behind when it cannot find Claude", async () => {
    const root = await home();
    const { install } = await import("./lifecycle.js");

    await install(makeEnvironment(root)).catch(() => {});

    await expect(readFile(klauxyPaths(root, "darwin").shim, "utf8")).rejects.toThrow();
  });
});
describe("install", () => {
  async function stagedEnvironment(overrides: Partial<Environment> = {}) {
    const root = await home();
    const source = join(root, "build");
    await mkdir(join(source, "dist"), { recursive: true });
    await writeFile(join(source, "dist", "index.js"), "// entry\n", "utf8");
    // installRuntime copies the manifest alongside dist.
    await writeFile(join(source, "package.json"), '{"name":"klauxy","version":"0.1.0"}', "utf8");

    // A real executable on PATH so resolveRealClaude succeeds.
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });

    const calls: Array<{ command: string; args: string[] }> = [];
    const environment = makeEnvironment(root, {
      projectRoot: source,
      path: bin,
      run: async (command, args) => {
        calls.push({ command, args });
      },
      waitForProxy: async () => {},
      ...overrides,
    });
    return { root, environment, calls };
  }

  it("stages the runtime, shim, and service, then routes Claude", async () => {
    const { root, environment, calls } = await stagedEnvironment();
    const paths = klauxyPaths(root, "darwin");

    await install(environment);

    expect(await readFile(paths.shim, "utf8")).toContain("__wrap-claude");
    expect(JSON.parse(await readFile(paths.manifest, "utf8"))).toMatchObject({
      realClaude: join(root, "bin", "claude"),
    });
    expect(await readFile(paths.serviceFile, "utf8")).toContain("com.klauxy.proxy");
    expect(JSON.parse(await readFile(paths.claudeSettings, "utf8")).env).toMatchObject({
      ANTHROPIC_BASE_URL: "http://127.0.0.1:18789",
    });
    expect(calls.every((call) => call.command === "launchctl")).toBe(true);
  });

  it("registers a systemd unit on Linux instead", async () => {
    const { root, environment } = await stagedEnvironment({ platform: "linux" });

    await install(environment);

    expect(await readFile(klauxyPaths(root, "linux").serviceFile, "utf8")).toContain(
      "WantedBy=default.target",
    );
  });

  it("does not route Claude when the proxy never answers", async () => {
    const { root, environment } = await stagedEnvironment({
      waitForProxy: async () => {
        throw new Error("persistent proxy is unavailable");
      },
    });

    await expect(install(environment)).rejects.toThrow("unavailable");
    // Leaving the setting behind would send Claude to a proxy that is not there.
    await expect(readFile(klauxyPaths(root, "darwin").claudeSettings, "utf8")).rejects.toThrow();
  });

  it("is idempotent across repeated installs", async () => {
    const { root, environment } = await stagedEnvironment();

    await install(environment);
    await install(environment);

    const rc = await readFile(join(root, ".zshrc"), "utf8").catch(() => "");
    expect(rc.match(/# >>> klauxy >>>/g) ?? []).toHaveLength(1);
  });
});

describe("uninstall", () => {
  it("removes the shim, service, and routing", async () => {
    const root = await home();
    const source = join(root, "build");
    await mkdir(join(source, "dist"), { recursive: true });
    await writeFile(join(source, "dist", "index.js"), "// entry\n", "utf8");
    await writeFile(join(source, "package.json"), '{"name":"klauxy","version":"0.1.0"}', "utf8");
    const bin = join(root, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(join(bin, "claude"), "#!/bin/sh\n", { mode: 0o755 });
    const environment = makeEnvironment(root, {
      projectRoot: source,
      path: bin,
      run: async () => {},
      waitForProxy: async () => {},
    });
    const paths = klauxyPaths(root, "darwin");

    await install(environment);
    await uninstall(environment);

    await expect(readFile(paths.shim, "utf8")).rejects.toThrow();
    await expect(readFile(paths.serviceFile, "utf8")).rejects.toThrow();
  });
});
