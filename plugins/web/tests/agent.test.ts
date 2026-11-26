// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { denied, disk, file, mount } from "./harness";

const PAGE = file("~/Saved/page.html");
const LINK = file("~/Saved/item.url");
const FEED = file("~/Saved/feed.rss");
const OUTLINE = file("~/Saved/subscriptions.opml");
const FILES = {
  [PAGE.path]: `<p>First 🪴</p><p hidden>hidden text</p><p>Second</p>
    <script>document.body.textContent = "script ran";</script>
    <img src="https://example.com/remote.png"><iframe src="https://example.com/frame"></iframe>`,
  [LINK.path]: "[InternetShortcut]\nURL=https://example.com/saved\n",
  [FEED.path]: `<rss version="2.0"><channel><title>Fixtures</title>
    <item><title>One</title><link>https://example.com/one</link></item>
    <item><title>Two</title><description>Saved entry text</description></item>
    </channel></rss>`,
  [OUTLINE.path]: `<opml version="2.0"><head><title>Sources</title></head><body>
    <outline text="Example" xmlUrl="https://example.com/feed"/></body></opml>`,
};

describe("reading saved web files through commands", () => {
  it("reads visible text in slices without rendering or fetching resources", async () => {
    const { host, params } = await mount({ handlers: disk(FILES) });
    await host.command("desk.files.visit", PAGE);
    expect(await host.command("endue.web.read", { chars: 7 })).toMatchObject({
      source: "saved-web-content",
      kind: "page",
      text: "First 🪴",
      from: 0,
      more: 7,
    });
    const tail = await host.command("endue.web.read", { from: 7 });
    expect(tail).toMatchObject({ text: "\nSecond" });
    expect(params("fs.read")).toHaveLength(2);
    expect(params("shell.open")).toEqual([]);
  });

  it("names a saved link without opening it and refuses an ungranted file quietly", async () => {
    const reads = disk(FILES);
    const { host, view, params } = await mount({
      handlers: {
        ...reads,
        "fs.read": (input, caller) => {
          const read = reads["fs.read"];
          if (input.path === PAGE.path || !read) throw denied("saved file");
          return read(input, caller);
        },
      },
    });
    expect(await host.command("endue.web.read", { path: LINK.path })).toMatchObject({
      kind: "card",
      url: "https://example.com/saved",
    });
    await expect(host.command("endue.web.read", { path: PAGE.path })).rejects.toThrow(
      "Not allowed to read",
    );
    expect(view.shown.at(-1)).toBeNull();
    expect(params("perm.request")).toEqual([]);
    expect(params("shell.open")).toEqual([]);
  });

  it("lists feed entries, reads an exact entry, and reads an outline as saved content", async () => {
    const { host, view } = await mount({ handlers: disk(FILES) });
    await host.command("desk.files.visit", FEED);
    expect(await host.command("endue.web.read")).toMatchObject({
      source: "saved-web-content",
      kind: "entries",
      entries: [
        { index: 0, title: "One", link: "https://example.com/one" },
        { index: 1, title: "Two" },
      ],
    });
    expect(await host.command("endue.web.entry", { index: 1 })).toMatchObject({
      source: "saved-web-content",
      index: 1,
      title: "Two",
      text: "Saved entry text",
    });
    await expect(host.command("endue.web.entry", { index: 2 })).rejects.toThrow(/entry/i);
    expect(await host.command("endue.web.read", { path: OUTLINE.path })).toMatchObject({
      kind: "outline",
      text: "Example — https://example.com/feed",
    });
    expect(view.shown.at(-1)?.path).toBe(FEED.path);
  });
});
