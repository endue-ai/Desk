// The Browser shows a live web page in a desk window (#273, ADR 0216): the page is a web view of
// the desk's, a browser of its own the compositor draws over the plugin's surface. The spec serves
// two pages on this machine and drives them as a person does, through the compositor's input: the
// page shows, a link in it is followed and the address field follows, back returns and paints,
// what is typed into a field of the page arrives, and the page has nothing of the desk in it.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "@wdio/globals";
import {
  feed,
  inputState,
  inSurface,
  keyPress,
  pointIn,
  shellCommand,
} from "../support/compositor";
import { shellReady } from "../support/desk";
import { run, windowUntil } from "../support/windows";

const BROWSER = "endue.browser";
const HOST = "main.endue-browser";
const WEB = `web:${HOST}`;

const PAGES: Record<string, string> = {
  "/": `<!doctype html><title>Page A</title><body style="margin:8px;font:14px sans-serif">
<a id="next" href="/b">to B</a> <input id="field" size="8"><span id="echo"></span>
<script>field.addEventListener("input", () => (echo.textContent = field.value));</script>`,
  "/b": `<!doctype html><title>Page B</title><body style="margin:8px;font:14px sans-serif">B`,
};

type Web = Record<string, { counts: { paints: number }; texture: number[] | null }>;
const web = async () => (await shellCommand<{ web: Web }>("compositor_stats")).web;

/** The window handle the web view's page was last found at: a look through every page takes seconds. */
let found: string | undefined;

/** Evaluate `expression` in the web view's page (the one served from `origin`), then go back. */
async function inPage<T>(origin: string, expression: string): Promise<T> {
  const main = await browser.getWindowHandle();
  const its = async (handle: string) => {
    try {
      await browser.switchToWindow(handle);
      return (await browser.getUrl()).startsWith(origin);
    } catch {
      return false;
    }
  };
  try {
    if (found === undefined || !(await its(found))) {
      found = undefined;
      for (const handle of await browser.getWindowHandles()) {
        if (handle === main || !(await its(handle))) continue;
        found = handle;
        break;
      }
    }
    if (found === undefined) throw new Error(`no page of ${origin}`);
    return (await browser.execute(`return (${expression})`)) as T;
  } finally {
    await browser.switchToWindow(main);
  }
}

/** The middle of an element as a point of its page. */
const middle = (id: string) =>
  `(() => { const r = document.getElementById("${id}").getBoundingClientRect();
    return [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]; })()`;

const click = async (at: [number, number]) => {
  const button = (pressed: boolean) => ({ type: "pointerButton", button: "left", pressed });
  await feed([{ type: "pointerMoved", x: at[0], y: at[1] }, button(true)]);
  await feed([button(false)]);
};

describe("the Browser: a live web page in a desk window (#273)", () => {
  let server: Server;
  let origin = "";

  /** Where a point of the web page is in the app window: under the plugin's toolbar. */
  async function inWeb(id: string): Promise<[number, number]> {
    const [px, py] = await inPage<[number, number]>(origin, middle(id));
    const [bx, by] = await inSurface<[number, number]>(
      HOST,
      middle("page").replace(
        "[Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)]",
        "[Math.round(r.x), Math.round(r.y)]",
      ),
    );
    const at = await pointIn(HOST, [bx + px, by + py]);
    if (!at) throw new Error(`${id} is covered`);
    return at;
  }

  const address = () => inSurface<string>(HOST, `document.getElementById("address").value`);
  const title = () => inPage<string>(origin, "document.title");

  before(async () => {
    server = createServer((req, res) => {
      const body = PAGES[new URL(req.url ?? "/", "http://x").pathname];
      res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
      res.end(body ?? "");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await shellReady();
    await run("desk.plugins.open", { plugin: BROWSER });
    await windowUntil(BROWSER, (w) => w.focused === true, "the Browser's window is in use");
  });

  after(() => {
    server?.close();
  });

  it("shows the page it is sent to, in a view of its own with nothing of the desk", async () => {
    expect(await web()).toEqual({});
    await run("endue.browser.go", { url: `${origin}/` });
    await browser.waitUntil(async () => (await web())[WEB]?.texture != null, {
      timeoutMsg: "the view never painted",
    });
    await browser.waitUntil(async () => (await address()) === `${origin}/`);
    expect(await title()).toBe("Page A");
    expect(await inPage<string>(origin, "typeof globalThis.__deskNative")).toBe("undefined");
    // The view lies under the toolbar, as large as the box the plugin gave.
    const box = await inSurface<number[]>(
      HOST,
      `(() => {
      const r = document.getElementById("page").getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)]; })()`,
    );
    expect(await inPage<number[]>(origin, "[innerWidth, innerHeight]")).toEqual(box);
  });

  it("follows a link pressed in the page, and the address field follows", async () => {
    await click(await inWeb("next"));
    await browser.waitUntil(async () => (await address()) === `${origin}/b`, {
      timeoutMsg: "the address field did not follow the link",
    });
    expect(await title()).toBe("Page B");
    // The press gave the page the keys, and its window's own page heard it too.
    const state = await inputState();
    expect(state.focused).toBe(WEB);
    expect(state.pointer.hearing[0]).toBe(WEB);
  });

  it("goes back from the toolbar, and the page it returns to paints", async () => {
    const before = (await web())[WEB]?.counts.paints ?? 0;
    const back = await inSurface<[number, number]>(HOST, middle("back"));
    const at = await pointIn(HOST, back);
    expect(at).toBeDefined();
    await click(at as [number, number]);
    await browser.waitUntil(async () => (await address()) === `${origin}/`, {
      timeoutMsg: "back did not return to the first page",
    });
    expect(await title()).toBe("Page A");
    await browser.waitUntil(async () => ((await web())[WEB]?.counts.paints ?? 0) > before, {
      timeoutMsg: "the page it returned to never painted",
    });
    // The press on the toolbar took the keys back to the plugin.
    expect((await inputState()).focused).toBe(HOST);
  });

  it("types into a field of the page", async () => {
    await click(await inWeb("field"));
    await browser.waitUntil(async () => (await inputState()).focused === WEB);
    for (const [key, code] of [
      ["h", "KeyH"],
      ["i", "KeyI"],
    ] as const) {
      await feed(keyPress(key, code, key));
      await browser.pause(60);
    }
    await browser.waitUntil(
      async () =>
        (await inPage<string>(origin, `document.getElementById("echo").textContent`)) === "hi",
      { timeoutMsg: "what was typed did not reach the page" },
    );
  });

  it("ends its view with its window", async () => {
    await run("desk.windows.close", { window: BROWSER });
    await browser.waitUntil(async () => Object.keys(await web()).length === 0, {
      timeoutMsg: "the view outlived its window",
    });
  });
});
