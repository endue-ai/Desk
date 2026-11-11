// One extraction asks one question, for fs:write on the folder the person picked (#162 finding 15:
// a folder outside the archive's own asked a second time, to read it, before anything was written).
// The files already there are found under the read grants Archives holds; a folder it may not read
// is written as fs.write writes, which keeps what it replaces. "Allow once" lets one call through,
// so an extraction of more files than one says so before it writes anything.
import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { zipOf } from "./fixtures";
import { file, type Handlers, mount, READ, WRITE } from "./harness";

const PATH = "~/Downloads/pack.zip";
const PACK = zipOf([
  { name: "a.txt", data: "a" },
  { name: "sub/b.txt", data: "bb" },
  { name: "sub/deeper/c.txt", data: "ccc" },
]);
/** A folder outside the one the archive is in: no grant Archives holds reads it. */
const ELSEWHERE = "/tmp/out";
const BESIDE = "~/Downloads/pack";

/**
 * fs.list answers `folders` (names in each) and is refused outside `readable`; fs.write records each
 * write, and answers a version for the paths in `there` (a file it replaced).
 */
function disk({ folders = {}, readable = "~/Downloads/", there = [] as string[] } = {}) {
  const written: string[] = [];
  const handlers: Handlers = {
    "fs.list": ({ path }) => {
      if (!path.startsWith(readable)) throw new StubError("permission_denied", "fs:read");
      const names = folders[path as keyof typeof folders] as string[] | undefined;
      if (!names) throw new StubError("not_found", `${path} does not exist`);
      return { entries: names.map((name) => ({ name, kind: "file" as const, size: 1 })) };
    },
    "fs.write": ({ path, content }) => {
      written.push(path);
      return { bytesWritten: content.length, ...(there.includes(path) ? { version: "v1" } : {}) };
    },
  };
  return { written, handlers };
}

/** The person's answer to the one question: granted for the session, or once (a grant's id). */
const answered = (duration: "session" | "once"): Handlers => ({
  "perm.request": ({ permission }) => ({
    granted: true,
    grant: { grantId: "g7", permission, duration, grantedAt: "2026-11-12T00:00:00Z" },
  }),
  "perm.revoke": () => ({}),
});

async function extracting(
  target: string,
  how: { handlers: Handlers; picks?: string[] } = { handlers: disk().handlers },
) {
  const picks = [target, ...(how.picks ?? [])];
  const mounted = await mount({
    files: { [PATH]: PACK },
    grants: [READ("~/Downloads")],
    handlers: how.handlers,
    commands: {
      "desk.palette.pick": () => picks.shift() ?? Promise.reject(new Error("cancelled")),
    },
  });
  await mounted.host.command("desk.files.visit", file(PATH));
  await mounted.app.extract("all");
  return mounted;
}

describe("one extraction, one question (#162 finding 15)", () => {
  it("into a new folder Archives may not read: asks for fs:write only, and finishes", async () => {
    const { written, handlers } = disk();
    const { params, view } = await extracting(ELSEWHERE, { handlers });
    expect(params("perm.request")).toEqual([
      { permission: WRITE(ELSEWHERE), reason: `To extract pack.zip to ${ELSEWHERE}` },
    ]);
    expect(written).toEqual([
      `${ELSEWHERE}/a.txt`,
      `${ELSEWHERE}/sub/b.txt`,
      `${ELSEWHERE}/sub/deeper/c.txt`,
    ]);
    expect(view.statuses.at(-1)).toBe(`Extracted 3 files (6 bytes) to ${ELSEWHERE}.`);
  });

  it("into a folder it may not read that held a file of the same name: replaced, and said", async () => {
    const { written, handlers } = disk({ there: [`${ELSEWHERE}/sub/b.txt`] });
    const { params, view } = await extracting(ELSEWHERE, { handlers });
    expect(params("perm.request")).toHaveLength(1);
    expect(written).toHaveLength(3);
    expect(view.statuses.at(-1)).toBe(
      `Extracted 3 files (6 bytes) to ${ELSEWHERE}. Replaced 1 file that was already there: sub/b.txt; the desk keeps what it held in its history.`,
    );
  });

  it("beside the archive, which its grants read: a file already there still asks once for the run", async () => {
    const { written, handlers } = disk({ folders: { [BESIDE]: ["a.txt"] } });
    const { params, ran } = await extracting(BESIDE, { handlers, picks: ["skip"] });
    expect(params("perm.request")).toEqual([
      { permission: WRITE(BESIDE), reason: `To extract pack.zip to ${BESIDE}` },
    ]);
    expect(ran("desk.palette.pick")).toHaveLength(2);
    expect(written).toEqual([`${BESIDE}/sub/b.txt`, `${BESIDE}/sub/deeper/c.txt`]);
  });

  it("a new folder is listed once, not folder by folder", async () => {
    const { handlers } = disk();
    const { params } = await extracting(BESIDE, { handlers });
    expect(params("fs.list")).toEqual([{ path: BESIDE, scope: READ(BESIDE) }]);
  });

  it("Allow once for an extraction of three files: writes nothing, says why and gives the grant back", async () => {
    const { written, handlers } = disk();
    const { params, view } = await extracting(ELSEWHERE, {
      handlers: { ...handlers, ...answered("once") },
    });
    expect(written).toEqual([]);
    expect(params("perm.revoke")).toEqual([{ grantId: "g7" }]);
    expect(view.statuses.at(-1)).toBe(
      `Nothing was extracted: "Allow once" lets Archives write one file, and pack.zip has 3 to write. Extract again and allow it for this session.`,
    );
  });

  it("Allow once for one file writes it", async () => {
    const { written, handlers } = disk();
    const mounted = await mount({
      files: { [PATH]: PACK },
      grants: [READ("~/Downloads")],
      handlers: { ...handlers, ...answered("once") },
      commands: { "desk.palette.pick": () => ELSEWHERE },
    });
    await mounted.host.command("desk.files.visit", file(PATH));
    await mounted.app.select("a.txt");
    await mounted.app.extract("selected");
    expect(written).toEqual([`${ELSEWHERE}/a.txt`]);
    expect(mounted.params("perm.revoke")).toEqual([]);
    expect(mounted.view.statuses.at(-1)).toBe(`Extracted 1 file (1 byte) to ${ELSEWHERE}.`);
  });
});
