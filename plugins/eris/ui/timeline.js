// A timeline on an injected clock. Every Web Animation added here is paused and positioned from the
// clock on each frame, so a fake clock (tests) freezes and steps the whole scene exactly.

/** The browser's clock: requestAnimationFrame, whose frame times tests replace. */
export function browserClock() {
  return {
    frame: (callback) => requestAnimationFrame(callback),
  };
}

export class Timeline {
  #clock;
  #origin;
  #frame = null;
  #animations = [];
  #cues = [];

  /**
   * The timeline starts at its first frame (or at `origin`, in the clock's time) and its time is the
   * time of the latest frame. Frame times fall on the clock's frame grid; `now()` read at load or in an
   * event handler would carry however long loading or input took, and shift the whole scene.
   */
  constructor(clock = browserClock(), origin = null) {
    this.#clock = clock;
    this.#origin = origin;
    clock.frame((at) => this.#tick(at));
  }

  /** Milliseconds since the timeline started, as of the latest frame; 0 until its first frame. */
  get time() {
    return this.#frame === null ? 0 : this.#frame - this.#origin;
  }

  /** How many animations the timeline still holds and positions on every frame. */
  get size() {
    return this.#animations.length;
  }

  /**
   * Take over an animation: its effect moves to an animation without a document timeline, which never
   * advances on its own. (`pause()` is not enough: WebKit settles a pending pause on a later rendering
   * frame against the real document timeline, which shifts endless loops by real milliseconds.)
   */
  add(animation) {
    const held = new Animation(animation.effect, null);
    animation.cancel();
    held.currentTime = Math.max(0, this.time);
    this.#animations.push(held);
    return held;
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

  #tick(at) {
    this.#origin ??= at;
    this.#frame = at;
    const now = this.time;
    while (this.#cues.length > 0 && this.#cues[0].ms <= now) this.#cues.shift().fn(now);
    this.#animations = this.#animations.filter((animation) => this.#hold(animation, now));
    this.#clock.frame((next) => this.#tick(next));
  }

  /**
   * Position one animation at `now`, and say whether to keep holding it. One whose target left the
   * document is cancelled and let go: nothing shows it any more. A finite one that reached its end
   * gets its final time once and is let go; it is not cancelled, so its fill keeps that state.
   * Endless ones on connected targets stay held.
   */
  #hold(animation, now) {
    const target = animation.effect?.target;
    if (target && !target.isConnected) {
      animation.cancel();
      return false;
    }
    const end = Math.max(0, animation.effect?.getComputedTiming().endTime ?? 0);
    if (now >= end) {
      animation.currentTime = end;
      return false;
    }
    animation.currentTime = Math.max(0, now);
    return true;
  }
}
