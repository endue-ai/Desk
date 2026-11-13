// @vitest-environment jsdom
// Window pages (ADR 0201): each window's section lies in a page of its own, which a texture of its
// own draws. The page copies the desk's page's root (its classes and theme tokens), its style
// sheets and the windows' layer's ancestors, and keeps them in step; a window gone closes its page;
// where no popup opens every window stays in the desk's page.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOST_LIMIT, LOST_MS, PAGE_NAME, popupOpener, windowPages } from "./window-pages";

/** A page as `window.open` hands it: a document of its own, and its close. */
function fakePage() {
  const doc = document.implementation.createHTMLDocument("");
  const heard = new Map<string, EventListener>();
  const page = {
    document: doc,
    closed: false,
    close: vi.fn(() => {
      page.closed = true;
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => heard.set(type, listener)),
    removeEventListener: vi.fn((type: string) => heard.delete(type)),
    /** Run what the page hears for `type`, as its window would. */
    fire: (type: string) => heard.get(type)?.(new Event(type)),
  };
  return page;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("window pages", () => {
  let layer: HTMLElement;

  beforeEach(() => {
    document.documentElement.className = "desk-compositor";
    document.documentElement.setAttribute("style", "--desk-card: #111");
    const style = document.createElement("style");
    style.textContent = ".surface { display: grid; }";
    document.head.append(style);
    const desk = document.createElement("div");
    desk.id = "desk";
    const shell = document.createElement("div");
    shell.className = "shell";
    layer = document.createElement("div");
    layer.className = "surfaces";
    shell.append(layer);
    desk.append(shell);
    document.body.append(desk);
  });

  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  it("lay a window out in a page of its own, under copies of the page's root, styles and layer", () => {
    const made = fakePage();
    const open = vi.fn(() => made as unknown as Window);
    const pages = windowPages(document, layer, open);
    const host = pages.host("local:claude", 820, 600);
    expect(open).toHaveBeenCalledWith(`${PAGE_NAME}local:claude`, 820, 600);
    expect(host?.ownerDocument).toBe(made.document);
    expect(host?.className).toBe("surfaces");
    expect(host?.parentElement?.className).toBe("shell");
    expect(host?.parentElement?.parentElement?.id).toBe("desk");
    const root = made.document.documentElement;
    expect(root.className).toBe("desk-compositor");
    expect(root.getAttribute("style")).toBe("--desk-card: #111");
    expect(made.document.head.querySelector("style")?.textContent).toBe(
      ".surface { display: grid; }",
    );
    expect(made.document.title).toBe(`${PAGE_NAME}local:claude`);
    expect(pages.host("local:claude", 820, 600)).toBe(host);
    expect(open).toHaveBeenCalledTimes(1);
    expect(pages.open()).toEqual(["local:claude"]);
  });

  it("keep each page's root, styles and layer in step with the page's", async () => {
    const made = fakePage();
    const pages = windowPages(document, layer, () => made as unknown as Window);
    const host = pages.host("notes", 300, 200);
    document.documentElement.setAttribute("style", "--desk-card: #222");
    layer.style.setProperty("--chrome-left", "88px");
    const added = document.createElement("style");
    added.textContent = ".theme { color: red; }";
    document.head.append(added);
    await settle();
    expect(made.document.documentElement.getAttribute("style")).toBe("--desk-card: #222");
    expect(host?.style.getPropertyValue("--chrome-left")).toBe("88px");
    expect([...made.document.head.querySelectorAll("style")].map((s) => s.textContent)).toEqual([
      ".surface { display: grid; }",
      ".theme { color: red; }",
    ]);
    added.remove();
    await settle();
    expect(made.document.head.querySelectorAll("style")).toHaveLength(1);
  });

  it("close a window's page with it, and with every one on dispose", () => {
    const made = [fakePage(), fakePage()];
    const pages = windowPages(document, layer, () => made.shift() as unknown as Window);
    pages.host("a", 10, 10);
    const second = made[0];
    pages.host("b", 10, 10);
    pages.close("a");
    expect(pages.open()).toEqual(["b"]);
    pages.dispose();
    expect(second?.close).toHaveBeenCalled();
    expect(pages.open()).toEqual([]);
  });

  it("run a watch on the pages open now and those that open later, and its stop as one closes", () => {
    const pages = windowPages(document, layer, () => fakePage() as unknown as Window);
    pages.host("a", 10, 10);
    const stopped: string[] = [];
    const seen: string[] = [];
    const stop = pages.watch((id) => {
      seen.push(id);
      return () => stopped.push(id);
    });
    pages.host("b", 10, 10);
    expect(seen).toEqual(["a", "b"]);
    pages.close("a");
    expect(stopped).toEqual(["a"]);
    stop();
    expect(stopped).toEqual(["a", "b"]);
  });

  it("keep a window in the page while a press is held there, and give it its page as the press ends", () => {
    const pages = windowPages(document, layer, () => fakePage() as unknown as Window);
    const freed = vi.fn();
    pages.freed(freed);
    // A press in the page (a window's ×) while the window's page opens: moved now, the release
    // would find nothing where the press began.
    window.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerId: 1 }));
    expect(pages.host("a", 10, 10)).toBeNull();
    expect(pages.open()).toEqual(["a"]);
    window.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 1 }));
    expect(freed).toHaveBeenCalledTimes(1);
    expect(pages.host("a", 10, 10)).not.toBeNull();
    // No press held: no call.
    window.dispatchEvent(Object.assign(new Event("pointerup"), { pointerId: 2 }));
    expect(freed).toHaveBeenCalledTimes(1);
    pages.dispose();
  });

  it("close a page that goes under its window, its watches' stops run, and open one anew", () => {
    const made = [fakePage(), fakePage()];
    const first = made[0];
    const pages = windowPages(document, layer, () => made.shift() as unknown as Window);
    const stopped: string[] = [];
    pages.watch((id) => () => stopped.push(id));
    pages.host("a", 10, 10);
    // The shell closed it for a page that paints (`popup_room.rs`): its document unloads.
    first?.fire("pagehide");
    expect(stopped).toEqual(["a"]);
    expect(pages.open()).toEqual([]);
    const again = pages.host("a", 10, 10);
    expect(again?.ownerDocument).not.toBe(first?.document);
    expect(pages.open()).toEqual(["a"]);
  });

  it("keep a window in the desk's page once its page went under three times in a minute", () => {
    let clock = 0;
    const opened: ReturnType<typeof fakePage>[] = [];
    const open = vi.fn(() => {
      const made = fakePage();
      opened.push(made);
      return made as unknown as Window;
    });
    const pages = windowPages(document, layer, open, { now: () => clock });
    for (let lost = 1; lost < LOST_LIMIT; lost++) {
      expect(pages.host("a", 10, 10)).not.toBeNull();
      // The shell closed it: it painted nothing (`popup_room.rs`) or stopped (`revive.rs`).
      opened.at(-1)?.fire("pagehide");
      clock += 1000;
    }
    expect(pages.host("a", 10, 10)).not.toBeNull();
    opened.at(-1)?.fire("pagehide");
    expect(pages.host("a", 10, 10)).toBeNull();
    expect(open).toHaveBeenCalledTimes(LOST_LIMIT);
  });

  it("count a page's losses only within a minute, and never the person's own close", () => {
    let clock = 0;
    const opened: ReturnType<typeof fakePage>[] = [];
    const open = vi.fn(() => {
      const made = fakePage();
      opened.push(made);
      return made as unknown as Window;
    });
    const pages = windowPages(document, layer, open, { now: () => clock });
    for (let i = 0; i < LOST_LIMIT * 2; i++) {
      expect(pages.host("a", 10, 10)).not.toBeNull();
      opened.at(-1)?.fire("pagehide");
      clock += LOST_MS / (LOST_LIMIT - 1) + 1;
    }
    expect(pages.host("a", 10, 10), "losses a minute apart keep the page").not.toBeNull();
    for (let i = 0; i < LOST_LIMIT; i++) {
      pages.close("a");
      expect(pages.host("a", 10, 10), "closed with its window, not lost").not.toBeNull();
    }
  });

  it("keep one focus on the desk: a page the focus enters takes it from the desk's page", () => {
    const made = fakePage();
    const pages = windowPages(document, layer, () => made as unknown as Window);
    pages.host("notes", 300, 200);
    const field = document.createElement("input");
    document.body.append(field);
    field.focus();
    expect(document.activeElement).toBe(field);
    made.fire("focusin");
    expect(document.activeElement).toBe(document.body);
    pages.close("notes");
    expect(made.removeEventListener).toHaveBeenCalledWith("focusin", expect.any(Function), true);
  });

  it("leave a window in the page where its popup does not open, asking once for it", () => {
    const open = vi.fn(() => null);
    const pages = windowPages(document, layer, open);
    expect(pages.host("a", 10, 10)).toBeNull();
    expect(pages.host("a", 10, 10)).toBeNull();
    expect(pages.host("b", 10, 10)).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it("open a page as a popup of the window's size", () => {
    const scope = { open: vi.fn(() => null) } as unknown as Window;
    popupOpener(scope)(`${PAGE_NAME}a`, 820.4, 0);
    expect(scope.open).toHaveBeenCalledWith("", `${PAGE_NAME}a`, "popup,width=820,height=1");
  });
});
