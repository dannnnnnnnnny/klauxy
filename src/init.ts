import { applyProvider, type Config, loadConfig, setConfigValue } from "./config.js";
import {
  isProviderId,
  PROVIDER_IDS,
  type ProbeResult,
  type ProviderId,
  probeProvider,
  providerApiKey,
  providerDefinition,
} from "./providers.js";
import { plainStyle, type Style } from "./tui.js";

export interface InitDeps {
  configPath: string;
  output(line: string): void;
  /** Reads one line of user input, or null when input is unavailable. */
  prompt(question: string): Promise<string | null>;
  probe?: (id: ProviderId, host: string, timeoutMs: number) => Promise<ProbeResult>;
  style?: Style;
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
  const style = deps.style ?? plainStyle;

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
    deps.output(style.heading("Klauxy needs a local model to translate Korean prompts."));
    deps.output("");
    const availability = await Promise.all(
      PROVIDER_IDS.map(async (id) => {
        const definition = providerDefinition(id);
        const result = await probe(id, definition.defaultHost, PROBE_TIMEOUT_MS);
        return { id, result };
      }),
    );
    for (const [index, entry] of availability.entries()) {
      const up = entry.result.reachable;
      const status = up
        ? [style.mark("ok"), " ", style.color("green", "detected")].join("")
        : style.dim("not running");
      deps.output(
        [style.dim([index + 1, ")"].join("")), " ", describe(entry.id), "  ", status].join(""),
      );
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

  deps.output([style.dim("Provider "), style.bold(definition.label)].join(""));
  deps.output([style.dim("Host     "), host].join(""));
  deps.output([style.dim("Model    "), model].join(""));
  if (definition.apiKeyEnv !== undefined) {
    const configured = providerApiKey(selected) !== undefined;
    deps.output(
      [
        style.dim("API key  "),
        definition.apiKeyEnv,
        " ",
        configured ? style.color("green", "(set)") : style.color("yellow", "(not set)"),
      ].join(""),
    );
    if (!configured) {
      deps.output(
        [
          "  Export it in your shell if this provider requires auth: export ",
          definition.apiKeyEnv,
          "=...",
        ].join(""),
      );
      deps.output("  Klauxy reads it from the environment and never writes it to config.");
    }
  }
  deps.output("");

  const result = await probe(selected, host, PROBE_TIMEOUT_MS);
  if (!result.reachable) {
    deps.output([style.mark("fail"), " Cannot reach ", definition.label, " at ", host].join(""));
    if (result.error) deps.output(style.dim(["  ", result.error].join("")));
    deps.output("");
    deps.output(["  ", definition.setupHint].join(""));
    deps.output(style.dim("  Configuration saved. Re-check with: klx doctor"));
    return { code: 1, config: await loadConfig(deps.configPath) };
  }

  if (result.models.length > 0 && !result.models.includes(model)) {
    deps.output(
      [
        style.mark("warn"),
        " ",
        definition.label,
        " is running but does not serve ",
        style.bold(model),
      ].join(""),
    );
    deps.output(style.dim(["  available: ", result.models.slice(0, 10).join(", ")].join("")));
    deps.output("");
    deps.output(style.dim("  Fix with: klx config set translation.model <id>"));
    return { code: 1, config: await loadConfig(deps.configPath) };
  }

  deps.output(
    [style.mark("ok"), " ", definition.label, " is reachable and serving ", model].join(""),
  );
  deps.output("");
  deps.output([style.bold("Klauxy is ready."), " Enable translation with: klx on"].join(""));
  return { code: 0, config: await loadConfig(deps.configPath) };
}
