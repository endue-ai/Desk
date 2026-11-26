// What the desk's assistant does in the Browser (ui/agent.js) on a fake desk: it reads the page
// and acts in it through web.read and web.act under web:control, asked for once; each act
// answers the page as it reads afterwards; a long page comes in parts; and a load or a step of
// the history, which are the person's commands too, asks for nothing.
import { describe, expect, it } from "vitest";
import { CHARS, createAgent } from "../ui/agent.js";
import { createBrowser } from "../ui/browser.js";
import { fakeDesk, PAGE, recordingView } from "./harness";

const SCOPE = { permission: "web:control" };
const REST = { quiet: 0, most: 50 };
const LOADED = {
  viewId: "w-1",
  url: "https://home.example/",
  title: "Home",
  loading: false,
  canGoBack: true,
  canGoForward: false,
};

async function started(options: Parameters<typeof fakeDesk>[0] = {}) {
  const desk = fakeDesk({ settings: { home: "https://home.example/" }, ...options });
  const app = createBrowser(desk, recordingView());
  await app.start();
  desk.changed(LOADED);
  return { desk, app, agent: createAgent(desk, app, REST) };
}

describe("the assistant in the Browser", () => {
  it("reads the page the window shows, a part at a time", async () => {
    const { desk, agent } = await started({ page: { length: 9000 } });
    const page = await agent.read();
    expect(desk.of("web.read")).toEqual([{ viewId: "w-1", from: 0, max: CHARS, scope: SCOPE }]);
    expect(page).toMatchObject({ url: PAGE.url, title: "Home", text: PAGE.text, length: 9000 });
    // The text went on: `more` is where the next part starts.
    expect(page.more).toBe(Array.from(PAGE.text).length);
    await agent.read({ from: 4000, chars: 999999 });
    expect(desk.of("web.read")[1]).toEqual({ viewId: "w-1", from: 4000, max: 20000, scope: SCOPE });
  });

  it("says nothing of more when the part is the whole text", async () => {
    const { agent } = await started({ page: { length: Array.from(PAGE.text).length } });
    expect(await agent.read()).not.toHaveProperty("more");
  });

  it("scrolls, and answers the page with whether it moved", async () => {
    const { desk, agent } = await started({ acted: { moved: false } });
    const page = await agent.scroll({ to: "down", pages: 0.5 });
    await agent.scroll({});
    await agent.scroll({ ref: "e12" });
    expect(desk.of("web.act").map((p) => p.action)).toEqual([
      { do: "scroll", to: "down", pages: 0.5 },
      { do: "scroll", to: "down" },
      { do: "show", ref: "e12" },
    ]);
    expect(page).toMatchObject({ moved: false, title: "Home", scroll: PAGE.scroll });
  });

  it("clicks, types, presses a key and chooses, each by the ref the page gave", async () => {
    const { desk, agent } = await started();
    await agent.click({ ref: "e3" });
    await agent.type({ ref: "e2", text: "서울 날씨", submit: true });
    await agent.type({ text: " more", replace: false });
    await agent.key({ key: "Escape" });
    await agent.select({ ref: "e7", option: "한국어" });
    expect(desk.of("web.act")).toEqual([
      { viewId: "w-1", action: { do: "press", ref: "e3" }, scope: SCOPE },
      {
        viewId: "w-1",
        action: { do: "type", text: "서울 날씨", ref: "e2", submit: true },
        scope: SCOPE,
      },
      { viewId: "w-1", action: { do: "type", text: " more", replace: false }, scope: SCOPE },
      { viewId: "w-1", action: { do: "key", key: "Escape" }, scope: SCOPE },
      { viewId: "w-1", action: { do: "choose", ref: "e7", option: "한국어" }, scope: SCOPE },
    ]);
    // Each act is followed by a read of what came of it.
    expect(desk.of("web.read")).toHaveLength(5);
  });

  it("hands the core the agent's invocation only for reviewed page actions", async () => {
    const { desk, agent } = await started();
    const invocation = { caller: "agent:eris", invocationId: "i-7" };
    await agent.click({ ref: "e1" }, invocation);
    await agent.click({ ref: "e1" }, { ...invocation, caller: "desk" });
    await agent.scroll({ to: "bottom" });
    expect(desk.of("web.act").map((p) => p.invocationId)).toEqual(["i-7", undefined, undefined]);
    expect(desk.of("web.read").every((p) => p.invocationId === undefined)).toBe(true);
  });

  it("waits for the page an act loads before it reads", async () => {
    const { desk, agent } = await started();
    let read = false;
    const clicked = agent.click({ ref: "e1" }).then((page) => {
      read = true;
      return page;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    desk.changed({ ...LOADED, loading: true, url: "https://home.example/docs" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(read, "the page still loads").toBe(false);
    desk.changed({ ...LOADED, url: "https://home.example/docs", title: "Docs" });
    await clicked;
    expect(desk.of("web.read")).toHaveLength(1);
  });

  it("asks for web:control once, and says so when the person refuses", async () => {
    const { desk, agent } = await started({ control: false });
    await agent.read();
    await agent.scroll({ to: "bottom" });
    expect(desk.asked).toEqual(["To read and operate the web page for you"]);
    const refused = await started({ control: false, allow: false });
    await expect(refused.agent.click({ ref: "e1" })).rejects.toThrow(/did not allow/);
    expect(refused.desk.of("web.act")).toHaveLength(1);
  });

  it("goes to an address and steps through the history, answering the page it led to", async () => {
    const { desk, agent } = await started();
    const page = await agent.go({ url: "docs.example.com" });
    desk.changed(LOADED);
    expect(desk.of("web.load")[0]).toMatchObject({ url: "https://docs.example.com/" });
    expect(page).toMatchObject({ title: "Home", text: PAGE.text });
    await agent.back();
    await agent.forward();
    await agent.reload();
    expect(desk.of("web.go").map((p) => p.to)).toEqual(["back", "forward", "reload"]);
  });

  it("asks for nothing when the person loads or steps: the page is named, not read", async () => {
    const { desk, agent } = await started({ control: false });
    expect(await agent.reload()).toEqual({ url: "https://home.example/", title: "Home" });
    expect(await agent.back()).toEqual({ url: "https://home.example/", title: "Home" });
    expect(desk.asked).toEqual([]);
  });

  it("says there is no page when the window shows none", async () => {
    const desk = fakeDesk({ settings: { home: "" } });
    const app = createBrowser(desk, recordingView());
    await app.start();
    const agent = createAgent(desk, app, REST);
    await expect(agent.read()).rejects.toThrow(/shows no page/);
    await expect(agent.scroll({ to: "down" })).rejects.toThrow(/shows no page/);
    expect(desk.of("web.read")).toEqual([]);
  });
});
