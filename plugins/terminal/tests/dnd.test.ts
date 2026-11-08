// Drag and drop on the terminal (#550, ADR 0119): dropped paths are typed at the prompt quoted for
// the session's shell, dropped text goes in through the paste guard (so several lines ask first),
// and a tab drags the folder its shell is in as desk/paths, by reference only.
import { describe, expect, it } from "vitest";
import { pathsText, shellOf, shellQuote, TAB_KIND, tabDrag } from "../ui/drops.js";
import type { Session } from "../ui/types.js";
import { mount } from "./harness";

const paths = (...list: string[]) => [
  { type: "desk/paths" as const, paths: list.map((path) => ({ path, kind: "file" as const })) },
];
const text = (value: string) => [{ type: "desk/text" as const, text: value }];

describe("quoting a dropped path for the shell", () => {
  it("leaves a plain path alone and single-quotes the rest for sh, bash, zsh and fish", () => {
    expect(shellQuote("/usr/local/bin/node")).toBe("/usr/local/bin/node");
    expect(shellQuote("/Users/me/My Docs/a (1).txt")).toBe("'/Users/me/My Docs/a (1).txt'");
    expect(shellQuote("/tmp/it's here")).toBe("'/tmp/it'\\''s here'");
    expect(shellQuote("/tmp/$(rm -rf ~);`x`")).toBe("'/tmp/$(rm -rf ~);`x`'");
  });

  it("keeps ~/ outside the quotes, so the shell still expands it", () => {
    expect(shellQuote("~")).toBe("~");
    expect(shellQuote("~/Projects")).toBe("~/Projects");
    expect(shellQuote("~/My Docs/notes.md")).toBe("~/'My Docs/notes.md'");
  });

  it("quotes as PowerShell and cmd read it", () => {
    expect(shellQuote("C:/Program Files/it's", "powershell")).toBe("'C:/Program Files/it''s'");
    expect(shellQuote("C:/tools/x.exe", "powershell")).toBe("C:/tools/x.exe");
    expect(shellQuote("C:/Program Files/x & y", "cmd")).toBe('"C:/Program Files/x & y"');
    expect(shellQuote("C:/tools", "cmd")).toBe("C:/tools");
  });

  it("knows the shell from the program, and ends a drop with a space as Terminal.app does", () => {
    expect(shellOf("/bin/zsh")).toBe("posix");
    expect(shellOf("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("powershell");
    expect(shellOf("powershell")).toBe("powershell");
    expect(shellOf("cmd.exe")).toBe("cmd");
    expect(pathsText([{ path: "/a b" }, { path: "/c" }], "posix")).toBe("'/a b' /c ");
  });
});

describe("dropping on a terminal", () => {
  it("takes paths and text, paths as a link and text as a copy", async () => {
    const d = await mount();
    expect(d.host.dnd.accepts).toEqual(["desk/paths", "desk/text", "text/plain"]);
    expect(await d.host.dnd.hover({ items: paths("/tmp/a") })).toBe("link");
    expect(await d.host.dnd.hover({ items: text("ls") })).toBe("copy");
    // Rows, a container: data of other kinds arrives as its text.
    const rows = [{ type: "desk/json" as const, kind: "db/rows", value: { rows: [] } }];
    expect(await d.host.dnd.hover({ items: rows })).toBe("copy");
  });

  it("types dropped paths at the prompt, shell-quoted, through the paste guard", async () => {
    const d = await mount();
    const done = await d.host.dnd.drop({
      items: paths("/Users/me/My Docs/report.pdf", "/tmp/b.txt"),
      from: "endue.explorer",
    });
    expect(done).toBe("link");
    expect(d.view.pasted).toEqual([
      { id: "t-1", text: "'/Users/me/My Docs/report.pdf' /tmp/b.txt " },
    ]);
    expect(d.view.asked).toEqual([]);
    expect(d.view.focused).toContain("t-1");
  });

  it("quotes for the session's own shell", async () => {
    const d = await mount({ platform: "windows", settings: { "endue.terminal.shell": "pwsh" } });
    await d.host.dnd.drop({ items: paths("C:/Users/me/My Docs/a.txt"), from: "os" });
    expect(d.view.pasted).toEqual([{ id: "t-1", text: "'C:/Users/me/My Docs/a.txt' " }]);
  });

  it("asks before several lines of dropped text, and pastes nothing on no", async () => {
    const d = await mount();
    d.view.answer = false;
    expect(await d.host.dnd.drop({ items: text("cd /tmp\nrm -rf build\n") })).toBe("none");
    expect(d.view.asked).toEqual([{ id: "t-1", lines: 2 }]);
    expect(d.view.pasted).toEqual([]);
    d.view.answer = true;
    // The markers that would end bracketed paste early never reach the program.
    expect(await d.host.dnd.drop({ items: text("echo hi\x1b[201~\nwhoami") })).toBe("copy");
    expect(d.view.pasted).toEqual([{ id: "t-1", text: "echo hi\nwhoami" }]);
  });

  it("does not ask when the program brackets pastes", async () => {
    const d = await mount();
    d.view.bracketed = true;
    const sql = [
      { type: "desk/text" as const, text: "INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);" },
    ];
    expect(await d.host.dnd.drop({ items: sql, from: "endue.database" })).toBe("copy");
    expect(d.view.asked).toEqual([]);
    expect(d.view.pasted.at(-1)?.text).toBe("INSERT INTO t VALUES (1);\nINSERT INTO t VALUES (2);");
  });

  it("refuses a drop while no program runs in the terminal on screen", async () => {
    const d = await mount();
    d.host.emit({ event: "proc.exit", data: { procId: "p1", code: 0 } });
    await d.settle();
    expect(await d.host.dnd.hover({ items: paths("/tmp/a") })).toBe("none");
    expect(await d.host.dnd.drop({ items: text("ls") })).toBe("none");
    expect(d.view.pasted).toEqual([]);
  });
});

describe("dragging a terminal's folder out", () => {
  const session = (cwd: string | null) => ({ id: "t-3", title: "zsh", cwd }) as unknown as Session;

  it("offers the folder the shell is in as desk/paths, by reference only", () => {
    expect(tabDrag(session("/Users/me/My Project"))).toEqual({
      items: [
        { type: "desk/paths", paths: [{ path: "/Users/me/My Project", kind: "folder" }] },
        { type: "desk/json", kind: TAB_KIND, value: { session: "t-3" } },
      ],
      effectAllowed: ["link"],
      image: { label: "zsh", detail: "/Users/me/My Project" },
    });
  });

  it("offers no path while the shell has not said where it is", () => {
    const drag = tabDrag(session(null));
    expect(drag.items.map((item: { type: string }) => item.type)).toEqual([
      "desk/json",
      "text/plain",
    ]);
    expect(drag.effectAllowed).toEqual(["link"]);
  });

  it("drops the folder the shell reported (OSC 7) on a terminal as its quoted path", async () => {
    const d = await mount();
    d.app.osc("t-1", 7, "file://mac.local/Users/me/My%20Project");
    const shown = d.app.sessions().find((s) => s.id === "t-1") as Session;
    const drag = tabDrag(shown);
    const { items, effectAllowed } = drag;
    const done = await d.host.dnd.drop({ items, effectAllowed, from: "endue.terminal" });
    expect(done).toBe("link");
    expect(d.view.pasted).toEqual([{ id: "t-1", text: "'/Users/me/My Project' " }]);
  });
});
