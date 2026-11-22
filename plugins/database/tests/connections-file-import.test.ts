// What an import of connections does (#452, PG-15): the preview of each entry against the
// connections here (a change by id, one already here, a name taken here, a new one) with their
// default ticks, nothing written while it shows or when it is cancelled; then what is ticked kept at
// once: a taken name under a free one, a change keeping this computer's keychain choice and
// forgetting a kept password whose server changed.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import type { Feature } from "../ui/feature-host.js";
import { FORMAT } from "../ui/features/connections-file/file.js";
import * as builtins from "../ui/features/index.js";
import { mounted } from "./connections-file-harness";
import { SAVED } from "./harness";

type Deps = Parameters<NonNullable<Feature["commands"]>>[0];
const PASSWORD = "fixture-import-password";
const SHOP = SAVED[1] as Connection;
const NOTES = SAVED[0] as Connection;
const ARCHIVE: Connection = { ...NOTES, id: "c-arch", name: "Archive", file: "~/archive.db" };
const FILE = JSON.stringify({
  format: FORMAT,
  version: 1,
  exported: "2026-11-22T09:00:00.000Z",
  connections: [
    { ...SHOP, host: "db2.example" },
    NOTES,
    { ...NOTES, id: "c-new1", name: "archive", file: "~/old-archive.db" },
    { ...SHOP, id: "c-new2", name: "Reports", database: "reports" },
  ],
});
const at = { "~/in.json": FILE };

describe("importing connections", () => {
  it("previews what is added, changed, already here and taken by name, and writes nothing until confirmed", async () => {
    const before = [SHOP, NOTES, ARCHIVE];
    let during: unknown;
    const f = await mounted({
      connections: before,
      files: at,
      open: "~/in.json",
      answer: () => {
        during = structuredClone(f.stored());
        return undefined;
      },
    });
    await expect(f.m.host.command("endue.database.import-connections")).rejects.toThrow(
      "Not imported.",
    );
    const model = f.shown[0]?.model;
    expect(model).toMatchObject({
      file: "in.json",
      kind: "connections",
      version: 1,
      exported: "2026-11-22T09:00:00.000Z",
    });
    expect(model.rows.map((r: any) => [r.conn.name, r.kind, r.was, r.changes, r.ticked])).toEqual([
      ["Shop", "change", "Shop", ["host"], true],
      ["Notes", "same", "Notes", [], false],
      ["archive", "taken", "Archive", [], false],
      ["Reports", "add", "", [], true],
    ]);
    expect(during).toEqual(before);
    expect(f.stored()).toEqual(before);
    expect(
      f.m.host.calls.filter(
        (c) => c.method === "store.set" && (c.params as any).key === "connections",
      ),
    ).toEqual([]);
  });

  it("adds what is ticked", async () => {
    let deps: Deps | undefined;
    const probe: Feature = {
      id: "probe",
      commands: (given) => {
        deps = given;
        return {};
      },
    };
    const f = await mounted({
      connections: [SHOP, NOTES, ARCHIVE],
      files: at,
      open: "~/in.json",
      script: () => ({ rows: [["?column?"], ["1"]] }),
      password: PASSWORD,
      pick: () => "yes",
      features: [...Object.values(builtins), probe],
      answer: () => ({ ticked: [0, 1, 2, 3] }),
    });
    await f.m.host.command("endue.database.console", { connection: "Shop" });
    f.m.view.text = "select 1";
    const running = f.m.host.command("endue.database.run");
    await f.m.settle();
    f.m.app.password(PASSWORD, true);
    await running;
    await f.m.settle();
    const kept = async () => (await (deps as Deps).bridge.call("db.passwords.list", {})).passwords;
    expect((await kept()).map((p: { name: string }) => p.name)).toEqual(["c-prod"]);

    const done = await f.m.host.command("endue.database.import-connections");
    await f.m.settle();
    expect(done).toEqual({ added: 2, changed: 1, skipped: 1 });
    const stored = f.stored();
    expect(stored.map((c) => [c.id, c.name])).toEqual([
      ["c-prod", "Shop"],
      ["c-lite", "Notes"],
      ["c-arch", "Archive"],
      ["c-new1", "archive (2)"],
      ["c-new2", "Reports"],
    ]);
    expect(stored[0]).toMatchObject({ host: "db2.example", keychain: true });
    expect(stored[4]).not.toHaveProperty("keychain");
    expect(await kept()).toEqual([]);
    expect(f.m.view.said.at(-1)).toBe("Imported from in.json: 2 added, 1 changed, 1 skipped.");
    expect(f.m.view.trees.at(-1)?.map((n) => n.label)).toContain("archive (2)");
  });
});
