import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";
import { parseInitArgs, runInit } from "./init.js";
import type { ProbeResult, ProviderId } from "./providers.js";

async function configPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "klauxy-init-"));
  return join(dir, "config.toml");
}

function reachable(models: string[]): () => Promise<ProbeResult> {
  return async () => ({ reachable: true, models });
}

const unreachable = async (): Promise<ProbeResult> => ({
  reachable: false,
  models: [],
  error: "connect ECONNREFUSED",
});

describe("init argument parsing", () => {
  it("reads provider, host, and model flags", () => {
    expect(parseInitArgs(["--provider", "ollama", "--model", "qwen2.5:7b"])).toEqual({
      provider: "ollama",
      model: "qwen2.5:7b",
    });
  });

  it("rejects a flag with no value", () => {
    expect(parseInitArgs(["--provider"])).toEqual({ error: "missing value for --provider" });
  });

  it("rejects unknown options", () => {
    expect(parseInitArgs(["--verbose"])).toEqual({ error: "unknown option: --verbose" });
  });
});

describe("init", () => {
  it("persists a non-interactive provider choice with that provider's defaults", async () => {
    const path = await configPath();
    const output: string[] = [];

    const result = await runInit(
      { provider: "ollama" },
      {
        configPath: path,
        output: (line) => output.push(line),
        prompt: async () => null,
        probe: reachable(["qwen2.5:7b"]),
      },
    );

    expect(result.code).toBe(0);
    const config = await loadConfig(path);
    expect(config.translation.provider).toBe("ollama");
    expect(config.translation.host).toBe("http://127.0.0.1:11434");
    expect(config.translation.model).toBe("qwen2.5:7b");
    expect(output.join("\n")).toContain("Ollama is reachable");
  });

  it("rejects an unknown provider without writing config", async () => {
    const path = await configPath();
    const output: string[] = [];

    const result = await runInit(
      { provider: "gpt4" },
      {
        configPath: path,
        output: (line) => output.push(line),
        prompt: async () => null,
        probe: reachable([]),
      },
    );

    expect(result.code).toBe(1);
    expect(output.join("\n")).toContain("Unknown provider: gpt4");
    expect((await loadConfig(path)).translation.provider).toBe("omlx");
  });

  it("honours explicit host and model overrides", async () => {
    const path = await configPath();

    await runInit(
      { provider: "opencode", host: "http://127.0.0.1:9999", model: "custom-model" },
      {
        configPath: path,
        output: () => {},
        prompt: async () => null,
        probe: reachable(["custom-model"]),
      },
    );

    const config = await loadConfig(path);
    expect(config.translation.provider).toBe("opencode");
    expect(config.translation.host).toBe("http://127.0.0.1:9999");
    expect(config.translation.model).toBe("custom-model");
  });

  it("selects a provider by menu number when prompted", async () => {
    const path = await configPath();
    const questions: string[] = [];

    const result = await runInit(
      {},
      {
        configPath: path,
        output: () => {},
        prompt: async (question) => {
          questions.push(question);
          return "2";
        },
        probe: reachable(["qwen2.5:7b"]),
      },
    );

    expect(result.code).toBe(0);
    expect((await loadConfig(path)).translation.provider).toBe("ollama");
    expect(questions[0]).toContain("Select a provider");
  });

  it("accepts a provider id typed at the prompt", async () => {
    const path = await configPath();

    await runInit(
      {},
      {
        configPath: path,
        output: () => {},
        prompt: async () => "opencode",
        probe: reachable([]),
      },
    );

    expect((await loadConfig(path)).translation.provider).toBe("opencode");
  });

  it("defaults an empty answer to the detected provider", async () => {
    const path = await configPath();
    const probe = async (id: ProviderId): Promise<ProbeResult> =>
      id === "ollama"
        ? { reachable: true, models: ["qwen2.5:7b"] }
        : { reachable: false, models: [], error: "down" };

    await runInit({}, { configPath: path, output: () => {}, prompt: async () => "", probe });

    expect((await loadConfig(path)).translation.provider).toBe("ollama");
  });

  it("rejects an invalid menu answer", async () => {
    const path = await configPath();
    const output: string[] = [];

    const result = await runInit(
      {},
      {
        configPath: path,
        output: (line) => output.push(line),
        prompt: async () => "9",
        probe: unreachable,
      },
    );

    expect(result.code).toBe(1);
    expect(output.join("\n")).toContain("Invalid selection: 9");
  });

  it("explains how to run non-interactively when no input is available", async () => {
    const path = await configPath();
    const output: string[] = [];

    const result = await runInit(
      {},
      {
        configPath: path,
        output: (line) => output.push(line),
        prompt: async () => null,
        probe: unreachable,
      },
    );

    expect(result.code).toBe(1);
    expect(output.join("\n")).toContain("klx init --provider");
  });

  it("saves the config but reports failure when the provider is unreachable", async () => {
    const path = await configPath();
    const output: string[] = [];

    const result = await runInit(
      { provider: "ollama" },
      {
        configPath: path,
        output: (line) => output.push(line),
        prompt: async () => null,
        probe: unreachable,
      },
    );

    expect(result.code).toBe(1);
    expect((await loadConfig(path)).translation.provider).toBe("ollama");
    const text = output.join("\n");
    expect(text).toContain("Cannot reach Ollama");
    expect(text).toContain("ollama serve");
  });

  it("warns when the provider runs but lacks the configured model", async () => {
    const path = await configPath();
    const output: string[] = [];

    const result = await runInit(
      { provider: "ollama" },
      {
        configPath: path,
        output: (line) => output.push(line),
        prompt: async () => null,
        probe: reachable(["llama3:8b"]),
      },
    );

    expect(result.code).toBe(1);
    const text = output.join("\n");
    expect(text).toContain("does not serve model");
    expect(text).toContain("llama3:8b");
  });
});
