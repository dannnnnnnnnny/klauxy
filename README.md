<h1 align="center">Klauxy</h1>

<p align="center">
  <strong>Type Korean. Claude reads English. Nothing else changes.</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/klauxy"><img alt="npm" src="https://img.shields.io/npm/v/klauxy?color=cb3837&label=npm"></a>
  <a href="https://github.com/dannnnnnnnnny/klauxy/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/dannnnnnnnnny/klauxy/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/npm/l/klauxy?color=blue"></a>
  <img alt="Node" src="https://img.shields.io/node/v/klauxy">
  <img alt="Platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey">
</p>

Klauxy (클록시) keeps the normal `claude` command and rewrites your Korean
prompt into concise English through a model running on your own machine, in the
moment before the request leaves for Anthropic.

```
  you type Korean          klauxy                Anthropic sees
  ───────────────    ───────────────────    ────────────────────
  구조 설명해줘  ──▶  local model, on      ──▶  Explain the project
                     127.0.0.1 only            structure.
                            ▲
              oMLX  │  Ollama  │  any OpenAI-compatible server
```

Enter reaches the real Claude Code process with no delay, so its native
"thinking" state shows up the instant you press it. Authentication, streaming,
tools, permissions, MCP, extended thinking, and the TUI all stay inside real
Claude Code. Klauxy only edits the one text block you just typed.

### Why bother

- **Think in Korean, prompt in English.** No mental context switch, no
  copy-pasting into a translation tab.
- **Cheaper turns.** Korean costs noticeably more tokens than the equivalent
  English. `klx savings` estimates what you got back.
- **Nothing leaves your machine to be translated.** The model is local; no
  third-party translation service ever sees a prompt.
- **Fails open, always.** If the model is slow, cold, or down, your original
  prompt is forwarded untouched. A broken translator never blocks your work.
- **Code survives.** Paths, identifiers, and code spans are masked before
  translation and restored after, so `src/config.ts 리팩터링해줘` becomes
  `Refactor src/config.ts.` with the path byte-identical.

## Quick start

Four steps, about two minutes.

**1. Install Klauxy.** Pick whichever you prefer:

```sh
npm install -g klauxy                                # npm
brew tap dannnnnnnnnny/tap && brew install klauxy    # Homebrew
curl -fsSL https://raw.githubusercontent.com/dannnnnnnnnny/klauxy/HEAD/install.sh | sh
```

**2. Start a local model.** Klauxy never installs one for you. Ollama is the
easiest; oMLX is the fastest on Apple silicon.

```sh
ollama serve
ollama pull qwen2.5:7b
```

**3. Run setup once.** It picks the provider, wraps the `claude` command, and
turns translation on.

```sh
klx setup
```

**4. Check it, then forget it.**

```sh
klx try
```

```
Klauxy translation test

provider  oMLX - Local Apple-silicon MLX server (fastest on Mac)
model     Qwen3-8B-4bit

ko  이 프로젝트의 구조를 설명해줘
en  Explain the structure of this project.

✓ 1204ms
```

That is the whole setup. From here just run `claude` the way you always have
and type Korean. `klx off` pauses translation, `klx uninstall` puts everything
back.

```sh
klx savings   # estimated tokens saved
klx history   # what your Korean actually became
klx doctor    # diagnose a broken setup
```

## Requirements

- macOS (Apple silicon or Intel) or Linux
- zsh, bash, or fish
- Node.js 20 or newer
- Claude Code already installed and on your `PATH`
- One local model server, which you start yourself: oMLX, Ollama, or any OpenAI-compatible server

Klauxy does not install a model server for you. `klx doctor` reports which of
these are missing.

Only the oMLX backend requires Apple silicon. On Intel Macs and Linux use
`klx provider ollama`. `klx install` detects your shell and writes its PATH
entry with the right syntax, including `fish_add_path` for fish.

## Command reference

`klx --help` prints the same list, grouped:

| Command | What it does |
| --- | --- |
| `klx setup` | One-step first run: pick a provider, wire `claude`, enable |
| `klx init` | Choose the translation provider, probing which are running |
| `klx install` | Wrap the `claude` command and start the proxy |
| `klx uninstall` | Undo install and restore Claude settings |
| `klx on` / `klx off` | Start or stop translating |
| `klx status` | Show whether translation is on |
| `klx provider [id]` | List providers, or switch to one |
| `klx try [text]` | Translate one sample to check the setup |
| `klx history` | Recent original/sent prompt pairs |
| `klx savings` | Estimated token savings |
| `klx doctor` | Diagnose platform, Claude, and provider |
| `klx config get` / `set` | Read or update configuration |

A few less obvious forms:

