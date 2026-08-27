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
describe("preserving the user's Claude settings", () => {
  async function paths() {
    const root = await mkdtemp(join(tmpdir(), "klauxy-settings-"));
    return { settings: join(root, "settings.json"), backup: join(root, "backup.json") };
  }

  const PROXY = "http://127.0.0.1:18789";

  it("restores a gateway the user had configured", async () => {
    const { settings, backup } = await paths();
    await writeFile(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://gateway.example.com" } }),
      "utf8",
    );

    await installClaudeRouting(settings, backup, PROXY);
    await uninstallClaudeRouting(settings, backup, PROXY);

    const restored = JSON.parse(await readFile(settings, "utf8"));
    expect(restored.env.ANTHROPIC_BASE_URL).toBe("https://gateway.example.com");
  });

  it("removes the key entirely when there was none before", async () => {
    const { settings, backup } = await paths();

    await installClaudeRouting(settings, backup, PROXY);
    await uninstallClaudeRouting(settings, backup, PROXY);

    const restored = JSON.parse(await readFile(settings, "utf8"));
    expect(restored.env).not.toHaveProperty("ANTHROPIC_BASE_URL");
  });

  it("keeps unrelated settings across install and uninstall", async () => {
    const { settings, backup } = await paths();
    await writeFile(
      settings,
      JSON.stringify({ theme: "dark", env: { OTHER: "keep" }, permissions: { allow: ["Bash"] } }),
      "utf8",
    );

    await installClaudeRouting(settings, backup, PROXY);
    await uninstallClaudeRouting(settings, backup, PROXY);

    const restored = JSON.parse(await readFile(settings, "utf8"));
    expect(restored.theme).toBe("dark");
    expect(restored.env.OTHER).toBe("keep");
    expect(restored.permissions.allow).toEqual(["Bash"]);
  });

  it("does not overwrite the backup when install runs twice", async () => {
    const { settings, backup } = await paths();
    await writeFile(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://original.example.com" } }),
      "utf8",
    );

    await installClaudeRouting(settings, backup, PROXY);
    // A second install must not record the proxy URL as the original value.
    await installClaudeRouting(settings, backup, PROXY);
    await uninstallClaudeRouting(settings, backup, PROXY);

    expect(JSON.parse(await readFile(settings, "utf8")).env.ANTHROPIC_BASE_URL).toBe(
      "https://original.example.com",
    );
  });

  it("leaves a value the user changed after install alone", async () => {
    const { settings, backup } = await paths();
    await installClaudeRouting(settings, backup, PROXY);
    await writeFile(
      settings,
      JSON.stringify({ env: { ANTHROPIC_BASE_URL: "https://user-chose-this.example.com" } }),
      "utf8",
    );

    await uninstallClaudeRouting(settings, backup, PROXY);

    // The setting is no longer Klauxy's, so uninstall must not touch it.
    expect(JSON.parse(await readFile(settings, "utf8")).env.ANTHROPIC_BASE_URL).toBe(
      "https://user-chose-this.example.com",
    );
  });

  it("is a no-op when there is no backup to restore from", async () => {
    const { settings, backup } = await paths();
    await writeFile(settings, JSON.stringify({ env: { ANTHROPIC_BASE_URL: PROXY } }), "utf8");

    await expect(uninstallClaudeRouting(settings, backup, PROXY)).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(settings, "utf8")).env.ANTHROPIC_BASE_URL).toBe(PROXY);
  });

  it("removes the backup file once uninstall completes", async () => {
    const { settings, backup } = await paths();

    await installClaudeRouting(settings, backup, PROXY);
    await uninstallClaudeRouting(settings, backup, PROXY);

    await expect(readFile(backup, "utf8")).rejects.toThrow();
  });

  it("treats a non-object settings file as empty rather than crashing", async () => {
    const { settings, backup } = await paths();
    await writeFile(settings, "[1, 2, 3]", "utf8");

    await expect(installClaudeRouting(settings, backup, PROXY)).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(settings, "utf8")).env.ANTHROPIC_BASE_URL).toBe(PROXY);
  });
});
