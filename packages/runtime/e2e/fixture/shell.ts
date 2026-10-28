// Test page: the desk shell on the browser bridge stub, a manual clock and in-memory storage.
// ?lang=en, ?persist=1 (localStorage), ?reduced=1. Never shipped.
import "../../src/shell/styles";
import { browserBridge, type Envelope } from "../../src/bridge/browser";
import erisReply from "../../src/bridge/envelopes/eris-reply.json";
import userHello from "../../src/bridge/envelopes/user-hello.json";
import { ManualClock } from "../../src/clock";
import { mountDesk } from "../../src/shell/Desk";

const root = document.getElementById("desk");
if (!root) throw new Error("no #desk element");
const params = new URLSearchParams(location.search);
const clock = new ManualClock();
const memory = new Map<string, string>();
const storage = params.has("persist")
  ? window.localStorage
  : {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    };
// A fixed wall clock and platform, so "4:12 ago" and "⌘N" read the same on every machine.
const epoch = Date.parse("2026-10-28T09:00:00.000Z");
const bridge = browserBridge({ now: () => clock.now(), storage, epoch });
const desk = mountDesk({
  root,
  bridge,
  clock,
  epoch,
  platform: "mac",
  lang: params.get("lang") === "en" ? "en" : "ko",
  reducedMotion: params.has("reduced") ? true : undefined,
});

/** Advance the clock in 16 ms frames, ending exactly at `ms` later. */
function step(ms: number): void {
  let left = ms;
  while (left > 0) {
    const d = Math.min(16, left);
    clock.advance(d);
    left -= d;
  }
}

window.__shell = {
  desk,
  clock,
  bridge,
  step,
  envelopes: { user: userHello as Envelope, eris: erisReply as Envelope },
};
