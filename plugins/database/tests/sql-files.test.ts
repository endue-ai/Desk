// A .sql file is a console bound to it (PG-24, ADR 0286): opened by the desk (`*.sql` is among the
// plugin's files) or dropped, on the connection the person picks and that the file remembers; its
// edits marked unsaved, saved to that file only (asked for where the grants do not reach), read
// again on revert, and a change on disk handed to the desk, which asks before the text is replaced.
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { EDITOR_MAX } from "../ui/console-files.js";
import type { Console } from "../ui/consoles.js";
import { type Handlers, mount, SAVED } from "./harness";

type Scope = { permission: string; paths: string[] };
const PATH = "/work/report.sql";
const BUFFER = `file:${PATH}`;

/** fs.* over `files`, refusing the first write of each file until a perm.request grants it. */
function disk(files: Record<string, string>, grant = true) {
  const asked: Array<{ permission: Scope; reason: string }> = [];
  const writes: Array<{ path: string; content: string; scope: Scope }> = [];
  const watches: Array<{ path: string; scope: Scope }> = [];
  const granted = new Set<string>();
  const handlers: Handlers = {
    "fs.read": ({ path, length }) => {
      const content = files[path];
      if (content === undefined) throw new StubError("not_found", `${path}: no such file`);
      const bytes = new TextEncoder().encode(content);
      const part =
        length === undefined ? content : new TextDecoder().decode(bytes.slice(0, length));
      return { content: part, encoding: "utf8", size: bytes.length };
    },
    "fs.write": ({ path, content, scope }) => {
      if (!granted.has(path)) throw new StubError("permission_denied", "no", scope);
      writes.push({ path, content, scope: scope as Scope });
      files[path] = content;
      return { bytesWritten: content.length };
    },
    "fs.watch": ({ path, scope }) => {
      watches.push({ path, scope: scope as Scope });
      return { watchId: `w-${watches.length}` };
    },
    "perm.request": (params) => {
      const asking = params as { permission: Scope; reason: string };
      asked.push(asking);
      if (grant) for (const path of asking.permission.paths) granted.add(path);
      return { granted: grant };
    },
  };
  return { handlers, asked, writes, watches, files };
}

const picker =
  (answer: string, titles: string[]) =>
  ({ title }: { title: string }) => {
    titles.push(title);
    return title.startsWith("Database: run report.sql") ? answer : "";
  };

