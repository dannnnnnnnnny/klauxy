import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appendHistory, clearHistory, readHistory } from "./history.js";

describe("translation history", () => {
  it("stores and reads the newest entries with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kagent-history-"));
    const path = join(directory, "history.jsonl");

    await appendHistory(path, {
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 684,
      original: "구조를 설명해줘",
      sent: "Explain the structure.",
    });

    expect(await readHistory(path)).toEqual([
      {
        schema: 1,
        timestamp: "2026-08-26T12:00:00.000Z",
        status: "translated",
        durationMs: 684,
        original: "구조를 설명해줘",
        sent: "Explain the structure.",
      },
    ]);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("keeps only the newest 100 valid entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kagent-history-"));
    const path = join(directory, "history.jsonl");
    for (let index = 0; index < 105; index++) {
      await appendHistory(path, {
        schema: 1,
        timestamp: new Date(index * 1_000).toISOString(),
        status: "translated",
        durationMs: index,
        original: `원문 ${index}`,
        sent: `Translation ${index}`,
      });
    }

    const entries = await readHistory(path);
    expect(entries).toHaveLength(100);
    expect(entries[0].original).toBe("원문 5");
    expect(entries.at(-1)?.sent).toBe("Translation 104");
    expect((await readFile(path, "utf8")).split("\n").filter(Boolean)).toHaveLength(100);
  });

  it("ignores malformed lines and clears history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "kagent-history-"));
    const path = join(directory, "history.jsonl");
    await appendHistory(path, {
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "failed",
      durationMs: 5000,
      original: "고쳐줘",
      sent: "고쳐줘",
      failure: "oMLX request timed out",
    });

    await clearHistory(path);

    expect(await readHistory(path)).toEqual([]);
  });
});
describe("concurrent appends", () => {
  it("keeps every entry when many writers race", async () => {
    const directory = await mkdtemp(join(tmpdir(), "klauxy-history-"));
    const path = join(directory, "history.jsonl");

    await Promise.all(
      Array.from({ length: 25 }, (_value, index) =>
        appendHistory(path, {
          schema: 1,
          timestamp: new Date(Date.UTC(2026, 7, 26, 12, 0, index)).toISOString(),
          status: "translated",
          durationMs: 1,
          original: `원문 ${index}`,
          sent: `Text ${index}`,
        }),
      ),
    );

    const entries = await readHistory(path);
    expect(entries).toHaveLength(25);
    expect(new Set(entries.map((entry) => entry.sent)).size).toBe(25);
  });

  it("still enforces the cap under concurrency", async () => {
    const directory = await mkdtemp(join(tmpdir(), "klauxy-history-"));
    const path = join(directory, "history.jsonl");

    await Promise.all(
      Array.from({ length: 130 }, (_value, index) =>
        appendHistory(path, {
          schema: 1,
          timestamp: new Date(Date.UTC(2026, 7, 26, 12, 0, 0, index)).toISOString(),
          status: "translated",
          durationMs: 1,
          original: `원문 ${index}`,
          sent: `Text ${index}`,
        }),
      ),
    );

    expect(await readHistory(path)).toHaveLength(100);
  });

  it("lets later writes proceed after one fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "klauxy-history-"));
    const path = join(directory, "history.jsonl");
    const entry = (index: number) => ({
      schema: 1 as const,
      timestamp: new Date(Date.UTC(2026, 7, 26, 12, 0, index)).toISOString(),
      status: "translated" as const,
      durationMs: 1,
      original: `원문 ${index}`,
      sent: `Text ${index}`,
    });

    // A path inside a missing parent cannot be created, so this write fails.
    const failing = appendHistory(join(directory, "no", "\u0000bad"), entry(0)).catch(
      () => "failed",
    );
    const succeeding = appendHistory(path, entry(1));

    await expect(failing).resolves.toBe("failed");
    await expect(succeeding).resolves.toBeUndefined();
    expect(await readHistory(path)).toHaveLength(1);
  });
});
