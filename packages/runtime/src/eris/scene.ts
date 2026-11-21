/** The desk and standalone figure share the same material, animation clock and depth ordering. */
import { h } from "../shell/dom";
import { BODY, digest, type FrameModel, frameModel, type Palette, paint, paintMoon } from "./draw";
import { basisFor, DENSITIES, type DensityName, generateMesh, type Mesh, VIEW_IDLE } from "./mesh";
import { Dysnomia, helperPose, Slots } from "./satellites";
import { coreBreath, type ErisState, floatOffset, type Look, LookTween } from "./states";
import type { RingFrame } from "./voice";

function palette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (key: string) => css.getPropertyValue(`--desk-${key}`).trim();
  return {
    frost: token("eris-frost"),
    white: token("eris-white"),
    shade: token("eris-shade"),
    ground: token("background"),
    moonDark: token("eris-moon-dark"),
    moonLit: token("eris-moon-lit"),
    warning: token("warning"),
    danger: token("danger"),
  };
}

export function createScene(initial: ErisState, start: number) {
  const pixelRatio = Math.min(3, window.devicePixelRatio || 1);
  const canvas = h("canvas", {
    class: "eris-mesh",
    width: Math.round(BODY.width * pixelRatio),
    height: Math.round(BODY.height * pixelRatio),
  });
  const ctx = canvas.getContext("2d");
  if (pixelRatio !== 1) ctx?.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const core = h("span", { class: "eris-core" });
  const halo = h("span", { class: "eris-halo" });
  const body = h("div", { class: "eris-body" }, halo, canvas, core);
  const meshes = new Map<DensityName, Mesh>();
  const fleet = new Slots();
  const dysnomia = new Dysnomia();
  const tween = new LookTween(initial);
  let colors = palette();
  let painted: { model: FrameModel; look: Look } | undefined;
  let spin = 0;
  let last = start;

  function moon(size: number, id?: string) {
    const pixels = Math.ceil(size * pixelRatio);
    const face = h("canvas", { class: "eris-moon", width: pixels, height: pixels });
    const box = h("span", { class: "eris-moon-box", "aria-hidden": "true" }, face);
    box.style.width = box.style.height = `${size}px`;
    if (id) box.dataset.helper = id;
    body.append(box);
    const brush = face.getContext("2d");
    const redraw = () => {
      if (colors.frost && brush) paintMoon(brush, pixels, colors);
    };
    redraw();
    return { box, redraw };
  }
  const primary = moon(18);
  const helpers = new Map<string, ReturnType<typeof moon>>();
  function place(box: HTMLElement, p: ReturnType<typeof helperPose>) {
    box.style.left = `${(BODY.cx + p.x).toFixed(2)}px`;
    box.style.top = `${(BODY.cy + p.y).toFixed(2)}px`;
    box.style.zIndex = String(100 + Math.round(p.z * 0.9));
    box.style.opacity = p.z < 0 ? ".70" : "1";
    const turn = Math.atan2(p.y, p.x) - Math.PI / 4;
    box.style.transform = `translate(-50%, -50%) rotate(${turn.toFixed(3)}rad) scale(${p.scale.toFixed(3)})`;
  }
  function restyle() {
    colors = palette();
    primary.redraw();
    for (const m of helpers.values()) m.redraw();
    if (ctx && colors.frost && painted) paint(ctx, painted.model, painted.look, colors, BODY);
  }
  function update(
    state: ErisState,
    density: DensityName,
    rings: RingFrame,
    now: number,
    reduced: boolean,
    ids: readonly string[] = [],
  ) {
    const { look, breath, tremor } = tween.at(state, now, reduced);
    if (!reduced) spin += (look.spin * Math.min(100, Math.max(0, now - last))) / 1000;
    last = now;
    let topology = meshes.get(density);
    if (!topology) {
      topology = generateMesh({ ...DENSITIES[density], view: VIEW_IDLE });
      meshes.set(density, topology);
    }
    const mesh = { ...topology, basis: basisFor(look.view) };
    const model = frameModel({
      mesh,
      look,
      geometry: BODY,
      spin,
      disp: rings.disp,
      glow: rings.glow,
    });
    if (!colors.frost) restyle();
    painted = { model, look };
    if (ctx && colors.frost) paint(ctx, model, look, colors, BODY);
    canvas.dataset.mesh = digest(model);
    canvas.dataset.voice = rings.mode;
    canvas.dataset.rings = rings.disp.map((d) => (d * 100).toFixed(2)).join(" ");
    const bob = reduced ? 0 : floatOffset(now).body * (rings.mode === "idle" ? 0.45 : 0.22);
    body.style.transform = `translate(${tremor.toFixed(2)}px, ${bob.toFixed(2)}px)`;
    core.style.opacity = (
      look.core.opacity * (reduced ? 1 : 1 + (coreBreath(now) - 1) * breath)
    ).toFixed(3);
    core.style.transform = `translate(-50%, -50%) scale(${(look.core.scale * rings.core).toFixed(3)})`;
    halo.hidden = !look.halo;
    place(primary.box, dysnomia.at(state === "thinking", now, reduced));
    for (const [id, m] of helpers)
      if (!ids.includes(id)) {
        m.box.remove();
        helpers.delete(id);
      }
    for (const run of fleet.update(ids, now)) {
      let m = helpers.get(run.id);
      if (!m) {
        m = moon(11, run.id);
        helpers.set(run.id, m);
      }
      place(m.box, helperPose(run, now, reduced));
    }
  }
  return { body, restyle, update };
}
