// @vitest-environment jsdom
// The viewer on the plugin's own index.html, joined to the controller on the SDK's test host:
// zoom steps, rotate and flip, the folder in natural order, and compare. jsdom has no layout and no
// canvas, so the stage measures 800 x 600 and drawing is a no-op; the view's state is in the DOM.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { pngHeader } from "./build";
import { type Commands, disk, fixture, image, mount } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const BIG = pngHeader(1600, 1200);

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

type Actions = Record<string, (...args: unknown[]) => unknown>;

/** Mount the plugin with the real view, the desk's open and close answered as the desk would. */
async function open(files: Record<string, Uint8Array>, path: string) {
  const opened: unknown[] = [];
  const closed: string[] = [];
  let mounted: Awaited<ReturnType<typeof mount>> | undefined;
  const commands: Commands = {
    "desk.files.open": async (args) => {
      opened.push(args);
      const { path } = args as { path: string };
      await mounted?.host.command("desk.files.visit", image(path));
      return `file:${path}`;
    },
    "desk.buffers.close": async (args) => {
      const { id } = args as { id: string };
      closed.push(id);
      await mounted?.host.command("desk.buffers.closed", { buffer: id });
      return true;
    },
  };
  mounted = await mount({
    handlers: disk(files),
    commands,
    view: (app) =>
      createView(
        document,
        (action: string, ...args: unknown[]) =>
          (app() as unknown as Actions | undefined)?.[action]?.(...args),
        { measure: () => ({ width: 800, height: 600 }), paint: () => {} },
      ),
  });
  await mounted.host.command("desk.files.visit", image(path));
  await mounted.settle();
  return { ...mounted, opened, closed };
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const zoom = () => byId("zoom-level").textContent;
const transform = (pane: "a" | "b" = "a") =>
  (document.querySelector(`#pane-${pane} .media`) as HTMLElement | null)?.style.transform;
const press = (key: string, mod = false) => {
  const event = new KeyboardEvent("keydown", {
    key,
    metaKey: mod,
    bubbles: true,
    cancelable: true,
  });
  byId("stage").dispatchEvent(event);
  return event;
};
const click = (id: string) => byId(id).click();
/** translate(x, y) and scale(sx, sy) out of a pane's transform. */
const parse = (text = "") => {
  const n = text.match(/-?[\d.]+/g)?.map(Number) ?? [];
  return { x: n[0], y: n[1], rotate: n[2], scale: n[4] };
};

describe("zoom", () => {
  it("fits by default, steps with Mod+= and Mod+-, and Mod+0 fits again", async () => {
    const { settle } = await open({ "~/Pictures/a.png": BIG }, "~/Pictures/a.png");
    expect(zoom()).toBe("50%");
    expect(transform()).toBe("translate(0px, 0px) rotate(0deg) scale(0.5, 0.5)");
    const kept = press("=", true);
    expect(kept.defaultPrevented).toBe(true);
    expect(zoom()).toBe("67%");
    press("=", true);
    expect(zoom()).toBe("100%");
    press("-", true);
    expect(zoom()).toBe("67%");
    press("0", true);
    expect(zoom()).toBe("50%");
    click("zoom-actual");
    expect(zoom()).toBe("100%");
    click("zoom-fit");
    expect(zoom()).toBe("50%");
    click("zoom-in");
    expect(zoom()).toBe("67%");
    click("zoom-out");
    expect(zoom()).toBe("50%");
    // The desk's chords pass through.
    for (const key of ["s", "o", "w", "k"]) expect(press(key, true).defaultPrevented).toBe(false);
    await settle();
  });

  it("Mod+wheel zooms around the pointer", async () => {
    await open({ "~/Pictures/a.png": BIG }, "~/Pictures/a.png");
    const wheel = new WheelEvent("wheel", {
      deltaY: -100,
      ctrlKey: true,
      clientX: 600,
      clientY: 300,
      bubbles: true,
      cancelable: true,
    });
    byId("stage").dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    const { x = 0, y, scale = 1 } = parse(transform());
    expect(scale).toBeGreaterThan(0.5);
    // The image point under the pointer (200 px right of the centre) stays under it.
    expect((200 - x) / scale).toBeCloseTo(400, 0);
    expect(y).toBe(0);
  });
});

describe("rotate and flip", () => {
  it("turn and mirror the view only, and refit", async () => {
    const { params } = await open({ "~/Pictures/a.png": BIG }, "~/Pictures/a.png");
    click("rotate-right");
    expect(transform()).toBe("translate(0px, 0px) rotate(90deg) scale(0.375, 0.375)");
    expect(zoom()).toBe("38%");
    click("rotate-left");
    expect(transform()).toBe("translate(0px, 0px) rotate(0deg) scale(0.5, 0.5)");
    click("rotate-left");
    expect(transform()).toBe("translate(0px, 0px) rotate(270deg) scale(0.375, 0.375)");
    click("flip");
    expect(transform()).toBe("translate(0px, 0px) rotate(90deg) scale(-0.375, 0.375)");
    expect(byId("flip").getAttribute("aria-pressed")).toBe("true");
    expect(params("fs.write")).toEqual([]);
  });

  it("applies the EXIF orientation on open", async () => {
    await open({ "~/Pictures/turned.jpg": fixture("exif.jpg") }, "~/Pictures/turned.jpg");
    expect(transform()).toBe("translate(0px, 0px) rotate(90deg) scale(1, 1)");
  });
});

describe("the folder", () => {
  const EXT = ["png", "JPG", "webp", "gif", "bmp"];
  const names = Array.from(
    { length: 37 },
    (_, i) => `${i % 4 ? "img" : "IMG"}${i + 1}.${EXT[i % 5]}`,
  );
  const files = Object.fromEntries([
    ...names.map((name) => [`~/Pictures/trip/${name}`, BIG]),
    ...["notes.txt", "layers.psd", ".hidden.png"].map((name) => [`~/Pictures/trip/${name}`, BIG]),
  ]);
  const at = (i: number) => `~/Pictures/trip/${names[i - 1]}`;

  it("Left and Right go through its images in natural order, with where on screen", async () => {
    const { opened, closed, settle } = await open(files, at(4));
    expect(byId("position").textContent).toBe("4 / 37");
    press("ArrowRight");
    await settle();
    expect(opened).toEqual([{ path: at(5), plugin: "endue.images" }]);
    expect(closed).toEqual([`file:${at(4)}`]);
    expect(byId("name").textContent).toBe(names[4]);
    expect(byId("position").textContent).toBe("5 / 37");
    press("ArrowLeft");
    await settle();
    press("ArrowLeft");
    await settle();
    expect(byId("position").textContent).toBe("3 / 37");
    press("End");
    await settle();
    expect(byId("position").textContent).toBe("37 / 37");
    press("ArrowRight");
    await settle();
    expect(opened).toHaveLength(4);
    expect(byId("status").textContent).toBe("This is the last image in the folder.");
    press("Home");
    await settle();
    expect(byId("position").textContent).toBe("1 / 37");
    click("next");
    await settle();
    expect(byId("position").textContent).toBe("2 / 37");
    expect(byId("name").textContent).toBe(names[1]);
  });

  it("when zoomed in, the arrows pan instead", async () => {
    const { opened, settle } = await open(files, at(4));
    press("=", true);
    press("=", true);
    expect(zoom()).toBe("100%");
    press("ArrowRight");
    press("ArrowDown");
    await settle();
    expect(opened).toEqual([]);
    expect(transform()).toBe("translate(-40px, -40px) rotate(0deg) scale(1, 1)");
  });
});

describe("compare", () => {
  it("splits the surface with another image; zoom and pan move both", async () => {
    const files = { "~/Pictures/a.png": BIG, "~/Pictures/b.png": BIG };
    const { settle } = await open(files, "~/Pictures/a.png");
    click("compare");
    const pick = byId("compare-with") as HTMLSelectElement;
    expect(byId("compare-pick").hidden).toBe(false);
    expect(Array.from(pick.options, (o) => [o.value, o.textContent])).toContainEqual([
      "~/Pictures/b.png",
      "b.png",
    ]);
    pick.value = "~/Pictures/b.png";
    pick.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    expect(byId("pane-b").hidden).toBe(false);
    expect(byId("compare").getAttribute("aria-pressed")).toBe("true");
    expect(zoom()).toBe("25%");
    expect(transform("b")).toBe(transform("a"));

    press("=", true);
    expect(zoom()).toBe("33%");
    expect(transform("b")).toBe(transform("a"));
    for (let i = 0; i < 3; i++) press("=", true);
    expect(zoom()).toBe("100%");
    press("ArrowRight");
    press("ArrowDown");
    const pane = byId("pane-b");
    pane.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 500, clientY: 300, bubbles: true }),
    );
    pane.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 460, clientY: 280, bubbles: true }),
    );
    pane.dispatchEvent(new MouseEvent("pointerup", { clientX: 460, clientY: 280, bubbles: true }));
    expect(transform("a")).toBe("translate(-80px, -60px) rotate(0deg) scale(1, 1)");
    expect(transform("b")).toBe(transform("a"));

    expect(press("Escape").defaultPrevented).toBe(true);
    expect(byId("pane-b").hidden).toBe(true);
    expect(byId("compare").getAttribute("aria-pressed")).toBe("false");
  });
});
