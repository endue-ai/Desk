// @vitest-environment jsdom
// Eris's body and Dysnomia are the brand's frost art (assets/*.svg, brand/LICENSE), drawn for a dark
// desk. In the light scheme each sits on a night of its own: a halo of the theme's erisMoonDark behind
// it, solid past her lines and fading out, so her outline reaches 3:1 on what sits directly behind it
// (#357). The art is used as it is: nothing over it filters, masks or blends it, and the dark scheme is
// exactly as before. The onboarding's arrival scene and greeting build the orb from orb.js and
// soul-text.css; the Eris page shows her pose.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PluginManifest } from "../../../packages/bridge/src/index";
import { contrast, parseColor, type Rgba } from "../../../packages/ui/src/theme/index";
import { buildOrb } from "../ui/orb.js";

type Scheme = "light" | "dark";
type Point = [number, number];

const read = (path: string) => readFileSync(join(import.meta.dirname, "../..", path), "utf8");
const tokens = (plugin: string, id: string) =>
  (JSON.parse(read(`${plugin}/plugin.json`)) as PluginManifest).contributes?.themes?.find(
    (theme) => theme.id === id,
  )?.tokens ?? {};
const shell = tokens("shell", "desk.shell.light");
const surfaces = tokens("theme", "desk.theme.light");
const color = (value: string | undefined) => {
  const parsed = parseColor(value ?? "");
  if (!parsed) throw new Error(`not a colour: ${value}`);
  return parsed;
};

const ONBOARDING = ["eris/ui/soul-text.css", "onboarding/ui/style.css", "onboarding/ui/desk.css"];
const ERIS_PAGE = ["eris/ui/soul-text.css", "eris/ui/style.css"];
const STATES = ["idle", "listening", "thinking", "done", "heads-up", "oops"];
const EFFECTS = ["filter", "backdrop-filter", "mask", "mask-image", "-webkit-mask-image"];
// The orb exactly as orb.js builds it before this change.
const CURRENT = [
  '<div class="float"><div class="core-wrap"><div class="core"></div></div>',
  '<img class="body" src="./assets/eris-balanced.svg" alt=""></div>',
  '<div class="moon"><img class="moon-float" src="./assets/dysnomia.svg" alt=""></div>',
  '<div class="flash" style="opacity: 0;"></div><div class="glint" style="opacity: 0;"></div>',
].join("");

/** A page's stylesheets and body under a scheme, which the SDK sets on the root. */
function load(scheme: Scheme, styles: string[], body: string) {
  document.documentElement.dataset.scheme = scheme;
  document.head.replaceChildren(
    ...styles.map((path) =>
      Object.assign(document.createElement("style"), { textContent: read(path) }),
    ),
  );
  document.body.innerHTML = body;
}

function orb(scheme: Scheme): HTMLElement {
  load(scheme, ONBOARDING, '<div id="sphere" class="sphere"></div>');
  const sphere = document.getElementById("sphere") as HTMLElement;
  buildOrb(document, { add: () => undefined }, sphere, { arrival: true });
  return sphere;
}

function pose(scheme: Scheme): HTMLElement {
  const html = read("eris/ui/index.html");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  load(scheme, ERIS_PAGE, body.replace(/<script[\s\S]*?<\/script>/g, ""));
  return document.querySelector("#pose") as HTMLElement;
}

const art = (root: HTMLElement, selector: string) => root.querySelector(selector) as HTMLElement;
const style = (el: Element) => getComputedStyle(el);
const box = (el: Element) => {
  const s = style(el);
  return {
    w: Number.parseFloat(s.width),
    h: Number.parseFloat(s.height),
    pad: Number.parseFloat(s.paddingTop) || 0,
  };
};

/** Her night: the colour soul-text.css's --eris-night takes from desk.shell's light palette. */
function night(): Rgba | undefined {
  const value = style(document.documentElement).getPropertyValue("--eris-night");
  const token = /var\(\s*--desk-([a-z-]+)/.exec(value)?.[1];
  return token
    ? color(shell[token.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())])
    : undefined;
}

/** The halos of the night on an element: centre and solid radius, in px of its padding box. */
function halos(el: Element) {
  const { w, h, pad } = box(el);
  const [width, height] = [w + 2 * pad, h + 2 * pad];
  const px = (value: string, of: number) =>
    value.endsWith("%") ? (Number.parseFloat(value) / 100) * of : Number.parseFloat(value);
  const layer =
    /radial-gradient\((?:circle|ellipse ([\d.]+%) ([\d.]+%)) at ([\d.]+(?:px|%)) ([\d.]+(?:px|%)), var\(--eris-night\) ([\d.]+(?:px|%))/g;
  return [...style(el).backgroundImage.matchAll(layer)].map(([, rx, ry, x, y, solid]) => {
    const ray = rx && ry ? Math.min(px(rx, width), px(ry, height)) : 0;
    return { x: px(x ?? "", width), y: px(y ?? "", height), solid: px(solid ?? "", ray) };
  });
}

/** The lines of an SVG: each stroked path or polygon with its points, colour, opacity and width. */
function lines(file: string) {
  const svg = read(`eris/ui/assets/${file}`);
  const viewBox = (/viewBox="([^"]+)"/.exec(svg)?.[1] ?? "").split(/\s+/).map(Number);
  const shapes = [...svg.matchAll(/<(path|polygon) ([^>]*)\/>/g)].flatMap(([, tag, attrs]) => {
    const attr = (name: string) => new RegExp(`(?:^| )${name}="([^"]*)"`).exec(attrs ?? "")?.[1];
    const stroke = attr("stroke");
    if (!stroke) return [];
    const n = (attr(tag === "path" ? "d" : "points") ?? "").match(/-?[\d.]+/g)?.map(Number) ?? [];
    const points = n.flatMap((_, i) => (i % 2 ? [] : [[n[i], n[i + 1]] as Point]));
    const opacity = Number(attr("stroke-opacity") ?? 1);
    return [{ tag, points, stroke, opacity, width: Number(attr("stroke-width") ?? 1) }];
  });
  return { viewBox, shapes };
}

