// @vitest-environment jsdom
// Eris's body and Dysnomia are the brand's frost art (assets/*.svg, brand/LICENSE), drawn for a dark
// desk. In the light scheme they sit on a night of their own: halos of the theme's erisMoonDark under
// the art, solid past her lines and fading out, so her outline reaches 3:1 on what sits directly behind
// it (#357). The art is used as it is: nothing over it filters, masks or blends it, the night is only
// ever beneath it, and the dark scheme is exactly as before. The onboarding's arrival scene and greeting
// build the orb from orb.js and soul-text.css; the Eris page shows her pose.
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
/** How far the body and Dysnomia drift apart as they float (orb.js: 8px each, out of phase). */
const DRIFT = 8;
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

/** The Eris page's pose, shown as main.js shows one: the figure's data-state and that state's image. */
function pose(scheme: Scheme, state = "idle"): HTMLElement {
  const html = read("eris/ui/index.html");
  const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>"));
  load(scheme, ERIS_PAGE, body.replace(/<script[\s\S]*?<\/script>/g, ""));
  const figure = document.querySelector("#pose") as HTMLElement;
  figure.dataset.state = state;
  figure.querySelector("img")?.setAttribute("src", `./assets/state-${state}.svg`);
  return figure;
}

const style = (el: Element) => getComputedStyle(el);
const num = (value: string) => Number.parseFloat(value) || 0;
const all = (root: Element) => [root, ...root.querySelectorAll("*")];
const box = (el: Element) => {
  const s = style(el);
  return { w: num(s.width), h: num(s.height), pad: num(s.paddingTop) };
};

/** Where an element's padding box starts within `top`, from the CSS alone (jsdom has no layout). */
function corner(el: Element, top: Element): Point {
  let [x, y] = [0, 0];
  for (let e: Element | null = el; e && e !== top; e = e.parentElement) {
    const s = style(e);
    if (s.position === "absolute") [x, y] = [x + num(s.left), y + num(s.top)];
    [x, y] = [x + num(s.marginLeft), y + num(s.marginTop)];
  }
  return [x, y];
}

/** Her night: the colour soul-text.css's --eris-night takes from desk.shell's light palette. */
function night(): Rgba | undefined {
  const value = style(document.documentElement).getPropertyValue("--eris-night");
  const token = /var\(\s*--desk-([a-z-]+)/.exec(value)?.[1];
  return token
    ? color(shell[token.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())])
    : undefined;
}

