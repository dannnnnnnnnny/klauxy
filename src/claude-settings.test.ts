import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installClaudeRouting, uninstallClaudeRouting } from "./claude-settings.js";

describe("persistent Claude routing", () => {
  it("preserves settings and backs up the previous upstream", async () => {
    const root = await mkdtemp(join(tmpdir(), "kagent-settings-"));
    const settings = join(root, "settings.json");
    const backup = join(root, "backup.json");
    await writeFile(
      settings,
      JSON.stringify({
        theme: "dark",
        env: { KEEP: "yes", ANTHROPIC_BASE_URL: "http://127.0.0.1:8787" },
      }),
    );

    await installClaudeRouting(settings, backup, "http://127.0.0.1:18789");

    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({
      theme: "dark",
      env: { KEEP: "yes", ANTHROPIC_BASE_URL: "http://127.0.0.1:18789" },
    });
    expect(JSON.parse(await readFile(backup, "utf8"))).toMatchObject({
      hadValue: true,
      value: "http://127.0.0.1:8787",
    });
  });

  it("is idempotent and restores only Klauxy's own routing value", async () => {
    const root = await mkdtemp(join(tmpdir(), "kagent-settings-"));
    const settings = join(root, "settings.json");
    const backup = join(root, "backup.json");
    await writeFile(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://old" } }));
    await installClaudeRouting(settings, backup, "http://127.0.0.1:18789");
    await installClaudeRouting(settings, backup, "http://127.0.0.1:18789");

    await uninstallClaudeRouting(settings, backup, "http://127.0.0.1:18789");

    expect(JSON.parse(await readFile(settings, "utf8"))).toEqual({
      env: { ANTHROPIC_BASE_URL: "http://old" },
    });
  });

  it("does not overwrite a user change made after installation", async () => {
    const root = await mkdtemp(join(tmpdir(), "kagent-settings-"));
    const settings = join(root, "settings.json");
    const backup = join(root, "backup.json");
    await writeFile(settings, JSON.stringify({ env: {} }));
    await installClaudeRouting(settings, backup, "http://127.0.0.1:18789");
    await writeFile(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "http://user-change" } }),
    );

    await uninstallClaudeRouting(settings, backup, "http://127.0.0.1:18789");

    expect(JSON.parse(await readFile(settings, "utf8")).env.ANTHROPIC_BASE_URL).toBe(
      "http://user-change",
    );
  });
});
