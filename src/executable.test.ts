import { chmod, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isHealthEndpoint, isProxyOrigin, resolveRealClaude } from "./executable.js";

describe("real Claude executable resolution", () => {
  it("skips the Klauxy shim and resolves a later executable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-bin-"));
    const shimDir = join(dir, "shim");
    const realDir = join(dir, "real");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(shimDir);
    await mkdir(realDir);
    const shim = join(shimDir, "claude");
    const real = join(realDir, "claude");
    await writeFile(shim, "#!/bin/sh\n", "utf8");
    await writeFile(real, "#!/bin/sh\n", "utf8");
    await chmod(shim, 0o755);
    await chmod(real, 0o755);

    expect(await resolveRealClaude([shimDir, realDir], shim)).toBe(real);
  });

  it("rejects a symlink that resolves back to the shim", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-bin-"));
    const shimDir = join(dir, "shim");
    const aliasDir = join(dir, "alias");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(shimDir);
    await mkdir(aliasDir);
    const shim = join(shimDir, "claude");
    await writeFile(shim, "#!/bin/sh\n", "utf8");
    await chmod(shim, 0o755);
    await symlink(shim, join(aliasDir, "claude"));

    await expect(resolveRealClaude([shimDir, aliasDir], shim)).rejects.toThrow(
      "could not locate the real Claude Code executable",
    );
  });

  it("skips both new and legacy managed shims", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-shim-exclude-"));
    const newShimDir = join(dir, "new-shim");
    const legacyShimDir = join(dir, "legacy-shim");
    const realDir = join(dir, "real");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(newShimDir);
    await mkdir(legacyShimDir);
    await mkdir(realDir);

    const newShim = join(newShimDir, "claude");
    const legacyShim = join(legacyShimDir, "claude");
    const real = join(realDir, "claude");

    await writeFile(newShim, "#!/bin/sh\n", "utf8");
    await writeFile(legacyShim, "#!/bin/sh\n", "utf8");
    await writeFile(real, "#!/bin/sh\n", "utf8");
    await chmod(newShim, 0o755);
    await chmod(legacyShim, 0o755);
    await chmod(real, 0o755);

    const isShim = async (candidate: string) => {
      const resolved = await (async () => {
        try {
          return await require("node:fs/promises").realpath(candidate);
        } catch {
          return candidate;
        }
      })();
      const newResolved = await (async () => {
        try {
          return await require("node:fs/promises").realpath(newShim);
        } catch {
          return newShim;
        }
      })();
      const legacyResolved = await (async () => {
        try {
          return await require("node:fs/promises").realpath(legacyShim);
        } catch {
          return legacyShim;
        }
      })();
      return resolved === newResolved || resolved === legacyResolved;
    };

    expect(await resolveRealClaude([newShimDir, legacyShimDir, realDir], newShim, isShim)).toBe(
      real,
    );
  });

  it("falls back to path comparison when realpath fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-bin-"));
    const shimDir = join(dir, "shim");
    const realDir = join(dir, "real");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(shimDir);
    await mkdir(realDir);
    const shim = join(shimDir, "claude");
    const real = join(realDir, "claude");
    await writeFile(shim, "#!/bin/sh\n", "utf8");
    await writeFile(real, "#!/bin/sh\n", "utf8");
    await chmod(shim, 0o755);
    await chmod(real, 0o755);

    expect(await resolveRealClaude([shimDir, realDir], shim)).toBe(real);
  });
});

describe("proxy origin detection", () => {
  it("detects Klauxy proxy origin", () => {
    expect(isProxyOrigin("http://127.0.0.1:18789")).toBe(true);
  });

  it("rejects non-proxy origins", () => {
    expect(isProxyOrigin(undefined)).toBe(false);
    expect(isProxyOrigin("")).toBe(false);
    expect(isProxyOrigin("https://api.anthropic.com")).toBe(false);
    expect(isProxyOrigin("http://127.0.0.1:8010")).toBe(false);
  });
});

describe("health endpoint detection", () => {
  it("detects Klauxy health endpoint", () => {
    expect(isHealthEndpoint("http://127.0.0.1:18789/__klauxy/health")).toBe(true);
  });

  it("rejects non-health endpoints", () => {
    expect(isHealthEndpoint(undefined)).toBe(false);
    expect(isHealthEndpoint("")).toBe(false);
    expect(isHealthEndpoint("http://127.0.0.1:18789/v1/models")).toBe(false);
  });
});
