# Anthropic Translation Proxy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude Code accept Enter immediately while KAgent translates the final Korean user prompt in a loopback Anthropic API proxy immediately before upstream delivery.

**Architecture:** Keep the real Claude process and its PTY untouched, but route foreground and background workers through one persistent loopback `ANTHROPIC_BASE_URL`. A focused transformer mutates at most the final human text turn with the existing fail-open translation pipeline, while a LaunchAgent-owned streaming proxy outlives individual Claude launchers.

**Tech Stack:** Node.js 20+ ESM, TypeScript 5.6, built-in `node:http`, Fetch API, Vitest, existing oMLX OpenAI-compatible translator.

**Spec:** `docs/superpowers/specs/2026-08-26-anthropic-translation-proxy-design.md`

## Global Constraints

- Bind the proxy only to the stable loopback address `127.0.0.1:18789`.
- Do not print or persist credentials, request bodies, or translated prompts.
- Translation is all-or-nothing and fail-open; never retry an Anthropic request.
- Preserve Claude Code authentication, beta/version metadata, URL query, status, streaming, tools, permissions, MCP, thinking, and token counting.
- Do not commit, push, or merge unless the user explicitly requests it.

---

### Task 1: Verify Claude custom-base-URL transport

**Files:**
- Create: `scripts/probe-claude-base-url.mjs`
- Create: `docs/probes/claude-base-url.md`

**Interfaces:**
- Consumes: installed real Claude executable and a harmless `claude -p` request.
- Produces: redacted evidence for paths, header names, credential presence, JSON shape, and streaming flags.

- [ ] Write a local-only probe server that records method, URL, header names, boolean auth presence, body top-level keys, message block types, and stream boolean; it must never record header values or text content.
- [ ] Run the installed real Claude with `ANTHROPIC_BASE_URL` pointing to the probe and a harmless non-project prompt.
- [ ] Return a minimal synthetic Anthropic SSE response so the invocation terminates normally.
- [ ] Record the redacted findings in `docs/probes/claude-base-url.md`; stop implementation if no usable credential reaches the custom base URL.

### Task 2: Transform the final human message

**Files:**
- Create: `src/message-transform.ts`
- Create: `src/message-transform.test.ts`
- Modify: `src/pipeline.ts`
- Modify: `src/pipeline.test.ts`

**Interfaces:**
- Consumes: `Translator.translate(text): Promise<string>`, enabled-state boolean, and an unknown parsed request body.
- Produces: `transformMessagesBody(body, enabled, translator): Promise<{ body: unknown; translated: boolean; failure?: string }>` without mutating the input.

- [ ] Write failing tests proving only the nearest `role: "user"` human text is eligible even with Claude's trailing internal system message; earlier messages, English, slash/shell commands, `tool_result`, and unknown blocks remain unchanged.
- [ ] Write failing tests proving multiple eligible text blocks preserve block count/order and a failed translation returns the original object unchanged.
- [ ] Add a failing regression test for removing a model-invented `{K0}` only when the source has no placeholders, while continuing to reject malformed expected-placeholder output.
- [ ] Implement strict body narrowing and final-turn extraction in `message-transform.ts`; use stable internal separator placeholders for multi-block reconstruction and validate every separator exactly once.
- [ ] Implement the no-source-placeholder repair in `pipeline.ts` by stripping invented `{K\d+}` tokens once and revalidating, without weakening validation when protected source tokens exist.
- [ ] Run `npm test -- src/message-transform.test.ts src/pipeline.test.ts` and require all targeted tests to pass.

### Task 3: Implement streaming Anthropic proxy

**Files:**
- Create: `src/anthropic-proxy.ts`
- Create: `src/anthropic-proxy.test.ts`

**Interfaces:**
- Consumes: `{ upstream: URL; translator: Translator; readEnabled(): Promise<boolean>; maxBodyBytes?: number }`.
- Produces: `startAnthropicProxy(options): Promise<{ baseUrl: string; close(): Promise<void> }>` bound to loopback.

- [ ] Write integration tests with local fake upstream and translator for translated Messages requests, exact pass-through of ineligible/malformed requests, path/query preservation, and redacted diagnostics.
- [ ] Write integration tests proving auth/version/beta header values reach upstream, upstream errors are preserved, SSE chunks arrive incrementally, and client abort cancels upstream work.
- [ ] Implement bounded request-body reading, JSON inspection only for Messages POST paths, original-byte fail-open forwarding, hop-by-hop header filtering, Fetch upstream calls with `redirect: "manual"`, and incremental Web Stream piping.
- [ ] Reject a configured upstream origin matching the local listener and ensure internal failures contain no secrets or prompt content.
- [ ] Run `npm test -- src/anthropic-proxy.test.ts` and require all proxy integration tests to pass.

### Task 4: Launch Claude through the proxy

**Files:**
- Modify: `src/index.ts`
- Modify: `src/runner.ts`
- Modify: `src/runner.test.ts`
- Remove after integration passes: `src/interceptor.ts`, `src/interceptor.test.ts`, `src/screen-mirror.ts`, `src/screen-mirror.test.ts`, `src/session.ts`, `src/session.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: proxy `baseUrl` and `close()`.
- Produces: real Claude child with `ANTHROPIC_BASE_URL=<baseUrl>` and transparent stdin/stdout PTY lifecycle.

- [ ] Write failing lifecycle tests proving the proxy starts before child spawn, the child environment gets the loopback URL, raw input is forwarded immediately, and proxy closure occurs on normal exit, startup error, and termination signal.
- [ ] Refactor `runClaude` to start the proxy, spawn the real Claude with the injected URL, and forward terminal bytes directly without screen mirroring or input interception.
- [ ] Keep resize, raw-mode cleanup, exit-code propagation, and signal handling intact; ensure proxy shutdown is idempotent and awaited where the lifecycle permits.
- [ ] Remove the now-unused terminal parsing modules, `@xterm/headless`, and related tests only after the new lifecycle tests pass. Keep `node-pty` because it preserves the real Claude TUI.
- [ ] Run all runner and PTY tests and require them to pass.

### Task 5: Documentation, installation, and full verification

**Files:**
- Modify: `README.md`
- Modify if diagnostics need proxy coverage: `src/doctor.ts`, `src/doctor.test.ts`

**Interfaces:**
- Consumes: completed proxy runtime.
- Produces: installed KAgent runtime and user-facing documentation matching actual behavior.

- [ ] Update README to describe immediate Enter behavior, API-level translation, fail-open semantics, loopback/security properties, `Ctrl+Enter` removal, and existing configuration commands.
- [ ] Run `npm test`, `npm run typecheck`, `npm run check`, and `npm run build` in background-capable sessions; fix every failure and rerun affected checks.
- [ ] Install the built runtime with `kagent install`, preserving the user's current config/state, then run `kagent doctor`.
- [ ] Run a local end-to-end fake-upstream smoke test proving immediate child input forwarding, final-user Korean-to-English transformation, incremental SSE, and shutdown.
- [ ] Run one harmless authenticated Claude smoke test without logging prompt or credential values; confirm Claude's native processing state appears immediately and the response completes.
- [ ] Audit every acceptance criterion in the spec against test output, runtime output, source, and installed files before reporting completion.
