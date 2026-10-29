import { describe, expect, it } from "vitest";
import { disk, mount, note } from "./harness";

const A = note("~/Notes/a.md");
const changedOnDisk = (watchId: string) =>
  ({ event: "fs.changed", data: { watchId, path: A.path, change: "modified" } }) as const;

describe("changes on disk", () => {
  it("a change on disk runs desk.files.changed with the path", async () => {
    const answered: unknown[] = [];
    const { host, ran, settle } = await mount({
      handlers: { ...disk({ [A.path]: "# A\n" }), "fs.watch": () => ({ watchId: "w1" }) },
      commands: {
        "desk.files.changed": (args) => {
          answered.push(args);
          return "reloaded";
        },
      },
    });
    await host.command("desk.files.visit", A);
    host.emit(changedOnDisk("w1"));
    await settle();
    expect(host.ran).toEqual([{ name: "desk.files.changed", args: { path: A.path } }]);
    expect(ran("desk.files.changed")).toEqual([{ path: A.path }]);
    expect(answered).toEqual([{ path: A.path }]);
  });

  it("changes for a closed note or an unknown watch run nothing", async () => {
    const { host, ran, settle } = await mount({
      handlers: { ...disk({ [A.path]: "# A\n" }), "fs.watch": () => ({ watchId: "w1" }) },
    });
    await host.command("desk.files.visit", A);
    host.emit(changedOnDisk("w9"));
    await settle();
    expect(ran("desk.files.changed")).toEqual([]);

    host.emit(changedOnDisk("w1"));
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);

    await host.command("desk.buffers.closed", { buffer: A.buffer });
    host.emit(changedOnDisk("w1"));
    await settle();
    expect(ran("desk.files.changed")).toHaveLength(1);
  });

  it("a note still opens when fs.watch is refused", async () => {
    const handlers = disk({ [A.path]: "# A\n" });
    delete handlers["fs.watch"];
    const { host, view, params } = await mount({ handlers });
    await expect(host.command("desk.files.visit", A)).resolves.toBeUndefined();
    expect(params("fs.watch")).toHaveLength(1);
    expect(view.notes.at(-1)).toMatchObject({ buffer: A.buffer, text: "# A\n", modified: false });
    expect(view.statuses).toEqual([]);
  });
});
