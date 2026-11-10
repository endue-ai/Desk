/**
 * Plugins whose frame the runtime unloaded (ADR 0070), whose first frame still loads, or whose frame
 * loads its page again in place (an update, #142), until the next page says hello: what they kept for
 * it (ui.surface.state), and the messages that wait for it. A request, a command invocation, a permission prompt or an agent's approval needs the
 * plugin's answer, so it waits and wakes the frame; anything else is dropped, since the plugin
 * reads what it needs again when it loads.
 * A plugin can also start asleep (#590): it has no surface yet, and waking it opens one. When no
 * frame can load, a command invocation is not kept: the host answers it (#1). A prompt or a desk
 * command still waits, since the person may open the plugin's window later.
 */
import type { BridgeEvent } from "@endue-ai/bridge";

/**
 * Events the core waits on the plugin to answer. A prompt dropped here is never asked again: the
 * core keeps waiting for a perm.answer, and the plugin that asked waits with it.
 */
const ANSWERED = new Set(["cmd.invoked", "perm.prompt", "perm.approval"]);

/** What became of a message for a sleeping plugin: dropped, kept for its frame, or stuck. */
export type Hold = "dropped" | "held" | "stuck";

export class Sleepers {
  readonly #waiting = new Map<string, unknown[]>();
  readonly #restored = new Map<string, unknown>();
  /** Plugins that started asleep, with what opens their surface. */
  readonly #dozing = new Map<string, () => void>();
  /** Plugins whose frame loads for what waits, until its hello. */
  readonly #rousing = new Set<string>();
  /** Plugins whose live frame loads a page that has not said hello yet: not asleep. */
  readonly #loading = new Set<string>();
  /** Loads an unloaded frame again (the frame policy's wake); true when its frame is live after. */
  readonly #load: (id: string) => boolean;

  constructor(load: (id: string) => boolean = () => false) {
    this.#load = load;
  }

  /** The plugin's frame is gone; `state` goes to its next init. */
  sleep(id: string, state: unknown): void {
    this.#restored.delete(id);
    this.#rousing.delete(id);
    this.#loading.delete(id);
    if (state !== undefined) this.#restored.set(id, state);
    if (!this.#waiting.has(id)) this.#waiting.set(id, []);
  }

  /** The plugin starts asleep: no surface until `rise`, which runs `open`. */
  doze(id: string, open: () => void): void {
    this.sleep(id, undefined);
    this.#dozing.set(id, open);
  }

  /**
   * A plugin mounts awake: `open` opens its surface, and until its first frame says hello what
   * needs its answer waits, as for a sleeper. Its page hears nothing before the SDK connects, and a
   * command run then was lost: its caller waited for ever (#139).
   */
  load(id: string, open: () => void): void {
    this.reload(id);
    open();
  }

  /**
   * A live plugin's frame loads its page again in place (its update, #84's hot reload): until the
   * new page says hello, what needs its answer waits, as on its first load. The page it leaves goes
   * with what it was posted, and the new one hears nothing before the SDK connects (#142).
   */
  reload(id: string): void {
    this.sleep(id, undefined);
    this.#loading.add(id);
    this.#rousing.add(id);
  }

  /** Open the surface of a plugin that started asleep; false for any other. It sleeps until hello. */
  rise(id: string): boolean {
    const open = this.#dozing.get(id);
    if (!open) return false;
    this.#dozing.delete(id);
    this.#rousing.add(id);
    open();
    return true;
  }

  /** Load a sleeping plugin's frame for what waits; true when it loads, now or already. */
  rouse(id: string): boolean {
    if (this.#rousing.has(id) || this.rise(id) || this.#load(id)) this.#rousing.add(id);
    return this.#rousing.has(id);
  }

  /** Whether a plugin started asleep and has had no surface since. */
  dozing(id: string): boolean {
    return this.#dozing.has(id);
  }

  /** Whether a plugin has no live frame until its next hello: it started asleep, or unloaded. */
  asleep(id: string): boolean {
    return this.#waiting.has(id) && !this.#loading.has(id);
  }

  /** Whether what needs a plugin's answer waits for its next hello: asleep, or loading. */
  waits(id: string): boolean {
    return this.#waiting.has(id);
  }

  /**
   * Keep a message that needs the plugin's answer and load its frame for it. A command invocation
   * whose frame cannot load is `stuck` and not kept, so the host answers its caller; a prompt or a
   * desk command waits for a frame the person may still open. Anything else is dropped.
   */
  hold(id: string, message: unknown): Hold {
    const waiting = this.#waiting.get(id);
    const m = message as { type?: string; event?: BridgeEvent };
    const answered = m.type === "desk:command" || ANSWERED.has(m.event?.event ?? "");
    if (!waiting || !answered) return "dropped";
    if (!this.rouse(id) && m.event?.event === "cmd.invoked") return "stuck";
    waiting.push(message);
    return "held";
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
    this.#rousing.delete(id);
    this.#loading.delete(id);
  }
}
