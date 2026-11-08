// Korean IME composition into the terminal never drops or doubles a syllable (#538, TERM-E02): the
// sequences xterm and WebKit produce while 한 is composed, committed by the next syllable, by Enter
// or by nothing at all.
import { describe, expect, it } from "vitest";
import { createImeGuard } from "../ui/ime.js";

function guard() {
  const sent: string[] = [];
  let deferred: Array<() => void> = [];
  let timers: Array<() => void> = [];
  const ime = createImeGuard({
    send: (data) => sent.push(data),
    defer: (callback) => deferred.push(callback),
    later: (callback) => timers.push(callback),
    cancel: () => {
      timers = [];
    },
  });
  /** The timeouts of this turn run: xterm's first, as it queued them first. */
  const tick = (late?: string) => {
    if (late !== undefined) ime.data(late);
    const due = deferred;
    deferred = [];
    for (const callback of due) callback();
  };
  const compose = (...steps: string[]) => {
    ime.start();
    for (const step of steps) ime.update(step);
  };
  return {
    ime,
    sent,
    tick,
    compose,
    timeout: () => {
      for (const timer of timers.splice(0)) timer();
    },
  };
}

describe("IME composition", () => {
  it("sends a syllable once, xterm's late copy dropped", () => {
    const { ime, sent, tick, compose } = guard();
    compose("ㅎ", "하", "한");
    ime.end("한");
    tick("한");
    expect(sent).toEqual(["한"]);
  });

  it("the same syllable twice in a row is two syllables", () => {
    const { ime, sent, tick, compose } = guard();
    compose("ㅎ", "하");
    ime.end("하");
    tick("하");
    compose("ㅎ", "하");
    ime.end("하");
    tick("하");
    expect(sent).toEqual(["하", "하"]);
  });

  it("Enter during a composition: the syllable once, then Enter, in that order", () => {
    const { ime, sent, tick, compose } = guard();
    compose("ㄱ", "그", "글");
    // WebKit: the key that ends the composition makes xterm send the syllable and the Enter first.
    ime.data("글");
    ime.data("\r");
    ime.end("글");
    tick("글");
    expect(sent).toEqual(["글", "\r"]);
  });

  it("a stale part of the syllable xterm sent early is not typed", () => {
    const { ime, sent, tick, compose } = guard();
    compose("ㅎ", "하", "한");
    ime.data("하");
    ime.data("\r");
    ime.end("한");
    tick();
    expect(sent).toEqual(["한", "\r"]);
  });

  it("the next syllable starting at once still gets this one, and its own", () => {
    const { ime, sent, tick, compose } = guard();
    compose("ㅎ", "하", "한");
    ime.end("한");
    compose("ㄱ");
    tick("한");
    ime.update("그");
    ime.update("글");
    ime.end("글");
    tick("글 ");
    expect(sent).toEqual(["한", "글", " "]);
  });

  it("a cancelled composition, or one that never ends, loses nothing it held", () => {
    const { ime, sent, compose, timeout } = guard();
    compose("ㅎ");
    ime.data("\x1b");
    ime.end("");
    expect(sent).toEqual(["\x1b"]);
    compose("ㅎ", "하");
    ime.data("x");
    timeout();
    expect(sent).toEqual(["\x1b", "x"]);
  });

  it("typing without an IME goes straight through", () => {
    const { ime, sent } = guard();
    ime.data("ls");
    ime.data("\r");
    expect(sent).toEqual(["ls", "\r"]);
  });
});
