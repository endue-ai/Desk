// The Eris orb: a core of light, the geodesic body and Dysnomia, assembled on a timeline.
// Structure, sizes and keyframes are ported from docs/reference/eris-opening-prototype.html.

const EASE = "cubic-bezier(.2,.7,.2,1)";

// Assembly timings (ms). `quick` is the second-run version, done in 1.2 s. `arrival` is the end of the
// first run's scene 1: the core forms where the beam lands, the body settles as the polygons lock in,
// and Dysnomia slides in after the gold face.
const FULL = { core: [200, 1600], body: [600, 1700], moon: [2200, 900], idleAt: 2400 };
const QUICK = { core: [0, 600], body: [200, 900], moon: [700, 500], idleAt: 1200 };
const ARRIVAL = { core: [400, 1600], body: [1500, 1300], moon: [2500, 600], idleAt: 3000 };

function el(doc, tag, className) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Build the orb into `container` and add its animations to `timeline`, starting at `at`.
 * Options: assets (folder URL of the SVGs), quick, arrival, reduced, assembled (start finished).
 */
export function buildOrb(doc, timeline, container, options = {}) {
  const { assets = "./assets", quick = false, arrival = false, reduced = false } = options;
  const at = options.assembled ? -10000 : (options.at ?? 0);
  const plan = quick ? QUICK : arrival ? ARRIVAL : FULL;
  container.replaceChildren();

  const float = el(doc, "div", "float");
  const coreWrap = el(doc, "div", "core-wrap");
  const core = el(doc, "div", "core");
  coreWrap.append(core);
  const body = el(doc, "img", "body");
  body.src = `${assets}/eris-balanced.svg`;
  body.alt = "";
  float.append(coreWrap, body);
  const moonWrap = el(doc, "div", "moon");
  const moon = el(doc, "img", "moon-float");
  moon.src = `${assets}/dysnomia.svg`;
  moon.alt = "";
  moonWrap.append(moon);
  const flash = el(doc, "div", "flash");
  container.append(float, moonWrap, flash);

  const play = (node, frames, delay, duration, extra = {}) =>
    timeline.add(
      node.animate(frames, { delay: at + delay, duration, easing: EASE, fill: "both", ...extra }),
    );

  if (reduced) {
    const fade = [{ opacity: 0 }, { opacity: 1 }];
    play(core, fade, 0, 200);
    play(body, fade, 0, 200);
    play(moonWrap, fade, 0, 200);
  } else {
    play(
      core,
      [
        { offset: 0, opacity: 0, transform: "scale(0.04)" },
        { offset: 0.35, opacity: 1, transform: "scale(0.08)" },
        { offset: 1, opacity: 1, transform: "scale(1)" },
      ],
      ...plan.core,
    );
    play(
      body,
      [
        { opacity: 0, filter: "blur(18px)", transform: "scale(1.16)" },
        { opacity: 1, filter: "blur(0px)", transform: "none" },
      ],
      ...plan.body,
    );
    play(
      moonWrap,
      [
        { opacity: 0, transform: "translateX(90px)" },
        { opacity: 1, transform: "none" },
      ],
      ...plan.moon,
    );
    // Idle breathing, as in the prototype: the core pulses and the body and moon float.
    const loop = { easing: "ease-in-out", iterations: Number.POSITIVE_INFINITY, fill: "none" };
    play(core, [{ filter: "brightness(0.8)" }, { filter: "brightness(1.2)" }], plan.idleAt, 2500, {
      ...loop,
      direction: "alternate",
    });
    play(
      float,
      [{ transform: "none" }, { transform: "translateY(-8px)" }, { transform: "none" }],
      plan.idleAt,
      6000,
      loop,
    );
    play(
      moon,
      [{ transform: "none" }, { transform: "translateY(-8px)" }, { transform: "none" }],
      plan.idleAt + 800,
      4500,
      { ...loop, direction: "reverse" },
    );
  }
  flash.style.opacity = "0";
  const glint = el(doc, "div", "glint");
  container.append(glint);
  glint.style.opacity = "0";

  // "forwards", not "both": a later animation filling backwards would undo the assembly before it starts.
  const once = (node, frames, from, duration, easing = EASE) =>
    timeline.add(
      node.animate(frames, {
        delay: from,
        duration: reduced ? 0 : duration,
        easing,
        fill: "forwards",
      }),
    );

  return {
    /** The core leans in while Eris listens (the prototype's .listening, 600 ms). */
    listen(from, on = true) {
      const frames = [
        { transform: "none", filter: "brightness(1)" },
        { transform: "scale(1.18)", filter: "brightness(1.35)" },
      ];
      timeline.add(
        coreWrap.animate(on ? frames : [...frames].reverse(), {
          delay: from,
          duration: reduced ? 0 : 600,
          easing: EASE,
          fill: "forwards",
        }),
      );
    },
    /** While she speaks she slowly turns her gold face towards the person (scene 2). */
    turn(from, duration) {
      once(
        body,
        [{ transform: "none" }, { transform: "rotate(-9deg)" }],
        from,
        duration,
        "ease-in-out",
      );
    },
    /** "Small, I know.": the whole orb shrinks a little and comes back. */
    shrink(from) {
      const frames = [{ transform: "none" }, { transform: "scale(0.94)" }, { transform: "none" }];
      once(container, frames, from, 900, "ease-in-out");
    },
    /** Heads-up: the gold face lifts off the rim and glows; `on = false` settles it back. */
    headsUp(from, on = true) {
      const lift = [
        { opacity: 0, transform: "none" },
        { opacity: 1, transform: "translate(10px, -10px)" },
      ];
      once(glint, on ? lift : [...lift].reverse(), from, 500);
    },
    /** The core lights up once as words are absorbed. */
    flash(from) {
      timeline.add(
        flash.animate(
          [
            { offset: 0, opacity: 0, transform: "scale(0.6)" },
            { offset: 0.4, opacity: 0.9, transform: "scale(1)" },
            { offset: 1, opacity: 0, transform: "scale(1.3)" },
          ],
          { delay: from, duration: reduced ? 200 : 1000, easing: "ease-out", fill: "both" },
        ),
      );
    },
  };
}
