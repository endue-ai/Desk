// What the desk keeps for plugin windows and sends again after each init: messages for every plugin
// (the theme, the language), and messages for one plugin only (its person's changes, ADR 0398).
import { pluginOf } from "./instances";

export type SharedMessage = { type: string; [field: string]: unknown };

export class SharedMessages {
  /** For every plugin, by type; initMessage reads the language from it. */
  readonly all = new Map<string, SharedMessage>();
  readonly #byPlugin = new Map<string, Map<string, SharedMessage>>();

  /** Keep `message` for every plugin, or for `plugin`'s windows; `drop` forgets that one's instead. */
  keep(message: SharedMessage, plugin?: string, drop = false): void {
    if (plugin === undefined) {
      this.all.set(message.type, message);
      return;
    }
    const kept = this.#byPlugin.get(plugin) ?? new Map<string, SharedMessage>();
    if (drop) kept.delete(message.type);
    else kept.set(message.type, message);
    if (kept.size > 0) this.#byPlugin.set(plugin, kept);
    else this.#byPlugin.delete(plugin);
  }

  /** What window `key` gets after its init: every plugin's messages, then its own plugin's. */
  *for(key: string): Iterable<SharedMessage> {
    yield* this.all.values();
    yield* this.#byPlugin.get(pluginOf(key))?.values() ?? [];
  }
}
