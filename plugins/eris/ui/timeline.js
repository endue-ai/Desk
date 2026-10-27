// A timeline on an injected clock. Every Web Animation added here is paused and positioned from the
// clock on each frame, so a fake clock (tests) freezes and steps the whole scene exactly.

/** The browser's clock: performance.now and requestAnimationFrame. Tests replace both. */
export function browserClock() {
  return {
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(callback),
  };
}

export class Timeline {
  #clock;
  #origin;
  #animations = [];
  #cues = [];

  constructor(clock = browserClock(), origin = clock.now()) {
    this.#clock = clock;
    this.#origin = origin;
    this.#tick();
  }

  /** Milliseconds since the timeline started. */
  get time() {
    return this.#clock.now() - this.#origin;
  }

  /** Take over an animation: it stops running on its own and follows this timeline. */
  add(animation) {
    animation.pause();
    animation.currentTime = Math.max(0, this.time);
    this.#animations.push(animation);
    return animation;
  }

  /** Run `fn` on the first frame at or after `ms`. Cues at the same time run in the order added. */
  at(ms, fn) {
    this.#cues.push({ ms, fn });
    this.#cues.sort((a, b) => a.ms - b.ms);
  }

  /** Drop every animation and cue (a scene was skipped). */
  clear() {
    for (const animation of this.#animations) animation.cancel();
    this.#animations = [];
    this.#cues = [];
  }

  #tick() {
    const now = this.time;
    while (this.#cues.length > 0 && this.#cues[0].ms <= now) this.#cues.shift().fn(now);
    for (const animation of this.#animations) animation.currentTime = Math.max(0, now);
    this.#clock.frame(() => this.#tick());
  }
}
