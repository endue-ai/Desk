/**
 * The window manager for a desk without the compositor (#83): crates/desk-wm built as WebAssembly
 * (`crates/desk-wm-wasm`), one instance per desk, so the runtime's tests and fixture pages run the
 * window manager the app runs. It applies each edit at once and publishes the desk before the
 * edit's promise settles. Nothing drags or resizes here (there is no compositor input): a page that
 * needs a window moved runs a window command (`run`) or places it (fixture's `wm.ts`). Nor does a
 * live budget decide here: every window keeps its frame unless a test names the set (`keep`).
 */
import type { BrainDesk } from "@endue-ai/bridge";
import { answers, type WindowManagerHost } from "./host";
import type { Published, Told } from "./types";

interface Exports {
  memory: WebAssembly.Memory;
  input(len: number): number;
  call(): number;
  output(): number;
}

/** The module's one call: a JSON request in, its JSON answer out. */
function caller(module: WebAssembly.Module): (request: unknown) => unknown {
  const exports = new WebAssembly.Instance(module, {}).exports as unknown as Exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  return (request) => {
    const bytes = encoder.encode(JSON.stringify(request));
    const at = exports.input(bytes.length);
    new Uint8Array(exports.memory.buffer, at, bytes.length).set(bytes);
    const len = exports.call();
    const out = new Uint8Array(exports.memory.buffer, exports.output(), len);
    return JSON.parse(decoder.decode(out));
  };
}

export interface LocalWindowManager extends WindowManagerHost {
  /** The app is `w` × `h` CSS pixels now: where each window is on screen follows. */
  resize(w: number, h: number): void;
  /**
   * The windows that keep a live frame, as the compositor's live budget would say; `undefined`
   * (the start): every window does. No budget decides here: a test names the set.
   */
  keep(ids: readonly string[] | undefined): void;
}

/** desk-wm from its compiled `module`, on an app `size` big. */
export function localWindowManager(
  module: WebAssembly.Module,
  size: { w: number; h: number } = { w: 1440, h: 900 },
): LocalWindowManager {
  const ask = caller(module);
  const pending = answers();
  let take: (published: Published) => void = () => undefined;
  let rev = 0;
  const deliver = (answer: unknown) => {
    for (const published of (answer as { published?: Published[] }).published ?? []) {
      rev = published.rev;
      take(published);
      pending.settle(published);
    }
  };
  const resize = (w: number, h: number) =>
    deliver(ask({ took: { applied: rev, screen: { w, h } } }));
  resize(size.w, size.h);
  let kept: Set<string> | undefined;
  const listening = new Set<() => void>();
  return {
    live: () => kept,
    onLive(listener) {
      listening.add(listener);
      return () => listening.delete(listener);
    },
    keep(ids) {
      kept = ids ? new Set(ids) : undefined;
      for (const listener of [...listening]) listener();
    },
    connect(next) {
      take = next;
    },
    edit(edits) {
      const { seq, done } = pending.next();
      deliver(ask({ edit: { seq, edits } }));
      return done;
    },
    snapshot: (told: Told) => Promise.resolve(ask({ snapshot: told }) as BrainDesk),
    grab: () => undefined,
    run: (op, window) => deliver(ask({ run: { ...op, ...(window ? { window } : {}) } })),
    resize,
  };
}
