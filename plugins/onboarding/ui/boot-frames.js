// The heads-up boot's timing and keyframes (boot.js plays them): a piece forms in the middle of the
// screen, holds there for a beat, then flies home to its edge. Pure, so it is tested without a page.

/** A piece forms (`appear`), holds in the middle (`hold`), then travels home (`travel`), in ms. */
export const PIECE = { appear: 380, hold: 420, travel: 600 };
/** An agent stays a little longer in the middle: it is someone arriving, not a part switching on. */
export const AGENT = { appear: 420, hold: 640, travel: 700 };
/** How big a piece shows in the middle: its longer side grows to about this, and never shrinks. */
export const SHOW = 112;
export const MAX_SCALE = 2.6;

/** How long a boot with `times` takes, from nothing to home. */
export const total = (times) => times.appear + times.hold + times.travel;

/** How much a `width` x `height` piece grows while it stands in the middle. */
export function showScale(width, height) {
  const side = Math.max(width, height, 1);
  return Math.min(MAX_SCALE, Math.max(1, SHOW / side));
}

/**
 * The keyframes for a piece whose home is `dx`, `dy` away from the middle: it forms there from
 * `from` (`scaleX(0)` draws a line, the default grows from a point), holds at `scale`, and lands
 * home at `opacity`. `ease` eases the forming and the flight.
 */
export function bootFrames({
  dx,
  dy,
  scale,
  from = "scale(0.3)",
  opacity = 1,
  times = PIECE,
  ease = "ease-out",
}) {
  const all = total(times);
  const formed = times.appear / all;
  const held = (times.appear + times.hold) / all;
  const there = `translate(${dx}px, ${dy}px) scale(${scale})`;
  return [
    { offset: 0, opacity: 0, filter: "blur(10px)", transform: `${there} ${from}`, easing: ease },
    { offset: formed * 0.7, opacity: 1, filter: "blur(0px)" },
    { offset: formed, opacity: 1, transform: `${there} scale(1.06)`, easing: "ease-out" },
    { offset: held, opacity: 1, transform: `${there} scale(1)`, easing: ease },
    { offset: 1, opacity, filter: "blur(0px)", transform: "none" },
  ];
}
