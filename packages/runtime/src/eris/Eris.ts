/**
 * Eris on the desk: the mesh body, the core glow, Dysnomia, the soul text under her, and the sound
 * rings. Draggable anywhere (the position is saved in the current mode); a click (or Enter) starts a
 * spoken turn (talk.ts). Everything runs on the ticker.
 */
import userHello from "../bridge/envelopes/user-hello.json";
import type { Bands, WordTime } from "../bridge/types";
import { moveEris } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { draggable } from "../shell/drag";
import { BODY, digest, type FrameModel, frameModel, type Palette, paint, paintMoon } from "./draw";
import { audioContext, openMic, sampleEar } from "./ear";
import { mountErrands } from "./errand";
import { basisFor, DENSITIES, type DensityName, generateMesh, type Mesh } from "./mesh";
import { speakAloud } from "./mouth";
import { SoulText } from "./SoulText";
import { coreBreath, type ErisState, floatOffset, LOOKS, type Look, LookTween } from "./states";
import { Talk } from "./talk";
import { type Cue, PULSE_TO_RIM_MS, Voice } from "./voice";

const MOON = 18;
const DEFAULT_TOP = 40;
const CUES: Partial<Record<ErisState, Cue>> = { listening: "listen", thinking: "think" };
const SYLLABLE_PULSE = 0.75;

