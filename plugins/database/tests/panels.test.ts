// A panel is a desk buffer like a console (ui/panels.js): it opens once per type and name, shows,
// takes a new state, closes, and comes back after a restart when its state says so. The ER diagram
// is a panel that keeps nothing, as before.
import { describe, expect, it } from "vitest";
import type { Feature } from "../ui/feature-host.js";
import * as builtins from "../ui/features/index.js";
import { fakeFeature } from "./fake-feature";
import { type Mounted, mount, SAVED } from "./harness";

const features = (): Feature[] => [...Object.values(builtins), fakeFeature()];
const acts = (m: Mounted) =>
  m.app as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
const opened = (m: Mounted) =>
  m.host.ran
    .filter((r) => r.name === "desk.buffers.open")
    .map((r) => (r.args as { name: string }).name);

/** sqlite3's answers to the ER diagram's two queries: one table with a key, no foreign keys. */
const diagramScript = (sql: string) =>
  sql.includes("pragma_table_info")
    ? {
        rows: [
          ["table", "column", "type", "key"],
          ["notes", "id", "integer", "YES"],
        ],
      }
    : { rows: [["table", "name", "from", "to", "columns"]] };

describe("panels", () => {
  it("opens a panel as a buffer, finds it again by type and name, updates it and closes it", async () => {
    const m = await mount({ store: { connections: SAVED }, features: features() });
    await m.host.command("endue.database.fake-open", { connection: "Notes" });
    const first = m.shown();
    expect(first).toMatchObject({ kind: "fake", connection: "c-lite", name: "count: Notes" });
    await m.host.command("endue.database.console", { connection: "Notes" });
    await m.host.command("endue.database.fake-open", { connection: "Notes", n: 3 });
    expect(m.shown()).toMatchObject({ id: first?.id, fake: { n: 3 } });
    expect(opened(m)).toEqual(["count: Notes", "db: Notes"]);
    await acts(m).fakeBump?.(2);
    expect(m.shown()?.fake).toEqual({ n: 5 });
    await m.host.command("desk.buffers.closed", { buffer: first?.id });
    await m.settle();
    expect(m.shown()).toBeNull();
    await acts(m).fakeBump?.(1);
    expect(m.view.said.at(-1)).toBe("No counter on screen.");
    await m.host.command("endue.database.fake-open", { connection: "Notes" });
    expect(m.shown()?.id).not.toBe(first?.id);
  });

  it("brings a panel back after a restart when its state says so, on screen when it was, and leaves the ER diagram out", async () => {
    const before = await mount({
      store: { connections: SAVED },
      script: diagramScript,
      features: features(),
    });
    await before.host.command("endue.database.fake-open", { connection: "Notes" });
    await expect(
      before.host.command("endue.database.er-diagram", { connection: "Notes", schema: "main" }),
    ).resolves.toEqual({ tables: 1, links: 0 });
    expect(before.shown()?.kind).toBe("diagram");
    await before.host.command("endue.database.fake-open", { connection: "Shop", n: 4, keep: true });
    await before.settle();
    expect(before.host.state).toMatchObject({
      current: "c-prod",
      panels: [
        {
          type: "fake",
          connection: "c-prod",
          name: "count: Shop",
          state: { n: 4, keep: true },
          shown: true,
        },
      ],
    });

    const after = await mount({
      store: before.store,
      state: before.host.state,
      features: features(),
    });
    expect(after.shown()).toMatchObject({
      kind: "fake",
      connection: "c-prod",
      name: "count: Shop",
      fake: { n: 4, keep: true },
    });
    expect(opened(after)).toEqual(["db: Shop", "count: Shop"]);
  });

  it("brings a kept panel back behind the console that was on screen", async () => {
    const before = await mount({ store: { connections: SAVED }, features: features() });
    await before.host.command("endue.database.fake-open", { connection: "Shop", n: 7, keep: true });
    await before.host.command("endue.database.console", { connection: "Notes" });
    await before.settle();
    const ids = new Map<string, string>();
    const after = await mount({
      store: before.store,
      state: before.host.state,
      features: features(),
      commands: {
        "desk.buffers.open": (args) => {
          const id = `buffer-${ids.size + 1}`;
          ids.set((args as { name: string }).name, id);
          return id;
        },
      },
    });
    expect(after.shown()).toMatchObject({ kind: "console", name: "db: Notes" });
    expect([...ids.keys()]).toEqual(["db: Notes", "count: Shop"]);
    // It came back without taking the screen, even for a moment.
    expect(after.view.consoles.some((c) => c.model?.kind === "fake")).toBe(false);
    await after.host.command("desk.buffers.show", { buffer: ids.get("count: Shop") });
    expect(after.shown()).toMatchObject({ kind: "fake", fake: { n: 7, keep: true } });
  });
});
