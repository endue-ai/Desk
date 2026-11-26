// The desk's assistant reads and operates the Browser's page (ADR 0272): the commands it is
// offered (endue.browser.read, scroll, click, type, key, select, back) run here as it runs them,
// against a page served on this machine. Each answers the page as it reads afterwards, so the
// spec sees what the real page made of each act: the text with its elements named, a scroll
// that moved, text typed as a person's (the page's own input handler heard it), Enter sent, a
// press of the pointer the page trusts, a choice, a link followed and the way back.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { $, browser, expect } from "@wdio/globals";
import { serve } from "../../examples/brain-echo/server.mjs";
import { inputState } from "../support/compositor";
import { MODE, press, shellReady, waitForData } from "../support/desk";
import { call, run, windowUntil } from "../support/windows";

const BROWSER = "endue.browser";

const PAGES: Record<string, string> = {
  "/": `<!doctype html><title>Shop</title><body style="margin:8px;font:14px sans-serif">
<h1>Shop</h1>
<p><a id="next" href="/b">to B</a></p>
<p><label for="q">Search</label> <input id="q" value="old"> <span id="echo"></span></p>
<p><button id="count">Press</button></p>
<p><select id="size" aria-label="Size"><option>Small</option><option>Large</option></select>
<span id="chosen"></span></p>
<p><button style="display:flex"><span>Open</span><span>menu</span><span hidden>now</span></button></p>
<p hidden>not shown</p>
<p id="long">${"A page long enough to be read a part at a time. ".repeat(8)}</p>
<div style="height:3000px"></div><p id="end">The end</p>
<script>
let presses = 0;
q.addEventListener("input", () => (echo.textContent = "heard " + q.value));
q.addEventListener("keydown", (e) => { if (e.key === "Enter") document.title = "Sent " + q.value; });
size.addEventListener("change", () => (chosen.textContent = "chose " + size.value));
count.addEventListener("click", (e) => {
  count.textContent = (e.isTrusted ? "Pressed " : "Scripted ") + ++presses;
});
</script>`,
  "/b": `<!doctype html><title>Page B</title><body><p>B</p><a href="/">home</a>`,
  "/form": `<!doctype html><title>Fixture form</title>
    <form method="post" action="/posted"><button>Send fixture</button></form>`,
  "/posted": `<!doctype html><title>Fixture posted</title><p>The form was sent.</p>`,
};

interface Page {
  url: string;
  title: string;
  text: string;
  from: number;
  length: number;
  more?: number;
  moved?: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  scroll: { x: number; y: number; width: number; height: number; pageHeight: number };
}

const does = (command: string, args?: Record<string, unknown>) =>
  run(`endue.browser.${command}`, args) as Promise<Page>;

