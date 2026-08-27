#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";

const claude = process.argv[2];
if (!claude) {
  console.error("usage: probe-claude-base-url.mjs <real-claude>");
  process.exit(2);
}

const observations = [];
const server = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = undefined;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      // Metadata-only probe: an unparseable body is represented by its byte count.
    }
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    observations.push({
      method: request.method,
      url: request.url,
      headerNames: Object.keys(request.headers).sort(),
      auth: {
        authorization: typeof request.headers.authorization === "string",
        xApiKey: typeof request.headers["x-api-key"] === "string",
      },
      bodyBytes: chunks.reduce((total, chunk) => total + chunk.length, 0),
      bodyKeys: body && typeof body === "object" ? Object.keys(body).sort() : [],
      stream: body?.stream === true,
      messageShapes: messages.map((message) => ({
        role: typeof message?.role === "string" ? message.role : "unknown",
        content: Array.isArray(message?.content)
          ? message.content.map((block) =>
              block && typeof block === "object" && typeof block.type === "string"
                ? block.type
                : typeof block,
            )
          : typeof message?.content,
      })),
    });

    response.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    const events = [
      ["message_start", { type: "message_start", message: { id: "msg_probe", type: "message", role: "assistant", model: body?.model ?? "probe", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    response.end();
  });
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected address");
  const child = spawn(
    claude,
    ["-p", "Reply with the single word ok.", "--no-session-persistence", "--tools", "", "--output-format", "text"],
    {
      cwd: process.cwd(),
      env: { ...process.env, ANTHROPIC_BASE_URL: `http://127.0.0.1:${address.port}` },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const timer = setTimeout(() => child.kill("SIGTERM"), 15_000);
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("exit", (code, signal) => {
    clearTimeout(timer);
    server.close(() => {
      console.log(JSON.stringify({ child: { code, signal, stderrPresent: Buffer.concat(stderr).length > 0 }, observations }, null, 2));
      process.exitCode = code === 0 && observations.length > 0 ? 0 : 1;
    });
  });
});
