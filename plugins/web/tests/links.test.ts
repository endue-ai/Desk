// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { createExternal } from "../ui/external.js";
import { openFile } from "../ui/formats.js";
import { createView } from "../ui/view.js";
import { shellLink, utf8 } from "./build";
import { disk, file, fixture, type Handlers, loadPage, mount } from "./harness";

const nowhere = { read: async () => null };
const card = async (bytes: Uint8Array, path: string) => {
  const model = await openFile(bytes, path, nowhere);
  if (model.kind !== "card") throw new Error(`not a card: ${JSON.stringify(model)}`);
  return model;
};

describe("link files as a card", () => {
  it(".url: the [InternetShortcut] URL", async () => {
    const text =
      "[{000214A0-0000-0000-C000-000000000046}]\r\nProp3=19,11\r\n[InternetShortcut]\r\nIDList=\r\nURL=https://example.com/news?id=7\r\nIconIndex=0\r\n";
    expect(await card(utf8(text), "~/Desktop/News.url")).toMatchObject({
      format: "Internet shortcut",
      title: "News",
      url: "https://example.com/news?id=7",
    });
  });

  it(".url pointing at a local file gives a path to open", async () => {
    const text = "[InternetShortcut]\nURL=file:///Users/someone/Sites/My%20Page.html\n";
    expect(await card(utf8(text), "~/Desktop/Local.url")).toMatchObject({
      url: "file:///Users/someone/Sites/My%20Page.html",
      path: "/Users/someone/Sites/My Page.html",
    });
  });

  it(".webloc as an XML property list", async () => {
    const xml = new TextDecoder().decode(fixture("link.webloc.xml"));
    expect(await card(utf8(xml), "~/Desktop/Docs.webloc")).toMatchObject({
      format: "Website location",
      title: "Docs",
      url: "https://example.com/docs?a=1&b=2",
    });
  });

  it(".webloc as a binary property list (plutil -convert binary1)", async () => {
    expect(await card(fixture("link.webloc"), "~/Desktop/Docs.webloc")).toMatchObject({
      format: "Website location",
      url: "https://example.com/docs?a=1&b=2",
    });
  });

  it(".desktop of Type=Link gives its URL", async () => {
    const text =
      "# A link\n[Desktop Entry]\nVersion=1.0\nType=Link\nName=Example site\nName[ko]=예제\nURL=https://example.com/\nIcon=text-html\n";
    expect(await card(utf8(text), "~/Desktop/example.desktop")).toMatchObject({
      format: "Desktop entry",
      title: "Example site",
      url: "https://example.com/",
    });
  });

  it(".desktop of Type=Application shows Name, Exec and Icon as text", async () => {
    const text =
      "[Desktop Entry]\nType=Application\nName=Text Editor\nComment=Edit text files\nExec=gedit %U\nIcon=org.gnome.gedit\nTerminal=false\n";
    const model = await card(utf8(text), "~/Desktop/gedit.desktop");
    expect(model).toMatchObject({ format: "Desktop entry", title: "Text Editor" });
    expect(model.url).toBeUndefined();
    expect(model.fields).toEqual(
      expect.arrayContaining([
        ["Type", "Application"],
        ["Exec", "gedit %U"],
        ["Icon", "org.gnome.gedit"],
        ["Comment", "Edit text files"],
      ]),
    );
  });

  it(".lnk: target, arguments, working folder, description and icon location", async () => {
    const bytes = shellLink({
      local: "C:\\Users\\Public\\Documents\\report.txt",
      description: "Quarterly report",
      relative: "..\\Documents\\report.txt",
      workingDir: "C:\\Users\\Public\\Documents",
      arguments: "/view",
      icon: "%SystemRoot%\\system32\\shell32.dll",
    });
    const model = await card(bytes, "~/Desktop/Report.lnk");
    expect(model).toMatchObject({ format: "Windows shortcut", title: "Quarterly report" });
    expect(model.fields).toEqual([
      ["Target", "C:\\Users\\Public\\Documents\\report.txt"],
      ["Arguments", "/view"],
      ["Working folder", "C:\\Users\\Public\\Documents"],
      ["Description", "Quarterly report"],
      ["Icon location", "%SystemRoot%\\system32\\shell32.dll"],
      ["Relative path", "..\\Documents\\report.txt"],
    ]);
  });

  it(".lnk to a network share gives the share path", async () => {
    const bytes = shellLink({ network: { share: "\\\\server\\team", suffix: "plans\\q4.xlsx" } });
    const model = await card(bytes, "~/Desktop/Plans.lnk");
    expect(model).toMatchObject({ title: "Plans" });
    expect(model.fields).toEqual([["Network path", "\\\\server\\team\\plans\\q4.xlsx"]]);
  });

  it("a damaged .lnk opens as its details", async () => {
    const bytes = shellLink({ local: "C:\\x.txt" }).subarray(0, 90);
    const model = await openFile(bytes, "~/Desktop/Broken.lnk", nowhere);
    expect(model).toMatchObject({ kind: "details", format: "Windows shortcut" });
  });
});

const SCOPE = { permission: "shell:open", schemes: ["http", "https", "mailto"] };

