interface SessionPty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (code: number) => void): void;
}

export interface SessionOptions {
  pty: SessionPty;
  output(data: string): void;
  exit(code: number): void;
  close(): Promise<void>;
}

export interface WiredSession {
  input(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export function wireSession(options: SessionOptions): WiredSession {
  options.pty.onData((data) => {
    options.output(data);
  });
  options.pty.onExit((code) => {
    void options.close().finally(() => options.exit(code));
  });
  return {
    input(data) {
      options.pty.write(data);
    },
    resize(cols, rows) {
      options.pty.resize(cols, rows);
    },
    kill(signal) {
      options.pty.kill(signal);
    },
  };
}
