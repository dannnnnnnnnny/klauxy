# Changelog

All notable changes to Klauxy are recorded here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `klx init` selects the translation backend, probing oMLX, Ollama, and OpenCode
  and reporting which are already running.
- `klx provider` lists backends and switches between them.
- `klx savings` estimates tokens saved across successful translations.
- `klx --help` and `klx --version`, plus a suggestion when a command is mistyped.
- Linux support through a systemd user service for the proxy daemon.
- Shell detection for zsh, bash, and fish, including `fish_add_path` syntax.
- API keys are read from the environment (`OPENCODE_API_KEY`) and never written
  to the config file, history, or error messages.

### Changed

- Replaced node-pty with inherited stdio, cutting install size from about 26 MB
  to under 300 KB and leaving exactly one runtime dependency.
- The proxy now buffers only `/v1/messages` and streams every other request, so
  large uploads no longer accumulate in memory.
- Platform support is no longer gated on Apple silicon; only the oMLX backend
  requires it.

### Fixed

- A request body over the size limit left the client waiting instead of
  receiving the 413 response.
- `resolveRealClaude` threw at runtime because `join` was never imported.
- `klx savings` printed unclamped percentages such as `+200%` and `+NaN%`.
