import { configKeys, loadConfig, setConfigValue } from "../config.js";
import { readState, writeEnabled } from "../state.js";
import { classifyDiagnostic } from "../tui.js";
import { type CommandHandler, labelled } from "./context.js";

export const toggle: CommandHandler = async (run) => {
  const command = run.args[0];
  if (command !== "on" && command !== "off") return undefined;
  const state = await writeEnabled(run.paths.state, command === "on");
  run.output(
    [
      run.style.mark(state.enabled ? "ok" : "warn"),
      " Klauxy ",
      run.style.bold(state.enabled ? "on" : "off"),
    ].join(""),
  );
  return 0;
};

export const status: CommandHandler = async (run) => {
  if (run.args[0] !== "status") return undefined;
  const state = await readState(run.paths.state);
  run.output(
    [
      run.style.mark(state.enabled ? "ok" : "warn"),
      " Klauxy is ",
      run.style.bold(state.enabled ? "on" : "off"),
    ].join(""),
  );
  return 0;
};

export const config: CommandHandler = async (run) => {
  if (run.args[0] !== "config") return undefined;
  const [, action, key, ...rest] = run.args;

  if (action === "get") {
    const settings = await loadConfig(run.paths.config);
    if (key !== undefined) {
      // `config get <key>` prints one value, which is what a script wants.
      const [section, property] = key.split(".");
      const record = (settings as unknown as Record<string, Record<string, unknown>>)[
        section ?? ""
      ];
      const value = record?.[property ?? ""];
      if (value === undefined) {
        run.output([run.style.mark("fail"), " unknown key: ", run.style.bold(key)].join(""));
        run.output(run.style.dim(`valid keys: ${configKeys().join(", ")}`));
        return 1;
      }
      run.output(typeof value === "string" ? value : JSON.stringify(value));
      return 0;
    }
    run.output(JSON.stringify(settings, null, 2));
    return 0;
  }
  if (action === "set" && key !== undefined && rest.length > 0) {
    await setConfigValue(run.paths.config, key, rest.join(" "));
    run.output([run.style.mark("ok"), " saved ", run.style.bold(key)].join(""));
    return 0;
  }
  run.output("Usage: klx config get [<key>] | klx config set <key> <value>");
  run.output(run.style.dim(`keys: ${configKeys().join(", ")}`));
  return 1;
};

export const install: CommandHandler = async (run) => {
  if (run.args[0] !== "install" || run.context.install === undefined) return undefined;
  await run.context.install();
  run.output([run.style.mark("ok"), " ", run.style.bold("Klauxy installed.")].join(""));
  const settings = await loadConfig(run.paths.config);
  run.output("");
  run.output(labelled(run.style, "  provider", settings.translation.provider, 12));
  const hint = run.context.reloadHint ? await run.context.reloadHint() : "Restart your shell";
  run.output(run.style.dim(["  ", hint].join("")));
  run.output(run.style.dim("  Then enable translation: klx on"));
  return 0;
};

export const uninstall: CommandHandler = async (run) => {
  if (run.args[0] !== "uninstall" || run.context.uninstall === undefined) return undefined;
  await run.context.uninstall();
  run.output([run.style.mark("ok"), " Klauxy uninstalled."].join(""));
  return 0;
};

export const doctor: CommandHandler = async (run) => {
  if (run.args[0] !== "doctor" || run.context.doctor === undefined) return undefined;
  const result = await run.context.doctor();
  run.output(run.style.heading("Klauxy doctor"));
  run.output("");
  for (const line of result.lines) {
    const state = classifyDiagnostic(line);
    run.output(
      state === undefined ? ["  ", line].join("") : [run.style.mark(state), " ", line].join(""),
    );
  }
  return result.ok ? 0 : 1;
};
