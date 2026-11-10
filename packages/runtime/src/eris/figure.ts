/**
 * Her figure on its own, for a window without the shell (the floating Eris, ADR 0121): the same
 * mesh, core, halo and Dysnomia as the desk's Eris, in the same classes and theme tokens, painted
 * from a state on an injected clock. No microphone rings; one pulse per syllable while she speaks.
 * Idle, silent and settled for `REST_MS` she rests as the desk's Eris does (ADR 0164): a new state, a
 * line or a new look wakes her.
 */
import { wordTimes } from "../bridge/browser";
import type { Clock } from "../clock";
import { h } from "../shell/dom";
import { IDLE, Ticker } from "../shell/ticker";
import { BODY, digest, type FrameModel, frameModel, type Palette, paint, paintMoon } from "./draw";
import { basisFor, DENSITIES, type DensityName, generateMesh, type Mesh } from "./mesh";
import { syllablePulses } from "./mouth";
import {
  coreBreath,
  type ErisState,
  floatOffset,
  LOOKS,
  type Look,
  LookTween,
  REST_MS,
} from "./states";
import { type Cue, PULSE_TO_RIM_MS, Voice } from "./voice";

const MOON = 18;
const SILENT = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0]);
const CUES: Partial<Record<ErisState, Cue>> = { listening: "listen", thinking: "think" };
const SYLLABLE_PULSE = 0.75;

/** Her colours: the theme's eris* tokens, which the theme in force sets on the document's root. */
export function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--desk-eris-${name}`).trim();
  return {
    frost: v("frost"),
    gold: css.getPropertyValue("--desk-eris").trim(),
    goldLight: v("gold-light"),
    goldDeep: v("gold-deep"),
    goldDimLight: v("gold-dim-light"),
    goldDimDeep: v("gold-dim-deep"),
    white: v("white"),
    moonDark: v("moon-dark"),
    moonLit: v("moon-lit"),
    shade: v("shade"),
    ground: css.getPropertyValue("--desk-background").trim(),
  };
}

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
  const canvas = h("canvas", { class: "eris-mesh", width: BODY.width, height: BODY.height });
  const moon = h("canvas", { class: "eris-moon", width: MOON, height: MOON });
  const core = h("span", { class: "eris-core" });
  const halo = h("span", { class: "eris-halo" });
  const tail = [
    h("span", { class: "eris-tail eris-tail-1" }),
    h("span", { class: "eris-tail eris-tail-2" }),
  ];
  const spark = h("span", { class: "eris-spark" });
  const moonBox = h("span", { class: "eris-moon-box" }, moon, spark);
  const body = h("div", { class: "eris-body" }, halo, canvas, core, ...tail, moonBox);
  const el = h(
    "div",
    { class: "eris", "data-state": "idle" },
    h("span", { class: "eris-ring", "aria-hidden": "true" }),
    body,
  );

  const density = options.density ?? "balanced";
  const ticker = new Ticker(options.clock);
  const voice = new Voice();
  let state: ErisState = "idle";
  const tween = new LookTween(state);
  const meshes = new Map<string, Mesh>();
  const meshFor = (s: ErisState): Mesh => {
    const look = LOOKS[s];
    const key = `${look.view.join()}:${look.goldToward.join()}`;
    let mesh = meshes.get(key);
    if (!mesh) {
      mesh = generateMesh({ ...DENSITIES[density], view: look.view, goldToward: look.goldToward });
      meshes.set(key, mesh);
    }
    return mesh;
  };
  const ctx2d = canvas.getContext("2d");
  let colors = palette();
  let painted: { model: FrameModel; look: Look } | undefined;
  let spin = 0;
  let last = ticker.now();

  const paintMoonNow = () => {
    const m = moon.getContext("2d");
    if (m && colors.frost) paintMoon(m, MOON, colors);
  };
  paintMoonNow();

  const frame = (now: number) => {
    const reduced = options.reduced();
    const { look, goldOf, breath: breathShown } = tween.at(state, now, reduced);
    const dt = Math.max(0, now - last);
    last = now;
    if (!reduced) spin += (look.spin * dt) / 1000;
    const rings = voice.update(now, { user: SILENT, eris: SILENT }, reduced, CUES[state] ?? "none");
    const target = meshFor(state);
    const mesh =
      look === LOOKS[state]
        ? target
        : { ...target, basis: basisFor(look.view), gold: meshFor(goldOf).gold };
    const model = frameModel({
      mesh,
      look,
      geometry: BODY,
      spin,
      disp: rings.disp,
      glow: rings.glow,
      goldMoves: rings.mode === "speaking",
    });
    if (!colors.frost) {
      colors = palette();
      paintMoonNow();
    }
    painted = { model, look };
    if (ctx2d && colors.frost) paint(ctx2d, model, look, colors, BODY);
    canvas.dataset.mesh = digest(model);
    canvas.dataset.voice = rings.mode;

    const float = reduced ? { body: 0, moon: 0 } : floatOffset(now);
    body.style.transform = `translateY(${float.body.toFixed(2)}px)`;
    const breath = reduced ? 1 : 1 + (coreBreath(now) - 1) * breathShown;
    core.style.opacity = (look.core.opacity * breath).toFixed(3);
    core.style.transform = `translate(-50%, -50%) scale(${(look.core.scale * rings.core).toFixed(3)})`;
    halo.hidden = !look.halo;
    moonBox.style.left = `${Math.round(look.dysnomia.x * 100)}%`;
    moonBox.style.top = `${Math.round(look.dysnomia.y * 100)}%`;
    moonBox.style.transform = `translate(-50%, calc(-50% + ${float.moon.toFixed(2)}px))`;
    for (const t of tail) t.hidden = !look.dysnomia.tail;
    spark.hidden = !look.dysnomia.spark;
    el.dataset.state = state;
    options.tick?.(now);
    if (state !== "idle" || look !== LOOKS.idle || rings.mode !== "idle") {
      quiet = undefined;
      return;
    }
    quiet ??= now;
    return now - quiet >= REST_MS ? IDLE : undefined;
  };
  // Since when she has been idle, silent and settled.
  let quiet: number | undefined;
  const wake = () => {
    quiet = undefined;
    ticker.wake();
  };
  const off = ticker.add(frame);

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
        SYLLABLE_PULSE,
      );
    },
    restyle() {
      wake();
      colors = palette();
      paintMoonNow();
      if (ctx2d && colors.frost && painted) {
        paint(ctx2d, painted.model, painted.look, colors, BODY);
      }
    },
    dispose() {
      off();
      ticker.dispose();
      el.remove();
    },
  };
}
