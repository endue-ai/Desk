/** Eris in a standalone window, driven by the same scene as the desk. */
import { wordTimes } from "../bridge/browser";
import type { Clock } from "../clock";
import { h, listen } from "../shell/dom";
import { IDLE, Ticker } from "../shell/ticker";
import type { DensityName } from "./mesh";
import { syllablePulses } from "./mouth";
import { createScene } from "./scene";
import type { ErisState } from "./states";
import { type Cue, PULSE_TO_RIM_MS, Voice } from "./voice";

const SILENT = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);
const CUES: Partial<Record<ErisState, Cue>> = { listening: "listen", thinking: "think" };
export interface FigureOptions {
  clock: Clock;
  reduced(): boolean;
  density?: DensityName;
  /** Called on every frame after she is painted. */
  tick?(now: number): void;
}

export interface Figure {
  /** `.eris` with her body inside; the caller gives it its role and label. */
  el: HTMLElement;
  set(state: ErisState): void;
  /** Pulse once per syllable of `text`, at `msPerChar` a letter. */
  speak(text: string, msPerChar: number): void;
  /** The theme changed: read her colours again and repaint. */
  restyle(): void;
  dispose(): void;
}

export function mountFigure(options: FigureOptions): Figure {
  const density = options.density ?? "balanced";
  const ticker = new Ticker(options.clock);
  const voice = new Voice();
  let state: ErisState = "idle";
  const scene = createScene(state, ticker.now());
  const el = h("div", { class: "eris", "data-state": state }, scene.body);
  const off = ticker.add((now) => {
    if (document.hidden) return IDLE;
    const reduced = options.reduced();
    const rings = voice.update(now, { user: SILENT, eris: SILENT }, reduced, CUES[state] ?? "none");
    scene.update(state, density, rings, now, reduced);
    el.dataset.state = state;
    options.tick?.(now);
    return reduced && state === "idle" && rings.mode === "idle" ? IDLE : undefined;
  });
  const wake = () => ticker.wake();
  const visibility = listen(document, "visibilitychange", wake);
  return {
    el,
    set(next) {
      state = next;
      wake();
    },
    speak(text, msPerChar) {
      wake();
      const start = ticker.now() + PULSE_TO_RIM_MS;
      const pulses = syllablePulses(wordTimes(text, msPerChar), msPerChar);
      voice.speak(
        pulses.map((at) => start + at),
        0.75,
      );
    },
    restyle() {
      wake();
      scene.restyle();
    },
    dispose() {
      visibility();
      off();
      ticker.dispose();
      el.remove();
    },
  };
}
