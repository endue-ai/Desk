/**
 * Eris on the desk: the mesh body, the core glow, Dysnomia, the soul text under her, and the sound
 * rings. Draggable anywhere (the position is saved in the current mode). Everything runs on the ticker.
 */
import type { WordTime } from "../bridge/types";
import { moveEris } from "../shell/actions";
import type { ShellCtx } from "../shell/context";
import { h, listen } from "../shell/dom";
import { draggable } from "../shell/drag";
import { BODY, digest, frameModel, type Palette, paint, paintMoon } from "./draw";
import { DENSITIES, type DensityName, generateMesh, type Mesh } from "./mesh";
import { SoulText } from "./SoulText";
import { coreBreath, type ErisState, floatOffset, LOOKS } from "./states";
import { PULSE_TO_RIM_MS, Voice } from "./voice";

const MOON = 18;
const DEFAULT_TOP = 40;

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(`--persona-eris-${name}`).trim();
  return {
    frost: v("frost"),
    gold: css.getPropertyValue("--persona-eris").trim(),
    goldLight: v("gold-light"),
    goldDeep: v("gold-deep"),
    goldDimLight: v("gold-dim-light"),
    goldDimDeep: v("gold-dim-deep"),
    white: v("white"),
    moonDark: v("moon-dark"),
    moonLit: v("moon-lit"),
    shade: v("shade"),
  };
}

export interface ErisHandle {
  say(text: string, words?: WordTime[]): void;
  setState(state: ErisState): void;
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
      role: "img",
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
  let spin = 0;
  let last = ctx.ticker.now();
  let dragging: { x: number; y: number } | null = null;

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
    const look = LOOKS[state];
    const reduced = ctx.reduced();
    const dt = Math.max(0, now - last);
    last = now;
    if (!reduced) spin += (look.spin * dt) / 1000;
    const rings = voice.update(now, ctx.bridge.audio.levels(), reduced);
    if (rings.interrupted) {
      soul.stop(now);
      voice.hush(now);
    }
    const mesh = meshFor(s.eris.density, state);
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
    if (ctx2d && colors.frost) paint(ctx2d, model, look, colors, BODY);
    canvas.dataset.mesh = digest(model);
    canvas.dataset.rings = rings.disp.map((d) => (d * 100).toFixed(2)).join(" ");
    canvas.dataset.voice = rings.mode;

    const float = reduced ? { body: 0, moon: 0 } : floatOffset(now);
    body.style.transform = `translateY(${float.body.toFixed(2)}px)`;
    const breath = look.core.breathe && !reduced ? coreBreath(now) : 1;
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
    el.setAttribute(
      "aria-label",
      saying ? `${ctx.tr("erisLabel")}: ${saying}` : ctx.tr("erisLabel"),
    );
    el.dataset.state = state;
    const p = position();
    el.style.left = `${p.x}px`;
    el.style.top = `${p.y}px`;
  };

  let start = { x: 0, y: 0 };
  const offs = [
    ctx.ticker.add(frame),
    ctx.store.watch(
      (s) => s.theme,
      () => {
        colors = palette();
        paintMoonNow();
      },
    ),
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
    }),
    listen(el, "keydown", (e) => {
      const k = e as KeyboardEvent;
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
      const now = ctx.ticker.now();
      const voiced = words !== undefined;
      const line = soul.say(text, now, words, voiced ? PULSE_TO_RIM_MS : 0);
      if (voiced && words) voice.speak(words.map((w) => line.start + w.at));
      ctx.store.set((s) => ({ eris: { ...s.eris, state: "idle", saying: text } }));
    },
    setState(state) {
      ctx.store.set((s) => ({ eris: { ...s.eris, state } }));
    },
    dispose() {
      for (const off of offs) off();
      el.remove();
      soul.live.remove();
    },
  };
}
