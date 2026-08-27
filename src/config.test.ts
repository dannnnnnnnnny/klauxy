import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configKeys, DEFAULT_CONFIG, loadConfig, setConfigValue } from "./config.js";

describe("configuration", () => {
  it("uses the local oMLX translation defaults when the file is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kagent-config-"));
    const config = await loadConfig(join(dir, "missing.toml"));

    expect(config).toEqual(DEFAULT_CONFIG);
    expect(config.translation.provider).toBe("omlx");
    expect(config.translation.host).toBe("http://127.0.0.1:8010");
    expect(config.translation.model).toBe("Qwen3-8B-4bit");
    expect(config.translation.timeout_ms).toBe(5000);
    expect(config.translation.system_prompt).toContain("including both curly braces");
    expect(config.translation.system_prompt).toContain("Never invent a placeholder");
  });

  it("reads translation and UI values from TOML", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kagent-config-"));
    const path = join(dir, "config.toml");
    await BunLike.write(
      path,
      '[translation]\nhost = "http://127.0.0.1:9000"\ntimeout_ms = 1200\n\n[ui]\nshow_translation = true\n',
    );

    const config = await loadConfig(path);
    expect(config.translation.host).toBe("http://127.0.0.1:9000");
    expect(config.translation.timeout_ms).toBe(1200);
    expect(config.ui.show_translation).toBe(true);
  });

  it("updates one supported key without losing other settings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kagent-config-"));
    const path = join(dir, "config.toml");

    await setConfigValue(path, "translation.timeout_ms", "1500");

    const config = await loadConfig(path);
    expect(config.translation.timeout_ms).toBe(1500);
    expect(config.translation.model).toBe("Qwen3-8B-4bit");
    expect(await readFile(path, "utf8")).toContain("timeout_ms = 1500");
  });

  it("switches provider defaults and rejects unknown providers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-config-"));
    const path = join(dir, "config.toml");

    await setConfigValue(path, "translation.provider", "ollama");
    const config = await loadConfig(path);
    expect(config.translation.provider).toBe("ollama");
    expect(config.translation.host).toBe("http://127.0.0.1:11434");
    expect(config.translation.model).toBe("qwen2.5:7b");

    await expect(setConfigValue(path, "translation.provider", "gpt4")).rejects.toThrow(
      "unknown provider",
    );
  });

  it("keeps a customized host when switching provider", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-config-"));
    const path = join(dir, "config.toml");

    await setConfigValue(path, "translation.host", "http://127.0.0.1:7777");
    await setConfigValue(path, "translation.provider", "ollama");

    const config = await loadConfig(path);
    expect(config.translation.provider).toBe("ollama");
    expect(config.translation.host).toBe("http://127.0.0.1:7777");
  });

  it("falls back to omlx defaults when the provider value is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-config-"));
    const path = join(dir, "config.toml");
    await BunLike.write(path, '[translation]\nprovider = "bogus"\n');

    const config = await loadConfig(path);
    expect(config.translation.provider).toBe("omlx");
    expect(config.translation.host).toBe("http://127.0.0.1:8010");
  });
});

const BunLike = {
  write: async (path: string, data: string) => {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, data, "utf8");
  },
};
describe("configuration errors name the way forward", () => {
  it("lists valid keys when the key is unknown", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-config-"));
    const path = join(dir, "config.toml");

    await expect(setConfigValue(path, "translation.bogus", "5")).rejects.toThrow(
      /valid keys:.*translation\.provider/s,
    );
  });

  it("rejects a key outside the known sections", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-config-"));
    const path = join(dir, "config.toml");

    await expect(setConfigValue(path, "network.proxy", "on")).rejects.toThrow("valid keys:");
    await expect(setConfigValue(path, "translation", "x")).rejects.toThrow("valid keys:");
  });

  it("echoes the offending value for a type mismatch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "klauxy-config-"));
    const path = join(dir, "config.toml");

    await expect(setConfigValue(path, "translation.timeout_ms", "abc")).rejects.toThrow("got: abc");
    await expect(setConfigValue(path, "ui.show_translation", "yes")).rejects.toThrow("got: yes");
  });

  it("derives the key list from the config shape", () => {
    const keys = configKeys();

    expect(keys).toContain("translation.provider");
    expect(keys).toContain("translation.system_prompt");
    expect(keys).toContain("ui.show_translation");
    // Every advertised key must actually be settable.
    expect(keys.every((key) => key.includes("."))).toBe(true);
  });
});
