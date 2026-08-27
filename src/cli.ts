import { loadConfig, setConfigValue } from "./config.js";
import { clearHistory, readHistory } from "./history.js";
import { parseInitArgs, runInit } from "./init.js";
import { klauxyPaths } from "./paths.js";
import { PROVIDER_IDS, providerDefinition } from "./providers.js";
import { buildSavingsGauge, estimateSavings, estimateSavingsFromText } from "./savings.js";
import { readState, writeEnabled } from "./state.js";

export interface CommandContext {
  home: string;
  output(line: string): void;
  prompt?(question: string): Promise<string | null>;
  install?(): Promise<void>;
  uninstall?(): Promise<void>;
  doctor?(): Promise<{ ok: boolean; lines: string[] }>;
}

export async function runCommand(args: string[], context: CommandContext): Promise<number> {
  const paths = klauxyPaths(context.home);
  const command = args[0];
  if (command === "init") {
    const parsed = parseInitArgs(args.slice(1));
    if ("error" in parsed) {
      context.output(parsed.error);
      context.output("Usage: klx init [--provider <omlx|ollama|opencode>] [--host <url>] [--model <id>]");
      return 1;
    }
    const result = await runInit(parsed, {
      configPath: paths.config,
      output: context.output,
      prompt: context.prompt ?? (async () => null),
    });
    return result.code;
  }
  if (command === "provider") {
    const positional = args[1] === "set" ? args[2] : args[1];
    const flagStart = args[1] === "set" ? 3 : 2;
    if (positional === undefined || positional === "list") {
      const config = await loadConfig(paths.config);
      context.output("Klauxy providers");
      context.output("");
      for (const id of PROVIDER_IDS) {
        const definition = providerDefinition(id);
        const marker = id === config.translation.provider ? "*" : " ";
        context.output(
          [marker, " ", id.padEnd(9), definition.label, " - ", definition.description].join(""),
        );
      }
      context.output("");
      context.output(
        [
          "Current: ",
          config.translation.provider,
          " (",
          config.translation.host,
          ", ",
          config.translation.model,
          ")",
        ].join(""),
      );
      context.output("Change with: klx provider <id> [--host <url>] [--model <id>]");
      return 0;
    }
    const parsedFlags = parseInitArgs(args.slice(flagStart));
    if ("error" in parsedFlags) {
      context.output(parsedFlags.error);
      context.output("Usage: klx provider <id> [--host <url>] [--model <id>]");
      return 1;
    }
    const result = await runInit(
      { ...parsedFlags, provider: positional },
      {
        configPath: paths.config,
        output: context.output,
        prompt: context.prompt ?? (async () => null),
      },
    );
    return result.code;
  }
  if (command === "on" || command === "off") {
    const state = await writeEnabled(paths.state, command === "on");
    context.output(["Klauxy ", state.enabled ? "on" : "off"].join(""));
    return 0;
  }
  if (command === "status") {
    const state = await readState(paths.state);
    context.output(["Klauxy is ", state.enabled ? "on" : "off"].join(""));
    return 0;
  }
  if (command === "history" && args[1] === "clear") {
    await clearHistory(paths.history);
    context.output("Klauxy history cleared.");
    return 0;
  }
  if (command === "history") {
    const entries = await readHistory(paths.history);
    let limit = entries.length;
    if (args[1] === "--last") {
      const parsed = Number(args[2]);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        context.output("Usage: klx history [--last <count>|clear]");
        return 1;
      }
      limit = parsed;
    } else if (args.length > 1 && args[1] !== "clear") {
      context.output("Usage: klx history [--last <count>|clear]");
      return 1;
    }
    const selected = entries.slice(-limit);
    if (selected.length === 0) {
      context.output("No Klauxy history.");
      return 0;
    }
    for (const [index, entry] of selected.entries()) {
      if (index > 0) context.output("");
      context.output(
        `${new Date(entry.timestamp).toLocaleString()}  ${entry.status}  ${Math.round(entry.durationMs)}ms`,
      );
      context.output(`Original: ${entry.original}`);
      context.output(`Sent: ${entry.sent}`);
      if (entry.failure) context.output(`Failure: ${entry.failure}`);
    }
    return 0;
  }
  if (command === "savings") {
    const entries = await readHistory(paths.history);
    const valid = entries.filter(
      (e) => e.status === "translated" && e.original.length > 0 && e.sent.length > 0,
    );
    if (valid.length === 0) {
      context.output("Klauxy Savings");
      context.output("");
      context.output("No successful translations to compare.");
      return 0;
    }
    const estimates = valid.map((e) => estimateSavingsFromText(e.original, e.sent));
    const result = estimateSavings(estimates);
    const gauge = buildSavingsGauge(result.estimatedSavingsPercent);
    context.output("Klauxy Savings");
    context.output("");
    context.output(`Successful translations: ${valid.length}`);
    context.output(`Estimated original tokens: ${result.estimatedOriginal}`);
    context.output(`Estimated forwarded tokens: ${result.estimatedForwarded}`);
    if (result.estimatedSaved >= 0) {
      context.output(`Estimated tokens saved: ${result.estimatedSaved}`);
    } else {
      context.output(
        `Estimated net token change: +${Math.abs(result.estimatedSaved)} (translations longer)`,
      );
    }
    context.output(`Estimated savings: ${result.estimatedSavingsPercent}%`);
    context.output("");
    context.output(gauge);
    context.output("");
    context.output("(Token counts are estimates; Claude tokenizer is private.)");
    return 0;
  }
  if (command === "config" && args[1] === "get") {
    context.output(JSON.stringify(await loadConfig(paths.config), null, 2));
    return 0;
  }
  if (command === "config" && args[1] === "set" && args[2] && args[3] !== undefined) {
    await setConfigValue(paths.config, args[2], args.slice(3).join(" "));
    context.output(["saved ", args[2]].join(""));
    return 0;
  }
  if (command === "install" && context.install) {
    await context.install();
    context.output("Klauxy installed. Restart your shell or run: source ~/.zshrc");
    return 0;
  }
  if (command === "uninstall" && context.uninstall) {
    await context.uninstall();
    context.output("Klauxy uninstalled.");
    return 0;
  }
  if (command === "doctor" && context.doctor) {
    const result = await context.doctor();
    for (const line of result.lines) context.output(line);
    return result.ok ? 0 : 1;
  }
  context.output(
    "Usage: klx init|provider [<id>]|on|off|status|history [--last <count>|clear]|savings|config get|config set <key> <value>|doctor|install|uninstall",
  );
  return 1;
}
