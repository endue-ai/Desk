/**
 * Where plugins' places stay while their windows lie in pages of their own (ADR 0201): in the desk's
 * page, a group for each window, led by a stop that stands for the window's chrome (its title bar's
 * tools, which its own page holds), named as the window is. A place never paints; it holds its
 * plugin's spot in the focus order (ADR 0160), so Ctrl+Tab, Tab into and out of a plugin and the
 * focus the compositor's keys follow stay the desk's page's. Shift+Tab out of a plugin's first part
 * stops at its own window's chrome and Tab past its last part at the next window's, with the keys
 * left with the desk's page, as when the windows lay in the page and their tools came before their
 * panes. Without the stops, the places sat side by side and Shift+Tab out of one plugin entered the
 * plugin of another window.
 */

export interface Anchors {
  /** Keep the places of the plugins in `body`, window `id`'s, whose section is `el`, in its group. */
  hold(id: string, el: HTMLElement, body: HTMLElement): void;
  /** Window `id` is gone: its group goes. */
  drop(id: string): void;
}

/** The anchors of the windows laid out in `layer`, kept in a container at its end. */
export function surfaceAnchors(layer: HTMLElement): Anchors {
  const doc = layer.ownerDocument;
  const anchors = doc.createElement("div");
  anchors.className = "surface-anchors";
  layer.append(anchors);
  const groups = new Map<string, HTMLElement>();

  const make = (id: string) => {
    const chrome = doc.createElement("span");
    chrome.className = "surface-anchor-chrome";
    chrome.tabIndex = 0;
    const group = doc.createElement("div");
    group.className = "surface-anchor";
    group.dataset.window = id;
    group.append(chrome);
    groups.set(id, group);
    anchors.append(group);
    return group;
  };

  return {
    hold(id, el, body) {
      const plugins = body.querySelectorAll<HTMLElement>(".desk-surface");
      const group = groups.get(id) ?? (plugins.length ? make(id) : undefined);
      if (!group) return;
      const name = el.getAttribute("aria-label") ?? "";
      const chrome = group.firstElementChild as HTMLElement;
      if (chrome.getAttribute("aria-label") !== name) chrome.setAttribute("aria-label", name);
      // A move drops the focus of what it moves: a place the session gave the focus as the desk
      // started, before its window's page opened, keeps it.
      const active = doc.activeElement as HTMLElement | null;
      for (const plugin of plugins) group.append(plugin);
      if (active && active !== doc.activeElement && group.contains(active)) {
        active.focus({ preventScroll: true });
      }
    },
    drop(id) {
      groups.get(id)?.remove();
      groups.delete(id);
    },
  };
}
