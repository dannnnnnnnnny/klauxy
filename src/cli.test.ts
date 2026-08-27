import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCommand } from "./cli.js";
import { loadConfig } from "./config.js";
import { appendHistory } from "./history.js";
import { klauxyPaths } from "./paths.js";
import { readState } from "./state.js";
import { createStyle } from "./tui.js";

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
  it("points an unconfigured install at setup instead of listing everything", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand([], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("Not set up yet");
    expect(text).toContain("klx setup");
    expect(text).toContain("klx --help");
  });

  it("shows the full command list once installed", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const paths = klauxyPaths(home);
    await mkdir(dirname(paths.manifest), { recursive: true });
    await writeFile(paths.manifest, "{}", "utf8");
    const output: string[] = [];

    expect(await runCommand([], { home, output: (line) => output.push(line) })).toBe(0);

    const text = output.join("\n");
    expect(text).toContain("klx <command>");
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

describe("history argument validation", () => {
  it("rejects a non-numeric --last", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(
      await runCommand(["history", "--last", "abc"], { home, output: (line) => output.push(line) }),
    ).toBe(1);
    expect(output.join("\n")).toContain("Usage: klx history");
  });

  it("rejects zero and negative counts", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));

    for (const count of ["0", "-1", "1.5"]) {
      expect(
        await runCommand(["history", "--last", count], { home, output: () => {} }),
        `--last ${count}`,
      ).toBe(1);
    }
  });

  it("rejects --last with no value", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));

    expect(await runCommand(["history", "--last"], { home, output: () => {} })).toBe(1);
  });

  it("rejects an unrecognised subcommand", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(
      await runCommand(["history", "everything"], { home, output: (line) => output.push(line) }),
    ).toBe(1);
    expect(output.join("\n")).toContain("Usage: klx history");
  });

  it("caps output at the requested count", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    for (let index = 0; index < 3; index += 1) {
      await appendHistory(klauxyPaths(home).history, {
        schema: 1,
        timestamp: new Date(Date.UTC(2026, 7, 26, 12, 0, index)).toISOString(),
        status: "translated",
        durationMs: 10,
        original: `원문 ${index}`,
        sent: `Text ${index}`,
      });
    }
    const output: string[] = [];

    await runCommand(["history", "--last", "2"], { home, output: (line) => output.push(line) });

    const text = output.join("\n");
    expect(text).toContain("Text 2");
    expect(text).toContain("Text 1");
    expect(text).not.toContain("Text 0");
  });
});

describe("recovering from damaged local state", () => {
  it("treats a corrupted state file as off rather than crashing", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const paths = klauxyPaths(home);
    await mkdir(dirname(paths.state), { recursive: true });
    await writeFile(paths.state, "{ not json", "utf8");
    const output: string[] = [];

    expect(await runCommand(["status"], { home, output: (line) => output.push(line) })).toBe(0);
    expect(output.join("\n")).toContain("off");
  });

  it("ignores a state file with the wrong shape", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const paths = klauxyPaths(home);
    await mkdir(dirname(paths.state), { recursive: true });
    await writeFile(paths.state, JSON.stringify({ schema: 99, enabled: "yes" }), "utf8");
    const output: string[] = [];

    await runCommand(["status"], { home, output: (line) => output.push(line) });

    expect(output.join("\n")).toContain("off");
  });

  it("falls back to defaults when the config file is unparseable", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const paths = klauxyPaths(home);
    await mkdir(dirname(paths.config), { recursive: true });
    await writeFile(paths.config, "this is not = valid [toml", "utf8");
    const output: string[] = [];

    expect(
      await runCommand(["config", "get", "translation.provider"], {
        home,
        output: (line) => output.push(line),
      }),
    ).toBe(0);
    expect(output).toEqual(["omlx"]);
  });

  it("skips malformed history lines but keeps valid ones", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const paths = klauxyPaths(home);
    await mkdir(dirname(paths.history), { recursive: true });
    const valid = JSON.stringify({
      schema: 1,
      timestamp: "2026-08-26T12:00:00.000Z",
      status: "translated",
      durationMs: 10,
      original: "원문",
      sent: "Text",
    });
    await writeFile(paths.history, ["{ broken", valid, "also broken"].join("\n"), "utf8");
    const output: string[] = [];

    await runCommand(["history"], { home, output: (line) => output.push(line) });

    expect(output.join("\n")).toContain("Text");
  });
});

describe("config command", () => {
  it("prints one value for config get <key>", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    const code = await runCommand(["config", "get", "translation.provider"], {
      home,
      output: (line) => output.push(line),
    });

    expect(code).toBe(0);
    expect(output).toEqual(["omlx"]);
  });

  it("prints the whole config when no key is given", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["config", "get"], { home, output: (line) => output.push(line) });

    expect(output.join("\n")).toContain('"translation"');
  });

  it("names the valid keys for an unknown key", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    const code = await runCommand(["config", "get", "translation.nope"], {
      home,
      output: (line) => output.push(line),
    });

    expect(code).toBe(1);
    expect(output.join("\n")).toContain("translation.provider");
  });

  it("lists keys in the usage line", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(await runCommand(["config"], { home, output: (line) => output.push(line) })).toBe(1);
    expect(output.join("\n")).toContain("keys:");
  });

  it("round-trips a set value through get", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["config", "set", "translation.timeout_ms", "12000"], {
      home,
      output: () => {},
    });
    await runCommand(["config", "get", "translation.timeout_ms"], {
      home,
      output: (line) => output.push(line),
    });

    expect(output).toEqual(["12000"]);
  });
});

