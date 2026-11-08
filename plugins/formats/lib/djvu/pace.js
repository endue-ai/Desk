// Long decodes stay polite: they give the event loop a turn at least every 25 ms and stop with an
// AbortError as soon as the caller's signal fires.

const BUDGET = 25;
const now = () => (typeof performance === "undefined" ? Date.now() : performance.now());

/** The error a cancelled decode rejects with. @param {AbortSignal} [signal] */
export function abortError(signal) {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.name === "AbortError") return reason;
  const error = new Error("The decoding was cancelled.");
  error.name = "AbortError";
  return error;
}

/**
 * A pacer for one decode. Hot loops call `due()` (cheap) and, when it answers true,
 * `await rest()`, which yields to the event loop and throws if the signal fired.
 * @param {AbortSignal} [signal]
 */
export function pacer(signal) {
  let last = now();
  return {
    signal,
    due: () => now() - last >= BUDGET,
    async rest() {
      if (signal?.aborted) throw abortError(signal);
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (signal?.aborted) throw abortError(signal);
      last = now();
    },
    /** Throw now if the signal already fired. */
    check() {
      if (signal?.aborted) throw abortError(signal);
    },
  };
}

/** @typedef {ReturnType<typeof pacer>} Pacer */
