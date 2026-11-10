/**
 * Which plugins' pages said hello (`desk:hello`) since their frame last loaded, so they can answer
 * the desk, and the callers waiting for one that has not yet (`PluginHost.whenReady`). A greeting
 * holds while the frame's window is the one it came from, and ends when the frame is unloaded (ADR
 * 0070) or starts to load its page again in place, whose window stays the same (#142).
 */
type Waiter = { resolve(): void; reject(error: unknown): void };

export class PluginGreetings {
  readonly #greeted = new Map<string, Window | null>();
  readonly #waiting = new Map<string, Waiter[]>();

  /** Whether plugin `id`'s page greeted from `frame`, its frame's window now. */
  greeted(id: string, frame: Window | null): boolean {
    return this.#greeted.has(id) && this.#greeted.get(id) === frame;
  }

  /** Resolves at plugin `id`'s next hello; rejects if it stops first. */
  next(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#waiting.set(id, [...(this.#waiting.get(id) ?? []), { resolve, reject }]);
    });
  }

  /** Plugin `id`'s page said hello from `frame`: whoever waited for it goes on. */
  hello(id: string, frame: Window | null): void {
    this.#greeted.set(id, frame);
    for (const waiter of this.#waiting.get(id) ?? []) waiter.resolve();
    this.#waiting.delete(id);
  }

  /** Plugin `id`'s page has gone or is going: it greets again from its next page. */
  forget(id: string): void {
    this.#greeted.delete(id);
  }

  /** Plugin `id` stopped: whoever waits for its hello hears `error`. */
  stop(id: string, error: unknown): void {
    this.forget(id);
    for (const waiter of this.#waiting.get(id) ?? []) waiter.reject(error);
    this.#waiting.delete(id);
  }
}