/** Her colours: the theme's eris* tokens, which the theme in force sets on the document's root. */
function palette(): Palette {
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

/** The user's bands: the host's capture, or the turn's own ear where it is louder. */
function louder(host: Bands, heard: Bands): number[] {
  return Array.from({ length: 9 }, (_, k) => Math.max(host[k] ?? 0, heard[k] ?? 0));
}

export interface ErisHandle {
  say(text: string, words?: WordTime[]): void;
  setState(state: ErisState): void;
  /** Start a spoken turn (or, while she listens, stop listening and answer). */
  talk(): void;
  dispose(): void;
}

export function mountEris(
  root: HTMLElement,
  ctx: ShellCtx,
  layout: () => { x: number; y: number } | null,
): ErisHandle {
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
  const soul = new SoulText({
    style: () => ctx.store.get().eris.soul,
    reduced: ctx.reduced,
  });
  const el = h(
    "div",
    {
      class: "eris",
      role: "button",
      tabindex: "0",
      "aria-label": ctx.tr("erisLabel"),
      "data-state": "idle",
    },
    h("span", { class: "eris-ring", "aria-hidden": "true" }),
    body,
    soul.el,
  );
  root.append(el, soul.live);

  const voice = new Voice();
  const tween = new LookTween(ctx.store.get().eris.state);
  const meshes = new Map<string, Mesh>();
  const meshFor = (density: DensityName, state: ErisState): Mesh => {
    const look = LOOKS[state];
    const key = `${density}:${look.view.join()}:${look.goldToward.join()}`;
    let mesh = meshes.get(key);
    if (!mesh) {
      mesh = generateMesh({ ...DENSITIES[density], view: look.view, goldToward: look.goldToward });
      meshes.set(key, mesh);
    }
    return mesh;
  };
  const ctx2d = canvas.getContext("2d");
  let colors = palette();
  // The frame painted last, so a new theme repaints it at once instead of on the next tick.
  let painted: { model: FrameModel; look: Look } | undefined;
  let spin = 0;
  let last = ctx.ticker.now();
  let dragging: { x: number; y: number } | null = null;

  /** Soul text plus Eris's pulses (ms after the line starts); returns when the line starts. */
  const speakLine = (text: string, words: WordTime[] | undefined, pulses?: number[]) => {
    const now = ctx.ticker.now();
    const voiced = words !== undefined;
    const line = soul.say(text, now, words, voiced ? PULSE_TO_RIM_MS : 0);
    const times = pulses ?? words?.map((w) => w.at);
    // Syllables come closer together than words: smaller pulses keep each one distinct at the rim.
    const amplitude = pulses ? SYLLABLE_PULSE : 1;
    if (voiced && times)
      voice.speak(
        times.map((at) => line.start + at),
        amplitude,
      );
    ctx.store.set((s) => ({ eris: { ...s.eris, state: "idle", saying: text } }));
    return line.start;
  };
  const setState = (state: ErisState) => {
    ctx.store.set((s) => ({ eris: { ...s.eris, state } }));
  };
  const errands = mountErrands(
    () => (root.closest(".shell") as HTMLElement | null) ?? document.body,
    ctx,
  );
  const talk = new Talk({
    lang: () => ctx.store.get().lang,
    openEar: async () => {
      // Made inside the click, so the page lets it run once the person allows the microphone.
      const audio = audioContext();
      const granted = await ctx.bridge.perm.request("mic").catch(() => false);
      if (granted) return openMic(ctx.store.get().lang, audio);
      void audio?.close();
      return null;
    },
    sampleEar: (at) => sampleEar(userHello, at),
    // A spoken line runs the same agentic loop as a typed one, so its hand-offs are drawn too
    // (ADR 0089), and she speaks once every errand is back.
    answer: async (text) => {
      try {
        return await ctx.bridge.brain.say(text, (step) => errands.step(step));
      } finally {
        await errands.finish();
      }
    },
    line: (text, words, pulses) => speakLine(text, words, pulses),
    voice: speakAloud,
    setState,
    hush: () => {
      const now = ctx.ticker.now();
      soul.stop(now);
      voice.hush(now);
    },
  });

  const paintMoonNow = () => {
    const m = moon.getContext("2d");
    if (m && colors.frost) paintMoon(m, MOON, colors);
  };
  paintMoonNow();

  const position = () => {
    const vw = root.clientWidth || window.innerWidth;
    const vh = root.clientHeight || window.innerHeight;
    const p = dragging ?? layout() ?? { x: Math.round((vw - BODY.width) / 2), y: DEFAULT_TOP };
    return {
      x: Math.max(0, Math.min(p.x, vw - BODY.width)),
      y: Math.max(0, Math.min(p.y, vh - BODY.height)),
    };
  };

  const frame = (now: number) => {
    const s = ctx.store.get();
    const state = s.eris.state;
    const reduced = ctx.reduced();
    const { look, goldOf, breath: breathShown } = tween.at(state, now, reduced);
    const dt = Math.max(0, now - last);
    last = now;
    if (!reduced) spin += (look.spin * dt) / 1000;
    const heard = talk.update(now);
    const host = ctx.bridge.audio.levels();
    const levels = { user: louder(host.user, heard), eris: host.eris };
    const rings = voice.update(now, levels, reduced, CUES[state] ?? "none");
    if (rings.interrupted) {
      soul.stop(now);
      voice.hush(now);
      if (talk.phase === "speaking") talk.cancel();
    }
    const target = meshFor(s.eris.density, state);
    // Between two looks the same mesh turns from one view to the other; its gold face changes halfway.
    const mesh =
      look === LOOKS[state]
        ? target
        : { ...target, basis: basisFor(look.view), gold: meshFor(s.eris.density, goldOf).gold };
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
    canvas.dataset.rings = rings.disp.map((d) => (d * 100).toFixed(2)).join(" ");
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

    soul.update(now);
    const saying = soul.current(now);
    const doing =
      talk.phase === "listening"
        ? ctx.tr("erisListening")
        : talk.phase === "thinking"
          ? ctx.tr("erisThinking")
          : "";
    const said = saying || doing;
    el.setAttribute("aria-label", said ? `${ctx.tr("erisLabel")}: ${said}` : ctx.tr("erisLabel"));
    el.dataset.state = state;
    if (talk.phase === "off") delete el.dataset.talk;
    else el.dataset.talk = talk.phase;
    const p = position();
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  };

  let start = { x: 0, y: 0 };
  const offs = [
    ctx.ticker.add(frame),
    // Every theme applied: a desk.theme.* setting, a preview, a theme plugin installed or edited, the
    // OS's scheme. The theme system calls this after it has set the new tokens.
    ctx.runtime.themes.onChange(() => {
      colors = palette();
      paintMoonNow();
      if (ctx2d && colors.frost && painted) {
        paint(ctx2d, painted.model, painted.look, colors, BODY);
      }
    }),
    draggable(el, {
      start: () => {
        start = position();
      },
      move: (dx, dy) => {
        dragging = { x: start.x + dx, y: start.y + dy };
        frame(ctx.ticker.now());
      },
      end: (dx, dy) => {
        dragging = { x: start.x + dx, y: start.y + dy };
        const p = position();
        dragging = null;
        moveEris(ctx, p);
      },
      cancel: () => {
        dragging = null;
        frame(ctx.ticker.now());
      },
    }),
    // A click that was not a drag (drag.ts swallows the click after one) talks to her.
    listen(el, "click", () => talk.toggle(ctx.ticker.now())),
    listen(el, "keydown", (e) => {
      const k = e as KeyboardEvent;
      if (k.key === "Enter" || k.key === " ") {
        k.preventDefault();
        talk.toggle(ctx.ticker.now());
        return;
      }
      if (k.key === "Escape" && talk.phase !== "off") {
        k.preventDefault();
        k.stopPropagation();
        talk.cancel();
        return;
      }
      const step = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[
        k.key
      ];
      if (!step) return;
      k.preventDefault();
      const p = position();
      moveEris(ctx, { x: p.x + (step[0] ?? 0), y: p.y + (step[1] ?? 0) });
    }),
  ];

  return {
    say(text, words) {
      speakLine(text, words);
    },
    setState,
    talk() {
      talk.toggle(ctx.ticker.now());
    },
    dispose() {
      talk.dispose();
      errands.dispose();
      for (const off of offs) off();
      el.remove();
      soul.live.remove();
    },
  };
}
