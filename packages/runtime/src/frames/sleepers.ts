/**
 * Plugins whose frame the runtime unloaded (ADR 0070), until the next frame says hello: what they
 * kept for it (ui.surface.state), and the messages that wait for it. A request, a command
 * invocation, a permission prompt or an agent's approval needs the plugin's answer, so it waits and
 * wakes the frame; anything else is dropped, since the plugin reads what it needs again when it loads.
 * A plugin can also start asleep (#590): it has no surface yet, and waking it opens one.
 */
import type { BridgeEvent } from "@endue-ai/bridge";

/**
 * Events the core waits on the plugin to answer. A prompt dropped here is never asked again: the
 * core keeps waiting for a perm.answer, and the plugin that asked waits with it.
 */
const ANSWERED = new Set(["cmd.invoked", "perm.prompt", "perm.approval"]);

export class Sleepers {
  readonly #waiting = new Map<string, unknown[]>();
  readonly #restored = new Map<string, unknown>();
  /** Plugins that started asleep, with what opens their surface. */
  readonly #dozing = new Map<string, () => void>();

  /** The plugin's frame is gone; `state` goes to its next init. */
  sleep(id: string, state: unknown): void {
    this.#restored.delete(id);
    if (state !== undefined) this.#restored.set(id, state);
    if (!this.#waiting.has(id)) this.#waiting.set(id, []);
  }

  /** The plugin starts asleep: no surface until `rise`, which runs `open`. */
  doze(id: string, open: () => void): void {
    this.sleep(id, undefined);
    this.#dozing.set(id, open);
  }

  /** Open the surface of a plugin that started asleep; false for any other. It sleeps until hello. */
  rise(id: string): boolean {
    const open = this.#dozing.get(id);
    if (!open) return false;
    this.#dozing.delete(id);
    open();
    return true;
  }

  /** Whether a plugin started asleep and has had no surface since. */
  dozing(id: string): boolean {
    return this.#dozing.has(id);
  }

  asleep(id: string): boolean {
    return this.#waiting.has(id);
  }

  /** Keep a message for a sleeping plugin; true when the frame should load for it. */
  hold(id: string, message: unknown): boolean {
    const waiting = this.#waiting.get(id);
    const m = message as { type?: string; event?: BridgeEvent };
    const answered = m.type === "desk:command" || ANSWERED.has(m.event?.event ?? "");
    if (!waiting || !answered) return false;
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
    this.#dozing.delete(id);
  }
}
