import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readState, writeEnabled } from "./state.js";

describe("runtime state", () => {
  it("fails open to disabled when state is missing or malformed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kagent-state-"));
    const path = join(dir, "state.json");
    expect(await readState(path)).toEqual({ schema: 1, enabled: false, generation: 0 });

    await writeFile(path, "not-json", "utf8");
    expect(await readState(path)).toEqual({ schema: 1, enabled: false, generation: 0 });
  });

  it("persists toggles and increments generation", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kagent-state-"));
    const path = join(dir, "state.json");

    expect(await writeEnabled(path, true)).toEqual({ schema: 1, enabled: true, generation: 1 });
    expect(await writeEnabled(path, false)).toEqual({ schema: 1, enabled: false, generation: 2 });
    expect(await readState(path)).toEqual({ schema: 1, enabled: false, generation: 2 });
  });
});
describe("rejecting damaged state", () => {
  async function statePath(): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), "klauxy-state-")), "state.json");
  }

  it("ignores a negative generation", async () => {
    const path = await statePath();
    await writeFile(path, JSON.stringify({ schema: 1, enabled: true, generation: -1 }), "utf8");

    // A negative generation cannot have been written by Klauxy.
    expect(await readState(path)).toEqual({ schema: 1, enabled: false, generation: 0 });
  });

  it("ignores a non-integer generation", async () => {
    const path = await statePath();
    await writeFile(path, JSON.stringify({ schema: 1, enabled: true, generation: 1.5 }), "utf8");

    expect((await readState(path)).enabled).toBe(false);
  });

  it("ignores a missing generation", async () => {
    const path = await statePath();
    await writeFile(path, JSON.stringify({ schema: 1, enabled: true }), "utf8");

    expect((await readState(path)).enabled).toBe(false);
  });

  it("ignores a future schema rather than guessing its shape", async () => {
    const path = await statePath();
    await writeFile(path, JSON.stringify({ schema: 2, enabled: true, generation: 3 }), "utf8");

    expect((await readState(path)).enabled).toBe(false);
  });

  it("bumps generation on each write", async () => {
    const path = await statePath();

    const first = await writeEnabled(path, true);
    const second = await writeEnabled(path, false);

    expect(second.generation).toBe(first.generation + 1);
  });
});
