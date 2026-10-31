import { describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { safeTarget } from "../ui/safety.js";
import { zipOf } from "./fixtures";
import { type Commands, file, type Handlers, mount, READ, WRITE } from "./harness";

const PATH = "~/Downloads/evil.zip";
const TARGET = "~/Downloads/evil";
const EVIL = zipOf([
  { name: "ok.txt", data: "fine" },
  { name: "sub/in.txt", data: "inside", deflate: true },
  { name: "../evil", data: "x" },
  { name: "/etc/x", data: "x" },
  { name: "C:\\x", data: "x" },
  { name: "sub/..\\..\\win", data: "x" },
  { name: "out", link: "../../outside" },
  { name: "sub/up", link: "/etc/passwd" },
]);

const base64 = (text: string) => Buffer.from(text).toString("base64");

/** fs.write into `written`, fs.list from `existing` (folder -> names); everything recorded. */
function disk(existing: Record<string, string[]> = {}, onWrite?: (path: string) => void) {
  const written: Record<string, string> = {};
  const handlers: Handlers = {
    "fs.write": ({ path, content }) => {
      onWrite?.(path);
      written[path] = content;
      return { bytesWritten: content.length };
    },
    "fs.list": ({ path }) => {
      const names = existing[path];
      if (!names) throw new StubError("not_found", `${path} does not exist`);
      return { entries: names.map((name) => ({ name, kind: "file" as const, size: 1 })) };
    },
  };
  return { written, handlers };
}

/** desk.palette.pick answered in order: the target folder, then what to do about existing files. */
function picks(...answers: string[]): { commands: Commands; asked: unknown[] } {
  const asked: unknown[] = [];
  return {
    asked,
    commands: {
      "desk.palette.pick": (args) => {
        asked.push(args);
        const answer = answers.shift();
        if (answer === undefined) throw new Error("cancelled: nothing was picked");
        return answer;
      },
    },
  };
}

async function opened(existing?: Record<string, string[]>, ...answers: string[]) {
  const { written, handlers } = disk(existing);
  const { commands, asked } = picks(...answers);
  const mounted = await mount({
    files: { [PATH]: EVIL },
    grants: [READ("~/Downloads")],
    handlers,
    commands,
  });
  await mounted.host.command("desk.files.visit", file(PATH));
  return { ...mounted, written, asked };
}

describe("paths that would land outside the folder", () => {
  it("are refused: .., absolute paths, drive letters, backslashes and links out", () => {
    expect(safeTarget(TARGET, "ok.txt")).toEqual({ path: `${TARGET}/ok.txt` });
    expect(safeTarget(TARGET, "./sub//in.txt")).toEqual({ path: `${TARGET}/sub/in.txt` });
    expect(safeTarget(TARGET, "a/../b.txt")).toEqual({ path: `${TARGET}/b.txt` });
    for (const name of ["../evil", "a/../../evil", "/etc/x", "C:\\x", "c:x", "sub\\..\\..\\win"])
      expect(safeTarget(TARGET, name), name).toHaveProperty("refused");
    expect(safeTarget(TARGET, "out", "../../outside")).toHaveProperty("refused");
    expect(safeTarget(TARGET, "sub/up", "/etc/passwd")).toHaveProperty("refused");
    expect(safeTarget(TARGET, "sub/same", "../ok.txt")).toEqual({ path: `${TARGET}/sub/same` });
  });
});

describe("extraction", () => {
  it("asks for the folder, then fs:write on it, and writes with createDirs", async () => {
    const { app, asked, written, params, view } = await opened({}, TARGET);
    await app.extract("all");
    expect(asked[0]).toMatchObject({
      title: "Extract evil.zip to",
      free: true,
      placeholder: TARGET,
      items: [{ id: TARGET, label: TARGET }],
    });
    expect(params("perm.request")).toEqual([
      { permission: WRITE(TARGET), reason: `To extract evil.zip to ${TARGET}` },
    ]);
    expect(params("fs.write")).toEqual([
      {
        path: `${TARGET}/ok.txt`,
        content: base64("fine"),
        encoding: "base64",
        createDirs: true,
        scope: WRITE(TARGET),
      },
      {
        path: `${TARGET}/sub/in.txt`,
        content: base64("inside"),
        encoding: "base64",
        createDirs: true,
        scope: WRITE(TARGET),
      },
    ]);
    expect(Object.keys(written)).toEqual([`${TARGET}/ok.txt`, `${TARGET}/sub/in.txt`]);
    const said = view.statuses.at(-1) ?? "";
    expect(said).toContain(`Extracted 2 files (10 bytes) to ${TARGET}.`);
    // Names are shown with "/" between their parts, as the tree shows them.
    expect(said).toContain("Refused 6 outside the folder: ../evil, /etc/x, C:/x, sub/../../win");
    expect(said).toContain("out, sub/up.");
  });

  it("extracts the selection: a folder and what is under it", async () => {
    const { app, written } = await opened({}, TARGET);
    await app.select("sub");
    await app.extract("selected");
    expect(Object.keys(written)).toEqual([`${TARGET}/sub/in.txt`]);
  });

  it("asks once for the run about existing files: overwrite", async () => {
    const existing = { [TARGET]: ["ok.txt"], [`${TARGET}/sub`]: ["in.txt"] };
    const { app, asked, written } = await opened(existing, TARGET, "overwrite");
    await app.extract("all");
    expect(asked).toHaveLength(2);
    expect(asked[1]).toMatchObject({
      title: `ok.txt already exists in ${TARGET}`,
      items: [{ id: "overwrite" }, { id: "skip" }, { id: "stop" }],
    });
    expect(Object.keys(written)).toEqual([`${TARGET}/ok.txt`, `${TARGET}/sub/in.txt`]);
  });

  it("skip leaves existing files alone; stop ends the run", async () => {
    const existing = { [TARGET]: ["ok.txt"] };
    const skipping = await opened(existing, TARGET, "skip");
    await skipping.app.extract("all");
    expect(Object.keys(skipping.written)).toEqual([`${TARGET}/sub/in.txt`]);
    expect(skipping.view.statuses.at(-1)).toContain("Skipped 1 that already existed.");

    const stopping = await opened(existing, TARGET, "stop");
    await stopping.app.extract("all");
    expect(Object.keys(stopping.written)).toEqual([]);
    expect(stopping.view.statuses.at(-1)).toContain("Stopped after 0 of 2 files.");
  });

  it("a refused fs:write writes nothing and says why", async () => {
    const { written, handlers } = disk();
    const { commands } = picks(TARGET);
    const { host, app, view } = await mount({
      files: { [PATH]: EVIL },
      grants: [READ("~/Downloads")],
      prompt: (data) => data.permission.permission !== "fs:write",
      handlers,
      commands,
    });
    await host.command("desk.files.visit", file(PATH));
    await app.extract("all");
    expect(written).toEqual({});
    expect(view.statuses.at(-1)).toBe(`Not allowed to write ${TARGET}.`);
  });

  it("Escape stops between files and the progress line counts files and bytes", async () => {
    let app: { stop(): void } | undefined;
    const { written, handlers } = disk({}, () => app?.stop());
    const { commands } = picks(TARGET);
    const mounted = await mount({
      files: { [PATH]: EVIL },
      grants: [READ("~/Downloads")],
      handlers,
      commands,
    });
    app = mounted.app;
    await mounted.host.command("desk.files.visit", file(PATH));
    await mounted.app.extract("all");
    expect(Object.keys(written)).toEqual([`${TARGET}/ok.txt`]);
    expect(mounted.view.progresses).toContain("Extracting 1 of 2 files, 4 bytes of 10 bytes");
    expect(mounted.view.statuses.at(-1)).toContain("Stopped after 1 of 2 files.");
    expect(mounted.view.progresses.at(-1)).toBe("");
  });

  it("an archive that cannot be extracted says why", async () => {
    const rar = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    const { handlers } = disk();
    const { commands, asked } = picks(TARGET);
    const { host, app, view } = await mount({
      files: { "~/Downloads/x.rar": rar },
      grants: [READ("~/Downloads")],
      handlers,
      commands,
    });
    await host.command("desk.files.visit", file("~/Downloads/x.rar"));
    await app.extract("all");
    expect(asked).toEqual([]);
    expect(view.statuses.at(-1)).toMatch(/^[A-Z][^\n]*\.$/);
  });
});
