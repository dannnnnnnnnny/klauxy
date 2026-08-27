#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const realClaude = process.argv[2];
if (!realClaude) {
  console.error("usage: smoke-proxy-e2e.mjs <real-claude>");
  process.exit(2);
}

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected address");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

function readJson(request, callback) {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => callback(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
}

let omlxCalled = false;
const omlx = await listen((request, response) => {
  readJson(request, () => {
    omlxCalled = true;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message: { content: "Reply with the single word ok." } }],
      }),
    );
  });
});

let translatedAtUpstream = false;
let authorizationPresent = false;
const upstream = await listen((request, response) => {
  if (request.method === "HEAD") {
    response.writeHead(200);
    response.end();
    return;
  }
  readJson(request, (body) => {
    authorizationPresent =
      typeof request.headers["x-api-key"] === "string" ||
      typeof request.headers.authorization === "string";
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const user = [...messages].reverse().find((message) => message?.role === "user");
    const texts = Array.isArray(user?.content)
      ? user.content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
      : [];
    translatedAtUpstream = texts.includes("Reply with the single word ok.");

    response.writeHead(200, { "content-type": "text/event-stream" });
    const events = [
      ["message_start", { type: "message_start", message: { id: "msg_smoke", type: "message", role: "assistant", model: body.model ?? "smoke", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } }],
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
      ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } }],
      ["content_block_stop", { type: "content_block_stop", index: 0 }],
      ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } }],
      ["message_stop", { type: "message_stop" }],
    ];
    for (const [event, data] of events) {
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    }
    response.end();
  });
});

const temporaryHome = await mkdtemp(join(tmpdir(), "kagent-e2e-"));
try {
  const configDir = join(temporaryHome, ".config", "kagent");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "install.json"),
    JSON.stringify({
      schema: 1,
      realClaude: resolve(realClaude),
      entry: resolve("dist/index.js"),
    }),
  );
  await writeFile(
    join(configDir, "config.toml"),
    `[translation]\nhost = "${omlx.url}"\nmodel = "smoke"\ntimeout_ms = 5000\nmax_tokens = 256\nsystem_prompt = "Translate only."\n\n[ui]\nshow_translation = false\n`,
  );
  await writeFile(
    join(configDir, "state.json"),
    JSON.stringify({ schema: 1, enabled: true, generation: 1 }),
  );

  const child = spawn(
    process.execPath,
    [
      resolve("dist/index.js"),
      "__wrap-claude",
      "--bare",
      "-p",
      "한 단어로 ok라고 답해줘",
      "--no-session-persistence",
      "--tools",
      "",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: temporaryHome,
        CLAUDE_CONFIG_DIR: join(temporaryHome, ".claude"),
        ANTHROPIC_API_KEY: "test-only-key",
        ANTHROPIC_BASE_URL: upstream.url,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const result = await new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolveExit({ code: null, signal: "timeout" });
    }, 20_000);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
  const outcome = {
    child: result,
    stderrPresent: Buffer.concat(stderr).length > 0,
    omlxCalled,
    authorizationPresent,
    translatedAtUpstream,
    historyRecorded: false,
  };
  try {
    const history = await readFile(join(configDir, "history.jsonl"), "utf8");
    const entries = history
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    outcome.historyRecorded = entries.some(
      (entry) =>
        entry.status === "translated" &&
        entry.original === "한 단어로 ok라고 답해줘" &&
        entry.sent === "Reply with the single word ok.",
    );
  } catch {
    outcome.historyRecorded = false;
  }
  console.log(JSON.stringify(outcome, null, 2));
  if (
    result.code !== 0 ||
    result.signal !== null ||
    !omlxCalled ||
    !authorizationPresent ||
    !translatedAtUpstream ||
    !outcome.historyRecorded
  ) {
    process.exitCode = 1;
  }
} finally {
  await Promise.all([omlx.close(), upstream.close()]);
  await rm(temporaryHome, { recursive: true, force: true });
}