describe("try command", () => {
  it("shows the original and translated sample on success", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    const code = await runCommand(["try"], {
      home,
      output: (line) => output.push(line),
      createTranslator: () => ({ translate: async () => "Explain the project structure." }),
    });

    expect(code).toBe(0);
    const text = output.join("\n");
    expect(text).toContain("Klauxy translation test");
    expect(text).toContain("Explain the project structure.");
    expect(text).toContain("oMLX");
  });

  it("accepts custom sample text", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["try", "버그를", "고쳐줘"], {
      home,
      output: (line) => output.push(line),
      createTranslator: () => ({ translate: async () => "Fix the bug." }),
    });

    const text = output.join("\n");
    expect(text).toContain("버그를 고쳐줘");
    expect(text).toContain("Fix the bug.");
  });

  it("suggests raising the limit when the provider times out", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    const code = await runCommand(["try"], {
      home,
      output: (line) => output.push(line),
      createTranslator: () => ({
        translate: async () => {
          throw new Error("oMLX request timed out");
        },
      }),
    });

    expect(code).toBe(1);
    const text = output.join("\n");
    expect(text).toContain("still be loading");
    expect(text).toContain("translation.timeout_ms");
    expect(text).toContain("5000ms");
  });

  it("points at doctor for failures that are not timeouts", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["try"], {
      home,
      output: (line) => output.push(line),
      createTranslator: () => ({
        translate: async () => {
          throw new Error("connect ECONNREFUSED");
        },
      }),
    });

    const text = output.join("\n");
    expect(text).toContain("klx doctor");
    expect(text).not.toContain("still be loading");
  });

  it("reports a failing provider and exits non-zero", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    const code = await runCommand(["try"], {
      home,
      output: (line) => output.push(line),
      createTranslator: () => ({
        translate: async () => {
          throw new Error("oMLX request timed out");
        },
      }),
    });

    expect(code).toBe(1);
    const text = output.join("\n");
    expect(text).toContain("oMLX request timed out");
    expect(text).toContain("(unchanged)");
  });
});

describe("one-step setup", () => {
  it("runs provider selection, install, and enable in order", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];
    const install = vi.fn().mockResolvedValue(undefined);

    const code = await runCommand(["setup", "--provider", "ollama"], {
      home,
      output: (line) => output.push(line),
      install,
      reloadHint: async () => "Restart your shell or run: source ~/.zshrc",
      probe: async () => ({ reachable: true, models: ["qwen2.5:7b"] }),
    });

    expect(code).toBe(0);
    expect(install).toHaveBeenCalledOnce();
    expect((await readState(klauxyPaths(home).state)).enabled).toBe(true);
    expect((await loadConfig(klauxyPaths(home).config)).translation.provider).toBe("ollama");

    const text = output.join("\n");
    expect(text).toContain("1/3");
    expect(text).toContain("2/3");
    expect(text).toContain("3/3");
    expect(text).toContain("Ready.");
    expect(text).toContain("source ~/.zshrc");
  });

  it("stops before installing when the provider is unreachable", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];
    const install = vi.fn().mockResolvedValue(undefined);

    const code = await runCommand(["setup", "--provider", "ollama"], {
      home,
      output: (line) => output.push(line),
      install,
      probe: async () => ({ reachable: false, models: [], error: "connect ECONNREFUSED" }),
    });

    expect(code).toBe(1);
    expect(install).not.toHaveBeenCalled();
    // Translation must stay off so claude is never routed through a dead proxy.
    expect((await readState(klauxyPaths(home).state)).enabled).toBe(false);
    expect(output.join("\n")).toContain("stopped before installing");
  });

  it("reports an install failure and leaves translation off", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    const code = await runCommand(["setup", "--provider", "ollama"], {
      home,
      output: (line) => output.push(line),
      install: async () => {
        throw new Error("could not locate the real Claude Code executable");
      },
      probe: async () => ({ reachable: true, models: ["qwen2.5:7b"] }),
    });

    expect(code).toBe(1);
    expect((await readState(klauxyPaths(home).state)).enabled).toBe(false);
    const text = output.join("\n");
    expect(text).toContain("could not locate the real Claude Code executable");
    expect(text).toContain("klx setup");
  });

  it("rejects unknown setup flags", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    expect(
      await runCommand(["setup", "--verbose"], { home, output: (line) => output.push(line) }),
    ).toBe(1);
    expect(output.join("\n")).toContain("unknown option: --verbose");
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
    expect(text).toContain("openai-compatible");
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

    await runCommand(["provider", "set", "openai-compatible"], { home, output: () => {} });

    expect((await loadConfig(klauxyPaths(home).config)).translation.provider).toBe(
      "openai-compatible",
    );
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

  it("uses the injected probe when switching, not a live network call", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];
    let probed = 0;

    const code = await runCommand(["provider", "ollama"], {
      home,
      output: (line) => output.push(line),
      probe: async () => {
        probed += 1;
        return { reachable: true, models: ["qwen2.5:7b"] };
      },
    });

    // Before the handlers were split, this path dropped probe and style, so a
    // switch always hit the network and printed unstyled output.
    expect(code).toBe(0);
    expect(probed).toBeGreaterThan(0);
    expect(output.join("\n")).toContain("reachable");
  });

  it("applies the caller's style when switching provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-cli-"));
    const output: string[] = [];

    await runCommand(["provider", "ollama"], {
      home,
      output: (line) => output.push(line),
      style: createStyle({ tty: true, env: {} }),
      probe: async () => ({ reachable: true, models: ["qwen2.5:7b"] }),
    });

    expect(output.join("\n")).toContain("\u001b[");
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
