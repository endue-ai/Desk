// The software player's element on fakes: the worker protocol, the clock on the audio context, the
// pictures shown in time and the late ones dropped, seeking, flow control, the end and errors.
import { describe, expect, it, vi } from "vitest";
import { createClock } from "../ui/software/clock.js";
import { acked, picture, READY, setup, sound } from "./software-fakes";

const VIDEO_ONLY = { ...READY, audio: null };
const AUDIO_ONLY = { ...READY, video: null };
const near = (value: number) => expect.closeTo(value, 6);

describe("opening", () => {
  it("opens the file's URL in the worker and says loadedmetadata when it is ready", () => {
    const { media, worker, events } = setup();
    expect(worker().posted[0]?.message).toEqual({
      type: "open",
      wasm: "desk-plugin://endue.player/ui/vendor/ffmpeg/ffmpeg.wasm",
      url: "desk-plugin://desk/_desk/file/abc/clip.wmv",
      size: 1234,
      video: true,
      audio: true,
    });
    expect(media.duration).toBeNaN();
    expect(media.readyState).toBe(0);
    expect(media.waiting).toBe(true);
    worker().send(READY);
    expect(events).toEqual(["loadedmetadata", "durationchange"]);
    expect(media).toMatchObject({ duration: 10, readyState: 1, videoWidth: 4, videoHeight: 2 });
    expect(media).toMatchObject({ hasVideo: true, hasAudio: true, waiting: false, paused: true });
  });

  it("a file of unknown length has an infinite duration", () => {
    const { media, worker } = setup();
    worker().send({ ...READY, duration: 0 });
    expect(media.duration).toBe(Number.POSITIVE_INFINITY);
  });

  it("shows the first picture while paused", () => {
    const { media, worker, draws, events } = setup();
    worker().send(READY);
    worker().send(picture(0));
    worker().send(picture(0.1));
    expect(draws).toHaveLength(1);
    expect(draws[0]?.planes[0]?.[0]).toBe(0);
    expect(events).toContain("loadeddata");
    expect(media.readyState).toBe(4);
  });
});

describe("the clock", () => {
  it("play and pause follow the audio context", async () => {
    const { media, worker, ctx, events, pass } = setup();
    worker().send(READY);
    worker().send(sound(0, 2));
    await media.play();
    expect(ctx.state).toBe("running");
    expect(events.slice(-2)).toEqual(["play", "playing"]);
    pass(0.5);
    expect(media.currentTime).toEqual(near(0.5));
    expect(ctx.playing()[0]?.started).toEqual([0, 0]);
    // The wall clock does not count while the context runs.
    pass(0.25, { wall: false });
    expect(media.currentTime).toEqual(near(0.75));
    pass(0.25, { audio: false });
    expect(media.currentTime).toEqual(near(0.75));
    media.pause();
    expect(events.at(-1)).toBe("pause");
    expect(ctx.playing()).toEqual([]);
    pass(1);
    expect(media.currentTime).toEqual(near(0.75));
    // Playing on starts the sound again where the clock is.
    await media.play();
    expect(ctx.playing()[0]?.started).toEqual([near(1.75), near(0.75)]);
  });

  it("a context that stays suspended leaves the clock on the wall", async () => {
    const { media, worker, ctx, pass } = setup();
    ctx.resumes = false;
    worker().send(READY);
    worker().send(sound(0, 2));
    await media.play();
    pass(0.5, { audio: false });
    expect(media.currentTime).toEqual(near(0.5));
    expect(ctx.playing()).toEqual([]);
  });

  it("goes on from where it is when the context starts late", () => {
    let ms = 0;
    const audio = { on: false, time: 7 };
    const clock = createClock({
      now: () => ms,
      audio: () => ({ running: () => audio.on, time: () => audio.time }),
    });
    clock.start();
    ms = 1000;
    expect(clock.time()).toEqual(near(1));
    audio.on = true;
    expect(clock.time()).toEqual(near(1));
    audio.time = 7.5;
    ms = 5000;
    expect(clock.time()).toEqual(near(1.5));
    expect(clock.context(2)).toEqual(near(8));
    clock.rate(2);
    audio.time = 8;
    expect(clock.time()).toEqual(near(2.5));
  });

  it("waits where the sound ran out and plays on when more arrives", async () => {
    const { media, worker, events, pass } = setup();
    worker().send(READY);
    worker().send(sound(0, 0.5));
    await media.play();
    pass(0.6);
    expect(events.at(-1)).toBe("waiting");
    expect(media.waiting).toBe(true);
    pass(1);
    expect(media.currentTime).toEqual(near(0.5));
    worker().send(sound(0.5, 0.5));
    expect(events.at(-1)).toBe("playing");
    pass(0.25);
    expect(media.currentTime).toEqual(near(0.75));
  });

  it("the rate moves the clock and the sources", async () => {
    const { media, worker, ctx, events, pass } = setup();
    worker().send(READY);
    worker().send(sound(0, 4));
    await media.play();
    pass(0.5);
    media.playbackRate = 2;
    expect(events.at(-1)).toBe("ratechange");
    expect(ctx.sources[0]?.stopped).toBe(true);
    pass(0.25);
    expect(media.currentTime).toEqual(near(1));
    expect(ctx.playing()[0]?.playbackRate.value).toBe(2);
  });
});

