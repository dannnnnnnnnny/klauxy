import { loadConfig } from "../config.js";
import { type InitDeps, parseInitArgs, runInit } from "../init.js";
import { PROVIDER_IDS, providerDefinition } from "../providers.js";
import { writeEnabled } from "../state.js";
import type { CommandHandler, CommandRun } from "./context.js";

const PROVIDER_LIST = PROVIDER_IDS.join("|");

/** Shared wiring so every entry point into runInit behaves identically. */
function initDeps(run: CommandRun, output: (line: string) => void): InitDeps {
  return {
    configPath: run.paths.config,
    output,
    prompt: run.context.prompt ?? (async () => null),
    style: run.style,
    ...(run.context.probe === undefined ? {} : { probe: run.context.probe }),
  };
}

export const init: CommandHandler = async (run) => {
  if (run.args[0] !== "init") return undefined;
  const parsed = parseInitArgs(run.args.slice(1));
  if ("error" in parsed) {
    run.output(parsed.error);
    run.output(`Usage: klx init [--provider <${PROVIDER_LIST}>] [--host <url>] [--model <id>]`);
    return 1;
  }
  const result = await runInit(parsed, initDeps(run, run.output));
  return result.code;
};

export const setup: CommandHandler = async (run) => {
  if (run.args[0] !== "setup") return undefined;
  const { style, output, context, paths } = run;

  const parsed = parseInitArgs(run.args.slice(1));
  if ("error" in parsed) {
    output(parsed.error);
    output(`Usage: klx setup [--provider <${PROVIDER_LIST}>] [--host <url>] [--model <id>]`);
    return 1;
  }

  // One command for the whole first run. Choosing a provider, wiring the claude
  // shim, and switching translation on are always done together, and making
  // people discover three commands in order is what goes wrong on a fresh
  // install.
  output(style.heading("Klauxy setup"));
  output("");
  output(style.dim("1/3  choosing a translation provider"));
  const indented = (line: string) => output(line === "" ? "" : ["  ", line].join(""));
  const chosen = await runInit(parsed, initDeps(run, indented));
  if (chosen.code !== 0) {
    output("");
    output(style.dim("Provider is not ready, so setup stopped before installing."));
    output(style.dim("Start the server, then run klx setup again."));
    return chosen.code;
  }

  output("");
  output(style.dim("2/3  wrapping the claude command"));
  if (context.install === undefined) {
    output(["  ", style.mark("fail"), " install is unavailable here"].join(""));
    return 1;
  }
  try {
    await context.install();
  } catch (error) {
    output(
      ["  ", style.mark("fail"), " ", error instanceof Error ? error.message : String(error)].join(
        "",
      ),
    );
    output("");
    output(style.dim("The provider choice was saved. Fix the problem above, then rerun:"));
    output(style.dim("  klx setup"));
    output(style.dim("Run klx doctor for a full diagnosis."));
    return 1;
  }
  const hint = context.reloadHint ? await context.reloadHint() : "Restart your shell";
  output(["  ", style.mark("ok"), " claude now routes through Klauxy"].join(""));

  output("");
  output(style.dim("3/3  enabling translation"));
  await writeEnabled(paths.state, true);
  output(["  ", style.mark("ok"), " translation is on"].join(""));

  output("");
  output(style.bold("Ready."));
  output(style.dim(["  ", hint].join("")));
  output(style.dim("  Then run claude and type Korean as usual."));
  output(style.dim("  klx status shows state, klx off pauses translation."));
  return 0;
};

export const provider: CommandHandler = async (run) => {
  if (run.args[0] !== "provider") return undefined;
  const { style, output, paths } = run;

  // Accept both `klx provider ollama` and the explicit `klx provider set ollama`.
  const explicitSet = run.args[1] === "set";
  const requested = explicitSet ? run.args[2] : run.args[1];
  const flagStart = explicitSet ? 3 : 2;

  if (requested === undefined || requested === "list") {
    const config = await loadConfig(paths.config);
    const width = Math.max(...PROVIDER_IDS.map((id) => id.length)) + 2;
    output(style.heading("Klauxy providers"));
    output("");
    for (const id of PROVIDER_IDS) {
      const definition = providerDefinition(id);
      const active = id === config.translation.provider;
      output(
        [
          active ? style.color("cyan", "*") : " ",
          " ",
          active ? style.bold(id.padEnd(width)) : id.padEnd(width),
          definition.label,
          " ",
          style.dim(["- ", definition.description].join("")),
        ].join(""),
      );
    }
    output("");
    output(
      `Current: ${config.translation.provider} (${config.translation.host}, ${config.translation.model})`,
    );
    output(style.dim("Change with: klx provider <id> [--host <url>] [--model <id>]"));
    return 0;
  }

  const parsedFlags = parseInitArgs(run.args.slice(flagStart));
  if ("error" in parsedFlags) {
    output(parsedFlags.error);
    output("Usage: klx provider <id> [--host <url>] [--model <id>]");
    return 1;
  }
  // Reuse init so switching validates reachability and the model the same way.
  const result = await runInit({ ...parsedFlags, provider: requested }, initDeps(run, output));
  return result.code;
};
