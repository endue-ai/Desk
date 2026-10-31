import { describe, expect, it } from "vitest";
import { openFile } from "../ui/formats.js";
import { shellLink, utf8 } from "./build";
import { fixture } from "./harness";

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
