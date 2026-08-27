import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface RoutingBackup {
  schema: 1;
  hadValue: boolean;
  value?: string;
  installedValue: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  try {
    return record(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export async function readClaudeUpstream(settingsPath: string): Promise<string | undefined> {
  const settings = await readJson(settingsPath);
  const value = record(settings.env).ANTHROPIC_BASE_URL;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export async function installClaudeRouting(
  settingsPath: string,
  backupPath: string,
  proxyUrl: string,
): Promise<void> {
  const settings = await readJson(settingsPath);
  const env = record(settings.env);
  let backupExists = true;
  try {
    await readFile(backupPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    backupExists = false;
  }
  if (!backupExists) {
    const previous = env.ANTHROPIC_BASE_URL;
    const backup: RoutingBackup = {
      schema: 1,
      hadValue: typeof previous === "string",
      ...(typeof previous === "string" ? { value: previous } : {}),
      installedValue: proxyUrl,
    };
    await atomicJson(backupPath, backup);
  }
  env.ANTHROPIC_BASE_URL = proxyUrl;
  settings.env = env;
  await atomicJson(settingsPath, settings);
}

export async function uninstallClaudeRouting(
  settingsPath: string,
  backupPath: string,
  proxyUrl: string,
): Promise<void> {
  let backup: RoutingBackup;
  try {
    backup = JSON.parse(await readFile(backupPath, "utf8")) as RoutingBackup;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const settings = await readJson(settingsPath);
  const env = record(settings.env);
  if (env.ANTHROPIC_BASE_URL === proxyUrl) {
    if (backup.hadValue && typeof backup.value === "string") {
      env.ANTHROPIC_BASE_URL = backup.value;
    } else {
      delete env.ANTHROPIC_BASE_URL;
    }
    settings.env = env;
    await atomicJson(settingsPath, settings);
  }
  await rm(backupPath, { force: true });
}
