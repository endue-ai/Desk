// The Browser's behaviour (ui/browser.js) on a fake desk: the page it opens on, the view it opens
// and places, what the toolbar hears from web.changed, the permission it asks for once, and what a
// sleep keeps.
import { describe, expect, it } from "vitest";
import { createBrowser } from "../ui/browser.js";
import { fakeDesk, recordingView, settle } from "./harness";

const SCOPE = { permission: "web:browse" };
const HOME = { settings: { home: "https://home.example/" } };

async function started(options: Parameters<typeof fakeDesk>[0] = HOME) {
  const desk = fakeDesk(options);
  const view = recordingView();
  const app = createBrowser(desk, view);
  await app.start();
  return { desk, view, app };
}

describe("the Browser", () => {
  it("opens a view on its home page, places it under the toolbar and gives it the keys", async () => {
    const { desk, view } = await started();
    expect(desk.of("web.open")).toEqual([{ url: "https://home.example/", scope: SCOPE }]);
    expect(desk.of("web.place")).toEqual([{ viewId: "w-1", x: 0, y: 41, width: 800, height: 559 }]);
    expect(desk.of("web.focus")).toEqual([{ viewId: "w-1" }]);
    expect(view.shown.at(-1)).toMatchObject({ url: "https://home.example/", loading: true });
  });

  it("reads its home from its own setting, then init.yaml, then the default; empty opens none", async () => {
    const init = await started({ init: { "endue.browser.home": "init.example" } });
    expect(init.desk.of("web.open")[0]?.url).toBe("https://init.example/");
    const none = await started({});
    expect(none.desk.of("web.open")[0]?.url).toBe("https://endue.ai/");
    const empty = await started({ settings: { home: "" } });
    expect(empty.desk.of("web.open")).toEqual([]);
    expect(empty.view.shown.at(-1)).toMatchObject({ url: "", loading: false });
  });

  it("comes back from a sleep on the address it showed", async () => {
    const { desk, app } = await started({ ...HOME, restored: { url: "https://kept.example/a" } });
    expect(desk.of("web.open")[0]?.url).toBe("https://kept.example/a");
    desk.changed({
      viewId: "w-1",
      url: "https://kept.example/b",
      title: "B",
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    expect(app.kept()).toEqual({ url: "https://kept.example/b" });
  });

  it("loads what is typed in the view it has, searching for words", async () => {
    const { desk, app } = await started();
    await app.go("docs.example.com/guide");
    await app.go("two words");
    expect(desk.of("web.load")).toEqual([
      { viewId: "w-1", url: "https://docs.example.com/guide", scope: SCOPE },
      { viewId: "w-1", url: "https://duckduckgo.com/?q=two%20words", scope: SCOPE },
    ]);
    expect(desk.of("web.open")).toHaveLength(1);
    await app.go("   ");
    expect(desk.of("web.load")).toHaveLength(2);
  });

  it("runs loads one at a time: a second one waits for the view the first opens", async () => {
    const desk = fakeDesk({ settings: { home: "" } });
    const app = createBrowser(desk, recordingView());
    await app.start();
    await Promise.all([app.go("a.example"), app.go("b.example")]);
    expect(desk.of("web.open")).toEqual([{ url: "https://a.example/", scope: SCOPE }]);
    expect(desk.of("web.load")).toEqual([
      { viewId: "w-1", url: "https://b.example/", scope: SCOPE },
    ]);
  });

  it("shows what its view says: the address, the load and where the history can go", async () => {
    const { desk, view } = await started();
    desk.changed({
      viewId: "w-1",
      url: "https://home.example/next",
      title: "Next",
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    expect(view.shown.at(-1)).toMatchObject({
      url: "https://home.example/next",
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    // Another view's change is not this window's; an address refused is said.
    const before = view.shown.length;
    desk.changed({
      viewId: "w-9",
      url: "https://other.example/",
      title: "",
      loading: true,
      canGoBack: false,
      canGoForward: false,
    });
    expect(view.shown).toHaveLength(before);
    desk.changed({
      viewId: "w-1",
      url: "https://home.example/next",
      title: "Next",
      loading: false,
      canGoBack: true,
      canGoForward: false,
      refused: "https://away.example/",
    });
    expect(view.notes.at(-1)).toBe("The Browser may not go to https://away.example/.");
  });

  it("steps through the history, loads again and stops in its view", async () => {
    const { desk, app } = await started();
    app.back();
    app.forward();
    app.reload();
    app.stop();
    await settle();
    expect(desk.of("web.go").map((p) => p.to)).toEqual(["back", "forward", "reload", "stop"]);
  });

  it("tells the desk its box only when it changed", async () => {
    const { desk, view, app } = await started();
    await app.place();
    expect(desk.of("web.place")).toHaveLength(1);
    view.at = { x: 0, y: 41, width: 1024, height: 700 };
    await app.place();
    expect(desk.of("web.place").at(-1)).toEqual({
      viewId: "w-1",
      x: 0,
      y: 41,
      width: 1024,
      height: 700,
    });
  });

  it("asks for web:browse once when it does not hold it, and says so when it is refused", async () => {
    const allowed = await started({ ...HOME, granted: false });
    expect(allowed.desk.asked).toEqual(["To show web pages"]);
    expect(allowed.desk.of("web.open")).toHaveLength(2);
    expect(allowed.desk.of("web.place")).toHaveLength(1);
    const refused = await started({ ...HOME, granted: false, allow: false });
    expect(refused.desk.of("web.place")).toEqual([]);
    expect(refused.view.notes.at(-1)).toMatch(/may not show web pages/);
    expect(refused.view.shown.at(-1)).toMatchObject({
      url: "https://home.example/",
      loading: false,
    });
  });

  it("says a window out of the canvas shows no page, and opens anew once its view has gone", async () => {
    const out = await started({ ...HOME, fail: { "web.open": "unsupported" } });
    expect(out.view.notes.at(-1)).toMatch(/shows in the desk only/);
    const { desk, app } = await started();
    desk.changed({
      viewId: "w-1",
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
      closed: true,
    });
    app.reload();
    await settle();
    expect(desk.of("web.open").map((p) => p.url)).toEqual([
      "https://home.example/",
      "https://home.example/",
    ]);
    app.close();
    expect(desk.of("web.close")).toEqual([{ viewId: "w-2" }]);
  });
});
