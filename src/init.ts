import { applyProvider, type Config, loadConfig, setConfigValue } from "./config.js";
import {
  isProviderId,
  PROVIDER_IDS,
  type ProbeResult,
  type ProviderId,
  probeProvider,
  providerDefinition,
} from "./providers.js";

export interface InitDeps {
  configPath: string;
  output(line: string): void;
  /** Reads one line of user input, or null when input is unavailable. */
  prompt(question: string): Promise<string | null>;
  probe?: (id: ProviderId, host: string, timeoutMs: number) => Promise<ProbeResult>;
}

export interface InitOptions {
  /** Non-interactive provider selection, e.g. `klx init --provider ollama`. */
  provider?: string;
  host?: string;
  model?: string;
}

export function parseInitArgs(args: string[]): InitOptions | { error: string } {
  const options: InitOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--provider" || flag === "--host" || flag === "--model") {
      if (value === undefined || value.startsWith("--")) {
        return { error: ["missing value for ", flag].join("") };
      }
      if (flag === "--provider") options.provider = value;
      if (flag === "--host") options.host = value;
      if (flag === "--model") options.model = value;
      index += 1;
      continue;
    }
    return { error: ["unknown option: ", String(flag)].join("") };
  }
  return options;
}

const PROBE_TIMEOUT_MS = 2000;

function describe(id: ProviderId): string {
  const definition = providerDefinition(id);
  return [definition.label, " - ", definition.description].join("");
}

export async function runInit(
  options: InitOptions,
  deps: InitDeps,
): Promise<{ code: number; config?: Config }> {
  const probe = deps.probe ?? probeProvider;

  if (options.provider !== undefined && !isProviderId(options.provider)) {
    deps.output(
      ["Unknown provider: ", options.provider, ". Expected ", PROVIDER_IDS.join(", "), "."].join(
        "",
      ),
    );
    return { code: 1 };
  }

  let selected: ProviderId | undefined = isProviderId(options.provider)
    ? options.provider
    : undefined;

  if (selected === undefined) {
    deps.output("Klauxy needs a local model to translate Korean prompts.");
    deps.output("");
    const availability = await Promise.all(
      PROVIDER_IDS.map(async (id) => {
        const definition = providerDefinition(id);
        const result = await probe(id, definition.defaultHost, PROBE_TIMEOUT_MS);
        return { id, result };
      }),
    );
    for (const [index, entry] of availability.entries()) {
      const status = entry.result.reachable ? "detected" : "not running";
      deps.output([index + 1, ") ", describe(entry.id), " [", status, "]"].join(""));
    }
    deps.output("");
    const detected = availability.find((entry) => entry.result.reachable);
    const fallback = detected?.id ?? "omlx";
    const answer = await deps.prompt(
      ["Select a provider [1-", PROVIDER_IDS.length, "] (default ", fallback, "): "].join(""),
    );
    if (answer === null) {
      deps.output(
        ["No input available. Run: klx init --provider <", PROVIDER_IDS.join("|"), ">"].join(""),
      );
      return { code: 1 };
    }
    const trimmed = answer.trim();
    if (trimmed.length === 0) {
      selected = fallback;
    } else if (isProviderId(trimmed)) {
      selected = trimmed;
    } else {
      const index = Number(trimmed);
      const byIndex = Number.isSafeInteger(index) ? PROVIDER_IDS[index - 1] : undefined;
      if (byIndex === undefined) {
        deps.output(["Invalid selection: ", trimmed].join(""));
        return { code: 1 };
      }
      selected = byIndex;
    }
  }

  const definition = providerDefinition(selected);
  const config = await loadConfig(deps.configPath);
  applyProvider(config, selected);
  const host = options.host ?? config.translation.host;
  const model = options.model ?? config.translation.model;

  await setConfigValue(deps.configPath, "translation.provider", selected);
  if (host !== config.translation.host || options.host !== undefined) {
    await setConfigValue(deps.configPath, "translation.host", host);
  }
  if (model !== config.translation.model || options.model !== undefined) {
    await setConfigValue(deps.configPath, "translation.model", model);
  }

  deps.output(["Provider: ", definition.label].join(""));
  deps.output(["Host: ", host].join(""));
  deps.output(["Model: ", model].join(""));
  deps.output("");

  const result = await probe(selected, host, PROBE_TIMEOUT_MS);
  if (!result.reachable) {
    deps.output(["Cannot reach ", definition.label, " at ", host, "."].join(""));
    if (result.error) deps.output(["Reason: ", result.error].join(""));
    deps.output(definition.setupHint);
    deps.output("Saved the configuration anyway. Re-check later with: klx doctor");
    return { code: 1, config: await loadConfig(deps.configPath) };
  }

  if (result.models.length > 0 && !result.models.includes(model)) {
    deps.output([definition.label, " is running but does not serve model: ", model].join(""));
    deps.output(["Available: ", result.models.slice(0, 10).join(", ")].join(""));
    deps.output(["Fix with: klx config set translation.model <id>"].join(""));
    return { code: 1, config: await loadConfig(deps.configPath) };
  }

  deps.output([definition.label, " is reachable and serving ", model, "."].join(""));
  deps.output("Klauxy is ready. Enable translation with: klx on");
  return { code: 0, config: await loadConfig(deps.configPath) };
}
