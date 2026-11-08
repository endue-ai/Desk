// Drag and drop on Docker (#550, ADR 0119): a file or folder dropped on a container is copied in
// with docker cp, after the person confirms the folder, with its progress in the pane; containers,
// images and a container's files drag out as typed desk data with their id or path as text.
import { describe, expect, it } from "vitest";
import { FILE_KIND, fileDrag, itemDrag } from "../ui/dnd.js";
import { DB_ID, INSPECT } from "./fixtures";
import { LS_ROOT } from "./fixtures-more";
import { engine, mount, type Reply } from "./harness";

const DB = {
  kind: "container" as const,
  id: DB_ID,
  name: "shop-db-1",
  state: "running",
  project: "shop",
};
const paths = (...list: string[]) => [
  { type: "desk/paths" as const, paths: list.map((path) => ({ path, kind: "file" as const })) },
];
/** The container's inspect with a working folder of its own. */
const AT_APP = JSON.stringify(
  (JSON.parse(INSPECT) as Array<{ Config: object }>).map((c) => ({
    ...c,
    Config: { ...c.Config, WorkingDir: "/app" },
  })),
);

async function docker(
  options: {
    pick?: (args: { title: string; items: Array<{ id: string }> }) => unknown;
    cp?: Reply;
  } = {},
) {
  const picks: Array<{
    title: string;
    items: Array<{ id: string; label: string }>;
    free?: boolean;
  }> = [];
  const m = await mount({
    commands: {
      "desk.palette.pick": (args) => {
        picks.push(args as (typeof picks)[number]);
        return options.pick ? options.pick(args as never) : "";
      },
    },
    script: engine({
      "container inspect": { stdout: AT_APP },
      exec: { stdout: LS_ROOT },
      ...(options.cp ? { cp: options.cp } : {}),
    }),
  });
  const row = { parentNode: m.view.dropTarget, target: { kind: "container", item: DB } };
  const files = (path: string) => ({
    parentNode: m.view.dropTarget,
    target: { kind: "files", container: DB_ID, name: "shop-db-1", path },
  });
  const drop = async (items: ReturnType<typeof paths>, over: unknown) => {
    const done = await m.host.dnd.drop({ items, over, from: "endue.explorer" });
    await m.settle();
    return done;
  };
  return { ...m, picks, row, files, drop };
}

describe("dropping files on a container", () => {
  it("takes paths of this computer on a container or its Files tab, as a copy", async () => {
    const { host, view, row, files } = await docker();
    expect(host.dnd.accepts).toEqual(["desk/paths"]);
    expect(await host.dnd.hover({ items: paths("/Users/me/seed.sql"), over: row })).toBe("copy");
    expect(await host.dnd.hover({ items: paths("~/seed.sql"), over: files("/srv") })).toBe("copy");
    const nowhere = { parentNode: view.dropTarget };
    expect(await host.dnd.hover({ items: paths("/Users/me/seed.sql"), over: nowhere })).toBe(
      "none",
    );
    expect(await host.dnd.hover({ items: paths("/a"), over: row, effectAllowed: ["link"] })).toBe(
      "none",
    );
  });

  it("refuses a path docker cannot read here, before asking anything", async () => {
    const { drop, row, picks, docker: d, view } = await docker();
    expect(await drop(paths("C:/Users/me/a.txt"), row)).toBe("none");
    expect(picks).toEqual([]);
    expect(d.of("cp")).toEqual([]);
    expect(view.said.at(-1)).toBe(
      "Docker copies files of this computer only: C:/Users/me/a.txt is not one.",
    );
  });

  it("asks which folder, the container's working folder first, then runs docker cp into it", async () => {
    const { drop, row, picks, docker: d, view } = await docker();
    expect(await drop(paths("/Users/me/seed.sql"), row)).toBe("copy");
    expect(picks).toHaveLength(1);
    expect(picks[0]?.title).toBe("Docker: copy seed.sql into shop-db-1, into which folder?");
    expect(picks[0]?.items[0]?.id).toBe("/app");
    expect(picks[0]?.free).toBe(true);
    // The trailing slash makes docker refuse a folder that is not there, instead of renaming the file.
    expect(d.of("cp")).toEqual([["cp", "--", "/Users/me/seed.sql", `${DB_ID}:/app/`]]);
    expect(view.said).toContain("Copied seed.sql into shop-db-1:/app.");
    // The pane shows the folder it went to.
    expect(d.last("exec")?.args).toEqual(["exec", "--", DB_ID, "ls", "-lA", "--", "/app"]);
    expect(view.panes.at(-1)).toMatchObject({
      kind: "container",
      tab: "files",
      files: { path: "/app" },
    });
  });

  it("copies into the Files tab's folder, or the one typed, with each copy's progress", async () => {
    const { drop, files, picks, docker: d, view } = await docker({ pick: () => "/srv/data" });
    const done = await drop(paths("/Users/me/a.csv", "/Users/me/b.csv"), files("/srv"));
    expect(done).toBe("copy");
    expect(picks[0]?.title).toBe("Docker: copy 2 items into shop-db-1, into which folder?");
    expect(picks[0]?.items[0]?.id).toBe("/srv");
    expect(d.of("cp")).toEqual([
      ["cp", "--", "/Users/me/a.csv", `${DB_ID}:/srv/data/`],
      ["cp", "--", "/Users/me/b.csv", `${DB_ID}:/srv/data/`],
    ]);
    const ops = view.panes.filter((p) => (p as { kind?: string } | null)?.kind === "op") as Array<{
      title: string;
      state: string;
      op: { progress: { done: number; total: number }; lines: string[] };
    }>;
    expect(ops[0]?.title).toBe("Copy into shop-db-1:/srv/data");
    expect(ops.at(-1)?.state).toBe("done");
    expect(ops.at(-1)?.op.progress).toMatchObject({ done: 2, total: 2 });
    expect(ops.at(-1)?.op.lines).toContain("Copied /Users/me/b.csv into /srv/data.");
    expect(view.said).toContain("Copied 2 items into shop-db-1:/srv/data.");
    expect(view.panes.at(-1)).toMatchObject({ tab: "files", files: { path: "/srv/data" } });
  });

  it("copies a home-relative path from the home folder, never through a shell", async () => {
    const { drop, row, docker: d } = await docker();
    expect(await drop(paths("~/Downloads/seed data.sql"), row)).toBe("copy");
    const cp = d.last("cp");
    expect(cp?.args).toEqual(["cp", "--", "./Downloads/seed data.sql", `${DB_ID}:/app/`]);
    expect(cp?.cwd).toBe("~");
  });

  it("copies nothing when the person cancels or names a folder that is not one", async () => {
    const cancelled = await docker({ pick: () => null });
    expect(await cancelled.drop(paths("/Users/me/seed.sql"), cancelled.row)).toBe("none");
    expect(cancelled.docker.of("cp")).toEqual([]);
    const relative = await docker({ pick: () => "data" });
    expect(await relative.drop(paths("/Users/me/seed.sql"), relative.row)).toBe("none");
    expect(relative.docker.of("cp")).toEqual([]);
    expect(relative.view.said.at(-1)).toMatch(/not an absolute path in the container/);
  });

  it("stops at a copy that fails and says why", async () => {
    const stderr =
      "Error response from daemon: Could not find the file /app in container shop-db-1\n";
    const { drop, row, docker: d, view } = await docker({ cp: { code: 1, stderr } });
    expect(await drop(paths("/Users/me/a.csv", "/Users/me/b.csv"), row)).toBe("none");
    expect(d.of("cp")).toHaveLength(1);
    const op = view.panes.filter((p) => (p as { kind?: string } | null)?.kind === "op").at(-1);
    expect(op).toMatchObject({ state: "failed" });
    expect(view.said.at(-1)).toMatch(/^Copied nothing into shop-db-1:\/app: /);
  });
});

