// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { fb2 } from "./build/books";
import { cbz } from "./build/comics";
import { disk, file, loadPage, mount } from "./harness";

const COMIC = file("~/Comics/issue.cbz");
const BOOK = file("~/Books/lantern.fb2");
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
}

async function open(store: Record<string, unknown> = {}) {
  const files = { [COMIC.path]: cbz(), [BOOK.path]: fb2() };
  const mounted = await mount({
    handlers: disk(files, store),
    view: (app) =>
      createView(document, {
        moved: (at) => app()?.moved(at),
        zoomed: (zoom) => app()?.zoomed(zoom),
        bookmark: (at, label) => app()?.bookmark(at, label),
        note: (at, text) => app()?.note(at, text),
        forget: (kind, index) => app()?.forget(kind, index),
        unlock: (password) => app()?.unlock(password),
      }),
  });
  return mounted;
}

const kept = (store: Record<string, unknown>) =>
  Object.entries(store).find(([key]) => key.startsWith("file."));

describe("the reader's view", () => {
  beforeEach(() => loadPage(document));

  it("go-to-page moves the counter and the position is kept", async () => {
    const store: Record<string, unknown> = {};
    const { host, settle } = await open(store);
    await host.command("desk.files.visit", COMIC);
    await settle();
    expect(byId("title").textContent).toBe("issue.cbz");
    const at = byId<HTMLInputElement>("page");
    expect(at.value).toBe("1");
    expect(byId("count").textContent).toBe("/ 3");
    expect(document.querySelectorAll("#pages .page")).toHaveLength(3);

    at.value = "3";
    at.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(at.value).toBe("3");
    expect(byId("status").textContent).toBe("Page 3 of 3");
    const [key, value] = kept(store) ?? [];
    expect(key).toMatch(/^file\.[0-9a-f]{16}$/);
    expect(value).toMatchObject({ path: COMIC.path, unit: 2 });
  });

  it("zoom with Mod+= and Mod+- and the buttons; Mod+0 is actual size", async () => {
    const { host, settle } = await open();
    await host.command("desk.files.visit", COMIC);
    await settle();
    byId("doc").focus();
    const zoom = byId("zoom");
    expect(zoom.textContent).toBe("100%");
    const page = document.querySelector<HTMLElement>("#pages .page");
    expect(page?.style.width).toBe("6px");
    expect(press("=", { metaKey: true }).defaultPrevented).toBe(true);
    expect(zoom.textContent).toBe("110%");
    expect(page?.style.width).toBe("6.6px");
    press("-", { ctrlKey: true });
    press("-", { ctrlKey: true });
    expect(zoom.textContent).toBe("90%");
    byId("zoom-in").click();
    expect(zoom.textContent).toBe("100%");
    press("=", { metaKey: true });
    press("0", { metaKey: true });
    expect(zoom.textContent).toBe("100%");
    // Chords the desk binds are never prevented.
    for (const key of ["s", "o", "w", "k"])
      expect(press(key, { metaKey: true }).defaultPrevented).toBe(false);
  });

  it("search with Mod+F and Mod+G moves to the next match, across chapters", async () => {
    const { host, settle } = await open();
    await host.command("desk.files.visit", BOOK);
    await settle();
    expect(byId<HTMLInputElement>("page").value).toBe("1");
    expect(press("f", { metaKey: true }).defaultPrevented).toBe(true);
    const query = byId<HTMLInputElement>("find-text");
    expect(byId("find").hidden).toBe(false);
    expect(document.activeElement).toBe(query);
    query.value = "lantern";
    query.dispatchEvent(new Event("input", { bubbles: true }));
    byId<HTMLFormElement>("find").requestSubmit();
    await settle();
    const root = () => byId("chapter").shadowRoot;
    expect(byId("find-status").textContent).toBe("Chapter 1: match 1 of 2");
    expect(root()?.querySelector("mark.current")?.textContent).toBe("lantern");

    press("g", { metaKey: true });
    await settle();
    expect(byId("find-status").textContent).toBe("Chapter 1: match 2 of 2");
    press("g", { metaKey: true });
    await settle();
    expect(byId<HTMLInputElement>("page").value).toBe("2");
    expect(byId("find-status").textContent).toBe("Chapter 2: match 1 of 1");
    expect(root()?.querySelector("mark.current")?.textContent).toBe("lantern");
    press("g", { metaKey: true, shiftKey: true });
    await settle();
    expect(byId("find-status").textContent).toBe("Chapter 1: match 2 of 2");
    expect(press("Escape").defaultPrevented).toBe(true);
    expect(byId("find").hidden).toBe(true);
  });

  it("a bookmark and a note are kept under the file and come back on the next visit", async () => {
    const store: Record<string, unknown> = {};
    const first = await open(store);
    await first.host.command("desk.files.visit", COMIC);
    await first.settle();
    const at = byId<HTMLInputElement>("page");
    at.value = "2";
    at.dispatchEvent(new Event("change", { bubbles: true }));
    byId("bookmark").click();
    await first.settle();
    byId("add-note").click();
    const text = byId<HTMLTextAreaElement>("note-text");
    expect(document.activeElement).toBe(text);
    text.value = "Check the colours";
    byId<HTMLFormElement>("note-form").requestSubmit();
    await first.settle();
    const [, value] = kept(store) ?? [];
    expect(value).toMatchObject({
      path: COMIC.path,
      bookmarks: [expect.objectContaining({ unit: 1, label: "Page 2" })],
      notes: [expect.objectContaining({ unit: 1, text: "Check the colours" })],
    });
    at.value = "3";
    at.dispatchEvent(new Event("change", { bubbles: true }));
    await first.settle();
    await first.host.command("desk.buffers.closed", COMIC);

    loadPage(document);
    const second = await open(store);
    await second.host.command("desk.files.visit", COMIC);
    await second.settle();
    expect(byId<HTMLInputElement>("page").value).toBe("3");
    byId("contents-toggle").click();
    byId("tab-bookmarks").click();
    expect(byId("bookmarks").textContent).toContain("Page 2");
    byId("tab-notes").click();
    expect(byId("notes").textContent).toContain("Check the colours");
    const go = [...byId("bookmarks").querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Page 2"),
    );
    go?.click();
    await second.settle();
    expect(byId<HTMLInputElement>("page").value).toBe("2");
  });
});
