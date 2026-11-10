// Drag and drop through the compositor (#56, ADR 0119's broker in Rust): the desk runs in compositor
// mode with the drag fixture (e2e/fixtures/plugin-e2e-drag, a row that drags desk text) and the input
// fixture (a zone that takes desk text and paths). A drag from one plugin's surface to the other's
// lands its text and tells the source how it ended; files from the OS land on the zone under the
// pointer as desk paths. The events are winit's, fed to the compositor window's own input entry
// (support/compositor.ts): the screen may be locked.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browser, expect } from "@wdio/globals";
import { DRAG, feed, INPUT, inputState, inSurface, raise } from "../support/compositor";
import { shellReady } from "../support/desk";
import { HOME_VAR } from "../support/driver";

interface Dropped {
  text?: string;
  paths?: Array<{ path: string }>;
  effect: string;
  from: string;
}

const drops = () => inSurface<Dropped[]>(INPUT, "window.e2eInput.drops");
const mounted = (host: string) =>
  browser.waitUntil(
    async () =>
      (await inSurface<boolean>(host, "Boolean(window.e2eInput || window.e2eDrag)")) === true,
    {
      timeout: 20_000,
      timeoutMsg: `${host} never mounted`,
    },
  );

describe("dnd: between two plugins and from the OS through the compositor's broker", () => {
  before(async () => {
    await shellReady();
    await mounted(INPUT);
    await mounted(DRAG);
    await feed([{ type: "windowFocused", focused: true }]);
  });

  it("a row dragged from one plugin drops its text on the other's zone, and the source hears how", async () => {
    await raise(INPUT, [20, 65]);
    const row = await raise(DRAG, [20, 20]);
    // The zone may have gone under the drag fixture's window: it must still show.
    const target = await raise(INPUT, [20, 65]);
    await feed([
      { type: "pointerMoved", x: row[0], y: row[1] },
      { type: "pointerButton", button: "left", pressed: true },
      { type: "pointerMoved", x: row[0] + 4, y: row[1] + 2 },
      { type: "pointerMoved", x: row[0] + 12, y: row[1] + 8 },
    ]);
    await browser.waitUntil(async () => (await inputState()).drag.active, {
      timeoutMsg: "the drag never started",
    });
    await feed([{ type: "pointerMoved", x: target[0], y: target[1] }]);
    await browser.waitUntil(async () => (await inputState()).drag.effect === "copy", {
      timeoutMsg: "the zone never answered copy",
    });
    expect((await inputState()).drag.overlay?.caption).toBe("+ from e2e.drag");
    await feed([{ type: "pointerButton", button: "left", pressed: false }]);
    await browser.waitUntil(async () => (await drops()).length === 1, {
      timeoutMsg: "nothing landed",
    });
    expect(await drops()).toEqual([{ text: "from e2e.drag", effect: "copy", from: "e2e.drag" }]);
    await browser.waitUntil(
      async () => (await inSurface<unknown[]>(DRAG, "window.e2eDrag.ended")).length === 1,
    );
    expect(await inSurface(DRAG, "window.e2eDrag.ended")).toEqual([
      { effect: "copy", to: "e2e.input" },
    ]);
  });

  it("files from the OS land on the zone under the pointer as desk paths, copied, from the OS", async () => {
    const home = process.env[HOME_VAR] ?? "/tmp";
    const folder = join(home, "Docs");
    mkdirSync(folder, { recursive: true });
    const paths = [join(folder, "한 글.md"), join(folder, "b.md")];
    for (const path of paths) writeFileSync(path, "fixture\n");
    const zone = await raise(INPUT, [20, 65]);
    await feed(
      [
        { type: "pointerMoved", x: zone[0], y: zone[1] },
        ...paths.map((path) => ({ type: "fileHovered", path })),
      ],
      { osPointer: false },
    );
    await browser.waitUntil(async () => (await inputState()).drag.effect === "copy", {
      timeoutMsg: "the zone never answered",
    });
    await feed(paths.map((path) => ({ type: "fileDropped", path })));
    await browser.waitUntil(async () => (await drops()).length === 2, {
      timeoutMsg: "the files never landed",
    });
    const [, files] = await drops();
    expect(files).toEqual({ paths: paths.map((path) => ({ path })), effect: "copy", from: "os" });
  });
});
