/**
 * The shell as the runtime's window host (ADR 0040): a plugin's centre or floating surface arrives
 * as a detached section and goes into a shell window's pane, where it stays while the window does.
 * The sections are kept here, not in the store; the store only knows which surfaces arrived.
 */
import type { WindowHost } from "../runtime";
import { windowsOf } from "../shell/actions";
import { h } from "../shell/dom";
import type { DeskState, Store } from "../shell/state";
import { appSize } from "./coordinates";
import { coveredPlugins } from "./cover";
import { freeSlot } from "./tiling";

export interface PluginWindows extends WindowHost {
  /** The element a pane shows for plugin surface `id`: the runtime's section, once it arrived. */
  body(id: string): HTMLElement;
  /** Whether the runtime handed surface `id` over (its window shows the plugin, not "off"). */
  has(id: string): boolean;
}

export function pluginWindows(store: Store): PluginWindows {
  const sections = new Map<string, HTMLElement>();
  const containers = new Map<string, HTMLElement>();
  // Covered windows, worked out once per state and screen size (ADR 0070).
  let hidden: { state: DeskState; size: string; ids: Set<string> } | undefined;
  return {
    adopt(spec, section) {
      sections.set(spec.id, section);
      // A pane already waiting for it (a profile placed the plugin before it mounted) takes it now.
      const container = containers.get(spec.id);
      if (container && section.parentElement !== container) container.append(section);
      store.set((s) => {
        // A surface handed over again keeps its slot; a new one takes the first slot left free.
        const kept = s.adopted.find((a) => a.id === spec.id)?.slot;
        const others = s.adopted.filter((a) => a.id !== spec.id);
        const slot = kept ?? freeSlot(others.map((a, i) => a.slot ?? i));
        const at = s.adopted.find((a) => a.id === spec.id)?.at ?? s.pan[s.desktop];
        return {
          adopted: [...others, { id: spec.id, title: spec.title, slot, ...(at ? { at } : {}) }],
        };
      });
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
    covered(id) {
      const state = store.get();
      const { vw, vh } = appSize();
      const size = `${vw}x${vh}`;
      if (hidden?.state !== state || hidden.size !== size)
        hidden = { state, size, ids: coveredPlugins(state, vw, vh) };
      return hidden.ids.has(id);
    },
    // After the store's change is drawn: the shell draws its windows as the store changes.
    onChange: (listener) =>
      store.watch(
        (s) => [windowsOf(s), s.focused, s.desktop, s.pan, s.adopted, s.drawer],
        () => queueMicrotask(listener),
      ),
  };
}
