// @vitest-environment jsdom
// Long work shows the desk's progress element (#180) in place of the old progress line: it appears
// once an extraction has run 300 ms, counts files and bytes, and Cancel stops it between files; an
// opening that is cancelled leaves the details of a file not listed, never a blank surface.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StubError } from "../../../packages/bridge/src/index";
import { defineElements } from "../../../packages/ui/src/elements/index";

defineElements();

import type { DeskProgress } from "../../../packages/ui/src/elements/progress";
import { createView } from "../ui/view.js";
import { zipOf } from "./fixtures";
import { type App, file, type Handlers, mount, READ } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const TARGET = "~/Downloads/five";
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const until = async (check: () => boolean) => {
  for (let i = 0; i < 200 && !check(); i++) await sleep(5);
  if (!check()) throw new Error("it never happened");
};
const progress = () => document.querySelector("desk-progress") as DeskProgress;
const inside = (selector: string) =>
  progress().shadowRoot?.querySelector(selector) as HTMLElement | null;

async function opened(path: string, bytes: Uint8Array, handlers: Handlers = {}) {
  const mounted = await mount({
    files: { [path]: bytes },
    grants: [READ("~/Downloads")],
    handlers,
    commands: { "desk.palette.pick": () => TARGET },
    view: (app: () => App | undefined) =>
      createView(document, {
        select: (id) => app()?.select(id),
        toggle: (id) => app()?.toggle(id),
        open: (id) => app()?.open(id),
        up: () => app()?.up(),
        sort: (by) => app()?.sort(by),
        filter: (text) => app()?.filter(text),
        mark: (id) => app()?.mark(id),
        extract: (which) => app()?.extract(which),
        stop: () => app()?.stop(),
      }),
  });
  return mounted;
}

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});
afterEach(() => document.body.replaceChildren());

describe("the progress element", () => {
  it("shows for a long extraction, counts files and bytes, and Cancel stops it between files", async () => {
    const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"];
    const zip = zipOf(names.map((name) => ({ name, data: "four" })));
    const written: string[] = [];
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    const { host, app } = await opened("~/Downloads/five.zip", zip, {
      "fs.write": async ({ path, content }) => {
        written.push(path);
        if (written.length === 2) await held;
        return { bytesWritten: content.length };
      },
      "fs.list": () => {
        throw new StubError("not_found", "nothing is there yet");
      },
    });
    await host.command("desk.files.visit", file("~/Downloads/five.zip"));
    expect(progress().hidden).toBe(true);

    const running = app.extract("all");
    await until(() => written.length === 2);
    expect(progress().hidden).toBe(false);
    expect(progress().shown).toBe(false);
    await sleep(350);
    expect(progress().shown).toBe(true);
    expect(progress().label).toBe("Extracting five.zip");
    expect(progress().detail).toBe("1 of 5 files, 4 bytes of 20 bytes");
    expect([progress().value, progress().max]).toEqual([4, 20]);
    const bar = inside('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuetext")).toBe("20%, 1 of 5 files, 4 bytes of 20 bytes");
    const cancel = inside("button");
    expect(cancel?.hidden).toBe(false);
    expect(cancel?.textContent).toBe("Cancel");

    cancel?.click();
    release();
    await running;
    // The file being written finished; nothing after it was read or written.
    expect(written).toEqual([`${TARGET}/a.txt`, `${TARGET}/b.txt`]);
    expect(document.getElementById("status")?.textContent).toContain("Stopped after 2 of 5 files.");
    expect(progress().hidden).toBe(true);
    expect(progress().shown).toBe(false);
  });

  it("a cancelled opening shows the file's details and why it is not listed", async () => {
    const image = new Uint8Array(2 << 20);
    image.set([0x55, 0xaa], 510); // an MBR's mark: a disk image, read by endue.formats
    image.set([0, 0, 0, 0, 0x83, 0, 0, 0, 0x00, 0x08, 0, 0, 0x00, 0x08, 0, 0], 446);
    let reads = 0;
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    const { host } = await opened("~/Downloads/disk.img", image, {
      "fs.read": async ({ offset = 0, length = 0 }) => {
        // The first reads tell the format; the listing's next read waits.
        if (++reads > 3) await held;
        const part = image.subarray(offset, offset + length);
        return {
          content: Buffer.from(part).toString("base64"),
          encoding: "base64",
          size: image.length,
        };
      },
    });
    const visiting = host.command("desk.files.visit", file("~/Downloads/disk.img"));
    await until(() => !progress().hidden);
    expect(progress().label).toBe("Opening disk.img");
    await sleep(350);
    expect(progress().shown).toBe(true);
    inside("button")?.click();
    await visiting;
    release();
    expect(document.getElementById("note")?.textContent).toBe("Listing disk.img was cancelled.");
    expect(document.getElementById("browser")?.hidden).toBe(true);
    expect(progress().hidden).toBe(true);
  });
});
