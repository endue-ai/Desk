// Scene 1, arrival (0-8 s), with no words: a warp, a count of three, the desk's floor unfolding, a
// beam of light that becomes the core, and the polygons that lock in around it, the gold face last,
// before Dysnomia slides in. Sounds ride the same timeline. With reduced motion the warp and the
// floor are left out and the orb fades in.
import { buildOrb } from "eris/orb.js";
import { mulberry32, renderLine } from "eris/soul-text.js";
import { $, ASSETS, EASE, element, reduced, style } from "./director.js";
import { COUNT, TIMES } from "./script.js";

const STARS = 32;
const SHARDS = 12;
/** The core's centre and the rim's radius inside the 360x388 sphere. */
const CORE = { x: 180, y: 188 };
const RIM = 132;
/** The gold face of eris-balanced.svg at 360x388: the glint's box (soul-text.css) and its centre. */
const GOLD = { left: 262, top: 88, x: 279, y: 107 };
const SHARD_FACES = [
  "polygon(50% 0%, 100% 100%, 0% 85%)",
  "polygon(0% 0%, 100% 30%, 40% 100%)",
  "polygon(20% 0%, 100% 60%, 0% 100%)",
];

/** Build scene 1 and return how far it pushes the greeting back (0 with reduced motion). */
export function arrival(d) {
  const sphere = $("sphere");
  if (reduced) {
    d.orb = buildOrb(document, d.timeline, sphere, { assets: ASSETS, reduced });
    return 0;
  }
  d.orb = buildOrb(document, d.timeline, sphere, {
    assets: ASSETS,
    arrival: true,
    at: TIMES.arrival,
  });
  d.timeline.at(0, () => d.sound.hum());
  warp(d);
  count(d, sphere);
  floor(d);
  beam(d, sphere);
  shards(d, sphere);
  return TIMES.arrival;
}

/** 0-2 s: starlight stretches from the centre to the edges. */
function warp(d) {
  const random = mulberry32(2026);
  const space = $("space");
  for (let i = 0; i < STARS; i++) {
    const star = element("i", "star");
    const angle = Math.round(random() * 360);
    const from = Math.round(30 + random() * 90);
    const to = Math.round(520 + random() * 360);
    space.append(star);
    d.timeline.add(
      star.animate(
        [
          { opacity: 0, transform: `rotate(${angle}deg) translateX(${from}px) scaleX(0.05)` },
          { opacity: 1, offset: 0.4 },
          { opacity: 0, transform: `rotate(${angle}deg) translateX(${to}px) scaleX(1)` },
        ],
        {
          delay: Math.round(random() * 800),
          duration: 1100,
          easing: "cubic-bezier(.5,0,.9,.4)",
          fill: "both",
        },
      ),
    );
  }
  d.timeline.at(2100, () => {
    for (const star of space.querySelectorAll(".star")) star.remove();
  });
}

/** 2-3.5 s: 3, 2, 1, each a soul-text line where the core will be, with a tick. */
function count(d, sphere) {
  const box = element("div", "count");
  box.setAttribute("aria-hidden", "true");
  sphere.append(box);
  COUNT.forEach((number, i) => {
    const line = { index: 200 + i, words: [{ t: number.t, at: number.at }], out: number.out };
    d.timeline.at(number.at, () => {
      d.sound.tick();
      box.append(renderLine(document, d.timeline, line, style));
    });
  });
  const last = COUNT[COUNT.length - 1]?.out ?? 0;
  d.timeline.at(last + style.jitterMs + style.outMs + 50, () => box.remove());
}

/** 3.5-5 s: the floor grid rolls out towards the person and gives the desk its depth. */
export function floor(d, { instant = false } = {}) {
  const grid = element("div", "floor");
  $("space").append(grid);
  const flat = "rotateX(80deg) scaleY(0.02)";
  const laid = "rotateX(80deg) scaleY(1)";
  d.timeline.add(
    grid.animate(
      [
        { opacity: 0, transform: instant ? laid : flat },
        { opacity: 0.5, transform: laid },
      ],
      { delay: instant ? 0 : 3500, duration: instant ? 0 : 1500, easing: EASE, fill: "both" },
    ),
  );
}

/** 5-6 s: a beam comes down from above and lands as a point: the core. */
function beam(d, sphere) {
  const ray = element("div", "beam");
  sphere.append(ray);
  d.timeline.at(5000, () => d.sound.breath());
  d.timeline.add(
    ray.animate(
      [
        { offset: 0, opacity: 0, transform: "scaleY(0)" },
        { offset: 0.5, opacity: 1, transform: "scaleY(1)" },
        { offset: 1, opacity: 0, transform: "scaleY(1)" },
      ],
      { delay: 5000, duration: 1200, easing: "ease-in-out", fill: "both" },
    ),
  );
  d.timeline.at(6300, () => ray.remove());
}

/** 6-7.5 s: polygons fly in from the edges and lock in around the rim, each with a click; gold last. */
function shards(d, sphere) {
  const random = mulberry32(88);
  const pieces = [];
  for (let i = 0; i < SHARDS; i++) {
    const angle = ((-100 + (i * 360) / SHARDS + random() * 14) * Math.PI) / 180;
    const x = Math.round(CORE.x + RIM * Math.cos(angle));
    const y = Math.round(CORE.y + RIM * Math.sin(angle));
    pieces.push({ x, y, angle, land: 6000 + i * 115, face: SHARD_FACES[i % SHARD_FACES.length] });
  }
  pieces.push({ x: GOLD.x, y: GOLD.y, angle: -0.9, land: 7500, gold: true });
  for (const piece of pieces) {
    const shard = element("div", piece.gold ? "shard gold" : "shard");
    if (piece.gold) Object.assign(shard.style, { left: `${GOLD.left}px`, top: `${GOLD.top}px` });
    else Object.assign(shard.style, { left: `${piece.x - 11}px`, top: `${piece.y - 11}px` });
    if (piece.face) shard.style.clipPath = piece.face;
    sphere.append(shard);
    const dx = Math.round(Math.cos(piece.angle) * 900);
    const dy = Math.round(Math.sin(piece.angle) * 700);
    const turn = Math.round(random() * 540 - 270);
    d.timeline.add(
      shard.animate(
        [
          { opacity: 0, transform: `translate(${dx}px, ${dy}px) rotate(${turn}deg) scale(1.6)` },
          { opacity: 1, transform: "none" },
        ],
        { delay: piece.land - 700, duration: 700, easing: EASE, fill: "both" },
      ),
    );
    // Locked in: the body has settled underneath, so the piece melts into it.
    d.timeline.add(
      shard.animate([{ opacity: 1 }, { opacity: 0 }], {
        delay: Math.max(piece.land + 250, 7700),
        duration: 500,
        fill: "forwards",
      }),
    );
    d.timeline.at(piece.land, () => (piece.gold ? d.sound.chime() : d.sound.click()));
  }
  d.timeline.at(8400, () => {
    for (const shard of sphere.querySelectorAll(".shard")) shard.remove();
  });
}