/** The night's halos an element paints: centre and solid radius, in px of its padding box. */
function halos(el: Element) {
  const { w, h, pad } = box(el);
  const [width, height] = [w + 2 * pad, h + 2 * pad];
  const px = (value: string, of: number) =>
    value.endsWith("%") ? (Number.parseFloat(value) / 100) * of : Number.parseFloat(value);
  const layer =
    /radial-gradient\((?:circle|ellipse ([\d.]+%) ([\d.]+%)) at ([\d.]+(?:px|%)) ([\d.]+(?:px|%)), var\(--eris-night\) ([\d.]+(?:px|%))/g;
  // A value with var() comes back as written: make it one space between tokens, none in parentheses.
  const image = style(el)
    .backgroundImage.replace(/\s+/g, " ")
    .replace(/\( | \)/g, (m) => m.trim());
  return [...image.matchAll(layer)].map(([, rx, ry, x, y, solid]) => {
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
  const points = rim.flatMap((s) => s.points);
  const mid = (i: 0 | 1) =>
    (Math.min(...points.map((p) => p[i])) + Math.max(...points.map((p) => p[i]))) / 2;
  const r = (p: Point) => Math.hypot(p[0] - mid(0), p[1] - mid(1));
  const reach = Math.max(...points.map(r));
  const outer = rim.filter((s) => s.points.some((p) => r(p) >= reach * 0.98));
  const line = outer.reduce((a, b) => (b.opacity > a.opacity ? b : a));
  const [red, green, blue] = color(line.stroke);
  return [red, green, blue, line.opacity];
}

/**
 * What sits directly behind every line of `file`, drawn by the image `art` within `top`: the night if
 * the halos painted there cover each line, also when the art floats apart from the halo's element.
 */
function behind(art: Element, file: string, top: Element, surface: string): Rgba {
  const { viewBox, shapes } = lines(file);
  const [vx = 0, vy = 0, vw = 1, vh = 1] = viewBox;
  const { w, h, pad } = box(art);
  const [ax, ay] = corner(art, top);
  const scale = Math.min(w / vw, h / vh);
  const at = ([x, y]: Point): Point => [
    ax + pad + (w - vw * scale) / 2 + (x - vx) * scale,
    ay + pad + (h - vh * scale) / 2 + (y - vy) * scale,
  ];
  const rings = all(top).flatMap((ground) => {
    const [gx, gy] = corner(ground, top);
    const drift = ground.contains(art) ? 0 : DRIFT;
    return halos(ground).map((o) => ({ x: gx + o.x, y: gy + o.y, solid: o.solid - drift }));
  });
  const covered = shapes.every((s) =>
    s.points.every((p) => {
      const [x, y] = at(p);
      return rings.some((o) => Math.hypot(x - o.x, y - o.y) + (s.width * scale) / 2 <= o.solid);
    }),
  );
  return (covered && night()) || color(surfaces[surface]);
}

/** Nothing over the art filters, masks or blends it, and the night is only ever beneath it. */
function nothingOver(top: Element, art: Element[]) {
  for (const el of all(top)) {
    for (const name of EFFECTS) expect(["", "none"]).toContain(style(el).getPropertyValue(name));
    expect(["", "normal"]).toContain(style(el).getPropertyValue("mix-blend-mode"));
    expect(["", "auto"]).toContain(style(el).zIndex);
    if (halos(el).length === 0) continue;
    for (const image of art) {
      const beneath = el.contains(image) || !!(el.compareDocumentPosition(image) & 4);
      expect(beneath, `${el.className} paints its night under ${image.className}`).toBe(true);
    }
  }
}

const grounds = (top: Element) => all(top).filter((el) => halos(el).length > 0);

beforeAll(() => {
  // jsdom has no Web Animations; the orb's timeline is not under test here.
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: () => ({}) });
});

describe("Eris's orb in the onboarding (arrival scene and greeting)", () => {
  it("is exactly the current markup in the dark scheme, with no night", () => {
    const sphere = orb("dark");
    expect(sphere.innerHTML).toBe(CURRENT);
    for (const el of all(sphere)) expect(style(el).backgroundImage).not.toContain("--eris-night");
  });

  it("keeps the same markup and the brand art in the light scheme", () => {
    expect(orb("light").innerHTML).toBe(CURRENT);
  });

  it("paints a night of the theme's erisMoonDark in the light scheme", () => {
    const sphere = orb("light");
    expect(night()).toEqual(color(shell.erisMoonDark));
    expect(grounds(sphere).length).toBeGreaterThan(0);
  });

  it.each([
    [".body", "eris-balanced.svg"],
    [".moon-float", "dysnomia.svg"],
  ])("gives %s's outline 3:1 on what sits directly behind it", (selector, file) => {
    const sphere = orb("light");
    const art = sphere.querySelector(selector) as Element;
    expect(contrast(outline(file), behind(art, file, sphere, "background"))).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("paints nothing over the art", () => {
    for (const scheme of ["light", "dark"] as const) {
      const sphere = orb(scheme);
      nothingOver(sphere, [...sphere.querySelectorAll(".body, .moon-float")]);
    }
  });
});

describe("Eris's pose on the Eris page", () => {
  it("has no night in the dark scheme", () => {
    for (const state of STATES)
      for (const el of all(pose("dark", state)))
        expect(style(el).backgroundImage).not.toContain("--eris-night");
  });

  it.each(STATES)(
    "gives her %s pose an outline of 3:1 on what sits directly behind it",
    (state) => {
      const figure = pose("light", state);
      const img = figure.querySelector("img") as Element;
      const file = `state-${state}.svg`;
      expect(contrast(outline(file), behind(img, file, figure, "card"))).toBeGreaterThanOrEqual(3);
    },
  );

  it("paints nothing over the art", () => {
    for (const scheme of ["light", "dark"] as const) {
      for (const state of STATES) {
        const figure = pose(scheme, state);
        nothingOver(figure, [...figure.querySelectorAll("img")]);
      }
    }
  });
});