/** Her outline: the most opaque of the lines that reach her rim (Dysnomia's facets, if no paths). */
function outline(file: string): Rgba {
  const { shapes } = lines(file);
  const rim = shapes.some((s) => s.tag === "path")
    ? shapes.filter((s) => s.tag === "path")
    : shapes;
  const all = rim.flatMap((s) => s.points);
  const mid = (i: 0 | 1) =>
    (Math.min(...all.map((p) => p[i])) + Math.max(...all.map((p) => p[i]))) / 2;
  const r = (p: Point) => Math.hypot(p[0] - mid(0), p[1] - mid(1));
  const reach = Math.max(...all.map(r));
  const outer = rim.filter((s) => s.points.some((p) => r(p) >= reach * 0.98));
  const line = outer.reduce((a, b) => (b.opacity > a.opacity ? b : a));
  const [red, green, blue] = color(line.stroke);
  return [red, green, blue, line.opacity];
}

/** What sits directly behind every line of `file` drawn by `el`: the night if its halos cover them. */
function behind(el: Element, file: string, surface: string): Rgba {
  const { viewBox, shapes } = lines(file);
  const [vx = 0, vy = 0, vw = 1, vh = 1] = viewBox;
  const { w, h, pad } = box(el);
  const scale = Math.min(w / vw, h / vh);
  const at = ([x, y]: Point) => [
    pad + (w - vw * scale) / 2 + (x - vx) * scale,
    pad + (h - vh * scale) / 2 + (y - vy) * scale,
  ];
  const rings = halos(el);
  const covered = shapes.every((s) =>
    s.points.every((p) => {
      const [x = 0, y = 0] = at(p);
      return rings.some((o) => Math.hypot(x - o.x, y - o.y) + (s.width * scale) / 2 <= o.solid);
    }),
  );
  return (covered && night()) || color(surfaces[surface]);
}

beforeAll(() => {
  // jsdom has no Web Animations; the orb's timeline is not under test here.
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: () => ({}) });
});

describe("Eris's orb in the onboarding (arrival scene and greeting)", () => {
  it("is exactly the current markup in the dark scheme, with no ground behind the art", () => {
    const sphere = orb("dark");
    expect(sphere.innerHTML).toBe(CURRENT);
    for (const selector of [".body", ".moon-float"]) {
      expect(style(art(sphere, selector)).backgroundImage).toBe("none");
      expect(box(art(sphere, selector)).pad).toBe(0);
    }
  });

  it("keeps the same markup and the brand art in the light scheme", () => {
    expect(orb("light").innerHTML).toBe(CURRENT);
  });

  it("puts a night of the theme's erisMoonDark behind her body and Dysnomia in the light scheme", () => {
    const sphere = orb("light");
    expect(night()).toEqual(color(shell.erisMoonDark));
    expect(halos(art(sphere, ".body"))).toHaveLength(1);
    expect(halos(art(sphere, ".moon-float"))).toHaveLength(1);
  });

  it.each([
    [".body", "eris-balanced.svg"],
    [".moon-float", "dysnomia.svg"],
  ])("gives %s's outline 3:1 on what sits directly behind it", (selector, file) => {
    const ground = behind(art(orb("light"), selector), file, "background");
    expect(contrast(outline(file), ground)).toBeGreaterThanOrEqual(3);
  });

  it("puts no filter, mask or blend mode over the art", () => {
    for (const scheme of ["light", "dark"] as const) {
      const sphere = orb(scheme);
      for (const el of [sphere, ...sphere.querySelectorAll("*")]) {
        for (const name of EFFECTS)
          expect(["", "none"]).toContain(style(el).getPropertyValue(name));
        expect(["", "normal"]).toContain(style(el).getPropertyValue("mix-blend-mode"));
      }
    }
  });
});

describe("Eris's pose on the Eris page", () => {
  it("has no ground behind the art in the dark scheme", () => {
    const img = art(pose("dark"), "img");
    expect(style(img).backgroundImage).toBe("none");
    expect(box(img).pad).toBe(0);
  });

  it.each(STATES)(
    "gives her %s pose an outline of 3:1 on what sits directly behind it",
    (state) => {
      const img = art(pose("light"), "img");
      expect(img.getAttribute("src")).toBe("./assets/state-idle.svg");
      const file = `state-${state}.svg`;
      expect(contrast(outline(file), behind(img, file, "card"))).toBeGreaterThanOrEqual(3);
    },
  );

  it("puts no filter, mask or blend mode over the art", () => {
    for (const scheme of ["light", "dark"] as const) {
      const figure = pose(scheme);
      for (const el of [figure, ...figure.querySelectorAll("*")]) {
        for (const name of EFFECTS)
          expect(["", "none"]).toContain(style(el).getPropertyValue(name));
        expect(["", "normal"]).toContain(style(el).getPropertyValue("mix-blend-mode"));
      }
    }
  });
});
