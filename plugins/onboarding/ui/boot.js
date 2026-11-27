// The desk boots like a heads-up display: each piece of the frame and each agent first forms in the
// middle of the screen inside a targeting ring, holds there for a beat, then flies out to its own
// place along the edge (left bar, right toolbar, dock below). The centre is borrowed only while a
// piece forms; it is the person's again once the piece has gone home.
import { AGENT, bootFrames, PIECE, showScale, total } from "./boot-frames.js";
import { $, centre, EASE, element, reduced } from "./director.js";

export { AGENT, PIECE, total };

/** The ring stands this far around the piece it frames. */
const RING_GAP = 28;

/** Animate before its start too (fill both): a piece that has not booted yet is not seen. */
function play(d, node, frames, at, duration) {
  return d.timeline.add(
    node.animate(frames, { delay: at, duration, easing: "linear", fill: "both" }),
  );
}

/** The frame stands over the orb while something boots, so a piece in the middle is not hidden. */
let booting = 0;
function raise(d, from, to) {
  d.timeline.at(from, () => {
    booting += 1;
    $("frame").classList.add("booting");
  });
  d.timeline.at(to, () => {
    booting = Math.max(0, booting - 1);
    if (booting === 0) $("frame").classList.remove("booting");
  });
}

/** The targeting ring around a piece while it forms and holds in the middle; `color` tints it. */
function ring(d, at, { width, height, color, times }) {
  const node = element("div", "boot-ring");
  node.setAttribute("aria-hidden", "true");
  node.append(element("span", "sweep"));
  Object.assign(node.style, {
    width: `${width + RING_GAP * 2}px`,
    height: `${height + RING_GAP * 2}px`,
  });
  if (color) node.style.setProperty("--boot", color);
  $("root").append(node);
  const life = times.appear + times.hold + times.travel * 0.4;
  play(
    d,
    node,
    [
      { opacity: 0, transform: "translate(-50%, -50%) scale(1.5) rotate(-40deg)" },
      { offset: 0.3, opacity: 1, transform: "translate(-50%, -50%) scale(1) rotate(0deg)" },
      { offset: 0.75, opacity: 1, transform: "translate(-50%, -50%) scale(1) rotate(12deg)" },
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.85) rotate(20deg)" },
    ],
    at,
    life,
  );
  d.timeline.at(at + life + 50, () => node.remove());
}

/**
 * Boot `node` from `at`: it forms in the middle of #root, holds, and flies home. Returns when it
 * lands. Reduced motion fades it in where it stands. `from` is how it forms (`scaleX(0)` draws a
 * line), `opacity` where it lands, `color` the ring's tint, `times` PIECE or AGENT.
 */
export function boot(d, node, at, { from, opacity = 1, color, times = PIECE } = {}) {
  if (reduced) {
    play(d, node, [{ opacity: 0 }, { opacity }], at, 200);
    return at + 200;
  }
  const root = $("root");
  const home = centre(node);
  const dx = root.offsetWidth / 2 - home.x;
  const dy = root.offsetHeight / 2 - home.y;
  const scale = showScale(node.offsetWidth, node.offsetHeight);
  play(d, node, bootFrames({ dx, dy, scale, from, opacity, times, ease: EASE }), at, total(times));
  const size = { width: node.offsetWidth * scale, height: node.offsetHeight * scale };
  ring(d, at, { ...size, color, times });
  const lands = at + total(times);
  raise(d, at, lands);
  d.timeline.at(at + times.appear * 0.6, () => d.sound.tick());
  d.timeline.at(lands, () => d.sound.click());
  return lands;
}