/** The ref the page's text gives the element written `[ref <what>`. */
function ref(page: Page, what: string): string {
  const at = page.text.indexOf(` ${what}`);
  const found = /\[(e\d+)$/.exec(page.text.slice(0, Math.max(at, 0)));
  if (at < 0 || !found) throw new Error(`the page names no ${what}:\n${page.text}`);
  return found[1] as string;
}

describe("the Browser, read and operated by the desk's assistant (ADR 0272)", () => {
  let server: Server;
  let echo: Server;
  let posts = 0;
  let origin = "";
  let page: Page;

  before(async () => {
    server = createServer((req, res) => {
      const path = new URL(req.url ?? "/", "http://x").pathname;
      if (path === "/posted" && req.method === "POST") posts++;
      req.resume();
      const body = PAGES[path];
      res.writeHead(body ? 200 : 404, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
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
    echo?.close();
  });

  it("goes to an address and answers the page as text, its elements named", async () => {
    page = await does("go", { url: `${origin}/` });
    expect(page).toMatchObject({ url: `${origin}/`, title: "Shop", from: 0 });
    expect(page.text.split("\n").slice(0, 5)).toEqual([
      "# Shop",
      `[${ref(page, 'link "to B"')} link "to B"]`,
      `Search [${ref(page, 'field "Search"')} field "Search" = "old"]`,
      `[${ref(page, 'button "Press"')} button "Press"]`,
      `[${ref(page, 'select "Size"')} select "Size" = "Small" of "Small", "Large"]`,
    ]);
    // A name is what the element shows: its parts side by side stay apart, a hidden one is left out.
    expect(page.text).toContain('button "Open menu"]');
    expect(page.text).toContain("The end");
    expect(page.text).not.toContain("not shown");
    expect(page.scroll.y).toBe(0);
    expect(page.scroll.pageHeight).toBeGreaterThan(3000);
    // Reading again names the same elements the same.
    expect((await does("read")).text).toBe(page.text);
    expect(await does("read", { from: 2, chars: 200 })).toMatchObject({ from: 2, more: 202 });
  });

  it("scrolls the page, and says when there is nowhere further to go", async () => {
    const down = await does("scroll", { to: "down" });
    expect(down.moved).toBe(true);
    expect(down.scroll.y).toBeGreaterThan(0);
    expect(down.scroll.y).toBeLessThan(down.scroll.height);
    const bottom = await does("scroll", { to: "bottom" });
    expect(bottom.scroll.y).toBe(bottom.scroll.pageHeight - bottom.scroll.height);
    expect((await does("scroll", { to: "down" })).moved).toBe(false);
    const shown = await does("scroll", { ref: ref(page, 'button "Press"') });
    expect(shown.scroll.y).toBeLessThan(bottom.scroll.y);
    expect((await does("scroll", { to: "top" })).scroll.y).toBe(0);
  });

  it("types into a field as a person does, and sends it with Enter", async () => {
    const keys = (await inputState()).focused;
    const field = ref(page, 'field "Search"');
    const typed = await does("type", { ref: field, text: "figs 무화과" });
    expect(typed.text).toContain(`field "Search" = "figs 무화과"] heard figs 무화과`);
    const more = await does("type", { ref: field, text: "!", replace: false });
    expect(more.text).toContain("heard figs 무화과!");
    const sent = await does("type", { ref: field, text: "pears", submit: true });
    expect(sent.title).toBe("Sent pears");
    // The desk's keys stayed where the person had them.
    expect((await inputState()).focused).toBe(keys);
  });

  it("presses a key where the page has the keys", async () => {
    await does("type", { ref: ref(page, 'field "Search"'), text: "kiwi" });
    const pressed = await does("key", { key: "Enter" });
    expect(pressed.title).toBe("Sent kiwi");
    const erased = await does("key", { key: "Backspace" });
    expect(erased.text).toContain("heard kiw");
  });

  it("presses a button with the pointer, which the page trusts", async () => {
    const pressed = await does("click", { ref: ref(page, 'button "Press"') });
    expect(pressed.text).toContain('button "Pressed 1"]');
    const again = await does("click", { ref: ref(pressed, 'button "Pressed 1"') });
    expect(again.text).toContain('button "Pressed 2"]');
  });

  it("chooses an option of a list", async () => {
    const list = ref(page, 'select "Size"');
    const chosen = await does("select", { ref: list, option: "Large" });
    expect(chosen.text).toContain('select "Size" = "Large" of "Small", "Large"] chose Large');
    await expect(does("select", { ref: list, option: "Huge" })).rejects.toThrow(/no option/);
    await expect(does("type", { ref: list, text: "x" })).rejects.toThrow(/not a field/);
  });

  it("follows a link it clicks, and goes back", async () => {
    const there = await does("click", { ref: ref(page, 'link "to B"') });
    expect(there).toMatchObject({ url: `${origin}/b`, title: "Page B" });
    expect(there.text).toMatch(/^B\n\[e\d+ link "home"\]$/);
    // The page it left named its elements; this one names its own.
    await expect(does("click", { ref: "e999" })).rejects.toThrow(/no element e999/);
    const back = await does("back");
    expect(back).toMatchObject({ url: `${origin}/`, title: "Shop" });
    expect(back.text).toContain('button "Press"]');
  });

  it("moves, finds and zooms, and follows a link's address without a click", async () => {
    const from = await does("read");
    const found = await does("find", { text: "The end" });
    expect(found.scroll.y).toBeGreaterThan(from.scroll.y);
    const zoomed = await does("zoom", { level: 1.25 });
    expect(zoomed.scroll.width).toBeLessThan(found.scroll.width);
    await does("zoom", { level: 1 });
    await does("navigate-key", { key: "Tab" });
    const there = await does("follow", { ref: ref(from, 'link "to B"') });
    expect(there).toMatchObject({
      url: `${origin}/b`,
      loading: false,
      canGoBack: true,
      canGoForward: false,
    });
    expect(await does("stop")).toMatchObject({ url: there.url, loading: false });
  });

  it("holds native reload and history steps that can resend a submitted form", async () => {
    echo = await serve({ port: 18788, delayMs: 0 });
    const brains = `${MODE} [data-popover=brain]`;
    if (!(await $(brains).isExisting())) await press(`${MODE} [data-key=rail-brain]`);
    await press(`${brains} [data-key=brain-echo]`);
    await waitForData(
      "settings.json",
      (value) => (value as { desk?: Record<string, unknown> })?.desk?.["brain.use"] === "echo",
      "the echo brain is selected",
    );
    if (await $(brains).isExisting()) await press(`${MODE} [data-key=rail-brain]`);
    const scope = { permission: "perm:manage" };
    const pending = async () => {
      const { approvals } = (await call("perm.pending", { scope })) as {
        approvals: Array<{
          action: string;
          approvalId: string;
          task?: string;
          preview?: { text: string };
        }>;
      };
      return approvals.find((card) => card.action === "web.act");
    };
    const held = async (step: string, copies: number) => {
      const sent = await browser.execute((line) => {
        const input = document.querySelector<HTMLInputElement>("#composer-input");
        if (!input) return false;
        input.focus();
        input.value = line;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        for (const key of ["ArrowUp", "Enter"])
          input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        return true;
      }, `tool endue_browser_${step} as mira: {}`);
      expect(sent).toBe(true);
      await browser.waitUntil(async () => Boolean(await pending()), {
        timeout: 10_000,
        timeoutMsg: `${step} did not ask to resend the form`,
      });
      const card = await pending();
      expect(JSON.parse(card?.preview?.text ?? "{}")).toMatchObject({
        to: step,
        url: `${origin}/posted`,
        mayResendForm: true,
      });
      expect(card?.task).toBeUndefined();
      expect(posts).toBe(copies);
      await call("perm.approve", { scope, approvalId: card?.approvalId, answer: "deny" });
      await browser.waitUntil(
        async () =>
          !(await pending()) &&
          (await browser.execute(
            () => document.querySelector<HTMLElement>(".eris")?.dataset.state,
          )) !== "thinking",
        { timeout: 10_000 },
      );
      expect(posts).toBe(copies);
    };
    const post = async () => {
      const form = await does("go", { url: `${origin}/form` });
      const posted = await does("click", { ref: ref(form, 'button "Send fixture"') });
      expect(posted.title).toBe("Fixture posted");
    };
    await post();
    await held("reload", 1);
    expect((await does("back")).title).toBe("Fixture form");
    await held("forward", 1);
    await post();
    await does("go", { url: `${origin}/b` });
    await held("back", 2);
  });
});
