/**
 * Plugins whose frame the runtime unloaded (ADR 0070), until the next frame says hello: what they
 * kept for it (ui.surface.state), and the messages that wait for it. A request or a command
 * invocation needs the plugin's answer, so it waits and wakes the frame; anything else is dropped,
 * since the plugin reads what it needs again when it loads.
 */
import type { BridgeEvent } from "@endue-ai/bridge";

export class Sleepers {
  readonly #waiting = new Map<string, unknown[]>();
  readonly #restored = new Map<string, unknown>();

  /** The plugin's frame is gone; `state` goes to its next init. */
  sleep(id: string, state: unknown): void {
    this.#restored.delete(id);
    if (state !== undefined) this.#restored.set(id, state);
    if (!this.#waiting.has(id)) this.#waiting.set(id, []);
  }

  asleep(id: string): boolean {
    return this.#waiting.has(id);
  }

  /** Keep a message for a sleeping plugin; true when the frame should load for it. */
  hold(id: string, message: unknown): boolean {
    const waiting = this.#waiting.get(id);
    const m = message as { type?: string; event?: BridgeEvent };
    if (!waiting || (m.type !== "desk:command" && m.event?.event !== "cmd.invoked")) return false;
    waiting.push(message);
    return true;
  }

  /** The plugin's new frame said hello: what it kept and what waited, now delivered. */
  woke(id: string): { restored: unknown; waited: unknown[] } {
    const restored = this.#restored.get(id);
    const waited = this.#waiting.get(id) ?? [];
    this.forget(id);
    return { restored, waited };
  }

  forget(id: string): void {
    this.#waiting.delete(id);
    this.#restored.delete(id);
  }
}
