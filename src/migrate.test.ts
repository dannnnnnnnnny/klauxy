import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HistoryEntry, readHistory } from "./history.js";
import { getLegacyRealClaude, mergeHistory, migrateLegacyKagent } from "./migrate.js";
import { klauxyPaths, legacyKagentPaths } from "./paths.js";

function entry(timestamp: string, original: string, sent: string): HistoryEntry {
  return { schema: 1, timestamp, status: "translated", durationMs: 10, original, sent };
}

describe("history merge", () => {
  it("drops entries duplicated across both logs", () => {
    const shared = entry("2026-08-26T12:00:00.000Z", "안녕", "Hello");

    const merged = mergeHistory([shared], [shared]);

    expect(merged).toHaveLength(1);
  });

  it("keeps distinct entries from both sides", () => {
    const merged = mergeHistory(
      [entry("2026-08-26T12:01:00.000Z", "세계", "World")],
      [entry("2026-08-26T12:00:00.000Z", "안녕", "Hello")],
    );

    expect(merged.map((item) => item.sent)).toEqual(["Hello", "World"]);
  });

  it("orders the result chronologically", () => {
    const merged = mergeHistory(
      [entry("2026-08-26T12:02:00.000Z", "c", "C")],
      [entry("2026-08-26T12:00:00.000Z", "a", "A"), entry("2026-08-26T12:01:00.000Z", "b", "B")],
    );

    expect(merged.map((item) => item.sent)).toEqual(["A", "B", "C"]);
  });

  it("caps the merged log at 100 entries, keeping the newest", () => {
    // Spread across hours and minutes so the timestamps stay strictly ordered.
    const many = Array.from({ length: 140 }, (_value, index) => {
      const hour = String(Math.floor(index / 60)).padStart(2, "0");
      const minute = String(index % 60).padStart(2, "0");
      return entry(`2026-08-26T${hour}:${minute}:00.000Z`, `k${index}`, `e${index}`);
    });

    const merged = mergeHistory(many, []);

    expect(merged).toHaveLength(100);
    expect(merged.at(-1)?.sent).toBe("e139");
    expect(merged[0]?.sent).toBe("e40");
  });

  it("treats entries differing only in text as distinct", () => {
    const merged = mergeHistory(
      [entry("2026-08-26T12:00:00.000Z", "안녕", "Hello")],
      [entry("2026-08-26T12:00:00.000Z", "안녕", "Hi")],
    );

    expect(merged).toHaveLength(2);
  });
});
describe("migrating a KAgent installation", () => {
  async function home(): Promise<string> {
    return mkdtemp(join(tmpdir(), "klauxy-migrate-"));
  }

  async function seedLegacy(root: string, files: Record<string, string>): Promise<void> {
    const legacy = legacyKagentPaths(root);
    await mkdir(legacy.configDir, { recursive: true });
    for (const [key, contents] of Object.entries(files)) {
      await writeFile(legacy[key as keyof typeof legacy] as string, contents, "utf8");
    }
  }

  it("does nothing when there is no legacy installation", async () => {
    const root = await home();

    await expect(migrateLegacyKagent(root)).resolves.toBeUndefined();
    await expect(readFile(klauxyPaths(root, "darwin").config, "utf8")).rejects.toThrow();
  });

  it("copies legacy config and state to the canonical paths", async () => {
    const root = await home();
    await seedLegacy(root, {
      config: '[translation]\nmodel = "legacy-model"\n',
      state: JSON.stringify({ schema: 1, enabled: true, generation: 4 }),
    });
    const paths = klauxyPaths(root, "darwin");

    await migrateLegacyKagent(root);

    expect(await readFile(paths.config, "utf8")).toContain("legacy-model");
    expect(JSON.parse(await readFile(paths.state, "utf8")).enabled).toBe(true);
  });

  it("never overwrites config the user already has", async () => {
    const root = await home();
    await seedLegacy(root, { config: '[translation]\nmodel = "legacy"\n' });
    const paths = klauxyPaths(root, "darwin");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.config, '[translation]\nmodel = "current"\n', "utf8");

    await migrateLegacyKagent(root);

    expect(await readFile(paths.config, "utf8")).toContain("current");
  });

  it("merges legacy history into existing history", async () => {
    const root = await home();
    const entry = (seconds: number, sent: string) =>
      JSON.stringify({
        schema: 1,
        timestamp: new Date(Date.UTC(2026, 7, 26, 12, 0, seconds)).toISOString(),
        status: "translated",
        durationMs: 10,
        original: `원문 ${sent}`,
        sent,
      });
    await seedLegacy(root, { history: `${entry(0, "FromLegacy")}\n` });
    const paths = klauxyPaths(root, "darwin");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(paths.history, `${entry(1, "FromCurrent")}\n`, "utf8");

    await migrateLegacyKagent(root);

    const merged = await readHistory(paths.history);
    expect(merged.map((item) => item.sent).sort()).toEqual(["FromCurrent", "FromLegacy"]);
  });

  it("carries over the Claude settings backup so uninstall can still restore", async () => {
    const root = await home();
    await seedLegacy(root, {
      claudeSettingsBackup: JSON.stringify({ schema: 1, hadValue: false, installedValue: "x" }),
    });

    await migrateLegacyKagent(root);

    expect(
      JSON.parse(await readFile(klauxyPaths(root, "darwin").claudeSettingsBackup, "utf8")).schema,
    ).toBe(1);
  });

  it("is safe to run twice", async () => {
    const root = await home();
    await seedLegacy(root, { config: '[translation]\nmodel = "legacy"\n' });

    await migrateLegacyKagent(root);
    await expect(migrateLegacyKagent(root)).resolves.toBeUndefined();

    expect(await readFile(klauxyPaths(root, "darwin").config, "utf8")).toContain("legacy");
  });

  it("migrates when only a legacy manifest exists", async () => {
    const root = await home();
    await seedLegacy(root, {
      manifest: JSON.stringify({ realClaude: "/legacy/claude" }),
    });

    await expect(migrateLegacyKagent(root)).resolves.toBeUndefined();
    expect(await getLegacyRealClaude(root)).toBe("/legacy/claude");
  });

  it("reports no legacy Claude path when the manifest is corrupted", async () => {
    const root = await home();
    await seedLegacy(root, { manifest: "{ not json" });

    expect(await getLegacyRealClaude(root)).toBeNull();
  });

  it("reports no legacy Claude path when the manifest lacks the field", async () => {
    const root = await home();
    await seedLegacy(root, { manifest: JSON.stringify({ entry: "/app/index.js" }) });

    expect(await getLegacyRealClaude(root)).toBeNull();
  });
});
