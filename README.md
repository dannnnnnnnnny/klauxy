# Klauxy

Klauxy (클록시) keeps the normal `claude` command and translates Korean prompts to concise English through local oMLX immediately before the request reaches Anthropic. Enter is delivered to the real Claude Code process without delay, so its native processing state appears immediately. Claude Code authentication, streaming, tools, permissions, MCP, thinking, and TUI remain in the real Claude process.

## Commands

```sh
klx install
klx on
klx off
klx status
klx history
klx history --last 1
klx history clear
klx savings
klx doctor
klx config get
klx config set translation.system_prompt "Translate only."
klx uninstall
```

The full `klauxy` alias works identically: `klauxy install`, `klauxy savings`, etc.

The system prompt lives in `~/.config/klauxy/config.toml` at `translation.system_prompt`. Runtime on/off changes are read on every Anthropic Messages request, including already-running Claude sessions. Translation failures send the original prompt unchanged.

Klauxy runs a persistent HTTP proxy bound only to `127.0.0.1:18789`. The macOS LaunchAgent keeps it alive independently of foreground and background Claude sessions. Installation stores that URL in Claude's user `settings.json`, so Claude background workers use the same translation path. Klauxy backs up any existing `ANTHROPIC_BASE_URL`, uses it as the upstream gateway, and restores it on uninstall when the setting still belongs to Klauxy.

The proxy changes only eligible Korean text in the nearest human user turn and passes streaming responses through incrementally. Credentials stay in memory and are never logged. Translation history intentionally persists only the original and actually forwarded prompt text as described below.

Claude Code updates normally require no Klauxy action. Klauxy stores the stable Claude launcher path (for example `~/.local/bin/claude`), so when Claude's installer retargets that launcher to a new version, the next Klauxy session uses it automatically. Run `klx install` again only if Claude changes its launcher location.

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
