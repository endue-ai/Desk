// The media elements and the transport: one <video> and one <audio> (only one has a source at a time),
// play and pause, the seek bar and time, volume and mute, speed, loop, theatre mode, the subtitle
// overlay with its menu and offset, the resume offer, and the keys. A stalled element (the position
// stands still or no frame is drawn while playing, as when a URL's grant was revoked: stall.js) is
// reported with a Try again button, never left frozen.
import { actionFor } from "./keys.js";
import { createStallWatch } from "./stall.js";
import { activeAt } from "./subtitles.js";
import { clock } from "./time.js";

/**
 * @typedef {import("./player.js").Model} Model
 * @typedef {(name: string, ...args: unknown[]) => unknown} Act
 */

/**
 * @param {Document} doc
 * @param {Act} act
 */
export function createMedia(doc, act) {
  const byId = (/** @type {string} */ id) => /** @type {HTMLElement} */ (doc.getElementById(id));
  const video = /** @type {HTMLVideoElement} */ (byId("video"));
  const audio = /** @type {HTMLAudioElement} */ (byId("audio"));
  const overlay = byId("overlay");
  const transport = byId("transport");
  const play = byId("play");
  const seek = /** @type {HTMLInputElement} */ (byId("seek"));
  const time = byId("time");
  const length = byId("duration");
  const mute = byId("mute");
  const volume = /** @type {HTMLInputElement} */ (byId("volume"));
  const speed = /** @type {HTMLSelectElement} */ (byId("speed"));
  const loop = byId("loop");
  const theatre = byId("theatre");
  const subtitleControls = byId("subtitle-controls");
  const subs = /** @type {HTMLSelectElement} */ (byId("subs"));
  const offset = byId("offset");
  const retry = byId("retry");
  const resume = byId("resume");
  const resumeText = byId("resume-text");
  const win = doc.defaultView ?? globalThis;

  /** @type {HTMLMediaElement | null} */
  let media = null;
  let loaded = "";
  /** @type {Model | null} */
  let model = null;
  let pending = 0;
  let offered = "";
  /** @type {ReturnType<typeof setInterval> | undefined} */
  let ticker;
  const stall = createStallWatch();
  let shownCues = "";
  /** @type {((time: number) => void) | null} */
  let onTime = null;
  /** Whether the next source of the same buffer plays on (a playlist going on, next while playing). */
  let carryOn = false;

  const duration = () =>
    media && Number.isFinite(media.duration) ? media.duration : (model?.info?.duration ?? 0);
  const pressed = (/** @type {HTMLElement} */ button, /** @type {boolean} */ on) =>
    button.setAttribute("aria-pressed", String(on));

  const drawCues = () => {
    const words =
      media && model
        ? activeAt(model.cues ?? [], media.currentTime)
            .map((c) => c.text)
            .join("\n")
        : "";
    if (words === shownCues) return;
    shownCues = words;
    overlay.textContent = words;
  };
  const drawTime = () => {
    const now = media?.currentTime ?? 0;
    const total = duration();
    time.textContent = clock(now);
    length.textContent = clock(total);
    seek.max = String(total || 0);
    seek.value = String(now);
    seek.setAttribute("aria-valuetext", `${clock(now)} of ${clock(total)}`);
    drawCues();
    onTime?.(now);
  };
  const drawPlay = () => {
    const paused = !media || media.paused;
    play.setAttribute("aria-label", paused ? "Play" : "Pause");
    play.textContent = paused ? "▶" : "⏸";
  };

  const stopTicker = () => {
    if (ticker !== undefined) win.clearInterval(ticker);
    ticker = undefined;
  };
  /** While playing: draw the cues smoothly and watch for a stall. */
  const startTicker = () => {
    stopTicker();
    stall.check({ playing: false, time: 0, frames: -1, visible: true }, Date.now());
    ticker = win.setInterval(() => {
      if (!media || media.paused || media.ended) return stopTicker();
      drawCues();
      const quality =
        media instanceof win.HTMLVideoElement ? media.getVideoPlaybackQuality?.() : undefined;
      const sample = {
        playing: true,
        time: media.currentTime,
        frames: quality ? quality.totalVideoFrames : -1,
        visible: doc.visibilityState !== "hidden",
      };
      if (stall.check(sample, Date.now()) && retry.hidden) {
        retry.hidden = false;
        act("stalled");
      }
    }, 250);
  };

  const report = (paused = media?.paused ?? true) => {
    if (media && loaded) act("progress", { time: media.currentTime, duration: duration(), paused });
  };

  const toggle = () => {
    if (!media || !loaded) return;
    if (media.paused) {
      const started = media.play();
      if (started && typeof started.catch === "function") started.catch(() => {});
    } else media.pause();
    drawPlay();
  };
  const seekTo = (/** @type {number} */ to) => {
    if (!media || !loaded) return;
    const total = duration();
    media.currentTime = Math.max(0, total > 0 ? Math.min(total, to) : to);
    drawTime();
  };
  const setVolume = (/** @type {number} */ to) => {
    if (!media) return;
    media.volume = Math.round(Math.max(0, Math.min(1, to)) * 100) / 100;
    volume.value = String(media.volume);
  };
  const setMuted = (/** @type {boolean} */ on) => {
    if (!media) return;
    media.muted = on;
    pressed(mute, on);
  };
  const setSpeed = (/** @type {number} */ rate) => {
    speed.value = String(rate);
    for (const element of [video, audio]) {
      element.defaultPlaybackRate = rate;
      element.playbackRate = rate;
    }
  };
  const stepSpeed = (/** @type {number} */ step) => {
    const values = [...speed.options].map((o) => Number(o.value));
    const at = values.indexOf(Number(speed.value));
    const next = values[Math.max(0, Math.min(values.length - 1, at + step))];
    if (next !== undefined) setSpeed(next);
  };
  const setTheatre = (/** @type {boolean} */ on) => {
    doc.body.classList.toggle("theatre", on);
    pressed(theatre, on);
  };

  for (const element of [video, audio]) {
    const mine = (/** @type {Event} */ event) => event.target === media && loaded !== "";
    element.addEventListener("play", (e) => {
      if (!mine(e)) return;
      drawPlay();
      startTicker();
    });
    element.addEventListener("pause", (e) => {
      if (!mine(e)) return;
      drawPlay();
      stopTicker();
      report(true);
    });
    element.addEventListener("timeupdate", (e) => {
      if (!mine(e)) return;
      drawTime();
      report();
    });
    element.addEventListener("seeked", (e) => mine(e) && drawTime());
    for (const type of ["loadedmetadata", "durationchange"])
      element.addEventListener(type, (e) => {
        if (!mine(e)) return;
        if (pending > 0 && media) media.currentTime = pending;
        pending = 0;
        drawTime();
      });
    element.addEventListener("ended", (e) => {
      if (!mine(e)) return;
      drawPlay();
      carryOn = true;
      act("ended");
    });
    element.addEventListener("error", (e) => mine(e) && media?.error && act("failed"));
  }

  play.addEventListener("click", toggle);
  seek.addEventListener("input", () => seekTo(Number(seek.value)));
  volume.addEventListener("input", () => setVolume(Number(volume.value)));
  mute.addEventListener("click", () => setMuted(!media?.muted));
  speed.addEventListener("change", () => setSpeed(Number(speed.value)));
  loop.addEventListener("click", () => {
    const on = !video.loop;
    video.loop = on;
    audio.loop = on;
    pressed(loop, on);
  });
  theatre.addEventListener("click", () => setTheatre(!doc.body.classList.contains("theatre")));
  subs.addEventListener("change", () => act("subtitle", subs.value));
  byId("earlier").addEventListener("click", () => act("offset", -0.1));
  byId("later").addEventListener("click", () => act("offset", 0.1));
  retry.addEventListener("click", () => {
    retry.hidden = true;
    act("retry");
  });
  byId("previous").addEventListener("click", () => act("previous"));
  byId("next").addEventListener("click", () => act("next"));
  byId("resume-yes").addEventListener("click", () => {
    resume.hidden = true;
    // Where the person left it, as it was kept: before the metadata arrives, the element holds it.
    if (model?.resume && media) {
      media.currentTime = model.resume;
      if (media.readyState < 1) pending = model.resume;
    }
    act("resumed");
    toggle();
  });
  byId("resume-no").addEventListener("click", () => {
    resume.hidden = true;
    act("resumed");
  });

  /** @type {Record<string, () => void>} */
  const actions = {
    toggle,
    back5: () => seekTo((media?.currentTime ?? 0) - 5),
    forward5: () => seekTo((media?.currentTime ?? 0) + 5),
    back10: () => seekTo((media?.currentTime ?? 0) - 10),
    forward10: () => seekTo((media?.currentTime ?? 0) + 10),
    louder: () => setVolume((media?.volume ?? 1) + 0.1),
    quieter: () => setVolume((media?.volume ?? 1) - 0.1),
    mute: () => setMuted(!media?.muted),
    start: () => seekTo(0),
    end: () => seekTo(duration()),
    theatre: () => setTheatre(!doc.body.classList.contains("theatre")),
    slower: () => stepSpeed(-1),
    faster: () => stepSpeed(1),
    earlier: () => model?.subtitles && act("offset", -0.1),
    later: () => model?.subtitles && act("offset", 0.1),
  };

  doc.addEventListener("keydown", (event) => {
    if (model?.mode !== "media" || !loaded) return;
    const target = /** @type {HTMLElement} */ (event.target ?? doc.body);
    const focus = {
      tag: target.tagName ?? "",
      type: /** @type {HTMLInputElement} */ (target).type,
      id: target.id,
    };
    const action = actionFor(event, focus);
    if (!action) return;
    if (action === "leave") {
      if (!doc.body.classList.contains("theatre")) return;
      setTheatre(false);
    } else if (action === "previous" || action === "next") {
      if (!navigate(action === "next" ? 1 : -1)) return;
    } else actions[action]?.();
    event.preventDefault();
  });

  /** Next or previous: the playlist's entry, else the chapter; false when there is neither. */
  const navigate = (/** @type {number} */ step) => {
    if ((model?.playlist?.rows.length ?? 0) > 1) {
      act(step > 0 ? "next" : "previous");
      return true;
    }
    const chapters = model?.chapters ?? [];
    if (chapters.length === 0 || !media) return false;
    const now = media.currentTime;
    const index = chapters.findLastIndex((c) => c.start <= now + 0.5);
    const target =
      step > 0
        ? chapters[index + 1]
        : chapters[Math.max(0, now - (chapters[index]?.start ?? 0) > 3 ? index : index - 1)];
    if (target) seekTo(target.start);
    return true;
  };

  return {
    /** Show the model's media; a new source starts where the model says. */
    load(/** @type {Model} */ next) {
      const same = model?.buffer === next.buffer;
      const playing = carryOn || (media !== null && !media.paused);
      carryOn = false;
      model = next;
      const element = next.element === "video" ? video : audio;
      if (next.src && loaded !== next.src) {
        if (media) this.unload(false);
        media = element;
        loaded = next.src;
        retry.hidden = true;
        element.src = next.src;
        pending = next.start ?? 0;
        if (pending > 0) element.currentTime = pending;
        if (same && playing) toggle();
      } else if (!next.src) this.unload(false);
      media = element;
      video.hidden = next.element !== "video";
      audio.hidden = true;
      theatre.hidden = next.element !== "video";
      if (theatre.hidden) setTheatre(false);
      transport.hidden = !loaded;
      const many = (next.playlist?.rows.length ?? 0) > 1;
      byId("previous").hidden = !many;
      byId("next").hidden = !many;
      const options = next.subtitles?.options ?? [];
      subtitleControls.hidden = options.length === 0;
      subs.replaceChildren(
        new Option("Subtitles off", ""),
        ...options.map((o) => new Option(o.label, o.id, false, o.id === next.subtitles?.selected)),
      );
      subs.value = next.subtitles?.selected ?? "";
      offset.textContent = `${(next.subtitles?.offset ?? 0) >= 0 ? "+" : "−"}${Math.abs(next.subtitles?.offset ?? 0).toFixed(1)} s`;
      const offer = next.resume && loaded && offered !== loaded ? next.resume : 0;
      resume.hidden = !offer;
      if (offer) resumeText.textContent = `Resume at ${clock(offer)}?`;
      offered = offer ? loaded : offered;
      shownCues = "\0";
      drawTime();
      drawPlay();
    },
    /** Take the source away (details, cue lists, a closed file). */
    unload(all = true) {
      stopTicker();
      const had = loaded;
      // Forget the source first: the old element's pause event is not this file's progress.
      loaded = "";
      if (media && had) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
      overlay.textContent = "";
      shownCues = "";
      if (!all) return;
      media = null;
      model = null;
      transport.hidden = true;
      resume.hidden = true;
      video.hidden = true;
      setTheatre(false);
    },
    seekTo,
    /** Hear the position, for the chapter list. */
    onTime(/** @type {(time: number) => void} */ listener) {
      onTime = listener;
    },
    canPlay: (/** @type {string} */ type) => video.canPlayType(type),
    focus: () => !transport.hidden && play.focus(),
  };
}
