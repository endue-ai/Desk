import { describe, expect, it, vi } from "vitest";
import { openLink, REFUSED, readLink } from "./open-links";

const host = (answer?: string) => {
  const commands = {
    run: vi.fn(async (id: string, _args?: unknown) =>
      id === "desk.palette.pick" ? answer : undefined,
    ),
    has: vi.fn((id: string) => ["endue.notes.new", "desk.palette.pick"].includes(id)),
    list: vi.fn(() => [{ id: "endue.notes.new", title: "New note" }]),
  };
  return { commands, notify: vi.fn() };
};
const ran = (h: ReturnType<typeof host>) => h.commands.run.mock.calls.map((c) => c[0]);

describe("endue:// links the shell queued", () => {
  it("a file link runs desk.files.open", async () => {
    const h = host();
    await openLink(h, "endue://v1/open?path=%2FUsers%2Fa%2Fb%20c.md");
    expect(h.commands.run).toHaveBeenCalledWith("desk.files.open", { path: "/Users/a/b c.md" });
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a plugin link opens that plugin", async () => {
    const h = host();
    await openLink(h, "endue://v1/plugin/endue.notes?surface=main");
    expect(h.commands.run).toHaveBeenCalledWith("desk.plugins.open", { plugin: "endue.notes" });
    expect(readLink("endue://v1/plugin/endue.notes?surface=main")).toEqual({
      kind: "plugin",
      id: "endue.notes",
      surface: "main",
    });
  });

  it("a command link asks the person first and runs the command only on yes", async () => {
    const yes = host("run");
    await openLink(yes, "endue://v1/command/endue.notes.new");
    expect(ran(yes)).toEqual(["desk.palette.pick", "endue.notes.new"]);
    expect(yes.commands.run.mock.calls[0]?.[1]).toMatchObject({
      title: 'A link asks to run "New note". Run it?',
    });
    const no = host("no");
    await openLink(no, "endue://v1/command/endue.notes.new");
    expect(ran(no)).toEqual(["desk.palette.pick"]);
    const dismissed = host(undefined);
    await openLink(dismissed, "endue://v1/command/endue.notes.new");
    expect(ran(dismissed)).toEqual(["desk.palette.pick"]);
  });

  it("a refused or unknown link shows a plain notice and runs nothing", async () => {
    for (const entry of [
      `${REFUSED}${encodeURIComponent("This link asks for something the desk does not do.")}`,
      "endue://v2/open?path=%2Fa.md",
      "endue://v1/open",
      "endue://v1/command/endue.notes.new?args=1",
      "endue://v1/command/example.missing",
    ]) {
      const h = host("run");
      await openLink(h, entry);
      expect(ran(h), entry).toEqual([]);
      expect(h.notify, entry).toHaveBeenCalledOnce();
      expect(h.notify.mock.calls[0]?.[0]).toMatchObject({ title: "This link was not opened" });
    }
    const h = host();
    await openLink(h, `${REFUSED}${encodeURIComponent("This link is too long.")}`);
    expect(h.notify.mock.calls[0]?.[0]).toMatchObject({ body: "This link is too long." });
  });
});
