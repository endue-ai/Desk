/**
 * The shell as the runtime's window host (ADR 0040): a plugin's centre or floating surface arrives
 * as a detached section and goes into a shell window's pane, where it stays while the window does.
 * The sections are kept here, not in the store; the store only knows which surfaces arrived.
 */
import type { WindowHost } from "../runtime";
import { h } from "../shell/dom";
import type { Store } from "../shell/state";

export interface PluginWindows extends WindowHost {
  /** The element a pane shows for plugin surface `id`: the runtime's section, once it arrived. */
  body(id: string): HTMLElement;
  /** Whether the runtime handed surface `id` over (its window shows the plugin, not "off"). */
  has(id: string): boolean;
}

export function pluginWindows(store: Store): PluginWindows {
  const sections = new Map<string, HTMLElement>();
  const containers = new Map<string, HTMLElement>();
  return {
    adopt(spec, section) {
      sections.set(spec.id, section);
      // A pane already waiting for it (a profile placed the plugin before it mounted) takes it now.
      const container = containers.get(spec.id);
      if (container && section.parentElement !== container) container.append(section);
      store.set((s) => ({
        adopted: [...s.adopted.filter((a) => a.id !== spec.id), { id: spec.id, title: spec.title }],
      }));
    },
    release(id) {
      sections.delete(id);
      containers.delete(id);
      store.set((s) => ({ adopted: s.adopted.filter((a) => a.id !== id) }));
    },
    body(id) {
      const el = h("div", { class: "plugin-pane" });
      containers.set(id, el);
      const section = sections.get(id);
      if (section) el.append(section);
      return el;
    },
    has: (id) => sections.has(id),
  };
}
