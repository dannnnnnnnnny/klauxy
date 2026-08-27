import { readFile } from "node:fs/promises";
import { loadConfig, setConfigValue } from "./config.js";
import { renderHelp, suggestCommand } from "./help.js";
import { clearHistory, readHistory } from "./history.js";
import { parseInitArgs, runInit } from "./init.js";
import { klauxyPaths } from "./paths.js";
import { type Translator, translatePrompt } from "./pipeline.js";
import {
  createTranslator,
  PROVIDER_IDS,
  type ProbeResult,
  type ProviderId,
  providerDefinition,
  type TranslatorSettings,
} from "./providers.js";
import { buildSavingsGauge, estimateSavings, estimateSavingsFromText } from "./savings.js";
import { readState, writeEnabled } from "./state.js";
import { classifyDiagnostic, plainStyle, type Style } from "./tui.js";

export interface CommandContext {
  home: string;
  output(line: string): void;
  style?: Style;
  /** Package version, shown by `klx --version`. */
  version?: string;
  prompt?(question: string): Promise<string | null>;
  /** Overrides provider reachability checks; used by tests. */
  probe?(id: ProviderId, host: string, timeoutMs: number): Promise<ProbeResult>;
  /** Overrides translator construction; used by tests. */
  createTranslator?(settings: TranslatorSettings): Translator;
  install?(): Promise<void>;
  /** Shell-specific reload instruction, resolved by the caller. */
  reloadHint?(): Promise<string>;
  uninstall?(): Promise<void>;
  doctor?(): Promise<{ ok: boolean; lines: string[] }>;
}