describe("links open in the browser with shell.open", () => {
  it("http, https and mailto go to shell.open with the one scope; other schemes do nothing", async () => {
    const call = vi.fn().mockResolvedValue({ opened: true });
    const open = createExternal({ call });
    expect(await open("https://example.com/a b")).toBe(true);
    expect(await open("http://example.com/")).toBe(true);
    expect(await open("mailto:team@example.com")).toBe(true);
    expect(call.mock.calls).toEqual([
      ["shell.open", { target: "https://example.com/a%20b", scope: SCOPE }],
      ["shell.open", { target: "http://example.com/", scope: SCOPE }],
      ["shell.open", { target: "mailto:team@example.com", scope: SCOPE }],
    ]);
    call.mockClear();
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<b>x</b>",
      "file:///Users/someone/x.html",
      "ftp://example.com/",
      "#part",
      "not a url",
    ])
      expect(await open(url)).toBe(false);
    expect(call).not.toHaveBeenCalled();
  });

  it("a refusal is final: one call, no second ask, no retry", async () => {
    const refused = new StubError("permission_denied", "shell:open is not granted");
    const call = vi.fn(async () => {
      throw refused;
    });
    await expect(createExternal({ call })("https://example.com/")).rejects.toBe(refused);
    expect(call).toHaveBeenCalledExactlyOnceWith("shell.open", {
      target: "https://example.com/",
      scope: SCOPE,
    });
  });
});

describe("links on pages and cards", () => {
  const byId = (id: string) => document.getElementById(id) as HTMLElement;
  const click = (el: Element | null | undefined) => {
    if (!el) throw new Error("nothing to click");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, composed: true });
    el.dispatchEvent(event);
    return event;
  };
  beforeEach(() => loadPage(document));

  const opened: NonNullable<Handlers["shell.open"]> = () => ({ opened: true });
  async function visit(path: string, text: string, shell = opened) {
    const at = file(path);
    const mounted = await mount({
      handlers: { ...disk({ [path]: text }), "shell.open": shell },
      view: (actions) => createView(document, actions),
    });
    await mounted.host.command("desk.files.visit", at);
    await mounted.settle();
    return mounted;
  }

  const PAGE = `<p><a href="https://example.com/x">web</a> <a href="mailto:team@example.com">mail</a>
    <a href="javascript:alert(1)">script</a> <a href="data:text/html,x">data</a>
    <a href="ftp://example.com/f">ftp</a> <a href="#end">jump</a></p><p id="end">End</p>`;

  it("a page's http(s) and mailto links run shell.open; script, data and ftp links do nothing", async () => {
    const { params, settle, ran } = await visit("~/Sites/links.html", PAGE);
    const shadow = byId("page").shadowRoot as ShadowRoot;
    // The sanitizer keeps only http(s), mailto, file and fragment targets as links.
    const anchors = [...shadow.querySelectorAll("a[href]")];
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual([
      "https://example.com/x",
      "mailto:team@example.com",
      "#end",
    ]);
    for (const anchor of shadow.querySelectorAll("a")) click(anchor);
    await settle();
    expect(params("shell.open")).toEqual([
      { target: "https://example.com/x", scope: SCOPE },
      { target: "mailto:team@example.com", scope: SCOPE },
    ]);
    expect(ran("desk.files.open")).toEqual([]);
    // The status-line fallback is gone: no link puts its address there.
    expect(byId("status").textContent).toBe("");
  });

  it("a refused link says so on the status line and is not retried", async () => {
    const { params, settle } = await visit("~/Sites/links.html", PAGE, () => {
      throw new StubError("permission_denied", "shell:open is not granted");
    });
    click((byId("page").shadowRoot as ShadowRoot).querySelector("a[href^='https:']"));
    await settle();
    expect(params("shell.open")).toHaveLength(1);
    expect(params("perm.request")).toEqual([]);
    expect(byId("status").textContent).toBe("Not allowed to open links in the browser.");
  });

  for (const [path, text, url] of [
    [
      "~/Desktop/News.url",
      "[InternetShortcut]\r\nURL=https://example.com/news?id=7\r\n",
      "https://example.com/news?id=7",
    ],
    [
      "~/Desktop/Docs.webloc",
      new TextDecoder().decode(fixture("link.webloc.xml")),
      "https://example.com/docs?a=1&b=2",
    ],
    [
      "~/Desktop/site.desktop",
      "[Desktop Entry]\nType=Link\nName=Site\nURL=mailto:team@example.com\n",
      "mailto:team@example.com",
    ],
  ] as const)
    it(`a ${path.slice(path.lastIndexOf("."))} card opens its URL in the browser`, async () => {
      const { params, settle } = await visit(path, text);
      const button = byId("card").querySelector("button");
      expect(button?.textContent).toBe(
        url.startsWith("mailto:") ? "Open in mail app" : "Open in browser",
      );
      expect(byId("card").textContent).not.toContain("not available yet");
      click(button);
      await settle();
      expect(params("shell.open")).toEqual([{ target: url, scope: SCOPE }]);
    });

  it("a card whose URL is not http, https or mailto has no browser button", async () => {
    await visit("~/Desktop/odd.url", "[InternetShortcut]\nURL=javascript:alert(1)\n");
    expect(byId("card").hidden).toBe(false);
    expect(byId("card").querySelector("button")).toBeNull();
  });
});
