/**
 * One spark of Eris's errands (`errand.ts`, ADR 0271) and how it is drawn: where it is on its
 * flight and the thread under it. Both ends of a flight are read again on every frame, Eris's body
 * and the point of the window's border that faces her (`edgeOf`), so the spark and its thread stay
 * joined to her and to the window while either moves or the desk pans.
 */
import { erisAt } from "./errand-targets";
import { arc, type Point, shapeThread, threadOf } from "./errand-thread";

/** One spark of an errand, on its way to one place and back. */
export interface Spark {
  el: HTMLElement;
  /** What the spark is drawn on. */
  host: HTMLElement;
  /** The thread it runs along now. */
  thread: SVGSVGElement | null;
  /** Where the spark is, in the host's coordinates. */
  at: Point;
  /** Where it is going, or is, now: read on every frame, so it follows the window and the pan. */
  aim: () => Point;
  /** The flight it is on: from where, how far (0 to 1), and how big and clear it is drawn. */
  from: () => Point;
  t: number;
  look: [number, number];
  /** Stops following, once it is home. */
  unfollow: () => void;
  /** The outbound leg; the way back waits for it. */
  out: Promise<void>;
  /** Its flights so far: one sent somewhere else stops where it was going before. */
  flight: number;
  /** Until it is home: away from her. */
  away: boolean;
}

/** Put the spark at `p`, `scale` big and `opacity` clear. */
export function place(spark: Spark, p: Point, scale = 1, opacity = 1): void {
  spark.at = p;
  spark.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
  spark.el.style.opacity = opacity.toFixed(3);
}

/**
 * The thread's ends now: from her to where the spark goes or is, or on its way back from the
 * window to her.
 */
function ends(spark: Spark): [Point, Point] {
  return spark.el.dataset.leg === "back"
    ? [spark.from(), spark.aim()]
    : [erisAt(spark.host), spark.aim()];
}

/** Draw the spark and its thread where their ends are this frame; with reduced motion, at its end. */
export function render(spark: Spark, reduced: boolean): void {
  place(spark, arc(spark.from(), spark.aim(), reduced ? 1 : spark.t), ...spark.look);
  if (spark.thread) shapeThread(spark.thread, ...ends(spark));
}

/** Lay the thread under the spark; with reduced motion there is none. */
export function lay(spark: Spark, reduced: boolean): void {
  spark.thread?.remove();
  spark.thread = null;
  // A spark dropped meanwhile (the desk went) has nothing to run along.
  if (reduced || spark.el.parentNode !== spark.host) return;
  spark.thread = threadOf(spark.host.ownerDocument, ...ends(spark));
  spark.thread.dataset.leg = spark.el.dataset.leg ?? "out";
  spark.host.insertBefore(spark.thread, spark.el);
}
