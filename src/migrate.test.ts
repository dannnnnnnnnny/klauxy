import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "./history.js";
import { mergeHistory } from "./migrate.js";

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
