/**
 * The shell as the runtime's window host (ADR 0040): a plugin's centre or floating surface arrives
 * as a detached section and goes into a shell window's pane, where it stays while the window does.
 * The sections are kept here; the window manager (crates/desk-wm, #83) is told which surfaces
 * arrived and went, and gives each window its slot. Which windows keep a live frame is the window
 * manager host's to say (`WindowManagerHost.live`, ADR 0151); a desk without one keeps them all.
 */
import type { WindowHost } from "../runtime";
import { windowsOf } from "../shell/actions";
import { h } from "../shell/dom";
import type { Store } from "../shell/state";
import { unplace } from "../surfaces";
import type { WindowManagerHost } from "../wm/host";

export interface PluginWindows extends WindowHost {
  /** The element a pane shows for plugin surface `id`: the runtime's section, once it arrived. */
  body(id: string): HTMLElement;
  /** Whether the runtime handed surface `id` over (its window shows the plugin, not "off"). */
  has(id: string): boolean;
}

export function pluginWindows(
  store: Store,
  wm: () => WindowManagerHost,
  show?: (id: string) => void,
): PluginWindows {
  const sections = new Map<string, HTMLElement>();
  const containers = new Map<string, HTMLElement>();
  return {
    show: (id) => {
      if (sections.has(id)) show?.(id);
    },
    adopt(spec, section) {
      // The pane's one cell is the section's: no compositor cell comes along (issue 538).
      unplace(section);
      sections.set(spec.id, section);
      // A pane already waiting for it (a profile placed the plugin before it mounted) takes it now.
      const container = containers.get(spec.id);
      if (container && section.parentElement !== container) container.append(section);
      // A surface handed over again keeps its slot; a new one takes the first slot left free.
      void wm().edit([{ op: "adopt", id: spec.id, title: spec.title }]);
    },
    release(id) {
      sections.delete(id);
      containers.delete(id);
      void wm().edit([{ op: "release", id }]);
    },
    body(id) {
      const el = h("div", { class: "plugin-pane" });
      containers.set(id, el);
      const section = sections.get(id);
      if (section) el.append(section);
      return el;
    },
    has: (id) => sections.has(id),
    live: () => wm().live?.(),
    // After the store's change is drawn: the shell draws its windows as the store changes.
    onChange: (listener) => {
      const offs = [
        store.watch(
          (s) => [windowsOf(s), s.focused, s.desktop, s.pan, s.adopted, s.drawer],
          () => queueMicrotask(listener),
        ),
        wm().onLive?.(listener),
      ];
      return () => {
        for (const off of offs) off?.();
      };
    },
  };
}
