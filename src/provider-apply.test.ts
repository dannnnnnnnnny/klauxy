import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, loadConfig, setConfigValue } from "./config.js";
import { applyChoice, resolveChoice } from "./provider-apply.js";
import { providerDefinition } from "./providers.js";

async function configPath(): Promise<string> {
  return join(await mkdtemp(join(tmpdir(), "klauxy-apply-")), "config.toml");
}

describe("resolving a provider choice", () => {
  it("retargets host and model to the new provider's defaults", () => {
    const resolved = resolveChoice(DEFAULT_CONFIG, { provider: "ollama" });

    expect(resolved).toEqual({
      provider: "ollama",
      host: providerDefinition("ollama").defaultHost,
      model: providerDefinition("ollama").defaultModel,
    });
  });

  it("keeps a host the user customised away from the old default", () => {
    const custom = structuredClone(DEFAULT_CONFIG);
    custom.translation.host = "http://127.0.0.1:7777";

    const resolved = resolveChoice(custom, { provider: "ollama" });

    expect(resolved.host).toBe("http://127.0.0.1:7777");
    expect(resolved.model).toBe(providerDefinition("ollama").defaultModel);
  });

  it("lets an explicit override win over both", () => {
    const resolved = resolveChoice(DEFAULT_CONFIG, {
      provider: "ollama",
      host: "http://127.0.0.1:1234",
      model: "custom",
    });

    expect(resolved).toEqual({
      provider: "ollama",
      host: "http://127.0.0.1:1234",
      model: "custom",
    });
  });

  it("does not mutate the config it was given", () => {
    const before = structuredClone(DEFAULT_CONFIG);

    resolveChoice(before, { provider: "ollama" });

    expect(before).toEqual(DEFAULT_CONFIG);
  });
});

describe("persisting a provider choice", () => {
  it("writes provider, host, and model together", async () => {
    const path = await configPath();

    await applyChoice(path, { provider: "ollama" });

    const saved = await loadConfig(path);
    expect(saved.translation.provider).toBe("ollama");
    expect(saved.translation.host).toBe(providerDefinition("ollama").defaultHost);
    expect(saved.translation.model).toBe(providerDefinition("ollama").defaultModel);
  });

  it("leaves unrelated settings alone", async () => {
    const path = await configPath();
    await setConfigValue(path, "translation.timeout_ms", "12000");
    await setConfigValue(path, "translation.system_prompt", "Translate only.");

    await applyChoice(path, { provider: "ollama" });

    const saved = await loadConfig(path);
    expect(saved.translation.timeout_ms).toBe(12000);
    expect(saved.translation.system_prompt).toBe("Translate only.");
  });

  it("preserves a customised host across a switch", async () => {
    const path = await configPath();
    await setConfigValue(path, "translation.host", "http://127.0.0.1:7777");

    const resolved = await applyChoice(path, { provider: "ollama" });

    expect(resolved.host).toBe("http://127.0.0.1:7777");
    expect((await loadConfig(path)).translation.host).toBe("http://127.0.0.1:7777");
  });

  it("is idempotent when applied twice", async () => {
    const path = await configPath();

    const first = await applyChoice(path, { provider: "ollama" });
    const second = await applyChoice(path, { provider: "ollama" });

    expect(second).toEqual(first);
  });
});
