// @vitest-environment jsdom
// What web.read and web.act ask of a web view's page (ADR 0270; web_page.js, web_page_text.js),
// run in a page of the test's: the text it reads and the refs it names, what it leaves out, a
// page of another site left alone, and what makes a page ready for typed text, a key and a choice.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const source = (name: string) => readFileSync(new URL(name, import.meta.url), "utf8");
new Function(`${source("./web_page_text.js")}\n${source("./web_page.js")}`)();

type Said = { ok?: Record<string, unknown>; error?: { code: string; message: string } };
type Page = (request: Record<string, unknown>) => Said;
const scope = globalThis as unknown as { __deskPage: Page; __deskPageState?: unknown };

/** Ask the page script, for the page the core allowed: the one the test is at. */
const ask = (request: Record<string, unknown>) =>
  scope.__deskPage({ at: location.href, ...request });
const text = (request: Record<string, unknown> = {}) =>
  String(ask({ do: "read", ...request }).ok?.text);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function page(html: string) {
  scope.__deskPageState = undefined;
  document.title = "Shop";
  document.body.innerHTML = html;
}

describe("a web view's page, read", () => {
  beforeEach(() => page(""));

  it("is its text in reading order, a block a line, with headings and list items marked", () => {
    page(`<h1>Fruit</h1><p>Fresh  and
      <b>ripe</b>.</p><ul><li>Apple</li><li>Pear</li></ul><h2>More</h2>
      <table><tr><th>Name</th><th>Price</th></tr><tr><td>Fig</td><td>3</td></tr></table>`);
    expect(text()).toBe(
      "# Fruit\nFresh and ripe.\n- Apple\n- Pear\n## More\nName | Price\nFig | 3",
    );
  });

  it("names what can be acted on, with what a field holds and a box's state", () => {
    page(`<a href="/in">Sign in</a> <button disabled>Buy</button>
      <label for="q">Search</label><input id="q" value="figs">
      <input type="checkbox" checked aria-label="Gift"> <input type="radio" name="r">
      <select aria-label="Size"><option>Small</option><option selected>Large</option></select>
      <div role="tab" aria-selected="true">Reviews</div>
      <button aria-expanded="false" aria-label="Menu"></button>`);
    expect(text().split("\n")).toEqual([
      '[e1 link "Sign in"] [e2 button "Buy" disabled] Search [e3 field "Search" = "figs"] ' +
        '[e4 checkbox "Gift" on] [e5 radio off] [e6 select "Size" = "Large" of "Small", "Large"]',
      '[e7 tab "Reviews" selected]',
      '[e8 button "Menu" closed]',
    ]);
  });

  it("never holds a password, and leaves out what the page hides", () => {
    page(`<input type="password" value="hunter2" aria-label="Password">
      <input type="hidden" value="token"><p hidden>secret</p><p aria-hidden="true">shade</p>
      <script>var x = "code";</script><style>p { color: red }</style><p>shown</p>
      <img alt="A fig"><img alt=""><iframe title="Ad" src="https://ads.example/"></iframe>`);
    const read = text();
    expect(read).toBe('[e1 field "Password" = (hidden)]\nshown\n(image "A fig") (frame "Ad")');
    expect(read).not.toMatch(/hunter2|token|secret|shade|code|color/);
  });

  it("keeps an element's ref from one read to the next, and names a new one anew", () => {
    page(`<a href="/a">A</a><a href="/b" id="b">B</a>`);
    expect(text()).toBe('[e1 link "A"] [e2 link "B"]');
    byId("b").insertAdjacentHTML("beforebegin", `<a href="/new">New</a>`);
    expect(text()).toBe('[e1 link "A"] [e3 link "New"] [e2 link "B"]');
  });

  it("reads a role's box of other things through, not as one thing", () => {
    page(`<div role="button" tabindex="0"><i role="img" tabindex="-1"></i>Save</div>
      <div tabindex="0"><p>A long card</p><a href="/x">Open</a></div>`);
    expect(text()).toBe('[e1 button "Save"]\nA long card\n[e2 link "Open"]');
  });

  it("takes what shows the pointer a hand for something to press, once", () => {
    page(`<div style="cursor: pointer"><span style="cursor: pointer">Open menu</span></div>
      <p>plain</p>`);
    expect(text()).toBe('[e1 item "Open menu"]\nplain');
  });

  it("answers a part of the text, by characters, with the whole text's length", () => {
    page("<p>가나다라마 😀😀 end</p>");
    const read = ask({ do: "read", from: 4, max: 4 }).ok;
    expect(read).toMatchObject({ text: "마 😀😀", from: 4, length: 12, title: "Shop" });
    expect(read?.url).toBe(location.href);
    expect(read?.scroll).toMatchObject({ x: 0, y: 0 });
    expect(ask({ do: "read", from: 999 }).ok).toMatchObject({ text: "", from: 12 });
  });

  it("leaves a page of another site alone", () => {
    page("<p>mail</p>");
    const moved = scope.__deskPage({ at: "https://elsewhere.test/inbox", do: "read" });
    expect(moved.error?.code).toBe("moved");
    expect(scope.__deskPage({ at: "", do: "read" }).error?.code).toBe("moved");
  });
});

