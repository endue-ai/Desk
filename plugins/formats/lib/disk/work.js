// Long work over a disk: a turn for the event loop at least every 25 ms, a stop when the caller's
// AbortSignal fires, and the two ways reading fails: a refusal (a kind of image not read here) and
// damage (a structure that does not hold together). Both carry the one sentence a person reads.

/**
 * A disk image of a kind that is not read here; openDisk answers it as its details with the
 * sentence as the note. `format` and `details` are what the container could still tell.
 */
export class Refusal extends Error {
  /** @param {string} sentence @param {string} [format] @param {import("./archive.js").Detail[]} [details] */
  constructor(sentence, format = "", details = []) {
    super(sentence);
    this.format = format;
    this.details = details;
  }
}

/** A structure that does not hold together. @param {string} sentence */
export const damaged = (sentence) => new Error(sentence);

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The error an aborted signal gives. @param {AbortSignal} signal */
export const abortError = (signal) =>
  signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The work was cancelled.", "AbortError");

export class Work {
  /** @param {AbortSignal} [signal] */
  constructor(signal) {
    this.signal = signal;
    this.last = Date.now();
  }
  /** Throw if the work was cancelled; give the event loop a turn when 25 ms have gone by. */
  async tick() {
    if (this.signal?.aborted) throw abortError(this.signal);
    if (Date.now() - this.last < 25) return;
    await pause();
    this.last = Date.now();
    if (this.signal?.aborted) throw abortError(this.signal);
  }
}
