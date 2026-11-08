// Long decodes give the event loop a turn at least every 25 ms, say how far they are, and stop
// when their AbortSignal fires. Decoders work in slices and call `step()` between them.

export const CANCELLED = "The RAR decode was cancelled.";
const SLICE = 8;

const now = () => (typeof performance === "object" ? performance.now() : Date.now());

/** A macrotask turn: setImmediate in Node, a message in browsers (timers there wait 4 ms). */
const turn = (() => {
  if (typeof setImmediate === "function") return () => new Promise((done) => setImmediate(done));
  if (typeof MessageChannel === "function") {
    const channel = new MessageChannel();
    /** @type {(() => void)[]} */
    const waiting = [];
    channel.port1.onmessage = () => waiting.shift()?.();
    return () =>
      new Promise((done) => {
        waiting.push(() => done(undefined));
        channel.port2.postMessage(0);
      });
  }
  return () => new Promise((done) => setTimeout(done, 0));
})();

export class Pace {
  /**
   * @param {AbortSignal | undefined} signal
   * @param {(done: number, total: number) => void} [progress] told at each turn how many of the
   *   bytes to decode are decoded
   */
  constructor(signal, progress) {
    this.signal = signal;
    this.progress = progress;
    this.done = 0;
    this.total = 0;
    this.since = now();
    this.check();
  }

  /** Throws when the signal has fired. */
  check() {
    const signal = this.signal;
    if (!signal?.aborted) return;
    const reason = signal.reason;
    if (reason instanceof Error) throw reason;
    const error = new Error(CANCELLED);
    error.name = "AbortError";
    throw error;
  }

  /** Whether the current slice has run long enough to yield. */
  due() {
    return now() - this.since >= SLICE;
  }

  /** Yields when due, then checks the signal. */
  async step() {
    this.check();
    if (!this.due()) return;
    this.progress?.(Math.min(this.done, this.total), this.total);
    await turn();
    this.since = now();
    this.check();
  }
}