describe("a web view's page, acted in", () => {
  it("finds an element by its ref while it is in the page", () => {
    page(`<button id="go">Go</button>`);
    text();
    const pressed = vi.fn();
    byId("go").addEventListener("click", pressed);
    expect(ask({ do: "click", ref: "e1" })).toEqual({ ok: {} });
    expect(pressed).toHaveBeenCalledOnce();
    byId("go").remove();
    expect(ask({ do: "click", ref: "e1" }).error?.code).toBe("not_found");
    expect(ask({ do: "show", ref: "e77" }).error?.code).toBe("not_found");
  });

  it("says where a press lands, and whether something lies over it", () => {
    page(`<button id="go">Go</button><div id="veil"></div>`);
    text();
    const at = { left: 10, top: 20, width: 80, height: 30 };
    byId("go").getClientRects = () => [at] as unknown as DOMRectList;
    document.elementFromPoint = () => byId("go");
    expect(ask({ do: "point", ref: "e1" })).toEqual({ ok: { x: 50, y: 35, covered: false } });
    document.elementFromPoint = () => byId("veil");
    expect(ask({ do: "point", ref: "e1" }).ok).toMatchObject({ covered: true });
  });

  it("makes a field ready for typed text: the keys on it, what it holds selected", () => {
    page(`<input id="q" value="old"><a href="/x">x</a><input id="ro" readonly>`);
    text();
    const field = byId<HTMLInputElement>("q");
    expect(ask({ do: "ready", field: true, ref: "e1", replace: true, text: "new" })).toEqual({
      ok: {},
    });
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, 3]);
    // Kept: the caret goes to the end.
    ask({ do: "ready", field: true, ref: "e1", replace: false, text: "+" });
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3]);
    // Without a ref the field with the caret takes the text.
    expect(ask({ do: "ready", field: true, replace: false, text: "+" })).toEqual({ ok: {} });
    expect(ask({ do: "ready", field: true, ref: "e2", text: "x" }).error?.code).toBe("invalid");
    expect(ask({ do: "ready", field: true, ref: "e3", text: "x" }).error?.code).toBe("invalid");
    field.blur();
    expect(ask({ do: "ready", field: true, text: "x" }).error?.message).toMatch(/no field/);
  });

  it("sets a date whole, as its field takes it, and says so as input does", () => {
    page(`<input id="day" type="date">`);
    text();
    const heard: string[] = [];
    for (const kind of ["input", "change"])
      byId("day").addEventListener(kind, (event) => heard.push(event.type));
    const said = ask({ do: "ready", field: true, ref: "e1", replace: true, text: "2026-11-18" });
    expect(said).toEqual({ ok: { done: true } });
    expect(byId<HTMLInputElement>("day").value).toBe("2026-11-18");
    expect(heard).toEqual(["input", "change"]);
  });

  it("gives an element the keys for a key, and asks nothing of a key without one", () => {
    page(`<button id="go">Go</button>`);
    text();
    expect(ask({ do: "ready", field: false })).toEqual({ ok: {} });
    expect(document.activeElement).toBe(document.body);
    expect(ask({ do: "ready", field: false, ref: "e1" })).toEqual({ ok: {} });
    expect(document.activeElement).toBe(byId("go"));
  });

  it("chooses an option by the words it shows or by its value", () => {
    page(`<select id="lang"><option value="en">English</option>
      <option value="ko">한국어</option><option value="x" disabled>Old</option></select>
      <button>b</button>`);
    text();
    const list = byId<HTMLSelectElement>("lang");
    const changed = vi.fn();
    list.addEventListener("change", changed);
    expect(ask({ do: "choose", ref: "e1", option: " 한국어 " })).toEqual({ ok: {} });
    expect(list.value).toBe("ko");
    expect(ask({ do: "choose", ref: "e1", option: "en" })).toEqual({ ok: {} });
    expect(list.value).toBe("en");
    expect(changed).toHaveBeenCalledTimes(2);
    for (const [ref, option] of [
      ["e1", "Deutsch"],
      ["e1", "Old"],
      ["e2", "English"],
    ])
      expect(ask({ do: "choose", ref, option }).error?.code, `${ref} ${option}`).toBe("invalid");
  });

  it("answers what it does not know as an error, never by throwing", () => {
    page("<p>x</p>");
    expect(ask({ do: "eval" }).error?.code).toBe("invalid");
    expect(ask({ do: "point", ref: "e1" }).error?.code).toBe("not_found");
  });
});
