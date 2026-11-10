/**
 * What the desk asked plugins and waits on (`PluginHost.request`: a `desk:command` with a call id),
 * until the plugin's `desk:reply`. A call is cancelled when its plugin stops or its frame is unloaded
 * (ADR 0070), and when the page it went to was replaced by a reload in place before it answered: the
 * new page's hello says the old one has gone with it (#142).
 */
import { CommandError } from "./commands";
import type { PluginMessage } from "./plugin-messages";

type Reply = Extract<PluginMessage, { type: "desk:reply" }>;

interface Asked {
  plugin: string;
  name: string;
  /** It went to a page the plugin's frame has since started to replace. */
  left: boolean;
  resolve(value: unknown): void;
  reject(error: unknown): void;
}

export class PluginAsks {
  readonly #pending = new Map<number, Asked>();
  #next = 1;

  /** Ask `plugin` `name`: `post` sends the call by its number; resolves with the plugin's reply. */
  ask(plugin: string, name: string, post: (call: number) => void): Promise<unknown> {
    const call = this.#next++;
    return new Promise((resolve, reject) => {
      this.#pending.set(call, { plugin, name, left: false, resolve, reject });
      post(call);
    });
  }

  /** Whether the desk waits for an answer from `plugin`, besides one to `except`. */
  busy(plugin: string, except?: string): boolean {
    return [...this.#pending.values()].some((p) => p.plugin === plugin && p.name !== except);
  }

  /** `plugin` replied: only to a call it was asked. */
  reply(plugin: string, message: Reply): void {
    const pending = this.#pending.get(message.call);
    if (!pending || pending.plugin !== plugin) return;
    this.#pending.delete(message.call);
    if (message.ok) pending.resolve(message.result);
    else {
      const code = message.error?.code;
      const known = code === "cancelled" || code === "unknown_command" ? code : "failed";
      pending.reject(new CommandError(known, message.error?.message ?? "failed"));
    }
  }

  /** `plugin`'s frame starts to load another page: what the one on it was asked is marked so. */
  leaving(plugin: string): void {
    for (const pending of this.#pending.values())
      if (pending.plugin === plugin) pending.left = true;
  }

  /** Cancel what `plugin` was asked: everything, or only what went to a page it has left. */
  cancel(plugin: string, why: string, only: "left" | "all" = "all"): void {
    for (const [call, pending] of this.#pending) {
      if (pending.plugin !== plugin || (only === "left" && !pending.left)) continue;
      this.#pending.delete(call);
      pending.reject(new CommandError("cancelled", why));
    }
  }
}
