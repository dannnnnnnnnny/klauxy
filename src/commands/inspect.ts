import { loadConfig } from "../config.js";
import { clearHistory, readHistory } from "../history.js";
import { translatePrompt } from "../pipeline.js";
import { createTranslator, providerDefinition } from "../providers.js";
import { buildSavingsGauge, estimateSavings, estimateSavingsFromText } from "../savings.js";
import { wrap } from "../tui.js";
import { type CommandHandler, labelled } from "./context.js";

const HISTORY_LABEL_WIDTH = 4;

export const history: CommandHandler = async (run) => {
  if (run.args[0] !== "history") return undefined;
  const { style, output, paths } = run;

  if (run.args[1] === "clear") {
    await clearHistory(paths.history);
    output([style.mark("ok"), " Klauxy history cleared."].join(""));
    return 0;
  }

  const entries = await readHistory(paths.history);
  let limit = entries.length;
  if (run.args[1] === "--last") {
    const parsed = Number(run.args[2]);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      output("Usage: klx history [--last <count>|clear]");
      return 1;
    }
    limit = parsed;
  } else if (run.args.length > 1) {
    output("Usage: klx history [--last <count>|clear]");
    return 1;
  }

  const selected = entries.slice(-limit);
  if (selected.length === 0) {
    output(style.dim("No Klauxy history."));
    return 0;
  }
  for (const [index, entry] of selected.entries()) {
    if (index > 0) output("");
    const failed = entry.status !== "translated";
    output(
      [
        style.dim(new Date(entry.timestamp).toLocaleString()),
        "  ",
        failed ? style.color("yellow", entry.status) : style.color("green", entry.status),
        style.dim(`  ${Math.round(entry.durationMs)}ms`),
      ].join(""),
    );
    // Prompts are frequently longer than the terminal, so wrap them under a
    // hanging indent instead of letting the terminal break mid-word.
    for (const [line, text] of [
      ["ko", entry.original],
      ["en", entry.sent],
    ] as const) {
      const wrapped = wrap(text, run.width - HISTORY_LABEL_WIDTH - 2);
      output([style.dim(`  ${line} `), wrapped[0] ?? ""].join(""));
      for (const rest of wrapped.slice(1)) output(["      ", rest].join(""));
    }
    if (entry.failure) output([style.dim("  !  "), entry.failure].join(""));
  }
  return 0;
};

export const savings: CommandHandler = async (run) => {
  if (run.args[0] !== "savings") return undefined;
  const { style, output } = run;

  const entries = await readHistory(run.paths.history);
  const valid = entries.filter(
    (entry) => entry.status === "translated" && entry.original.length > 0 && entry.sent.length > 0,
  );
  output(style.heading("Klauxy savings"));
  output("");
  if (valid.length === 0) {
    output(style.dim("  No successful translations to compare."));
    return 0;
  }

  const result = estimateSavings(
    valid.map((entry) => estimateSavingsFromText(entry.original, entry.sent)),
  );
  const row = (label: string, value: string) => output(labelled(style, label, value, 22));
  row("Translations", String(valid.length));
  row("Original tokens", String(result.estimatedOriginal));
  row("Forwarded tokens", String(result.estimatedForwarded));
  if (result.estimatedSaved >= 0) {
    row("Tokens saved", style.color("green", String(result.estimatedSaved)));
  } else {
    row("Net token change", style.color("yellow", `+${Math.abs(result.estimatedSaved)} (longer)`));
  }
  row("Savings", style.bold(`${result.estimatedSavingsPercent}%`));
  output("");
  output(buildSavingsGauge(result.estimatedSavingsPercent));
  output("");
  output(style.dim("Estimates: Claude's tokenizer is private."));
  return 0;
};

export const attempt: CommandHandler = async (run) => {
  if (run.args[0] !== "try") return undefined;
  const { style, output } = run;

  // Confirms the pipeline end to end without starting a Claude session, which
  // is otherwise the only way to see a translation actually happen.
  const sample = run.args.slice(1).join(" ") || "이 프로젝트의 구조를 설명해줘";
  const config = await loadConfig(run.paths.config);
  const definition = providerDefinition(config.translation.provider);

  output(style.heading("Klauxy translation test"));
  output("");
  output(labelled(style, "provider", definition.label));
  output(labelled(style, "model", config.translation.model));
  output("");

  const indent = (label: string, text: string) => {
    const wrapped = wrap(text, run.width - 4);
    output([style.dim(`${label}  `), wrapped[0] ?? ""].join(""));
    for (const rest of wrapped.slice(1)) output(["    ", rest].join(""));
  };
  indent("ko", sample);

  const translator = (run.context.createTranslator ?? createTranslator)(config.translation);
  const started = Date.now();
  const result = await translatePrompt(sample, true, translator);
  const elapsed = Date.now() - started;

  if (!result.translated) {
    output([style.dim("en  "), style.color("yellow", "(unchanged)")].join(""));
    output("");
    output([style.mark("fail"), " ", result.failure ?? "translation did not run"].join(""));
    output(style.dim("Run klx doctor to check the provider."));
    return 1;
  }
  indent("en", result.text);
  output("");
  output([style.mark("ok"), style.dim(` ${elapsed}ms`)].join(""));
  return 0;
};
