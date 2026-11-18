// A window's icon (ADR 0273): every built-in plugin that opens a window has one of its own, drawn
// from the desk's line icons, and the page reports each view's as path data for the canvas map.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { iconPath } from "./icons";
import { pluginIcon, viewIcon } from "./plugin-icons";
import { Store, sampleState } from "./state";
import { viewIcons } from "./view-icons";

const PLUGINS = join(__dirname, "../../../../plugins");

/** The built-in plugins whose surfaces open in a window: not the overlays. */
function windowed(): string[] {
  return readdirSync(PLUGINS, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      try {
        const manifest = JSON.parse(readFileSync(join(PLUGINS, d.name, "plugin.json"), "utf8"));
        const surfaces: { placement?: string }[] = manifest.surfaces ?? [];
        return surfaces.some((s) => s.placement && s.placement !== "overlay") ? [manifest.id] : [];
      } catch {
        return [];
      }
    });
}

describe("a window's icon", () => {
  it("is a built-in plugin's own, one of the desk's line icons", () => {
    const ids = windowed();
    expect(ids).toContain("endue.terminal");
    for (const id of ids) {
      const name = pluginIcon(id);
      expect(name, id).not.toBe("box");
      // A name the icons do not know draws the sparkle, Eris's own.
      if (name !== "sparkle") {
        expect(iconPath(name), `${id}: ${name}`).not.toBe(iconPath("sparkle"));
      }
    }
    expect(pluginIcon("e2e.hello"), "a plugin it does not know").toBe("box");
  });

  it("is the shell's own view's, as its title bar shows it", () => {
    expect(viewIcon("plugin:endue.git")).toBe("branch");
    expect(viewIcon("calendar")).toBe("calendar");
    expect(viewIcon("launcher")).toBe("plus");
    expect(viewIcon("agent:a1")).toBe("user");
    expect(viewIcon("file:notes.md")).toBe("file");
    expect(viewIcon("recent:x")).toBe("sparkle");
  });

  it("is reported for every view of the desktop in front, by view as the window manager resolves it", () => {
    const store = new Store(sampleState("en", 0));
    const s = store.get();
    const mail = { id: "endue.mail", plugin: "endue.mail", panes: null };
    const split = {
      id: "window-2",
      panes: {
        id: "s",
        kind: "split",
        dir: "row",
        ratio: 0.5,
        a: { id: "p1", kind: "view", view: "keys" },
        b: { id: "p2", kind: "view", view: "plugin:endue.git" },
      },
    };
    const elsewhere = { id: "endue.chat", plugin: "endue.chat", panes: null };
    store.set({
      adopted: [{ id: "endue.mail", title: "Mail" }],
      wm: { ...s.wm, here: "1", windows: { "1": [mail, split], "2": [elsewhere] } } as never,
    });
    expect(viewIcons(store)).toEqual({
      "plugin:endue.mail": iconPath("mail"),
      keys: iconPath("settings"),
      "plugin:endue.git": iconPath("branch"),
    });
  });
});