describe("a .sql file the desk opens", () => {
  it("opens a .sql file the desk visits as a console bound to it, on the connection the person picks, remembered for the file", async () => {
    const files = disk({ [PATH]: "select * from orders;\n" });
    const titles: string[] = [];
    const m = await mount({
      store: { connections: SAVED },
      handlers: files.handlers,
      pick: picker("c-prod", titles),
    });
    await m.host.command("desk.files.visit", { buffer: BUFFER, path: PATH });
    await m.settle();
    expect(titles).toEqual(["Database: run report.sql on which connection?"]);
    expect(m.shown()).toMatchObject({
      id: BUFFER,
      kind: "console",
      connection: "c-prod",
      name: "db: report.sql · Shop",
      text: "select * from orders;\n",
      file: { path: PATH, modified: false, large: false },
    });
    expect(m.store["sql-files"]).toEqual([{ path: PATH, connection: "c-prod" }]);
    // The file opened again, after a restart: no question.
    const again = await mount({
      store: m.store,
      handlers: disk({ [PATH]: "select 1;\n" }).handlers,
      pick: picker("c-lite", titles),
    });
    await again.host.command("desk.files.visit", { buffer: BUFFER, path: PATH });
    expect(titles).toHaveLength(1);
    expect(again.shown()).toMatchObject({ connection: "c-prod", text: "select 1;\n" });
    // Another connection, picked for the file, is remembered for it.
    again.picks.length = 0;
    await again.host.command("endue.database.file-connection", { connection: "Notes" });
    expect(again.shown()).toMatchObject({ connection: "c-lite", name: "db: report.sql · Notes" });
    expect(again.store["sql-files"]).toEqual([{ path: PATH, connection: "c-lite" }]);
  });

  it("marks unsaved edits and saves them to that file only, asking for the write where the grants do not reach", async () => {
    const files = disk({ [PATH]: "select 1;\n" });
    const m = await mount({
      store: { connections: SAVED },
      handlers: files.handlers,
      pick: picker("c-lite", []),
    });
    await m.host.command("desk.files.visit", { buffer: BUFFER, path: PATH });
    const marks = () =>
      m.host.ran
        .filter((r) => r.name === "desk.buffers.update")
        .map((r) => r.args as { id: string; modified?: boolean });
    m.app.edited("select 2;\n");
    m.app.edited("select 22;\n");
    await m.settle();
    expect(marks()).toEqual([{ id: BUFFER, modified: true }]);
    expect(m.shown()?.file).toMatchObject({ modified: true });
    // Nothing of a bound console's text goes to the store.
    expect(Object.keys(m.store).filter((k) => k.startsWith("console:"))).toEqual([]);

    await m.host.command("desk.files.save", { buffer: BUFFER, path: PATH });
    const scope = { permission: "fs:write", paths: [PATH] };
    expect(files.asked).toEqual([
      { permission: scope, reason: "To save report.sql from Database" },
    ]);
    expect(files.writes).toEqual([{ path: PATH, content: "select 22;\n", scope }]);
    expect(m.shown()?.file).toMatchObject({ modified: false });
    await m.settle();
    expect(marks().at(-1)).toEqual({ id: BUFFER, modified: false });

    // Revert reads the file again.
    files.files[PATH] = "select 3;\n";
    m.app.edited("select 4;\n");
    await m.host.command("desk.files.revert", { buffer: BUFFER, path: PATH });
    expect(m.shown()).toMatchObject({ text: "select 3;\n", file: { modified: false } });

    // A refused write keeps the file as it was and the edit unsaved.
    const refused = disk({ [PATH]: "select 1;\n" }, false);
    const r = await mount({
      store: { connections: SAVED },
      handlers: refused.handlers,
      pick: picker("c-lite", []),
    });
    await r.host.command("desk.files.visit", { buffer: BUFFER, path: PATH });
    r.app.edited("drop table x;\n");
    await expect(r.host.command("desk.files.save", { buffer: BUFFER, path: PATH })).rejects.toThrow(
      "Not allowed to write report.sql.",
    );
    expect(refused.files[PATH]).toBe("select 1;\n");
    expect(r.shown()?.file).toMatchObject({ modified: true });
  });

  it("hands a change on disk to the desk, which asks before the text is replaced", async () => {
    const files = disk({ [PATH]: "select 1;\n" });
    const changed: unknown[] = [];
    const m = await mount({
      store: { connections: SAVED },
      handlers: files.handlers,
      pick: picker("c-lite", []),
      commands: { "desk.files.changed": (args) => void changed.push(args) },
    });
    await m.host.command("desk.files.visit", { buffer: BUFFER, path: PATH });
    expect(files.watches).toEqual([
      { path: PATH, scope: { permission: "fs:read", paths: [PATH] } },
    ]);
    m.host.emit({ event: "fs.changed", data: { watchId: "w-1", path: PATH, change: "modified" } });
    await m.settle();
    expect(changed).toEqual([{ path: PATH }]);
  });

  it("opens a dropped .sql file as a console bound to it", async () => {
    const files = disk({ "/work/drops/q.sql": "select 'dropped';\n" });
    const m = await mount({ store: { connections: SAVED }, handlers: files.handlers });
    await m.host.command("endue.database.console", { connection: "Notes" });
    const done = await m.host.dnd.drop({
      items: [{ type: "desk/paths", paths: [{ path: "/work/drops/q.sql", kind: "file" }] }],
    });
    await m.settle();
    expect(done).toBe("copy");
    const opened = m.host.ran.filter((r) => r.name === "desk.buffers.open").at(-1);
    expect(opened?.args).toEqual({ name: "q.sql", path: "/work/drops/q.sql" });
    // The console on screen named the connection: nothing was asked.
    expect(m.picks).toHaveLength(0);
    expect(m.shown()).toMatchObject({
      kind: "console",
      connection: "c-lite",
      text: "select 'dropped';\n",
      file: { path: "/work/drops/q.sql" },
    });
    expect(m.view.inserted).toEqual([]);
  });

  it("opens a file past the editor's limit without loading it, and refuses to save it", async () => {
    const big = `${"select 1;\n".repeat(Math.ceil(EDITOR_MAX / 10) + 10)}`;
    const reads: Array<{ length?: number }> = [];
    const files = disk({ [PATH]: big });
    const read = files.handlers["fs.read"] as NonNullable<(typeof files.handlers)["fs.read"]>;
    const m = await mount({
      store: { connections: SAVED },
      pick: picker("c-lite", []),
      handlers: {
        ...files.handlers,
        "fs.read": (params, caller) => {
          reads.push({ length: (params as { length?: number }).length });
          return read(params, caller);
        },
      },
    });
    await m.host.command("desk.files.visit", { buffer: BUFFER, path: PATH });
    const shown = m.shown() as Console;
    expect(shown.file).toMatchObject({ large: true, size: big.length });
    expect(shown.text.length).toBeLessThan(400);
    expect(shown.text).toMatch(/Database: run a \.sql file/u);
    expect(reads.every((r) => r.length !== undefined && r.length <= EDITOR_MAX)).toBe(true);
    await expect(m.host.command("desk.files.save", { buffer: BUFFER, path: PATH })).rejects.toThrow(
      /larger than the editor/u,
    );
    expect(files.writes).toEqual([]);
  });
});
