import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../cli.js";
import { COMMAND_NAMES } from "../help.js";
import { plainStyle } from "../tui.js";
import type { CommandHandler } from "./context.js";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "klauxy-dispatch-"));
}

describe("handler contract", () => {
  it("returns undefined for commands it does not own, so dispatch continues", async () => {
    const handler: CommandHandler = async (run) => (run.args[0] === "mine" ? 0 : undefined);

    const skipped = await handler({
      args: ["status"],
      context: { home: "/tmp", output: () => {} },
      paths: {} as never,
      style: plainStyle,
      version: "0.0.0",
      width: 80,
      output: () => {},
    });

    expect(skipped).toBeUndefined();
  });

  it("every documented command is dispatched rather than falling through", async () => {
    const root = await home();
    // A command that reaches the unknown-command fallback prints this line, so
    // its absence proves a handler claimed the command.
    for (const name of COMMAND_NAMES) {
      const output: string[] = [];
      await runCommand([name], {
        home: root,
        output: (line) => output.push(line),
        install: async () => {},
        uninstall: async () => {},
        doctor: async () => ({ ok: true, lines: [] }),
        probe: async () => ({ reachable: true, models: [] }),
        createTranslator: () => ({ translate: async (text) => text }),
      });

      expect(output.join("\n"), `${name} fell through to the unknown handler`).not.toContain(
        "Unknown command",
      );
    }
  });

  it("dispatches every command name without throwing", async () => {
    const root = await home();

    for (const name of COMMAND_NAMES) {
      await expect(
        runCommand([name], {
          home: root,
          output: () => {},
          install: async () => {},
          uninstall: async () => {},
          doctor: async () => ({ ok: true, lines: [] }),
          probe: async () => ({ reachable: true, models: [] }),
          createTranslator: () => ({ translate: async (text) => text }),
        }),
        `${name} threw`,
      ).resolves.toBeTypeOf("number");
    }
  });

  it("falls back to the unknown handler for an unregistered command", async () => {
    const root = await home();
    const output: string[] = [];

    const code = await runCommand(["nope"], { home: root, output: (line) => output.push(line) });

    expect(code).toBe(1);
    expect(output.join("\n")).toContain("Unknown command");
  });
});
