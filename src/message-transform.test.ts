import { describe, expect, it, vi } from "vitest";
import { transformMessagesBody } from "./message-transform.js";

describe("Anthropic message transformation", () => {
  it("translates the nearest human user turn before Claude's trailing system message", async () => {
    const body = {
      model: "claude-test",
      messages: [
        { role: "user", content: [{ type: "text", text: "old prompt" }] },
        { role: "assistant", content: [{ type: "text", text: "old answer" }] },
        { role: "user", content: [{ type: "text", text: "이 코드를 고쳐줘" }] },
        { role: "system", content: "internal context" },
      ],
    };
    const translator = { translate: vi.fn().mockResolvedValue("Fix this code.") };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.translated).toBe(true);
    expect(result.body).toEqual({
      ...body,
      messages: [
        body.messages[0],
        body.messages[1],
        { role: "user", content: [{ type: "text", text: "Fix this code." }] },
        body.messages[3],
      ],
    });
    expect(body.messages[2].content[0]).toEqual({ type: "text", text: "이 코드를 고쳐줘" });
  });

  it("preserves multiple text blocks and non-text blocks in their original order", async () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "첫 번째를 고쳐줘", cache_control: { type: "ephemeral" } },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AA==" } },
            { type: "text", text: "두 번째도 확인해줘" },
          ],
        },
        { role: "system", content: "internal" },
      ],
    };
    const translator = {
      translate: vi
        .fn()
        .mockImplementation(async (text: string) =>
          text
            .replace("첫 번째를 고쳐줘", "Fix the first one.")
            .replace("두 번째도 확인해줘", "Check the second one too."),
        ),
    };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.translated).toBe(true);
    const transformed = result.body as typeof body;
    expect(transformed.messages[0].content).toEqual([
      { type: "text", text: "Fix the first one.", cache_control: { type: "ephemeral" } },
      body.messages[0].content[1],
      { type: "text", text: "Check the second one too." },
    ]);
    expect(translator.translate).toHaveBeenCalledOnce();
  });

  it.each([
    ["disabled", false, [{ role: "user", content: [{ type: "text", text: "고쳐줘" }] }]],
    ["English", true, [{ role: "user", content: [{ type: "text", text: "Fix it" }] }]],
    ["slash command", true, [{ role: "user", content: [{ type: "text", text: "/review 한글" }] }]],
    ["shell command", true, [{ role: "user", content: [{ type: "text", text: "!echo 한글" }] }]],
    [
      "tool result",
      true,
      [
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "tool_1", content: "한글 결과" }],
        },
      ],
    ],
  ])("passes through %s input", async (_name, enabled, messages) => {
    const body = { messages };
    const translator = { translate: vi.fn() };

    const result = await transformMessagesBody(body, enabled as boolean, translator);

    expect(result).toMatchObject({ body, translated: false });
    expect(result.body).toBe(body);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("passes through an entire mixed turn when it contains a tool result", async () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "tool_1", content: "ok" },
            { type: "text", text: "이어서 해줘" },
          ],
        },
      ],
    };
    const translator = { translate: vi.fn() };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.body).toBe(body);
    expect(result.translated).toBe(false);
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("does not translate or record Claude's internal session-title request", async () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "<session>",
                "이 프로젝트를 분석해줘",
                "</session>",
                "",
                "Write the title in korean. Keep technical terms and code identifiers in their original form.",
              ].join("\n"),
            },
          ],
        },
      ],
    };
    const translator = { translate: vi.fn() };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.body).toBe(body);
    expect(result.translated).toBe(false);
    expect(result.history).toBeUndefined();
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("does not retranslate a preceding human turn for a later Claude system-reminder request", async () => {
    const reminder =
      "<system-reminder>Project instructions include 한글 examples.</system-reminder>";
    const body = {
      messages: [
        { role: "user", content: [{ type: "text", text: "추가 수정 변경 파일 있어?" }] },
        { role: "user", content: [{ type: "text", text: reminder }] },
      ],
    };
    const translator = { translate: vi.fn() };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.body).toBe(body);
    expect(result.translated).toBe(false);
    expect(result.history).toBeUndefined();
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("passes through an internal system-reminder when no human turn precedes it", async () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "<system-reminder>내부 한글 지침</system-reminder>",
            },
          ],
        },
      ],
    };
    const translator = { translate: vi.fn() };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.body).toBe(body);
    expect(result.translated).toBe(false);
    expect(result.history).toBeUndefined();
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("passes structured internal agent payloads through without translating or recording them", async () => {
    const payload = JSON.stringify({
      user: "https://example.test pasted-file.txt 안의 결과를 확인합니다.",
      command: "review",
    });
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: payload }] }],
    };
    const translator = { translate: vi.fn() };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.body).toBe(body);
    expect(result.translated).toBe(false);
    expect(result.history).toBeUndefined();
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("fails open to the identical input object when block reconstruction fails", async () => {
    const body = {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "첫째" },
            { type: "text", text: "둘째" },
          ],
        },
      ],
    };
    const translator = {
      translate: vi.fn().mockResolvedValue("Combined without the required boundary."),
    };

    const result = await transformMessagesBody(body, true, translator);

    expect(result.body).toBe(body);
    expect(result.translated).toBe(false);
    expect(result.failure).toBeDefined();
    expect(result.history).toMatchObject({
      status: "failed",
      original: "첫째\n\n둘째",
      sent: "첫째\n\n둘째",
    });
  });

  it("passes malformed and unknown request bodies through unchanged", async () => {
    const translator = { translate: vi.fn() };
    for (const body of [
      null,
      {},
      { messages: "bad" },
      { messages: [{ role: "user", content: [{ type: "future", text: "한글" }] }] },
    ]) {
      const result = await transformMessagesBody(body, true, translator);
      expect(result.body).toBe(body);
      expect(result.translated).toBe(false);
    }
    expect(translator.translate).not.toHaveBeenCalled();
  });

  it("passes the client cancellation signal into translation", async () => {
    const controller = new AbortController();
    const translator = { translate: vi.fn().mockResolvedValue("Fix it.") };
    const body = {
      messages: [{ role: "user", content: [{ type: "text", text: "고쳐줘" }] }],
    };

    await transformMessagesBody(body, true, translator, controller.signal);

    expect(translator.translate).toHaveBeenCalledWith("고쳐줘", controller.signal);
  });
});
describe("internal agent payloads stay untranslated", () => {
  const translator = { translate: async () => "TRANSLATED" };

  function messageWith(text: string) {
    return { model: "claude", messages: [{ role: "user", content: [{ type: "text", text }] }] };
  }

  async function sent(text: string): Promise<string> {
    const result = await transformMessagesBody(messageWith(text), true, translator);
    const body = result.body as {
      messages: Array<{ content: Array<{ text: string }> }>;
    };
    return body.messages[0]?.content[0]?.text ?? "";
  }

  it("passes a single JSON object through untouched", async () => {
    // Claude sends tool bookkeeping as JSON; translating it would corrupt it.
    const payload = JSON.stringify({ tool: "read", path: "src/파일.ts" });

    expect(await sent(payload)).toBe(payload);
  });

  it("passes a JSON array through untouched", async () => {
    const payload = JSON.stringify([{ step: "검토" }, { step: "수정" }]);

    expect(await sent(payload)).toBe(payload);
  });

  it("passes JSON-lines through untouched", async () => {
    const payload = [
      JSON.stringify({ event: "start", note: "시작" }),
      JSON.stringify({ event: "end", note: "끝" }),
    ].join("\n");

    expect(await sent(payload)).toBe(payload);
  });

  it("still translates prose that merely begins with a brace", async () => {
    // Not parseable as JSON, so it is a real prompt despite the leading brace.
    expect(await sent("{ 이것은 JSON이 아니고 설명이야")).toBe("TRANSLATED");
  });

  it("still translates when only one of several lines is JSON", async () => {
    const mixed = [JSON.stringify({ a: 1 }), "이 줄은 평범한 한국어 문장이야"].join("\n");

    expect(await sent(mixed)).toBe("TRANSLATED");
  });

  it("passes a system reminder through untouched", async () => {
    const reminder = "<system-reminder>이 내용은 내부용이야</system-reminder>";

    expect(await sent(reminder)).toBe(reminder);
  });
});
