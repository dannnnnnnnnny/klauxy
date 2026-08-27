import type { CommandContext, CommandHandler, CommandRun } from "./commands/context.js";
import * as control from "./commands/control.js";
import * as discover from "./commands/discover.js";
import * as inspect from "./commands/inspect.js";
import * as provisioning from "./commands/provisioning.js";
import { klauxyPaths } from "./paths.js";
import { plainStyle, terminalWidth } from "./tui.js";

export type { CommandContext } from "./commands/context.js";

/**
 * Ordered handler chain.
 *
 * Each handler claims its own command and returns undefined otherwise, so
 * adding a command means adding one module rather than another branch in a
 * single long function. `discover.help` runs first because it also owns the
 * bare `klx` case.
 */
const HANDLERS: readonly CommandHandler[] = [
  discover.help,
  discover.version,
  provisioning.setup,
  provisioning.init,
  provisioning.provider,
  control.toggle,
  control.status,
  control.config,
  control.install,
  control.uninstall,
  control.doctor,
  inspect.history,
  inspect.savings,
  inspect.attempt,
];

export async function runCommand(args: string[], context: CommandContext): Promise<number> {
  const run: CommandRun = {
    args,
    context,
    paths: klauxyPaths(context.home),
    style: context.style ?? plainStyle,
    version: context.version ?? "0.0.0",
    width: terminalWidth(context.columns),
    output: context.output,
  };

  for (const handler of HANDLERS) {
    const code = await handler(run);
    if (code !== undefined) return code;
  }
  return (await discover.unknown(run)) ?? 1;
}
