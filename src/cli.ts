import { loadConfig, setConfigValue } from "./config.js";
import { clearHistory, readHistory } from "./history.js";
import { parseInitArgs, runInit } from "./init.js";
import { klauxyPaths } from "./paths.js";
import { PROVIDER_IDS, providerDefinition } from "./providers.js";
import { buildSavingsGauge, estimateSavings, estimateSavingsFromText } from "./savings.js";
import { readState, writeEnabled } from "./state.js";
import { classifyDiagnostic, plainStyle, type Style } from "./tui.js";

export interface CommandContext {
  home: string;
  output(line: string): void;
  style?: Style;
  prompt?(question: string): Promise<string | null>;
  install?(): Promise<void>;
  uninstall?(): Promise<void>;
  doctor?(): Promise<{ ok: boolean; lines: string[] }>;
}

export async function runCommand(args: string[], context: CommandContext): Promise<number> {
  const paths = klauxyPaths(context.home);
  const style = context.style ?? plainStyle;
  const command = args[0];
  if (command === "init") {
    const parsed = parseInitArgs(args.slice(1));
    if ("error" in parsed) {
      context.output(parsed.error);
      context.output(
        "Usage: klx init [--provider <omlx|ollama|opencode>] [--host <url>] [--model <id>]",
      );
      return 1;
    }
    const result = await runInit(parsed, {
      configPath: paths.config,
      output: context.output,
      prompt: context.prompt ?? (async () => null),
      style,
    });
    return result.code;
  }
  if (command === "provider") {
    const positional = args[1] === "set" ? args[2] : args[1];
    const flagStart = args[1] === "set" ? 3 : 2;
    if (positional === undefined || positional === "list") {
      const config = await loadConfig(paths.config);
      context.output(style.heading("Klauxy providers"));
      context.output("");
      for (const id of PROVIDER_IDS) {
        const definition = providerDefinition(id);
        const active = id === config.translation.provider;
        const marker = active ? style.color("cyan", "*") : " ";
        const name = active ? style.bold(id.padEnd(9)) : id.padEnd(9);
        context.output(
          [
            marker,
            " ",
            name,
            definition.label,
            " ",
            style.dim(["- ", definition.description].join("")),
          ].join(""),
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
    context.output(
      [
        style.mark(state.enabled ? "ok" : "warn"),
        " Klauxy ",
        style.bold(state.enabled ? "on" : "off"),
      ].join(""),
    );
    return 0;
  }
  if (command === "status") {
    const state = await readState(paths.state);
    context.output(
      [
        style.mark(state.enabled ? "ok" : "warn"),
        " Klauxy is ",
        style.bold(state.enabled ? "on" : "off"),
      ].join(""),
    );
    return 0;
  }
  if (command === "history" && args[1] === "clear") {
    await clearHistory(paths.history);
    context.output([style.mark("ok"), " Klauxy history cleared."].join(""));
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
      context.output(style.dim("No Klauxy history."));
      return 0;
    }
    for (const [index, entry] of selected.entries()) {
      if (index > 0) context.output("");
      const failed = entry.status !== "translated";
      context.output(
        [
          style.dim(new Date(entry.timestamp).toLocaleString()),
          "  ",
          failed ? style.color("yellow", entry.status) : style.color("green", entry.status),
          style.dim(["  ", Math.round(entry.durationMs), "ms"].join("")),
        ].join(""),
      );
      context.output([style.dim("  ko "), entry.original].join(""));
      context.output([style.dim("  en "), entry.sent].join(""));
      if (entry.failure) context.output([style.dim("  !  "), entry.failure].join(""));
    }
    return 0;
  }
  if (command === "savings") {
    const entries = await readHistory(paths.history);
    const valid = entries.filter(
      (e) => e.status === "translated" && e.original.length > 0 && e.sent.length > 0,
    );
    if (valid.length === 0) {
      context.output(style.heading("Klauxy savings"));
      context.output("");
      context.output(style.dim("  No successful translations to compare."));
      return 0;
    }
    const estimates = valid.map((e) => estimateSavingsFromText(e.original, e.sent));
    const result = estimateSavings(estimates);
    const gauge = buildSavingsGauge(result.estimatedSavingsPercent);
    context.output(style.heading("Klauxy savings"));
    context.output("");
    const row = (label: string, value: string): string =>
      [style.dim(label.padEnd(22)), value].join("");
    context.output(row("Translations", String(valid.length)));
    context.output(row("Original tokens", String(result.estimatedOriginal)));
    context.output(row("Forwarded tokens", String(result.estimatedForwarded)));
    if (result.estimatedSaved >= 0) {
      context.output(row("Tokens saved", style.color("green", String(result.estimatedSaved))));
    } else {
      context.output(
        row(
          "Net token change",
          style.color("yellow", ["+", Math.abs(result.estimatedSaved), " (longer)"].join("")),
        ),
      );
    }
    context.output(row("Savings", style.bold([result.estimatedSavingsPercent, "%"].join(""))));
    context.output("");
    context.output(gauge);
    context.output("");
    context.output(style.dim("Estimates: Claude's tokenizer is private."));
    return 0;
  }
  if (command === "config" && args[1] === "get") {
    context.output(JSON.stringify(await loadConfig(paths.config), null, 2));
    return 0;
  }
  if (command === "config" && args[1] === "set" && args[2] && args[3] !== undefined) {
    await setConfigValue(paths.config, args[2], args.slice(3).join(" "));
    context.output([style.mark("ok"), " saved ", style.bold(args[2])].join(""));
    return 0;
  }
  if (command === "install" && context.install) {
    await context.install();
    context.output([style.mark("ok"), " ", style.bold("Klauxy installed.")].join(""));
    const config = await loadConfig(paths.config);
    context.output("");
    context.output([style.dim("  provider  "), config.translation.provider].join(""));
    context.output(style.dim("  Restart your shell or run: source ~/.zshrc"));
    context.output(style.dim("  Then enable translation: klx on"));
    return 0;
  }
  if (command === "uninstall" && context.uninstall) {
    await context.uninstall();
    context.output([style.mark("ok"), " Klauxy uninstalled."].join(""));
    return 0;
  }
  if (command === "doctor" && context.doctor) {
    const result = await context.doctor();
    context.output(style.heading("Klauxy doctor"));
    context.output("");
    for (const line of result.lines) {
      const state = classifyDiagnostic(line);
      context.output(
        state === undefined ? ["  ", line].join("") : [style.mark(state), " ", line].join(""),
      );
    }
    return result.ok ? 0 : 1;
  }
  context.output(
    "Usage: klx init|provider [<id>]|on|off|status|history [--last <count>|clear]|savings|config get|config set <key> <value>|doctor|install|uninstall",
  );
  return 1;
}
