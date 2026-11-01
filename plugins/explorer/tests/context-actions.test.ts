import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { DOCS, denied, disk, file, mount, sample } from "./harness";

describe("Explorer selection commands", () => {
  it("uses the selected folder or the file's parent for terminal and Git", async () => {
    const d = await mount({
      handlers: disk(sample()),
      commands: { "endue.terminal.new": () => "t-1", "endue.git.status": () => DOCS },
    });
    for (const path of [`${DOCS}/Work`, `${DOCS}/a2.md`]) {
      d.app.select(path);
      await d.host.command("endue.explorer.terminal-here");
      await d.host.command("endue.explorer.git-here");
    }
    expect(d.ran("endue.terminal.new")).toEqual([{ cwd: `${DOCS}/Work` }, { cwd: DOCS }]);
    expect(d.ran("endue.git.status")).toEqual([{ path: `${DOCS}/Work` }, { path: DOCS }]);
    expect(d.params("proc.spawn")).toEqual([]);
  });

  it("opens the selection in Desk and reveals the exact file or folder in the system", async () => {
    const d = await mount({
      handlers: { ...disk(sample()), "shell.open": () => ({ opened: true }) },
    });
    d.app.select(`${DOCS}/a2.md`);
    await d.host.command("endue.explorer.open-selected");
    expect(d.ran("desk.files.open")).toEqual([{ path: `${DOCS}/a2.md` }]);
    for (const path of [`${DOCS}/a2.md`, `${DOCS}/Work`]) {
      d.app.select(path);
      await d.host.command("endue.explorer.show-in-file-manager");
    }
    expect(d.params("shell.open")).toEqual(
      [`${DOCS}/a2.md`, `${DOCS}/Work`].map((target) => ({
        target,
        reveal: true,
        scope: { permission: "shell:open", paths: [target] },
      })),
    );
  });

  it("reports no selection and unavailable providers without starting or enabling them", async () => {
    const d = await mount({ handlers: disk(sample()) });
    await expect(d.host.command("endue.explorer.terminal-here")).rejects.toThrow(
      /select a file or folder/i,
    );
    d.app.select(`${DOCS}/a2.md`);
    await expect(d.host.command("endue.explorer.terminal-here")).rejects.toThrow(
      /terminal.*not available/i,
    );
    expect(d.view.statuses.at(-1)).toMatch(/terminal.*not available/i);
    await expect(d.host.command("endue.explorer.git-here")).rejects.toThrow(/git.*not available/i);
    expect(d.params("plugin.setEnabled")).toEqual([]);
    expect(d.params("proc.spawn")).toEqual([]);
  });

  it("lets the core ask for the exact reveal path once and preserves a refusal", async () => {
    const path = `${DOCS}/a2.md`;
    const d = await mount({
      handlers: {
        ...disk(sample()),
        "shell.open": () => {
          throw denied("reveal");
        },
        "perm.request": () => ({ granted: false }),
      },
    });
    d.app.select(path);
    await expect(d.host.command("endue.explorer.show-in-file-manager")).rejects.toThrow(
      /not allowed/i,
    );
    // shell.open already asks through core.check_or_ask. A denial must not trigger another ask.
    expect(d.params("perm.request")).toEqual([]);
    expect(d.params("shell.open")).toEqual([
      {
        target: path,
        reveal: true,
        scope: { permission: "shell:open", paths: [path] },
      },
    ]);
    expect(d.ran("desk.files.open")).toEqual([]);
  });

  it("never turns wildcard characters in a filename into a broader reveal grant", async () => {
    const d = await mount({ handlers: disk({ [DOCS]: [file("one*.txt")] }) });
    d.app.select(`${DOCS}/one*.txt`);
    await expect(d.host.command("endue.explorer.show-in-file-manager")).rejects.toThrow(
      /wildcard/i,
    );
    expect(d.params("perm.request")).toEqual([]);
    expect(d.params("shell.open")).toEqual([]);
  });

  it("accepts the core's granted reveal and reports other system failures without a new ask", async () => {
    let attempts = 0;
    const d = await mount({
      handlers: {
        ...disk(sample()),
        "shell.open": () => {
          attempts++;
          if (attempts === 2) throw new StubError("not_found", "gone");
          return { opened: true };
        },
        "perm.request": () => ({ granted: true }),
      },
    });
    d.app.select(`${DOCS}/a2.md`);
    await d.host.command("endue.explorer.show-in-file-manager");
    expect(d.params("shell.open")).toHaveLength(1);
    await expect(d.host.command("endue.explorer.show-in-file-manager")).rejects.toThrow(
      /not_found/,
    );
    expect(d.params("perm.request")).toEqual([]);
    expect(d.view.statuses.at(-1)).toMatch(/could not show/i);
  });

  it("Open expands a selected folder without collapsing an already open one", async () => {
    const d = await mount({ handlers: disk(sample()) });
    d.app.select(`${DOCS}/Work`);
    await d.host.command("endue.explorer.open-selected");
    await d.host.command("endue.explorer.open-selected");
    expect(d.view.shown()).toContain("1:dir:Work+");
    expect(d.view.shown()).toContain("2:file:c.md");
    expect(d.ran("desk.files.open")).toEqual([]);
  });
});
