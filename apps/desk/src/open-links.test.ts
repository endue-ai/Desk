import { describe, expect, it, vi } from "vitest";
import { type LinksHost, openLink, REFUSED, readLink, shown } from "./open-links";

/** A desk whose palette answers `answer`, with `known` commands and `plugins` (id → on). */
const host = (
  answer?: string,
  known = ["endue.notes.new", "desk.palette.pick"],
  plugins: Record<string, boolean> = { "endue.notes": true, "acme.sync": false },
) => {
  const commands = new Set(known);
  const listeners = new Set<() => void>();
  const h = {
    commands: {
      run: vi.fn(async (id: string, _args?: unknown) =>
        id === "desk.palette.pick" ? answer : undefined,
      ),
      has: vi.fn((id: string) => commands.has(id)),
      list: vi.fn(() => [{ id: "endue.notes.new", title: "New note" }]),
      onChange: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
    pluginOn: vi.fn(async (id: string) => plugins[id]),
    notify: vi.fn(),
    waitMs: 50,
    /** A command registers later, as plugins do after a cold start. */
    register(id: string) {
      commands.add(id);
      for (const listener of listeners) listener();
    },
  } satisfies LinksHost & { register(id: string): void };
  return h;
};
type Host = ReturnType<typeof host>;
const ran = (h: Host) => h.commands.run.mock.calls.map((c) => c[0]);
const picked = (h: Host) =>
  h.commands.run.mock.calls.find((c) => c[0] === "desk.palette.pick")?.[1] as {
    title: string;
    items: Array<{ id: string; label: string }>;
  };

describe("endue:// links the shell queued", () => {
  it("a file link asks first, no first, and opens the file only on yes", async () => {
    const yes = host("yes");
    await openLink(yes, "endue://v1/open?path=%2FUsers%2Fa%2Fb%20c.md");
    expect(ran(yes)).toEqual(["desk.palette.pick", "desk.files.open"]);
    expect(yes.commands.run).toHaveBeenCalledWith("desk.files.open", { path: "/Users/a/b c.md" });
    expect(picked(yes).title).toBe("A link asks to open /Users/a/b c.md. Open it?");
    expect(picked(yes).items.map((i) => i.id)).toEqual(["no", "yes"]);
    for (const answer of ["no", undefined]) {
      const h = host(answer);
      await openLink(h, "endue://v1/open?path=%2FUsers%2Fa%2F.ssh%2Fx.md");
      expect(ran(h), String(answer)).toEqual(["desk.palette.pick"]);
    }
  });

  it("a plugin link opens a plugin that is on, and never turns one on", async () => {
    const h = host();
    await openLink(h, "endue://v1/plugin/endue.notes?surface=main");
    expect(h.commands.run).toHaveBeenCalledWith("desk.plugins.open", { plugin: "endue.notes" });
    expect(readLink("endue://v1/plugin/endue.notes?surface=main")).toEqual({
      kind: "plugin",
      id: "endue.notes",
      surface: "main",
    });
    for (const id of ["acme.sync", "example.missing"]) {
      const off = host();
      await openLink(off, `endue://v1/plugin/${id}`);
      expect(ran(off), id).toEqual([]);
      expect(off.notify).toHaveBeenCalledOnce();
    }
    const off = host();
    await openLink(off, "endue://v1/plugin/acme.sync");
    expect(off.notify.mock.calls[0]?.[0]).toMatchObject({
      body: "acme.sync is turned off; a link does not turn it on.",
    });
  });

  it("a command link asks the person first, no first, and runs only on yes", async () => {
    const yes = host("yes");
    await openLink(yes, "endue://v1/command/endue.notes.new");
    expect(ran(yes)).toEqual(["desk.palette.pick", "endue.notes.new"]);
    expect(picked(yes)).toMatchObject({ title: 'A link asks to run "New note". Run it?' });
    // Enter picks the first row: a link that lands while the person types runs nothing.
    expect(picked(yes).items[0]).toEqual({ id: "no", label: "Don't run it" });
    for (const answer of ["no", undefined]) {
      const h = host(answer);
      await openLink(h, "endue://v1/command/endue.notes.new");
      expect(ran(h), String(answer)).toEqual(["desk.palette.pick"]);
    }
  });

  it("a link that started the desk waits for the palette and its command to register", async () => {
    const h = host("yes", []);
    const opening = openLink(h, "endue://v1/command/endue.notes.new");
    h.register("desk.palette.pick");
    h.register("endue.notes.new");
    await opening;
    expect(ran(h)).toEqual(["desk.palette.pick", "endue.notes.new"]);
    // One that never registers is said plainly once the wait is over.
    const never = host("yes", ["desk.palette.pick"]);
    await openLink(never, "endue://v1/command/example.missing");
    expect(ran(never)).toEqual([]);
    expect(never.notify.mock.calls[0]?.[0]).toMatchObject({
      body: "The desk has no command example.missing.",
    });
  });

  it("a refused or unknown link shows a plain notice and runs nothing", async () => {
    for (const entry of [
      `${REFUSED}${encodeURIComponent("This link asks for something the desk does not do.")}`,
      "endue://v2/open?path=%2Fa.md",
      "endue://v1/open",
      "endue://v1/command/endue.notes.new?args=1",
    ]) {
      const h = host("yes");
      await openLink(h, entry);
      expect(ran(h), entry).toEqual([]);
      expect(h.notify, entry).toHaveBeenCalledOnce();
      expect(h.notify.mock.calls[0]?.[0]).toMatchObject({ title: "This link was not opened" });
    }
  });

  it("text from a link reaches a notice without control or bidi characters, and short", () => {
    expect(shown("a‮gpj.exe\u0007")).toBe("agpj.exe");
    expect(shown("x".repeat(500))).toHaveLength(120);
    expect(readLink(`${REFUSED}${encodeURIComponent("bad‮\n")}`)).toEqual({ refused: "bad" });
  });
});
