# Claude Code custom base URL probe

Tested locally on 2026-08-26 with Claude Code 2.1.246. The probe bound an ephemeral `127.0.0.1` HTTP server, launched a harmless non-interactive Claude request with `ANTHROPIC_BASE_URL` pointed at it, and returned a synthetic SSE response. It recorded metadata only; it did not record header values or message text.

Observed requests:

- `HEAD /api/hello`, without authorization;
- `POST /v1/messages?beta=true`, with an `authorization` header;
- Anthropic version and beta headers were present;
- the Messages body set `stream: true`;
- the body included `system`, `messages`, `tools`, `thinking`, `context_management`, and output configuration;
- the message sequence contained a human `role: user` with two text blocks followed by a Claude-internal `role: system` string.

The synthetic stream completed successfully: Claude exited with code 0 and emitted no stderr. This proves a loopback custom base URL can receive the existing OAuth authorization and serve streaming Messages responses without TLS interception. It also establishes that message selection must scan backward for the nearest user turn instead of requiring the final array element to have `role: user`.
