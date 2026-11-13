// The desk socket (ADR 0030) from the perf runner, as the caller `cli`: newline-delimited
// specs/bridge/v0 documents, a request in and its answer and every core event out. The start-up
// spec opens its files through it and answers the permission prompts the plugins raise, as the
// person would; the app does not keep `always` grants yet, so every start asks again.
import { createConnection, type Socket } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { dataDir } from "../../support/cef.ts";

type Line = {
  id?: number;
  ok?: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
  event?: string;
  data?: Record<string, unknown>;
};

/** Where the app under `home` serves its socket (XDG_* are cleared for the app). */
export const socketPath = (home: string) => join(dataDir(home), "desk.sock");

export class DeskSocket {
  readonly closed: Promise<void>;
  readonly #socket: Socket;
  readonly #pending = new Map<number, { answer(line: Line): void; gone(): void }>();
  readonly #listeners = new Set<(line: Line) => void>();
  #next = 0;
  #buffer = "";

  private constructor(socket: Socket) {
    this.#socket = socket;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => this.#read(chunk));
    // A desk that quits resets the connection: "close" follows, which is what matters here.
    socket.on("error", () => {});
    this.closed = new Promise((resolve) =>
      socket.once("close", () => {
        for (const pending of this.#pending.values()) pending.gone();
        this.#pending.clear();
        resolve();
      }),
    );
  }

  /** Connect, or reject when no desk answers at `path` (yet). */
  static connect(path: string): Promise<DeskSocket> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(path);
      socket.once("connect", () => resolve(new DeskSocket(socket)));
      socket.once("error", reject);
    });
  }

  /** One bridge call; rejects with `<code>: <message>` when the desk answers with an error. */
  call(method: string, params: unknown): Promise<unknown> {
    const id = ++this.#next;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, {
        answer: (line) =>
          line.ok
            ? resolve(line.result)
            : reject(new Error(`${method}: ${line.error?.code}: ${line.error?.message}`)),
        gone: () => reject(new Error(`${method}: the desk went away`)),
      });
      this.#socket.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  /** Run a command as `desk cmd run` does: cmd.invoke, then wait for its cmd.answered. */
  async run(command: string, args: unknown): Promise<unknown> {
    const answers = new Map<string, Record<string, unknown>>();
    let waiting: { invocation: string; done(data: Record<string, unknown>): void } | undefined;
    const off = this.#listen((line) => {
      if (line.event !== "cmd.answered" || !line.data) return;
      const invocation = String(line.data.invocationId);
      if (waiting?.invocation === invocation) waiting.done(line.data);
      else answers.set(invocation, line.data);
    });
    try {
      const { invocationId } = (await this.call("cmd.invoke", {
        id: command,
        args,
        scope: { permission: "cmd:invoke", ids: [command] },
      })) as { invocationId: string };
      const data =
        answers.get(invocationId) ??
        (await Promise.race([
          new Promise<Record<string, unknown>>((done) => {
            waiting = { invocation: invocationId, done };
          }),
          this.closed.then(() => {
            throw new Error(`${command}: the desk went away before it answered`);
          }),
        ]));
      if (data.ok !== true) {
        const error = data.error as { code?: string; message?: string } | undefined;
        throw new Error(`${command}: ${error?.code ?? "failed"}: ${error?.message ?? ""}`);
      }
      return data.result;
    } finally {
      off();
    }
  }

  /** Answer every permission prompt from now on: granted, `always`. */
  answerPrompts(): void {
    this.#listen((line) => {
      if (line.event !== "perm.prompt") return;
      void this.call("perm.answer", {
        promptId: line.data?.promptId,
        granted: true,
        duration: "always",
        scope: { permission: "perm:manage" },
      }).catch(() => {});
    });
  }

  close(): void {
    this.#socket.end();
  }

  #listen(listener: (line: Line) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #read(chunk: string): void {
    this.#buffer += chunk;
    for (let end = this.#buffer.indexOf("\n"); end !== -1; end = this.#buffer.indexOf("\n")) {
      const text = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 1);
      if (!text.trim()) continue;
      const line = JSON.parse(text) as Line;
      if (line.event === undefined && typeof line.id === "number") {
        this.#pending.get(line.id)?.answer(line);
        this.#pending.delete(line.id);
      } else {
        for (const listener of this.#listeners) listener(line);
      }
    }
  }
}

/**
 * Answer the prompts of whichever desk serves `path`, across relaunches: connect, answer until the
 * desk goes, connect again. The app binds its socket in setup, long before the session restore
 * asks for its files, so the next desk's prompts find the runner listening.
 */
export function keepAnswering(path: string): { stop(): void } {
  let stopped = false;
  let current: DeskSocket | undefined;
  void (async () => {
    while (!stopped) {
      try {
        current = await DeskSocket.connect(path);
        current.answerPrompts();
        await current.closed;
      } catch {
        await delay(25);
      }
    }
  })();
  return {
    stop() {
      stopped = true;
      current?.close();
    },
  };
}
