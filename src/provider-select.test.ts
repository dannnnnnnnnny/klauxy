import { describe, expect, it } from "vitest";
import {
  detectProviders,
  menuLine,
  PROBE_TIMEOUT_MS,
  resolveAnswer,
  suggestedDefault,
} from "./provider-select.js";
import { PROVIDER_IDS, type ProbeResult, type ProviderId } from "./providers.js";
import { createStyle, plainStyle } from "./tui.js";

function reachable(...ids: ProviderId[]) {
  return async (id: ProviderId): Promise<ProbeResult> =>
    ids.includes(id) ? { reachable: true, models: ["m"] } : { reachable: false, models: [] };
}

describe("provider detection", () => {
  it("probes every provider at its own default host", async () => {
    const seen: Array<{ id: ProviderId; host: string; timeout: number }> = [];

    await detectProviders(async (id, host, timeout) => {
      seen.push({ id, host, timeout });
      return { reachable: false, models: [] };
    });

    expect(seen.map((entry) => entry.id)).toEqual([...PROVIDER_IDS]);
    expect(new Set(seen.map((entry) => entry.host)).size).toBe(PROVIDER_IDS.length);
    expect(seen.every((entry) => entry.timeout === PROBE_TIMEOUT_MS)).toBe(true);
  });

  it("suggests the first detected provider", async () => {
    expect(suggestedDefault(await detectProviders(reachable("ollama")))).toBe("ollama");
  });

  it("falls back to omlx when nothing is running", async () => {
    expect(suggestedDefault(await detectProviders(reachable()))).toBe("omlx");
  });
});

describe("menu rendering", () => {
  it("marks a reachable provider as detected", async () => {
    const availability = await detectProviders(reachable("omlx"));

    expect(menuLine(plainStyle, 0, availability[0] as never)).toContain("detected");
  });

  it("marks an unreachable provider as not running", async () => {
    const availability = await detectProviders(reachable());

    expect(menuLine(plainStyle, 1, availability[1] as never)).toContain("not running");
  });

  it("numbers entries from one", async () => {
    const availability = await detectProviders(reachable());

    expect(menuLine(plainStyle, 0, availability[0] as never)).toContain("1)");
    expect(menuLine(plainStyle, 2, availability[2] as never)).toContain("3)");
  });

  it("colourises when the style allows it", async () => {
    const availability = await detectProviders(reachable("omlx"));

    expect(menuLine(createStyle({ tty: true, env: {} }), 0, availability[0] as never)).toContain(
      "\u001b[",
    );
  });
});

describe("answer resolution", () => {
  it("treats an empty answer as the suggested default", () => {
    expect(resolveAnswer("", "ollama")).toEqual({ provider: "ollama" });
    expect(resolveAnswer("   ", "omlx")).toEqual({ provider: "omlx" });
  });

  it("accepts a one-based index", () => {
    expect(resolveAnswer("1", "omlx")).toEqual({ provider: PROVIDER_IDS[0] });
    expect(resolveAnswer("2", "omlx")).toEqual({ provider: PROVIDER_IDS[1] });
  });

  it("accepts a provider id directly", () => {
    expect(resolveAnswer("ollama", "omlx")).toEqual({ provider: "ollama" });
  });

  it("rejects an out-of-range index", () => {
    expect(resolveAnswer("0", "omlx")).toEqual({ error: "0" });
    expect(resolveAnswer("99", "omlx")).toEqual({ error: "99" });
  });

  it("rejects a name that is not a provider", () => {
    expect(resolveAnswer("gpt4", "omlx")).toEqual({ error: "gpt4" });
  });

  it("signals when no input is available at all", () => {
    expect(resolveAnswer(null, "omlx")).toEqual({ needsInput: true });
  });
});
