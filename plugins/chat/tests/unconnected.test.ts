// @vitest-environment jsdom
// Chat with no account connected (#160, QA 06 #19). The layout tabs and the navigation act on chats,
// so they are out of the page until there are some: hidden by `visibility` they kept their room, a
// 330 px hole beside the title and a band above the empty state's words, and at the first window
// size (400 px) the page laid out 633 px wide, its search and refresh past the edge (at the tile size,
// 203 px, the bar alone still made it 290 px). The empty state leads to connecting an account when
// an installed connector brings messages, as Projects does.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { installed } from "./harness";
import { drawn, loadPage } from "./page";

const byId = (id: string) => {
  const found = document.getElementById(id);
  if (!found) throw new Error(`no #${id}`);
  return found;
};
const displayed = (id: string) => getComputedStyle(byId(id)).display !== "none";
const connectButton = () => document.querySelector<HTMLButtonElement>("#main [data-act=connect]");
/** Every element the page draws that holds its room while it shows nothing. */
const invisible = () =>
  [...document.body.querySelectorAll<HTMLElement>("*")]
    .filter((el) => getComputedStyle(el).visibility === "hidden")
    .map((el) => el.id || el.className);

const SLACK = installed(["acme.slack", "Slack", ["message"]]);
const OPENS = { "desk.connectors.open": () => ({ ok: true }) };
const LAYOUTS = ["conversation", "inbox", "timeline", "columns"];

beforeEach(() => loadPage(document, { styles: true }));

describe("Chat without a connector", () => {
  it("draws no layouts and no navigation before it knows whether an account is connected", () => {
    createView(document, {} as Parameters<typeof createView>[1]);
    expect(document.body.dataset.connected).toBeUndefined();
    expect(displayed("layouts")).toBe(false);
    expect(displayed("nav")).toBe(false);
    expect(displayed("search")).toBe(true);
    expect(displayed("refresh")).toBe(true);
  });

  it("keeps the layouts and the navigation out of the page, not just out of sight", async () => {
    await drawn({ items: [], handlers: installed(["desk.github", "GitHub", ["task"]]) });
    expect(document.body.dataset.connected).toBe("false");
    expect(displayed("layouts")).toBe(false);
    expect(displayed("nav")).toBe(false);
    expect(invisible()).toEqual([]);
    // The main area takes the navigation's column too.
    expect(getComputedStyle(byId("main")).gridColumn).toBe("1 / -1");
    expect(byId("main").textContent).toBe("No installed connector brings messages yet.");
    // Nothing installed can bring messages: nothing to connect, as in Projects and views.
    expect(connectButton()).toBeNull();
  });

  it("offers to connect an account in every layout, which opens the connectors that bring messages", async () => {
    const m = await drawn({ items: [], handlers: SLACK, commands: OPENS });
    for (const layout of LAYOUTS) {
      await m.app.command("endue.chat.layout", { layout });
      expect(byId("main").textContent, layout).toContain(
        "No chat account is connected yet. Connect Slack and your conversations show here.",
      );
      const connect = connectButton();
      expect(connect?.textContent, layout).toBe("Connect an account");
      connect?.click();
      await m.settle();
    }
    expect(m.ran("desk.connectors.open")).toEqual(LAYOUTS.map(() => ({ kinds: ["message"] })));
    expect(invisible()).toEqual([]);
  });

  it("never lays the page out wider than a narrow window (the tile size, 203 px)", () => {
    // jsdom applies no media query; the narrow layout's one column is read from the stylesheet.
    const css = readFileSync(join(import.meta.dirname, "../ui/style.css"), "utf8");
    const narrow = css.slice(css.indexOf("@media (max-width: 760px)"));
    expect(narrow).toMatch(/grid-template-columns: minmax\(0, 1fr\);/u);
    expect(narrow).not.toMatch(/grid-template-columns: 1fr;/u);
  });

  it("shows the layouts and the navigation once an account is connected", async () => {
    await drawn();
    expect(document.body.dataset.connected).toBe("true");
    expect(displayed("layouts")).toBe(true);
    expect(displayed("nav")).toBe(true);
    expect(getComputedStyle(byId("main")).gridColumn).not.toBe("1 / -1");
    expect(connectButton()).toBeNull();
  });
});
