// @vitest-environment jsdom
// The desktops at the top right (issue 295): segments of one pill, "+" the last; the one in front is
// filled; a named desktop keeps its name, its label and its menu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dt } from "../desktops/copy";
import { emptyView } from "../wm/view";
import type { ShellCtx } from "./context";
import { desktopLabel, mountDesktops } from "./Desktops";
import { emptyState, Store } from "./state";

describe("the desktops", () => {
  let root: HTMLDivElement;
  let store: Store;
  let dispose: () => void;
  let ctx: ShellCtx;

  beforeEach(() => {
    store = new Store(emptyState("en"));
    store.set({
      wm: {
        ...emptyView(),
        desktops: [
          { id: "1", name: "1" },
          { id: "2", name: "2" },
          { id: "3", name: "3" },
        ],
      },
      desktop: "1",
    });
    root = document.createElement("div");
    document.body.append(root);
    ctx = {
      store,
      tr: (key: string, vars?: Record<string, unknown>) =>
        vars ? `${key} ${JSON.stringify(vars)}` : key,
      keyOf: (id: string) => (id === "desk.shell.desktop-1" ? "⌘1" : undefined),
      reduced: () => true,
      ticker: { animate: (_ms: number, _ease: unknown, update: (t: number) => void) => update(1) },
      runtime: {
        commands: { run: vi.fn(async () => undefined), list: () => [] },
        keymap: { onChange: () => () => {} },
        notify: vi.fn(),
      },
    } as unknown as ShellCtx;
    dispose = mountDesktops(root, ctx);
  });

  afterEach(() => {
    dispose();
    root.remove();
  });

  const pill = () => root.querySelector<HTMLElement>(".desktops > .desktops-pill");
  const button = (id: string) =>
    root.querySelector<HTMLElement>(`.desktop-button[data-desktop-id="${id}"]`);

  it("the desktops are segments of one pill, + the last", () => {
    expect(root.querySelectorAll(".desktops .desktops-pill")).toHaveLength(1);
    const children = [...(pill()?.children ?? [])];
    expect(children.map((c) => c.getAttribute("data-desktop-id") ?? c.className)).toEqual([
      "1",
      "2",
      "3",
      "add-button desktop-add",
    ]);
    for (const segment of children.slice(0, 3)) {
      expect(segment.classList.contains("desktop-button")).toBe(true);
      expect(segment.querySelector(".desktop-number")?.textContent).toBe(
        segment.getAttribute("data-desktop-id"),
      );
      expect(segment.querySelector(".mini-grid")).not.toBeNull();
    }
    // No desktop's button stands outside the pill.
    expect(root.querySelectorAll(".desktops .desktop-button")).toHaveLength(3);
    expect(root.querySelectorAll(".desktops-pill .desktop-button")).toHaveLength(3);
  });

  it("only the desktop in front is filled", () => {
    const pressed = () =>
      [...root.querySelectorAll<HTMLElement>(".desktop-button")]
        .filter(
          (b) => b.getAttribute("aria-pressed") === "true" && b.classList.contains("is-active"),
        )
        .map((b) => b.dataset.desktopId);
    expect(pressed()).toEqual(["1"]);
    expect(root.querySelectorAll(".desktop-button.is-active")).toHaveLength(1);
    store.set({ desktop: "2" });
    expect(pressed()).toEqual(["2"]);
    expect(root.querySelectorAll(".desktop-button.is-active")).toHaveLength(1);
    expect(button("1")?.getAttribute("aria-pressed")).toBe("false");
  });

  it("a named desktop keeps its name, its label and its menu", () => {
    store.set({
      wm: {
        ...store.get().wm,
        desktops: [
          { id: "1", name: "1" },
          { id: "2", name: "Mail" },
        ],
        // Mail holds a window, so no desktop is free.
        windows: { "2": [{ id: "notes", x: 0, y: 0, w: 400, h: 300 }] as never },
      },
    });
    const mail = button("2") as HTMLElement;
    expect(mail.closest(".desktops-pill")).not.toBeNull();
    expect(mail.querySelector(".desktop-number")?.textContent).toBe("Mail");
    expect(mail.classList.contains("is-named")).toBe(true);
    const label = desktopLabel(ctx, { id: "2", name: "Mail" }, 2, false);
    expect(mail.getAttribute("aria-label")).toBe(label);
    expect(mail.getAttribute("title")).toBe(label);
    mail.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(store.get().popover).toBe("desktop-menu");
    expect(root.querySelector(".desktops-menu")).not.toBeNull();
    // With every desktop in use, "+" makes a new one, and says so.
    store.set({ popover: null });
    const add = root.querySelector<HTMLElement>(".desktops-pill > .desktop-add");
    expect(add).toBe(pill()?.lastElementChild);
    expect(add?.getAttribute("aria-label")).toBe(dt("en", "newDesktop"));
  });
});
