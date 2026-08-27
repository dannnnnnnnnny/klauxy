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