export async function runCommand(args: string[], context: CommandContext): Promise<number> {
  const paths = klauxyPaths(context.home);
  const style = context.style ?? plainStyle;
  const command = args[0];
  const version = context.version ?? "0.0.0";

  if (command === undefined || command === "help" || command === "--help" || command === "-h") {
    // A bare `klx` on a fresh machine should say what to do next, not just list
    // every command and leave the user to work out the order.
    if (command === undefined) {
      let configured = false;
      try {
        await readFile(paths.manifest, "utf8");
        configured = true;
      } catch {
        configured = false;
      }
      if (!configured) {
        context.output([style.bold("klauxy"), " ", style.dim(version)].join(""));
        context.output("");
        context.output("Translates Korean prompts to English before they reach Claude Code.");
        context.output("");
        context.output([style.mark("warn"), " Not set up yet."].join(""));
        context.output("");
        context.output(["  Run ", style.bold("klx setup"), " to get started."].join(""));
        context.output(
          style.dim(
            "  It picks a local model, wires the claude command, and turns translation on.",
          ),
        );
        context.output("");
        context.output(style.dim("  klx --help lists every command."));
        return 0;
      }
    }
    for (const line of renderHelp(style, version)) context.output(line);
    // A bare `klx` is a request for orientation, not a usage error.
    return 0;
  }
  if (command === "--version" || command === "-v" || command === "version") {
    context.output(version);
    return 0;
  }
  if (command === "init") {
    const parsed = parseInitArgs(args.slice(1));
    if ("error" in parsed) {
      context.output(parsed.error);
      context.output(
        "Usage: klx init [--provider <omlx|ollama|openai-compatible>] [--host <url>] [--model <id>]",
      );
      return 1;
    }
    const result = await runInit(parsed, {
      configPath: paths.config,
      output: context.output,
      prompt: context.prompt ?? (async () => null),
      style,
      ...(context.probe === undefined ? {} : { probe: context.probe }),
    });
    return result.code;
  }
  if (command === "setup") {
    const parsed = parseInitArgs(args.slice(1));
    if ("error" in parsed) {
      context.output(parsed.error);
      context.output(
        "Usage: klx setup [--provider <omlx|ollama|openai-compatible>] [--host <url>] [--model <id>]",
      );
      return 1;
    }

    // One command for the whole first run. Choosing a provider, wiring the
    // claude shim, and switching translation on are always done together, and
    // making people discover three commands in order is the main thing that
    // goes wrong on a fresh install.
    context.output(style.heading("Klauxy setup"));
    context.output("");
    context.output(style.dim("1/3  choosing a translation provider"));
    const chosen = await runInit(parsed, {
      configPath: paths.config,
      output: (line) => context.output(line === "" ? "" : ["  ", line].join("")),
      prompt: context.prompt ?? (async () => null),
      style,
      ...(context.probe === undefined ? {} : { probe: context.probe }),
    });
    if (chosen.code !== 0) {
      context.output("");
      context.output(style.dim("Provider is not ready, so setup stopped before installing."));
      context.output(style.dim("Start the server, then run klx setup again."));
      return chosen.code;
    }

    context.output("");
    context.output(style.dim("2/3  wrapping the claude command"));
    if (context.install === undefined) {
      context.output(["  ", style.mark("fail"), " install is unavailable here"].join(""));
      return 1;
    }
    try {
      await context.install();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      context.output(["  ", style.mark("fail"), " ", reason].join(""));
      context.output("");
      context.output(
        style.dim("The provider choice was saved. Fix the problem above, then rerun:"),
      );
      context.output(style.dim("  klx setup"));
      context.output(style.dim("Run klx doctor for a full diagnosis."));
      return 1;
    }
    const hint = context.reloadHint ? await context.reloadHint() : "Restart your shell";
    context.output(["  ", style.mark("ok"), " claude now routes through Klauxy"].join(""));

    context.output("");
    context.output(style.dim("3/3  enabling translation"));
    await writeEnabled(paths.state, true);
    context.output(["  ", style.mark("ok"), " translation is on"].join(""));

    context.output("");
    context.output(style.bold("Ready."));
    context.output(style.dim(["  ", hint].join("")));
    context.output(style.dim("  Then run claude and type Korean as usual."));
    context.output(style.dim("  klx status shows state, klx off pauses translation."));
    return 0;
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
    const hint = context.reloadHint ? await context.reloadHint() : "Restart your shell";
    context.output(style.dim(["  ", hint].join("")));
    context.output(style.dim("  Then enable translation: klx on"));
    return 0;
  }
  if (command === "uninstall" && context.uninstall) {
    await context.uninstall();
    context.output([style.mark("ok"), " Klauxy uninstalled."].join(""));
    return 0;
  }
  if (command === "try") {
    // Lets someone confirm translation works without starting a Claude session,
    // which is otherwise the only way to see the pipeline run end to end.
    const sample = args.slice(1).join(" ") || "이 프로젝트의 구조를 설명해줘";
    const config = await loadConfig(paths.config);
    const definition = providerDefinition(config.translation.provider);
    context.output(style.heading("Klauxy translation test"));
    context.output("");
    context.output([style.dim("provider  "), definition.label].join(""));
    context.output([style.dim("model     "), config.translation.model].join(""));
    context.output("");
    context.output([style.dim("ko  "), sample].join(""));

    const translator = (context.createTranslator ?? createTranslator)(config.translation);
    const started = Date.now();
    const result = await translatePrompt(sample, true, translator);
    const elapsed = Date.now() - started;

    if (!result.translated) {
      context.output([style.dim("en  "), style.color("yellow", "(unchanged)")].join(""));
      context.output("");
      context.output(
        [style.mark("fail"), " ", result.failure ?? "translation did not run"].join(""),
      );
      context.output(style.dim("Run klx doctor to check the provider."));
      return 1;
    }
    context.output([style.dim("en  "), result.text].join(""));
    context.output("");
    context.output([style.mark("ok"), style.dim([" ", elapsed, "ms"].join(""))].join(""));
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
  context.output([style.mark("fail"), " Unknown command: ", style.bold(command)].join(""));
  const suggestion = suggestCommand(command);
  if (suggestion !== undefined) {
    context.output(["", "Did you mean ", style.bold(["klx ", suggestion].join("")), "?"].join(""));
  }
  context.output("");
  context.output(style.dim("Run klx --help to see all commands."));
  return 1;
}
