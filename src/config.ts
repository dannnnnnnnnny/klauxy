import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import TOML from "@iarna/toml";

export interface Config {
  translation: {
    host: string;
    model: string;
    timeout_ms: number;
    max_tokens: number;
    system_prompt: string;
  };
  ui: { show_translation: boolean };
}

export const DEFAULT_SYSTEM_PROMPT = [
  "Translate the user Korean natural-language instruction into concise, natural English suitable for an expert AI coding agent.",
  "",
  "Tokens matching {K0}, {K1}, {K2}, and so on are immutable placeholders: reproduce every placeholder exactly once, including both curly braces, and never translate, rename, remove, or reorder it.",
  "Never invent a placeholder. If the input contains no placeholders, the output must contain no placeholders.",
  "",
  "Preserve technical meaning precisely. Never modify source code, identifiers, package names, file paths, shell commands, SQL, URLs, error messages, stack traces, code blocks, or quoted literals.",
  "",
  "Use standard software-engineering terminology. Do not answer, explain, reason, add information, or prefix the result. Output only the translated prompt.",
  "",
  "Example: {K0}를 수정해줘 -> Fix {K0}.",
].join("\n");

export const DEFAULT_CONFIG: Config = {
  translation: {
    host: "http://127.0.0.1:8010",
    model: "Qwen3-8B-4bit",
    timeout_ms: 5000,
    max_tokens: 256,
    system_prompt: DEFAULT_SYSTEM_PROMPT,
  },
  ui: { show_translation: false },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export async function loadConfig(path: string): Promise<Config> {
  let parsed: Record<string, unknown>;
  try {
    parsed = asRecord(TOML.parse(await readFile(path, "utf8")));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }

  const translation = asRecord(parsed.translation);
  const ui = asRecord(parsed.ui);
  return {
    translation: {
      host: stringValue(translation.host, DEFAULT_CONFIG.translation.host),
      model: stringValue(translation.model, DEFAULT_CONFIG.translation.model),
      timeout_ms: numberValue(translation.timeout_ms, DEFAULT_CONFIG.translation.timeout_ms),
      max_tokens: numberValue(translation.max_tokens, DEFAULT_CONFIG.translation.max_tokens),
      system_prompt: stringValue(
        translation.system_prompt,
        DEFAULT_CONFIG.translation.system_prompt,
      ),
    },
    ui: {
      show_translation:
        typeof ui.show_translation === "boolean"
          ? ui.show_translation
          : DEFAULT_CONFIG.ui.show_translation,
    },
  };
}

function parseConfigValue(current: unknown, value: string): string | number | boolean {
  if (typeof current === "number") {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error("value must be a number");
    return parsed;
  }
  if (typeof current === "boolean") {
    if (value !== "true" && value !== "false") throw new Error("value must be true or false");
    return value === "true";
  }
  return value;
}

export async function setConfigValue(path: string, key: string, value: string): Promise<void> {
  const config = await loadConfig(path);
  const [section, property, ...rest] = key.split(".");
  if (rest.length > 0 || (section !== "translation" && section !== "ui") || !property) {
    throw new Error(["unsupported configuration key: ", key].join(""));
  }

  const target = config[section] as unknown as Record<string, unknown>;
  if (!(property in target)) {
    throw new Error(["unsupported configuration key: ", key].join(""));
  }
  target[property] = parseConfigValue(target[property], value);

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = [path, ".tmp-", process.pid, "-", Date.now()].join("");
  const serialized = TOML.stringify(config as unknown as TOML.JsonMap).replace(
    /^(timeout_ms|max_tokens) = ([0-9_]+)$/gm,
    (_line, name: string, number: string) => [name, " = ", number.replaceAll("_", "")].join(""),
  );
  await writeFile(temporaryPath, serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}