describe("pictures", () => {
  it("shows each picture at its time, drops the late ones, and says so once", async () => {
    const { media, worker, draws, events, pass } = setup({ audio: false });
    worker().send(VIDEO_ONLY);
    for (let i = 0; i <= 5; i++) worker().send(picture(i / 10));
    expect(draws).toHaveLength(1);
    await media.play();
    pass(0.15);
    expect(draws.map((d) => d.planes[0]?.[0])).toEqual([0, 1]);
    expect(media.getVideoPlaybackQuality()).toEqual({ totalVideoFrames: 2, droppedVideoFrames: 0 });
    pass(0.35);
    expect(draws.map((d) => d.planes[0]?.[0])).toEqual([0, 1, 5]);
    expect(media.getVideoPlaybackQuality()).toEqual({ totalVideoFrames: 6, droppedVideoFrames: 3 });
    for (let i = 6; i <= 15; i++) worker().send(picture(i / 10));
    pass(1);
    expect(media.getVideoPlaybackQuality()).toEqual({
      totalVideoFrames: 16,
      droppedVideoFrames: 12,
    });
    expect(events.filter((e) => e === "dropping")).toEqual(["dropping"]);
    for (let i = 16; i <= 30; i++) worker().send(picture(i / 10));
    pass(1.5);
    expect(events.filter((e) => e === "dropping")).toHaveLength(1);
  });

  it("asks the decoder to hurry while far behind, and to stop once ahead", async () => {
    const { media, worker, pass } = setup();
    worker().send(READY);
    worker().send(sound(0, 1.5));
    worker().send(picture(0));
    await media.play();
    pass(0.5);
    expect(worker().sent("late")).toEqual([{ type: "late", on: true }]);
    worker().send(picture(0.6));
    pass(0.05);
    expect(worker().sent("late")).toEqual([
      { type: "late", on: true },
      { type: "late", on: false },
    ]);
  });
});

describe("seeking", () => {
  it("posts the seek with a new seq, drops old output and shows the new picture while paused", () => {
    const { media, worker, draws, events } = setup();
    worker().send(READY);
    media.currentTime = 5;
    expect(events.at(-1)).toBe("seeking");
    expect(media).toMatchObject({ seeking: true, currentTime: 5, waiting: true, readyState: 1 });
    expect(worker().sent("seek")).toEqual([{ type: "seek", time: 5, seq: 1 }]);
    worker().send(picture(4, 0));
    expect(draws).toEqual([]);
    expect(worker().sent("ack").at(-1)).toEqual({ type: "ack", video: 1 });
    worker().send(picture(5, 1));
    expect(events.filter((e) => e.startsWith("seek"))).toEqual(["seeking", "seeked"]);
    expect(media.seeking).toBe(false);
    expect(draws.map((d) => d.planes[0]?.[0])).toEqual([50]);
    expect(media.currentTime).toBe(5);
  });

  it("a seek before the worker is ready waits for it", () => {
    const { media, worker } = setup();
    media.currentTime = 3;
    expect(media.currentTime).toBe(3);
    expect(worker().sent("seek")).toEqual([]);
    worker().send(READY);
    expect(worker().sent("seek")).toEqual([{ type: "seek", time: 3, seq: 1 }]);
  });

  it("a seek past the end lands at the end", () => {
    const { media, worker } = setup();
    worker().send(READY);
    media.currentTime = 99;
    expect(worker().sent("seek")).toEqual([{ type: "seek", time: 10, seq: 1 }]);
  });
});

describe("flow control", () => {
  it("tells the worker every picture and every second of sound used", async () => {
    const { media, worker, pass } = setup();
    worker().send(READY);
    worker().send(sound(0, 0.5));
    worker().send(sound(0.5, 0.5));
    worker().send(picture(0));
    worker().send(picture(0.1));
    worker().send(picture(0.2));
    expect(acked(worker())).toEqual({ video: 1, audio: 0 });
    await media.play();
    pass(0.6);
    expect(acked(worker())).toEqual({ video: 3, audio: 0.5 });
    // A seek gives back what was queued for the old position.
    media.currentTime = 4;
    expect(acked(worker())).toEqual({ video: 3, audio: 1 });
    worker().send(sound(3, 0.25, 0));
    expect(acked(worker())).toEqual({ video: 3, audio: 1.25 });
  });
});

