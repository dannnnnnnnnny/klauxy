import { readFile } from "node:fs/promises";
import { renderHelp, suggestCommand } from "../help.js";
import type { CommandHandler } from "./context.js";

async function isConfigured(manifestPath: string): Promise<boolean> {
  try {
    await readFile(manifestPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export const help: CommandHandler = async (run) => {
  const command = run.args[0];
  if (command !== undefined && command !== "help" && command !== "--help" && command !== "-h") {
    return undefined;
  }
  const { style, output } = run;

  // A bare `klx` on a fresh machine should say what to do next rather than list
  // every command and leave the reader to infer the order.
  if (command === undefined && !(await isConfigured(run.paths.manifest))) {
    output([style.bold("klauxy"), " ", style.dim(run.version)].join(""));
    output("");
    output("Translates Korean prompts to English before they reach Claude Code.");
    output("");
    output([style.mark("warn"), " Not set up yet."].join(""));
    output("");
    output(["  Run ", style.bold("klx setup"), " to get started."].join(""));
    output(
      style.dim("  It picks a local model, wires the claude command, and turns translation on."),
    );
    output("");
    output(style.dim("  klx --help lists every command."));
    return 0;
  }

  for (const line of renderHelp(style, run.version)) output(line);
  return 0;
};

export const version: CommandHandler = async (run) => {
  const command = run.args[0];
  if (command !== "--version" && command !== "-v" && command !== "version") return undefined;
  run.output(run.version);
  return 0;
};

/** Last resort: name the mistake and point at the closest real command. */
export const unknown: CommandHandler = async (run) => {
  const command = run.args[0] ?? "";
  const { style, output } = run;
  output([style.mark("fail"), " Unknown command: ", style.bold(command)].join(""));
  const suggestion = suggestCommand(command);
  if (suggestion !== undefined) {
    output(["", "Did you mean ", style.bold(`klx ${suggestion}`), "?"].join(""));
  }
  output("");
  output(style.dim("Run klx --help to see all commands."));
  return 1;
};
