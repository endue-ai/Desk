// @vitest-environment jsdom
// Compare can always be left (#162, draft 08 #18): its chooser opens with the focus in its list, and
// this build draws no list for a <select>, so Escape there, or Compare pressed again, puts the
// chooser away and gives the keys back to the image; with an image chosen, the same ends the split.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, expect, it } from "vitest";
import { createView } from "../ui/view.js";
import { pngHeader } from "./build";
import { disk, fixture, image, mount } from "./harness";

const html = readFileSync(join(import.meta.dirname, "../ui/index.html"), "utf8");
const A = image("~/Pictures/a.png");
const FILES = { [A.path]: pngHeader(1600, 1200), "~/Pictures/b.png": pngHeader(1600, 1200) };
const PHOTO = image("~/Pictures/c.jpg");

type Actions = Record<string, (...args: unknown[]) => unknown>;

beforeEach(() => {
  document.body.innerHTML = new DOMParser().parseFromString(html, "text/html").body.innerHTML;
});

async function open() {
  const mounted = await mount({
    handlers: disk({ ...FILES, [PHOTO.path]: fixture("exif.jpg") }),
    view: (app) =>
      createView(
        document,
        (action: string, ...args: unknown[]) =>
          (app() as unknown as Actions | undefined)?.[action]?.(...args),
        { measure: () => ({ width: 800, height: 600 }), paint: () => {} },
      ),
  });
  await mounted.host.command("desk.files.visit", A);
  await mounted.settle();
  return mounted;
}

const byId = (id: string) => document.getElementById(id) as HTMLElement;
const pick = () => byId("compare-with") as HTMLSelectElement;
/** A key pressed where the focus is, as the person presses it. */
const press = (key: string) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  (document.activeElement ?? document.body).dispatchEvent(event);
  return event;
};
const left = () => {
  expect(byId("compare-pick").hidden).toBe(true);
  expect(byId("compare").getAttribute("aria-pressed")).toBe("false");
  expect(byId("pane-b").hidden).toBe(true);
  expect(document.activeElement).toBe(byId("stage"));
};

it("Escape in the chooser puts it away and gives the keys back to the image", async () => {
  await open();
  byId("compare").click();
  expect(byId("compare-pick").hidden).toBe(false);
  expect(document.activeElement).toBe(pick());
  expect(byId("compare").getAttribute("aria-expanded")).toBe("true");
  expect(press("Escape").defaultPrevented).toBe(true);
  left();
  expect(byId("compare").getAttribute("aria-expanded")).toBe("false");
});

it("Compare pressed again puts the chooser away", async () => {
  await open();
  byId("compare").click();
  byId("compare").click();
  left();
});

it("with an image chosen, Escape in the chooser and Compare again end the split", async () => {
  const { settle } = await open();
  byId("compare").click();
  pick().value = "~/Pictures/b.png";
  pick().dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  expect(byId("pane-b").hidden).toBe(false);
  expect(press("Escape").defaultPrevented).toBe(true);
  await settle();
  left();

  byId("compare").click();
  pick().value = "~/Pictures/b.png";
  pick().dispatchEvent(new Event("change", { bubbles: true }));
  await settle();
  byId("compare").click();
  await settle();
  left();
});

it("reads the visible image and shares the view transforms, comparison and folder walk", async () => {
  const mounted = await open();
  const { host, ran } = mounted;
  await host.command("desk.files.visit", PHOTO);
  await expect(host.command("endue.images.details", {})).resolves.toMatchObject({
    path: PHOTO.path,
    width: 64,
    height: 48,
    exif: expect.arrayContaining([{ label: "Camera", value: "Example Camera 1" }]),
    position: { index: 3, count: 3 },
  });
  await host.command("endue.images.zoom", { level: 2 });
  await host.command("endue.images.turn", { rotate: -90, flip: true });
  expect(byId("flip").getAttribute("aria-pressed")).toBe("true");
  await expect(host.command("endue.images.details", {})).resolves.toMatchObject({
    rotation: 0,
    flipped: true,
  });
  await host.command("endue.images.compare", { path: A.path });
  expect(byId("pane-b").hidden).toBe(false);
  await host.command("endue.images.step", { to: "first" });
  expect(ran("desk.files.open").at(-1)).toMatchObject({ path: A.path });
});

it("uses the existing pan and details controls for an agent", async () => {
  const { host } = await open();
  await host.command("endue.images.zoom", { level: 2 });
  await expect(host.command("endue.images.pan", { dx: 24, dy: -12 })).resolves.toMatchObject({
    x: 24,
    y: -12,
  });
  await host.command("endue.images.show-details", { shown: true });
  expect(byId("details-toggle").getAttribute("aria-expanded")).toBe("true");
  await host.command("endue.images.show-details", { shown: false });
  expect(byId("details-toggle").getAttribute("aria-expanded")).toBe("false");
});
