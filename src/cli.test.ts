import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCommand } from "./cli.js";
import { loadConfig } from "./config.js";
import { appendHistory } from "./history.js";
import { klauxyPaths } from "./paths.js";
import { readState } from "./state.js";

describe("Klauxy commands", () => {
  it("toggles persistent state and reports status", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];
    expect(await runCommand(["on"], { home, output: (line) => output.push(line) })).toBe(0);
    expect((await readState(klauxyPaths(home).state)).enabled).toBe(true);
    await runCommand(["status"], { home, output: (line) => output.push(line) });
    expect(output.at(-1)).toContain("on");
    await runCommand(["off"], { home, output: (line) => output.push(line) });
    expect((await readState(klauxyPaths(home).state)).enabled).toBe(false);
  });

  it("sets and prints system_prompt through config commands", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];
    await runCommand(["config", "set", "translation.system_prompt", "Translate only."], {
      home,
      output: (line) => output.push(line),
    });
    await runCommand(["config", "get"], { home, output: (line) => output.push(line) });
    expect(output.at(-1)).toContain("Translate only.");
  });

  it("delegates install, uninstall, and doctor operations", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];
    const install = vi.fn().mockResolvedValue(undefined);
    const uninstall = vi.fn().mockResolvedValue(undefined);
    const doctor = vi.fn().mockResolvedValue({ ok: true, lines: ["Claude: ok", "oMLX: ok"] });
    const context = {
      home,
      output: (line: string) => output.push(line),
      install,
      uninstall,
      doctor,
    };
    expect(await runCommand(["install"], context)).toBe(0);
    expect(await runCommand(["uninstall"], context)).toBe(0);
    expect(await runCommand(["doctor"], context)).toBe(0);
    expect(install).toHaveBeenCalledOnce();
    expect(uninstall).toHaveBeenCalledOnce();
    expect(output.join("\n")).toContain("oMLX: ok");
  });

  it("prints recent translation history and supports --last", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const path = klauxyPaths(home).history;
    await appendHistory(path, {
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 684,
      original: "첫 번째",
      sent: "First",
    });
    await appendHistory(path, {
      schema: 1,
      timestamp: "2026-08-26T12:01:00.000Z",
      status: "failed",
      durationMs: 5000,
      original: "두 번째",
      sent: "두 번째",
      failure: "timed out",
    });
    const output: string[] = [];

    expect(
      await runCommand(["history", "--last", "1"], {
        home,
        output: (line) => output.push(line),
      }),
    ).toBe(0);

    expect(output.join("\n")).toContain("failed");
    expect(output.join("\n")).toContain("ko 두 번째");
    expect(output.join("\n")).toContain("en 두 번째");
    expect(output.join("\n")).not.toContain("첫 번째");
  });

  it("clears translation history", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    await appendHistory(klauxyPaths(home).history, {
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 10,
      original: "원문",
      sent: "Translation",
    });
    const output: string[] = [];

    expect(
      await runCommand(["history", "clear"], { home, output: (line) => output.push(line) }),
    ).toBe(0);
    expect(output.at(-1)).toContain("Klauxy history cleared.");
    const after: string[] = [];
    await runCommand(["history"], { home, output: (line) => after.push(line) });
    expect(after).toEqual(["No Klauxy history."]);
  });

  it("shows savings for translated entries", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    await appendHistory(klauxyPaths(home).history, {
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 100,
      original: "구조를 설명해줘",
      sent: "Explain the structure.",
    });
    const output: string[] = [];

    expect(await runCommand(["savings"], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("Klauxy savings");
    expect(text).toContain("Translations");
    expect(text).toContain("Original tokens");
    expect(text).toContain("Forwarded tokens");
    expect(text).toContain("Tokens saved");
    expect(text).toContain("Savings");
    expect(text).toContain("tokenizer is private");
    expect(text).not.toContain("구조");
  });

  it("reports no data when history is empty for savings", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand(["savings"], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("Klauxy savings");
    expect(text).toContain("No successful translations to compare.");
  });

  it("shows net increase when translations grow", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    await appendHistory(klauxyPaths(home).history, {
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 50,
      original: "ok",
      sent: "OK, I understand the request and will proceed accordingly.",
    });
    const output: string[] = [];

    expect(await runCommand(["savings"], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("Net token change");
    expect(text).toContain("(longer)");
    expect(text).not.toContain("Tokens saved");
  });
});

describe("discoverability", () => {
  it("shows help for a bare invocation and exits successfully", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand([], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("klx <command>");
    expect(text).toContain("init");
    expect(text).toContain("savings");
  });

  it("accepts help, --help, and -h alike", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    for (const flag of ["help", "--help", "-h"]) {
      const output: string[] = [];
      expect(await runCommand([flag], { home, output: (line) => output.push(line) })).toBe(0);
      expect(output.join("\n")).toContain("Usage:");
    }
  });

  it("prints the version for --version and -v", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    for (const flag of ["--version", "-v", "version"]) {
      const output: string[] = [];
      expect(
        await runCommand([flag], { home, output: (line) => output.push(line), version: "9.9.9" }),
      ).toBe(0);
      expect(output).toEqual(["9.9.9"]);
    }
  });

  it("suggests a correction for a mistyped command and fails", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand(["instal"], { home, output: (line) => output.push(line) })).toBe(1);

    const text = output.join("\n");
    expect(text).toContain("Unknown command: instal");
    expect(text).toContain("klx install");
  });

  it("still fails cleanly when no command is close enough", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand(["deploy"], { home, output: (line) => output.push(line) })).toBe(1);

    const text = output.join("\n");
    expect(text).toContain("Unknown command: deploy");
    expect(text).not.toContain("Did you mean");
    expect(text).toContain("klx --help");
  });

  it("reports the shell-specific reload hint after install", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["install"], {
      home,
      output: (line) => output.push(line),
      install: async () => {},
      reloadHint: async () => "Restart your shell or run: source ~/.bashrc",
    });

    expect(output.join("\n")).toContain("source ~/.bashrc");
  });
});

describe("provider command", () => {
  it("lists providers and marks the current one", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand(["provider"], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("omlx");
    expect(text).toContain("ollama");
    expect(text).toContain("opencode");
    expect(text).toContain("* omlx");
    expect(text).toContain("Current: omlx");
  });

  it("changes the provider and retargets host and model defaults", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["provider", "ollama"], { home, output: (line) => output.push(line) });

    const config = await loadConfig(klauxyPaths(home).config);
    expect(config.translation.provider).toBe("ollama");
    expect(config.translation.host).toBe("http://127.0.0.1:11434");
    expect(config.translation.model).toBe("qwen2.5:7b");
  });

  it("accepts the explicit set form", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));

    await runCommand(["provider", "set", "opencode"], { home, output: () => {} });

    expect((await loadConfig(klauxyPaths(home).config)).translation.provider).toBe("opencode");
  });

  it("rejects an unknown provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(
      await runCommand(["provider", "gpt4"], { home, output: (line) => output.push(line) }),
    ).toBe(1);
    expect(output.join("\n")).toContain("Unknown provider: gpt4");
    expect((await loadConfig(klauxyPaths(home).config)).translation.provider).toBe("omlx");
  });

  it("passes host and model overrides through", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));

    await runCommand(["provider", "ollama", "--host", "http://127.0.0.1:1234"], {
      home,
      output: () => {},
    });

    expect((await loadConfig(klauxyPaths(home).config)).translation.host).toBe(
      "http://127.0.0.1:1234",
    );
  });
});
