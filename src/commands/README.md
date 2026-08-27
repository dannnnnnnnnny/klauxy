# Commands

`runCommand` in [../cli.ts](../cli.ts) walks an ordered list of handlers. Each
handler inspects `run.args[0]`, returns an exit code if the command is its own,
and returns `undefined` otherwise so the next handler gets a turn.

## Adding a command

1. Write a handler in the module matching its purpose, or add a new module:

   ```ts
   export const mine: CommandHandler = async (run) => {
     if (run.args[0] !== "mine") return undefined;
     run.output(run.style.heading("Mine"));
     return 0;
   };
   ```

2. Register it in the `HANDLERS` array in `../cli.ts`.
3. Add an entry to `COMMANDS` in [../help.ts](../help.ts) so it shows up in
   `klx --help` and becomes a typo-suggestion target.

Nothing else needs to change: usage output, suggestions, and the exit-code
contract all derive from those two lists.

## What a handler gets

`CommandRun` carries the parsed context: `paths` for canonical file locations,
`style` for colour that respects `NO_COLOR`, `width` for wrapping, `version`,
and `output`. Reach for `labelled()` for aligned `label  value` rows and
`wrap()` from [../tui.ts](../tui.ts) for text that may exceed the terminal.

## Modules

| Module | Commands |
| --- | --- |
| `discover.ts` | bare `klx`, `help`, `--version`, unknown-command fallback |
| `provisioning.ts` | `setup`, `init`, `provider` |
| `control.ts` | `on`, `off`, `status`, `config`, `install`, `uninstall`, `doctor` |
| `inspect.ts` | `history`, `savings`, `try` |

## Side effects

Handlers must not call `process.exit`, write to stdout directly, or reach into
`process.env` for platform behaviour. Return a code and use `run.output`;
anything ambient belongs in `CommandContext` or [../lifecycle.ts](../lifecycle.ts)
so it can be faked in a test.