describe("the end", () => {
  it("ends when everything decoded was shown and heard", async () => {
    const { media, worker, events, pass } = setup({ audio: false });
    worker().send({ ...VIDEO_ONLY, duration: 0.2 });
    worker().send(picture(0));
    worker().send(picture(0.1));
    worker().send({ type: "end", seq: 0 });
    await media.play();
    pass(0.15);
    expect(media.ended).toBe(false);
    pass(0.1);
    expect(events.slice(-2)).toEqual(["pause", "ended"]);
    expect(media).toMatchObject({ ended: true, paused: true, currentTime: 0.2 });
    await media.play();
    expect(worker().sent("seek")).toEqual([{ type: "seek", time: 0, seq: 1 }]);
    expect(media).toMatchObject({ ended: false, paused: false });
  });

  it("loops back to the start and plays on", async () => {
    const { media, worker, events, pass } = setup({ audio: false });
    media.loop = true;
    worker().send({ ...VIDEO_ONLY, duration: 0.2 });
    worker().send(picture(0));
    worker().send(picture(0.1));
    worker().send({ type: "end", seq: 0 });
    await media.play();
    pass(0.3);
    expect(worker().sent("seek")).toEqual([{ type: "seek", time: 0, seq: 1 }]);
    expect(events).not.toContain("ended");
    expect(media.paused).toBe(false);
    worker().send(picture(0, 1));
    expect(events.at(-1)).toBe("playing");
  });
});

describe("errors", () => {
  it("an error from the worker is an error event with its words", async () => {
    const { media, worker, events } = setup();
    worker().send({ type: "error", code: "open", message: "FFmpeg cannot open clip.rm." });
    expect(events).toEqual(["error"]);
    expect(media.error).toEqual({ code: 4, message: "FFmpeg cannot open clip.rm." });
    expect(worker().terminated).toBe(true);
    expect(media.waiting).toBe(false);
    await expect(media.play()).rejects.toThrow("FFmpeg cannot open clip.rm.");
  });

  it("a worker that cannot read the URL gets the whole file, once, and goes on where it was", async () => {
    const bytes = new ArrayBuffer(16);
    const readAll = vi.fn(async () => bytes);
    const { media, workers, worker, events } = setup({ readAll });
    worker().send(READY);
    media.currentTime = 4;
    workers[0]?.send({ type: "error", code: "read", message: "Cannot read the URL." });
    expect(readAll).toHaveBeenCalledOnce();
    expect(workers[0]?.terminated).toBe(true);
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const open = workers[1]?.posted[0];
    expect(open?.message).toMatchObject({ type: "open", bytes, size: 1234 });
    expect(open?.message).not.toHaveProperty("url");
    expect(open?.transfer).toEqual([bytes]);
    expect(events).not.toContain("error");
    worker().send(READY);
    expect(worker().sent("seek")).toEqual([{ type: "seek", time: 4, seq: 1 }]);
    expect(events.filter((e) => e === "loadedmetadata")).toHaveLength(1);
    worker().send({ type: "error", code: "read", message: "Cannot read the URL." });
    expect(events.at(-1)).toBe("error");
    expect(readAll).toHaveBeenCalledOnce();
  });

  it("a worker that fails to start is an error", () => {
    const { media, worker, events } = setup();
    worker().dispatchEvent(new Event("error"));
    expect(events).toEqual(["error"]);
    expect(media.error?.message).toBe("The software decoder could not start.");
  });
});

describe("sound", () => {
  it("audio-only files need no canvas", async () => {
    const { media, worker, ctx, screens, pass } = setup({ canvas: false });
    expect(screens()).toBe(0);
    expect(worker().posted[0]?.message).toMatchObject({ video: false, audio: true });
    worker().send(AUDIO_ONLY);
    expect(media).toMatchObject({ hasVideo: false, hasAudio: true });
    worker().send(sound(0, 1));
    await media.play();
    pass(0.5);
    expect(ctx.playing()).toHaveLength(1);
    expect(media.currentTime).toEqual(near(0.5));
  });

  it("volume and muted reach the gain", () => {
    const { media, worker, ctx, events } = setup();
    worker().send(READY);
    const gain = ctx.gains[0]?.gain;
    expect(gain?.value).toBe(1);
    media.volume = 0.5;
    expect(gain?.value).toBe(0.5);
    media.muted = true;
    expect(gain?.value).toBe(0);
    media.muted = false;
    expect(gain?.value).toBe(0.5);
    expect(events.filter((e) => e === "volumechange")).toHaveLength(3);
  });

  it("close ends the worker, the context and the screen, and hears nothing more", () => {
    const { media, worker, ctx, screen, draws } = setup();
    worker().send(READY);
    media.close();
    expect(worker().sent("close")).toEqual([{ type: "close" }]);
    expect(worker().terminated).toBe(true);
    expect(ctx.state).toBe("closed");
    expect(screen.closed).toBe(1);
    worker().send(picture(0));
    expect(draws).toEqual([]);
  });
});
