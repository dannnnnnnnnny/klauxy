import { join } from "node:path";

export interface LegacyKagentPaths {
  configDir: string;
  config: string;
  state: string;
  history: string;
  claudeSettingsBackup: string;
  manifest: string;
  binDir: string;
  shim: string;
  commandShim: string;
  globalCommandShim: string;
  installDir: string;
  launchAgent: string;
}

export const LEGACY_KAGENT_PROXY = "http://127.0.0.1:18789";
export const LEGACY_KAGENT_PROXY_LABEL = "com.kagent.proxy";
export const LEGACY_KAGENT_HEALTH = "/__kagent/health";

export function legacyKagentPaths(home: string): LegacyKagentPaths {
  const configDir = join(home, ".config", "kagent");
  const binDir = join(home, ".kagent", "bin");
  return {
    configDir,
    config: join(configDir, "config.toml"),
    state: join(configDir, "state.json"),
    history: join(configDir, "history.jsonl"),
    claudeSettingsBackup: join(configDir, "claude-settings-backup.json"),
    manifest: join(configDir, "install.json"),
    binDir,
    shim: join(binDir, "claude"),
    commandShim: join(binDir, "kagent"),
    globalCommandShim: join(home, ".local", "bin", "kagent"),
    installDir: join(home, ".local", "share", "kagent"),
    launchAgent: join(home, "Library", "LaunchAgents", "com.kagent.proxy.plist"),
  };
}

export interface KlauxyPaths {
  configDir: string;
  config: string;
  state: string;
  history: string;
  claudeSettingsBackup: string;
  manifest: string;
  binDir: string;
  shim: string;
  shortCommandShim: string;
  globalShortCommandShim: string;
  brandedCommandShim: string;
  globalBrandedCommandShim: string;
  installDir: string;
  claudeSettings: string;
  launchAgent: string;
  proxyLog: string;
  proxyErrorLog: string;
}

export function klauxyPaths(home: string): KlauxyPaths {
  const configDir = join(home, ".config", "klauxy");
  const binDir = join(home, ".klauxy", "bin");
  return {
    configDir,
    config: join(configDir, "config.toml"),
    state: join(configDir, "state.json"),
    history: join(configDir, "history.jsonl"),
    claudeSettingsBackup: join(configDir, "claude-settings-backup.json"),
    manifest: join(configDir, "install.json"),
    binDir,
    shim: join(binDir, "claude"),
    shortCommandShim: join(binDir, "klx"),
    globalShortCommandShim: join(home, ".local", "bin", "klx"),
    brandedCommandShim: join(binDir, "klauxy"),
    globalBrandedCommandShim: join(home, ".local", "bin", "klauxy"),
    installDir: join(home, ".local", "share", "klauxy"),
    claudeSettings: join(home, ".claude", "settings.json"),
    launchAgent: join(home, "Library", "LaunchAgents", "com.klauxy.proxy.plist"),
    proxyLog: join(configDir, "proxy.log"),
    proxyErrorLog: join(configDir, "proxy.err.log"),
  };
}
