// The desk's DevTools from the motion gate (`e2e/perf/motion.ts`), with no WebDriver: its page
// targets, a session on one (`Runtime.evaluate`), and the CEF shell's development commands sent
// through the desk's main page as the app e2e sends them (`e2e/support/compositor.ts`).
import { setTimeout as delay } from "node:timers/promises";

export interface Target {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

/** The desk's DevTools targets. */
export async function targets(port: number): Promise<Target[]> {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Target[];
}

export interface Session {
  send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** An expression's value in the page (promises awaited). */
  evaluate<T>(expression: string): Promise<T>;
  close(): void;
}

/** A DevTools session on `target`. */
export async function session(target: Target): Promise<Session> {
  if (!target.webSocketDebuggerUrl) throw new Error(`target ${target.url} has no socket`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let next = 0;
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>;
    const answer = pending.get(message.id as number);
    if (answer) {
      pending.delete(message.id as number);
      answer(message);
    }
  };
  await new Promise<void>((done, fail) => {
    socket.onopen = () => done();
    socket.onerror = () => fail(new Error(`DevTools did not open ${target.url}`));
  });
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((done, fail) => {
      const id = ++next;
      const timer = setTimeout(() => fail(new Error(`${method}: no answer in 20 s`)), 20_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        if (message.error) fail(new Error(`${method}: ${JSON.stringify(message.error)}`));
        else done(message.result as Record<string, unknown>);
      });
      socket.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async <T>(expression: string): Promise<T> => {
    const result = (await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "an exception");
    return result.result?.value as T;
  };
  return { send, evaluate, close: () => socket.close() };
}

/** The desk's main page: the runtime's. */
export async function mainPage(port: number): Promise<Target> {
  const all = await targets(port);
  const main = all.find((t) => t.type === "page" && t.url === "desk-app://app/index.html");
  if (!main) throw new Error("the desk's main page is not a DevTools target");
  return main;
}

/** A CEF shell command (`commands.rs`) from the desk's main page, and its answer. */
export async function shell<T>(port: number, cmd: string, args: unknown = {}): Promise<T> {
  const page = await session(await mainPage(port));
  try {
    const answer = await page.evaluate<{ ok?: T; error?: string }>(`new Promise((resolve) => {
      const native = globalThis.__deskNative;
      if (!native) return resolve({ error: "no __deskNative" });
      const id = 900000 + Math.floor(Math.random() * 99999);
      const before = native.onMessage;
      const timer = setTimeout(() => {
        native.onMessage = before;
        resolve({ error: ${JSON.stringify(cmd)} + ": no answer" });
      }, 15000);
      native.onMessage = (text) => {
        const message = JSON.parse(text);
        if (message.id !== id) return before(text);
        native.onMessage = before;
        clearTimeout(timer);
        resolve(message.error ? { error: message.error } : { ok: message.ok });
      };
      native.send(JSON.stringify({ id, cmd: ${JSON.stringify(cmd)}, args: ${JSON.stringify(args)} }));
    })`);
    if (answer.error) throw new Error(answer.error);
    return answer.ok as T;
  } finally {
    page.close();
  }
}

/** Poll `check` every 200 ms until it answers something truthy, for at most `ms`. */
export async function until<T>(ms: number, check: () => Promise<T> | T): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await check();
      if (value) return value;
    } catch {
      // Not yet.
    }
    await delay(200);
  }
  return undefined;
}
