import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { BodyTooLargeError, readBody, requestHeaders, responseHeaders } from "./http-relay.js";

describe("request headers", () => {
  it("forwards Anthropic credentials untouched", () => {
    const headers = requestHeaders(
      { authorization: "Bearer secret", "x-api-key": "key-123", "anthropic-version": "2023-06-01" },
      undefined,
    );

    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(headers.get("x-api-key")).toBe("key-123");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("drops hop-by-hop headers and host", () => {
    const headers = requestHeaders(
      { host: "example.com", connection: "keep-alive", "transfer-encoding": "chunked" },
      undefined,
    );

    expect(headers.get("host")).toBeNull();
    expect(headers.get("connection")).toBeNull();
    expect(headers.get("transfer-encoding")).toBeNull();
  });

  it("sets content-length only when a body is present", () => {
    expect(requestHeaders({}, 42).get("content-length")).toBe("42");
    expect(requestHeaders({}, 0).get("content-length")).toBeNull();
    expect(requestHeaders({}, undefined).get("content-length")).toBeNull();
  });

  it("replaces a stale client content-length", () => {
    const headers = requestHeaders({ "content-length": "999" }, 10);

    expect(headers.get("content-length")).toBe("10");
  });

  it("preserves repeated headers", () => {
    const headers = requestHeaders({ "x-trial": ["a", "b"] }, undefined);

    expect(headers.get("x-trial")).toBe("a, b");
  });
});

describe("response headers", () => {
  it("omits content-encoding because fetch already decompressed the body", () => {
    const response = new Response("{}", {
      headers: { "content-encoding": "gzip", "content-type": "application/json" },
    });

    const headers = responseHeaders(response);

    expect(headers["content-encoding"]).toBeUndefined();
    expect(headers["content-type"]).toBe("application/json");
  });

  it("carries every set-cookie value across", () => {
    const response = new Response("{}");
    response.headers.append("set-cookie", "a=1");
    response.headers.append("set-cookie", "b=2");

    expect(responseHeaders(response)["set-cookie"]).toEqual(["a=1", "b=2"]);
  });
});

describe("body buffering", () => {
  it("returns the whole body when it fits", async () => {
    const body = await readBody(Readable.from([Buffer.from("ab"), Buffer.from("cd")]), 16);

    expect(body.toString()).toBe("abcd");
  });

  it("throws a typed error past the limit", async () => {
    await expect(readBody(Readable.from([Buffer.alloc(32)]), 8)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    );
  });

  it("consumes the stream fully even after the limit trips", async () => {
    let delivered = 0;
    const stream = Readable.from(
      (function* () {
        for (let index = 0; index < 8; index += 1) {
          delivered += 1;
          yield Buffer.alloc(16);
        }
      })(),
    );

    await readBody(stream, 8).catch(() => {});

    // Every chunk must be read, otherwise the client never sees the 413.
    expect(delivered).toBe(8);
  });

  it("accepts an empty body", async () => {
    expect((await readBody(Readable.from([]), 16)).length).toBe(0);
  });
});
