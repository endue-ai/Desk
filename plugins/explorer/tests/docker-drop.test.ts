// A container's file dropped on an explorer folder (#550): Docker drags it as desk/json docker/file
// (it has no path on this computer), and the folder copies it there with Docker's own copy-out, a
// name already in the folder asking first, then lists the folder again.
import { describe, expect, it } from "vitest";
import { stubFileTree } from "../../../packages/runtime/src/bridge/fs";
import { createDrops } from "../ui/drops.js";
import { DOCS, type Handlers, mount } from "./harness";

const WORK = `${DOCS}/Work`;
const CONTAINER = "3f771f073bb54447231a5e72d999ce7af2cfce86c3a48c1071ad600aa70beaa5";
const file = (path: string, kind: "file" | "folder" = "file") => ({
  container: CONTAINER,
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind,
});
const dragged = (...files: Array<ReturnType<typeof file>>) => [
  ...files.map((value) => ({ type: "desk/json" as const, kind: "docker/file", value })),
  { type: "desk/text" as const, text: files.map((f) => `shop-db-1:${f.path}`).join("\n") },
];

async function explorer(options: { pick?: string; copyOut?: (args: unknown) => unknown } = {}) {
  const files = stubFileTree({
    files: { [`${WORK}/hosts`]: "127.0.0.1 localhost\n", [`${DOCS}/b.txt`]: "b" },
    folders: [`${WORK}/deep`],
  });
  const mounted = await mount({
    handlers: files.handlers as Handlers,
    store: { tree: { expanded: [DOCS, WORK], selected: null } },
    ...(options.pick ? { pick: () => options.pick } : {}),
    commands: {
      "endue.docker.copy-out":
        options.copyOut ?? ((args) => `Copied ${(args as { path: string }).path}.`),
    },
  });
  const drop = async (folder: string, items: ReturnType<typeof dragged>) => {
    const done = await mounted.host.dnd.drop({
      items,
      over: mounted.view.row(folder),
      from: "endue.docker",
      effectAllowed: ["copy"],
    });
    await mounted.settle();
    return done;
  };
  return { ...mounted, tree: files.tree, drop };
}

describe("a container's file dropped on an explorer folder", () => {
  it("takes docker/file beside paths, as a copy", async () => {
    const { host, view } = await explorer();
    expect(host.dnd.accepts).toEqual(["desk/json:docker/file", "desk/paths"]);
    const items = dragged(file("/etc/os-release"));
    expect(await host.dnd.hover({ items, over: view.row(WORK), effectAllowed: ["copy"] })).toBe(
      "copy",
    );
    expect(await host.dnd.hover({ items, over: view.row(WORK), effectAllowed: ["link"] })).toBe(
      "none",
    );
  });

  it("copies it into the folder with endue.docker.copy-out, then lists the folder again", async () => {
    const { drop, ran, params, view } = await explorer();
    const listed = params("fs.list").length;
    expect(
      await drop(`${WORK}/deep`, dragged(file("/etc/os-release"), file("/var/log", "folder"))),
    ).toBe("copy");
    expect(ran("endue.docker.copy-out")).toEqual([
      { container: CONTAINER, path: "/etc/os-release", dest: `${WORK}/deep` },
      { container: CONTAINER, path: "/var/log", dest: `${WORK}/deep` },
    ]);
    expect(params("fs.list").length).toBeGreaterThan(listed);
    expect(view.statuses.at(-1)).toBe("Copied 2 items to deep.");
  });

  it("asks before a name that is already there: keep both names the copy anew", async () => {
    const { drop, ran } = await explorer({ pick: "keep" });
    expect(await drop(WORK, dragged(file("/etc/hosts")))).toBe("copy");
    expect(ran("desk.palette.pick")).toHaveLength(1);
    expect(ran("endue.docker.copy-out")).toEqual([
      { container: CONTAINER, path: "/etc/hosts", dest: `${WORK}/hosts 2` },
    ]);
  });

  it("replaces through the Trash, or skips", async () => {
    const replaced = await explorer({ pick: "replace" });
    expect(await replaced.drop(WORK, dragged(file("/etc/hosts")))).toBe("copy");
    expect(replaced.params("fs.trash")).toMatchObject([{ path: `${WORK}/hosts` }]);
    expect(replaced.ran("endue.docker.copy-out")).toEqual([
      { container: CONTAINER, path: "/etc/hosts", dest: WORK },
    ]);
    const skipped = await explorer({ pick: "skip" });
    expect(await skipped.drop(WORK, dragged(file("/etc/hosts")))).toBe("none");
    expect(skipped.ran("endue.docker.copy-out")).toEqual([]);
  });

  it("says why a copy failed", async () => {
    const { drop, view } = await explorer({
      copyOut: () => {
        throw new Error("The docker program is not on PATH");
      },
    });
    expect(await drop(WORK, dragged(file("/etc/os-release")))).toBe("none");
    expect(view.statuses.at(-1)).toMatch(/^Could not copy os-release to Work: /);
  });

  it("asks once for the command when its grant is missing", async () => {
    const asked: unknown[] = [];
    let refused = false;
    const drops = createDrops(
      {
        bridge: {
          call: async (method: string, params: unknown) => {
            if (method === "perm.request") asked.push(params);
            return { granted: true };
          },
        } as never,
        commands: {
          run: async () => {
            if (refused) return "Copied.";
            refused = true;
            throw Object.assign(new Error("not granted"), { code: "permission_denied" });
          },
        } as never,
      },
      {},
      { say: () => {}, rootOf: () => DOCS, list: async () => [], placed: async () => {} },
    );
    expect(await drops.fromContainer({ files: [file("/etc/hosts")], folder: WORK })).toBe("copy");
    expect(asked).toEqual([
      {
        permission: { permission: "cmd:invoke", ids: ["endue.docker.copy-out"] },
        reason: `To copy hosts out of its container to ${WORK}`,
      },
    ]);
  });
});