```sh
klx history --last 1                    # only the latest entry
klx history clear                       # delete stored prompt text
klx config get translation.provider     # print one value
klx config set translation.system_prompt "Translate only."
```

The full `klauxy` alias works identically: `klauxy install`, `klauxy savings`, etc.

Output is colourised on interactive terminals and falls back to plain text when
piped. Set `NO_COLOR=1` to disable colour, or `FORCE_COLOR=1` to keep it when
redirecting.

## Translation provider

`klx init` picks the local model that performs the translation. It probes each
candidate, shows which ones are already running, and saves the choice.

| Provider | Default host | Default model |
| --- | --- | --- |
| `omlx` | `http://127.0.0.1:8010` | `Qwen3-8B-4bit` |
| `ollama` | `http://127.0.0.1:11434` | `qwen2.5:7b` |
| `openai-compatible` | `http://127.0.0.1:1234` | `local-model` |

If a provider requires an API key, export it in your shell instead of storing it
in the config file. Klauxy reads `KLAUXY_API_KEY` for the generic backend, keeps it in
memory only, and never writes it to `config.toml`, history, or error messages.

All three speak the OpenAI-compatible `/v1/chat/completions` API, so switching
providers changes only the host, model, and a few provider-specific request
fields.

```sh
klx init                          # interactive menu with availability probe
klx init --provider ollama        # non-interactive
klx provider                      # list providers, mark the active one
klx provider ollama               # switch, retargeting host and model defaults
klx provider omlx --model Qwen3-14B-4bit
klx provider openai-compatible --host http://127.0.0.1:1234 --model local-model
```

Switching providers keeps a host or model you customized earlier and only
retargets values that still match the previous provider's defaults. `klx init`
and `klx provider` both verify that the provider answers and serves the
configured model, and exit non-zero with setup guidance when it does not. The
configuration is still saved so you can start the server and re-check with
`klx doctor`.

The system prompt lives in `~/.config/klauxy/config.toml` at
`translation.system_prompt`. On/off changes are read on every Anthropic Messages
request, so they take effect in already-running Claude sessions too.

## How it works

Klauxy runs a small HTTP proxy bound only to `127.0.0.1:18789` and points
Claude's `ANTHROPIC_BASE_URL` at it.

- **Only your newest message is touched.** The proxy scans backward for the
  nearest human `user` turn and rewrites eligible Korean text blocks there.
  Earlier turns, English, slash and shell commands, and tool results pass
  through byte for byte.
- **Streaming stays streaming.** Responses are piped through incrementally, so
  tokens appear as fast as they would without Klauxy.
- **Credentials are never touched.** Auth headers are forwarded in memory and
  never logged; API keys are read from the environment, never written to disk.
- **Background workers included.** Installation records the proxy URL in
  Claude's user `settings.json`, so background Claude sessions translate too.
  Any existing `ANTHROPIC_BASE_URL` is backed up, used as the upstream gateway,
  and restored on uninstall.
- **A service keeps it alive.** macOS uses a LaunchAgent, Linux a systemd user
  service, independent of any foreground session.

Claude Code updates need no action from you. Klauxy stores the stable launcher
path (for example `~/.local/bin/claude`), so when Claude's installer retargets
that launcher, the next session picks it up. Rerun `klx install` only if Claude
moves its launcher entirely.

## Translation history

`klx history` shows the original Korean text and the text actually sent upstream for the latest 100 translation attempts. An entry is written only after the Anthropic upstream returns response headers. Translation failures are marked `failed` and show that the unchanged original was sent.

```
2026. 8. 26. 오후 9:42:03  translated  684ms
Original: 이 프로젝트 구조를 설명해줘
Sent: Explain the structure of this project.
```

History is stored locally at `~/.config/klauxy/history.jsonl` with user-only `0600` permissions. It contains prompt text in plaintext, so clear it with `klx history clear` when the prompts are sensitive. API credentials, Claude responses, tool results, and attachments are never stored in history.

## Savings

`klx savings` shows an estimated token savings overview across all successful translations. It reads only local history, never contacts the network, and never outputs prompt content. Token counts are estimates using a lightweight heuristic model and are clearly labeled as such because Claude's tokenizer is private.

## Migration

When you run `klx install` for the first time after upgrading from a previous KAgent installation, Klauxy automatically migrates your configuration, state, history, and LaunchAgent to the new canonical paths (`~/.config/klauxy`, `~/.klauxy/bin`, `~/.local/share/klauxy`, `com.klauxy.proxy`). Legacy KAgent artifacts (shims, LaunchAgent, runtime) are removed after the new service is verified healthy. Your data is preserved during migration.

## Acknowledgments

Klauxy was built on top of KAgent, originally developed by Klaude. The oMLX translation layer and Claude integration architecture are credited to Klaude.
