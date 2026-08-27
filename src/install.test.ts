import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readHistory } from "./history.js";
import {
  installShim,
  migrateLegacyKagent,
  removeLegacyLaunchAgent,
  removeLegacyShims,
  uninstallShim,
} from "./install.js";
import { klauxyPaths, legacyKagentPaths } from "./paths.js";

describe("managed Claude shim installation", () => {
  it("writes executable shims, manifest, and an idempotent PATH block", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-home-"));
    const rc = join(home, ".zshrc");
    await writeFile(rc, "export KEEP_ME=1\n", "utf8");
    await installShim({
      home,
      realClaude: "/real/claude",
      node: "/usr/bin/node",
      entry: "/app/index.js",
      upstream: "http://127.0.0.1:8787",
      rcFiles: [rc],
    });
    await installShim({
      home,
      realClaude: "/real/claude",
      node: "/usr/bin/node",
      entry: "/app/index.js",
      upstream: "http://127.0.0.1:8787",
      rcFiles: [rc],
    });
    const paths = klauxyPaths(home);
    expect(await readFile(paths.shim, "utf8")).toContain("__wrap-claude");
    expect(await readFile(paths.shortCommandShim, "utf8")).toContain("/app/index.js");
    expect(await readFile(paths.globalShortCommandShim, "utf8")).toContain("/app/index.js");
    expect(await readFile(paths.brandedCommandShim, "utf8")).toContain("/app/index.js");
    expect(await readFile(paths.globalBrandedCommandShim, "utf8")).toContain("/app/index.js");
    expect(JSON.parse(await readFile(paths.manifest, "utf8"))).toMatchObject({
      realClaude: "/real/claude",
      upstream: "http://127.0.0.1:8787",
    });
    expect((await readFile(rc, "utf8")).match(/# >>> klauxy >>>/g)).toHaveLength(1);
  });

  it("removes only Klauxy-managed content", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-home-"));
    const rc = join(home, ".zshrc");
    await writeFile(rc, "export KEEP_ME=1\n", "utf8");
    await installShim({
      home,
      realClaude: "/real/claude",
      node: "/usr/bin/node",
      entry: "/app/index.js",
      upstream: "https://api.anthropic.com",
      rcFiles: [rc],
    });
    await uninstallShim({ home, rcFiles: [rc] });
    expect(await readFile(rc, "utf8")).toBe("export KEEP_ME=1\n");
    const paths = klauxyPaths(home);
    await expect(readFile(paths.shim, "utf8")).rejects.toThrow();
    await expect(readFile(paths.shortCommandShim, "utf8")).rejects.toThrow();
    await expect(readFile(paths.globalShortCommandShim, "utf8")).rejects.toThrow();
    await expect(readFile(paths.brandedCommandShim, "utf8")).rejects.toThrow();
    await expect(readFile(paths.globalBrandedCommandShim, "utf8")).rejects.toThrow();
  });
});

describe("migration from legacy KAgent", () => {
  it("copies config and state when canonical is empty", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-migrate-"));
    const legacy = legacyKagentPaths(home);
    await mkdir(legacy.configDir, { recursive: true });
    await writeFile(legacy.config, "translation.system_prompt = 'test'\n", "utf8");
    await writeFile(
      legacy.state,
      JSON.stringify({ schema: 1, enabled: true, generation: 3 }),
      "utf8",
    );

    await migrateLegacyKagent(home);

    const canonical = klauxyPaths(home);
    expect(await readFile(canonical.config, "utf8")).toContain("translation.system_prompt");
    expect(JSON.parse(await readFile(canonical.state, "utf8"))).toMatchObject({
      enabled: true,
      generation: 3,
    });
  });

  it("does not overwrite existing canonical config", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-migrate-"));
    const legacy = legacyKagentPaths(home);
    const canonical = klauxyPaths(home);
    await mkdir(legacy.configDir, { recursive: true });
    await mkdir(canonical.configDir, { recursive: true });
    await writeFile(legacy.config, "# legacy\n", "utf8");
    await writeFile(canonical.config, "# canonical\n", "utf8");

    await migrateLegacyKagent(home);

    expect(await readFile(canonical.config, "utf8")).toBe("# canonical\n");
  });

  it("merges history from both sources with deduplication", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-migrate-"));
    const legacy = legacyKagentPaths(home);
    const canonical = klauxyPaths(home);
    await mkdir(legacy.configDir, { recursive: true });
    await mkdir(canonical.configDir, { recursive: true });

    const legacyEntry = JSON.stringify({
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 100,
      original: "안녕",
      sent: "Hello",
    });
    const canonicalEntry = JSON.stringify({
      schema: 1,
      timestamp: "2026-08-26T12:01:00.000Z",
      status: "translated",
      durationMs: 200,
      original: "세계",
      sent: "World",
    });
    const dupEntry = JSON.stringify({
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 100,
      original: "안녕",
      sent: "Hello",
    });

    await writeFile(legacy.history, `${legacyEntry}
    await writeFile(canonical.history, `${canonicalEntry}
`, "utf8");
    await writeFile(canonical.history, `${canonicalEntry}
`, "utf8");
    await writeFile(canonical.history, canonicalEntry + "\n", "utf8");

    await migrateLegacyKagent(home);

    const entries = await readHistory(canonical.history);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.sent).sort()).toEqual(["Hello", "World"]);
  });

  it("does nothing when no legacy data exists", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-migrate-"));
    await expect(migrateLegacyKagent(home)).resolves.toBeUndefined();
  });
});

describe("legacy cleanup", () => {
  it("removes legacy shims and bins", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cleanup-"));
    const legacy = legacyKagentPaths(home);
    await mkdir(legacy.binDir, { recursive: true });
    await writeFile(legacy.commandShim, "#!/bin/sh\n", "utf8");
    await writeFile(legacy.globalCommandShim, "#!/bin/sh\n", "utf8");
    await writeFile(legacy.shim, "#!/bin/sh\n", "utf8");

    await removeLegacyShims(home);

    await expect(readFile(legacy.commandShim, "utf8")).rejects.toThrow();
    await expect(readFile(legacy.globalCommandShim, "utf8")).rejects.toThrow();
    await expect(readFile(legacy.shim, "utf8")).rejects.toThrow();
  });

  it("removes legacy LaunchAgent", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cleanup-"));
    const legacy = legacyKagentPaths(home);
    await mkdir(legacy.launchAgent.replace(/[^/]*$/, "").replace(/\/$/, ""), { recursive: true });
    await writeFile(legacy.launchAgent, "<?xml?>\n", "utf8");

    await removeLegacyLaunchAgent(home);

    await expect(readFile(legacy.launchAgent, "utf8")).rejects.toThrow();
  });
});
