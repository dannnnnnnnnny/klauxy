import { describe, expect, it } from "vitest";
import { klauxyPaths, legacyKagentPaths } from "./paths.js";

describe("Klauxy paths", () => {
  it("keeps configuration, state, shim, and runtime files separate", () => {
    expect(klauxyPaths("/tmp/home")).toEqual({
      configDir: "/tmp/home/.config/klauxy",
      config: "/tmp/home/.config/klauxy/config.toml",
      state: "/tmp/home/.config/klauxy/state.json",
      history: "/tmp/home/.config/klauxy/history.jsonl",
      claudeSettingsBackup: "/tmp/home/.config/klauxy/claude-settings-backup.json",
      manifest: "/tmp/home/.config/klauxy/install.json",
      binDir: "/tmp/home/.klauxy/bin",
      shim: "/tmp/home/.klauxy/bin/claude",
      shortCommandShim: "/tmp/home/.klauxy/bin/klx",
      globalShortCommandShim: "/tmp/home/.local/bin/klx",
      brandedCommandShim: "/tmp/home/.klauxy/bin/klauxy",
      globalBrandedCommandShim: "/tmp/home/.local/bin/klauxy",
      installDir: "/tmp/home/.local/share/klauxy",
      claudeSettings: "/tmp/home/.claude/settings.json",
      launchAgent: "/tmp/home/Library/LaunchAgents/com.klauxy.proxy.plist",
      proxyLog: "/tmp/home/.config/klauxy/proxy.log",
      proxyErrorLog: "/tmp/home/.config/klauxy/proxy.err.log",
    });
  });
});

describe("legacy Kagent paths", () => {
  it("returns correct legacy paths for migration", () => {
    expect(legacyKagentPaths("/tmp/home")).toEqual({
      configDir: "/tmp/home/.config/kagent",
      config: "/tmp/home/.config/kagent/config.toml",
      state: "/tmp/home/.config/kagent/state.json",
      history: "/tmp/home/.config/kagent/history.jsonl",
      claudeSettingsBackup: "/tmp/home/.config/kagent/claude-settings-backup.json",
      manifest: "/tmp/home/.config/kagent/install.json",
      binDir: "/tmp/home/.kagent/bin",
      shim: "/tmp/home/.kagent/bin/claude",
      commandShim: "/tmp/home/.kagent/bin/kagent",
      globalCommandShim: "/tmp/home/.local/bin/kagent",
      installDir: "/tmp/home/.local/share/kagent",
      launchAgent: "/tmp/home/Library/LaunchAgents/com.kagent.proxy.plist",
    });
  });
});