describe("dragging out of Docker", () => {
  it("drags a container or an image as typed JSON, with its id as text", () => {
    expect(itemDrag(DB)).toEqual({
      items: [
        {
          type: "desk/json",
          kind: "docker/container",
          value: { id: DB_ID, name: "shop-db-1", state: "running", project: "shop" },
        },
        { type: "desk/text", text: DB_ID },
      ],
      effectAllowed: ["copy", "link"],
      image: { label: "shop-db-1", detail: "container" },
    });
    const image = {
      kind: "image" as const,
      id: "sha256:9e1",
      ref: "postgres:17",
      dangling: false,
      containers: 1,
    };
    expect(itemDrag(image)?.items).toEqual([
      { type: "desk/json", kind: "docker/image", value: { id: "sha256:9e1", ref: "postgres:17" } },
      { type: "desk/text", text: "sha256:9e1" },
    ]);
    expect(itemDrag({ kind: "volume", name: "data" })).toBeUndefined();
  });

  it("drags a file of a container's Files tab as docker/file, its container:path as text", () => {
    expect(
      fileDrag({ id: DB_ID, name: "shop-db-1" }, { path: "/etc/my notes.txt", dir: false }),
    ).toEqual({
      items: [
        {
          type: "desk/json",
          kind: FILE_KIND,
          value: {
            container: DB_ID,
            path: "/etc/my notes.txt",
            name: "my notes.txt",
            kind: "file",
          },
        },
        { type: "desk/text", text: "shop-db-1:/etc/my notes.txt" },
      ],
      effectAllowed: ["copy"],
      image: { label: "my notes.txt", detail: "shop-db-1" },
    });
    expect(fileDrag({ id: DB_ID, name: "" }, { path: "/etc", dir: true })?.items[0]).toMatchObject({
      value: { kind: "folder", name: "etc" },
    });
  });

  it("copies a dragged file out to the folder a target names, from the home folder too", async () => {
    const { host, docker: d } = await docker();
    const words = await host.invoke("endue.docker.copy-out", {
      container: DB_ID,
      path: "/etc/hosts",
      dest: "~/Documents/Work",
    });
    expect(words).toBe("Copied /etc/hosts to ~/Documents/Work.");
    expect(d.last("cp")?.args).toEqual(["cp", "--", `${DB_ID}:/etc/hosts`, "./Documents/Work"]);
    expect(d.last("cp")?.cwd).toBe("~");
  });
});
