# Security

## Reporting a vulnerability

Report suspected vulnerabilities through GitHub's private advisory form on this
repository rather than a public issue.

## What Klauxy handles

Klauxy sits between Claude Code and Anthropic, so it necessarily sees prompt
text and credentials. The design constrains what it does with them.

**Anthropic credentials** pass through untouched. The proxy forwards
`authorization` and `x-api-key` headers to the upstream and never reads, stores,
or logs them.

**Provider API keys** are read from the environment, never from
`config.toml`. The config file is printed by `klx config get` and is easy to
commit by accident, so keys stay out of it. They are held in memory for the
lifetime of a request and are excluded from error messages, including HTTP
failures and timeouts.

**Prompt text** is stored locally in `~/.config/klauxy/history.jsonl` with
`0600` permissions, capped at the most recent 100 entries. It contains the
original Korean and the English actually sent. Clear it with `klx history clear`
when prompts are sensitive. Claude responses, tool results, and attachments are
never recorded.

**Network exposure** is limited to loopback. The proxy binds only
`127.0.0.1:18789` and is not reachable from other hosts. It has no
authentication because it accepts only local connections and forwards the
caller's own Anthropic credentials.

**Untrusted input** reaching the local model is wrapped in a `<source_text>`
envelope with an instruction not to act on its contents, and translated output
is validated before use. A translation that echoes the prompt, drops
placeholders, or still contains Korean is rejected and the original prompt is
sent unchanged.

## Supported versions

Fixes land on the latest released minor version.
