import { describe, expect, it } from "vitest";
import { dropAction } from "../ui/drop.js";
import {
  containerPath,
  copyInArgs,
  copyOutArgs,
  lsArgs,
  lsProblem,
  parentOf,
  parseLs,
} from "../ui/files.js";
import { DB_ID } from "./fixtures";
import { LS_ROOT } from "./fixtures-more";
import { engine, mount } from "./harness";

describe("a container's files (DOCK-22)", () => {
  it("checks container paths and lists a folder with the container's own ls", () => {
    expect(containerPath("/etc/../usr//lib/")).toBe("/usr/lib");
    expect(containerPath("/")).toBe("/");
    expect(() => containerPath("etc")).toThrow(/absolute path in the container/);
    expect(() => containerPath("/a\0b")).toThrow();
    expect(parentOf("/usr/lib")).toBe("/usr");
    expect(parentOf("/usr")).toBe("/");
    expect(lsArgs(DB_ID, "/var/lib/")).toEqual([
      "exec",
      "--",
      DB_ID,
      "ls",
      "-lA",
      "--",
      "/var/lib",
    ]);
  });

  it("reads ls -lA: folders first, links with their target, devices as other, names with spaces", () => {
    const entries = parseLs(LS_ROOT, "/");
    expect(entries.map((e) => [e.name, e.kind, e.size, e.path])).toEqual([
      ["boot", "dir", "", "/boot"],
      ["etc", "dir", "", "/etc"],
      [".dockerenv", "file", "0", "/.dockerenv"],
      ["bin", "link", "", "/bin"],
      ["my notes.txt", "file", "220", "/my notes.txt"],
      ["null", "other", "", "/null"],
    ]);
    expect(entries[3]?.target).toBe("usr/bin");
    expect(entries[4]?.modified).toBe("Jan 6 2025");
    expect(
      lsProblem(
        'OCI runtime exec failed: exec failed: unable to start container process: exec: "ls": executable file not found in $PATH',
      ),
    ).toMatch(/has no ls/);
    expect(lsProblem("Container 3f77 is not running")).toMatch(/^Start the container/);
  });

  it("copies out to and in from this computer with docker cp, paths checked", () => {
    expect(copyOutArgs(DB_ID, "/etc/hosts", "/tmp/out/")).toEqual([
      "cp",
      "--",
      `${DB_ID}:/etc/hosts`,
      "/tmp/out",
    ]);
    expect(copyInArgs("/Users/me/seed.sql", DB_ID, "/docker-entrypoint-initdb.d")).toEqual([
      "cp",
      "--",
      "/Users/me/seed.sql",
      `${DB_ID}:/docker-entrypoint-initdb.d`,
    ]);
    expect(() => copyOutArgs(DB_ID, "/etc", "out")).toThrow(/destination/);
    expect(() => copyInArgs("-a", DB_ID, "/tmp")).toThrow(/source/);
  });

  it("leaves a drop target's seam: a path dropped on a folder is a copy in", () => {
    expect(
      dropAction({ kind: "files", container: DB_ID, path: "/srv" }, ["/Users/me/a.txt", "rel"]),
    ).toEqual([
      {
        command: "endue.docker.copy-in",
        args: { container: DB_ID, source: "/Users/me/a.txt", path: "/srv" },
      },
    ]);
    expect(dropAction({ kind: "list" }, ["/Users/me/a.txt"])).toEqual([]);
  });
});

describe("the Files tab", () => {
  it("browses a running container, copies a path out and a file in, and lists again", async () => {
    const m = await mount({
      commands: { "desk.palette.pick": () => "/Users/me/Downloads" },
      script: engine({ exec: { stdout: LS_ROOT } }),
    });
    const listed = (await m.host.invoke("endue.docker.files", { container: DB_ID })) as Array<{
      name: string;
    }>;
    expect(listed.map((e) => e.name)).toContain("my notes.txt");
    expect(m.docker.last("exec")?.args).toEqual(["exec", "--", DB_ID, "ls", "-lA", "--", "/"]);
    expect(m.view.panes.at(-1)).toMatchObject({
      kind: "container",
      tab: "files",
      files: { path: "/", problem: "" },
    });
    expect(await m.host.invoke("endue.docker.copy-out", { container: DB_ID, path: "/etc" })).toBe(
      "Copied /etc to /Users/me/Downloads.",
    );
    expect(m.docker.last("cp")?.args).toEqual(["cp", "--", `${DB_ID}:/etc`, "/Users/me/Downloads"]);
    const lists = m.docker.of("exec").length;
    expect(
      await m.host.invoke("endue.docker.copy-in", {
        container: DB_ID,
        source: "/Users/me/seed.sql",
        path: "/tmp",
      }),
    ).toBe("Copied /Users/me/seed.sql into /tmp.");
    expect(m.docker.last("cp")?.args).toEqual(["cp", "--", "/Users/me/seed.sql", `${DB_ID}:/tmp`]);
    expect(m.docker.of("exec").length).toBe(lists + 1);
  });

  it("says why a container cannot be browsed", async () => {
    const m = await mount({
      script: engine({
        exec: {
          code: 126,
          stderr:
            'OCI runtime exec failed: exec failed: unable to start container process: exec: "ls": executable file not found in $PATH: unknown\n',
        },
      }),
    });
    expect(await m.host.invoke("endue.docker.files", { container: DB_ID, path: "/" })).toEqual([]);
    expect(m.view.panes.at(-1)).toMatchObject({
      files: { entries: [], problem: expect.stringMatching(/has no ls/) },
    });
  });
});
