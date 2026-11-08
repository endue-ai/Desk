// When playback has stopped without an error: WKWebView fires no error event when a file's URL stops
// working (its grant was taken back); the position stands still, or the clock runs on while no new
// frame is drawn. Either for six seconds while playing is a stall, reported once until it moves again.

/**
 * @typedef {{ playing: boolean, time: number, frames: number, visible: boolean }} Sample
 *   `frames` is the element's count of video frames drawn, -1 when it has none (audio).
 */

export function createStallWatch(limitMs = 6000) {
  let time = Number.NaN;
  let frames = Number.NaN;
  let movedAt = 0;
  let drawnAt = 0;
  let reported = false;

  return {
    /**
     * One look at the element; true the first time it has stalled.
     * @param {Sample} sample
     * @param {number} now milliseconds
     */
    check(sample, now) {
      if (!sample.playing) {
        time = Number.NaN;
        frames = Number.NaN;
        reported = false;
        return false;
      }
      if (sample.time !== time) {
        time = sample.time;
        movedAt = now;
      }
      if (sample.frames !== frames || !sample.visible) {
        frames = sample.frames;
        drawnAt = now;
      }
      const still = now - movedAt >= limitMs;
      const frozen = sample.frames >= 0 && now - drawnAt >= limitMs;
      if (!still && !frozen) {
        reported = false;
        return false;
      }
      if (reported) return false;
      reported = true;
      return true;
    },
  };
}
