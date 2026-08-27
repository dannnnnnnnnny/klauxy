import { describe, expect, it, vi } from "vitest";
import { wireSession } from "./runner.js";

function harness() {
  let onData: (data: string) => void = () => {};
  let onExit: (code: number) => void = () => {};
  const pty = {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (callback: typeof onData) => {
      onData = callback;
    },
    onExit: (callback: typeof onExit) => {
      onExit = callback;
    },
  };
  const output = vi.fn();
  const exit = vi.fn();
  const close = vi.fn().mockResolvedValue(undefined);
  const session = wireSession({ pty, output, exit, close });
  return { pty, output, exit, close, session, emitData: onData, emitExit: onExit };
}

describe("Claude session wiring", () => {
  it("forwards terminal input immediately without translation or buffering", () => {
    const h = harness();
    h.session.input("이 코드를 고쳐줘\r");
    expect(h.pty.write).toHaveBeenCalledOnce();
    expect(h.pty.write).toHaveBeenCalledWith("이 코드를 고쳐줘\r");
  });

  it("forwards child output and terminal resize unchanged", () => {
    const h = harness();
    h.emitData("hello");
    h.session.resize(100, 40);
    expect(h.output).toHaveBeenCalledWith("hello");
    expect(h.pty.resize).toHaveBeenCalledWith(100, 40);
  });

  it("closes the proxy before reporting the child exit", async () => {
    let finishClose: () => void = () => {};
    const h = harness();
    h.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    h.emitExit(3);
    await Promise.resolve();
    expect(h.close).toHaveBeenCalledOnce();
    expect(h.exit).not.toHaveBeenCalled();
    finishClose();
    await vi.waitFor(() => expect(h.exit).toHaveBeenCalledWith(3));
  });

  it("kills the child through the public session handle", () => {
    const h = harness();
    h.session.kill("SIGTERM");
    expect(h.pty.kill).toHaveBeenCalledWith("SIGTERM");
  });
});
