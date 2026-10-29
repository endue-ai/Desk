/**
 * Turn a mesh, a look and a ring frame into a list of projected triangles, paint it on a canvas, and
 * digest it for snapshots. The model is plain numbers, so its digest is the same on every OS.
 */
import { dot, fromBasis, LIGHT, type Mesh, position, random, type Vec3, type Vertex } from "./mesh";
import type { Look } from "./states";

export interface Geometry {
  width: number;
  height: number;
  cx: number;
  cy: number;
  R: number;
}

/** The 520×560 reference body drawn at 128×138, and the 200×200 state icon. */
export const BODY: Geometry = { width: 128, height: 138, cx: 64, cy: 67, R: (200 * 128) / 520 };
export const ICON: Geometry = { width: 200, height: 200, cx: 100, cy: 104, R: 72 };

export interface Tri {
  pts: [number, number, number, number, number, number];
  fill: number;
  line: number;
  kind: "front" | "back" | "gold";
}

export interface FrameModel {
  tris: Tri[];
  dots: { x: number; y: number; alpha: number }[];
  /** Where the gold face sat before heads-up pushed it out. */
  goldOutline?: [number, number, number, number, number, number];
}

export interface FrameInput {
  mesh: Mesh;
  look: Look;
  geometry: Geometry;
  /** Seconds-based spin angle about the view axis. */
  spin: number;
  disp: readonly number[];
  glow: readonly number[];
  /** Let the gold face ride the speaking pulse. */
  goldMoves: boolean;
}

export function frameModel(input: FrameInput): FrameModel {
  const { mesh, look, geometry: g, spin } = input;
  const scale = g.R / 200;
  const jitter = random(11);
  const project = (p: Vec3, offset: Vec3, extra: readonly [number, number]) =>
    [
      g.cx + (p[0] + offset[0]) * g.R + extra[0],
      g.cy - (p[1] + offset[1]) * g.R + extra[1],
    ] as const;
  const tris: Tri[] = [];
  let goldOutline: FrameModel["goldOutline"];
  mesh.faces.forEach((f, i) => {
    const n = fromBasis(mesh, f.n, spin);
    const ja = jitter() * 2 * Math.PI;
    const jr = look.jitterPx * scale * f.s;
    const front = n[2] > 0.02;
    const backLine = n[2] < 0 && n[2] > -0.45;
    if (!front && !backLine) return;
    const isGold = i === mesh.gold && front;
    const sound = isGold && !input.goldMoves ? 0 : (input.disp[f.ring] ?? 0);
    const push = look.push * f.s + sound + (isGold ? look.goldPop : 0);
    const offset: Vec3 = [n[0] * push, n[1] * push, 0];
    const extra = [Math.cos(ja) * jr, Math.sin(ja) * jr] as const;
    const pts = f.v.flatMap((vi) =>
      project(position(mesh, mesh.vertices[vi] as Vertex, spin), offset, extra),
    ) as Tri["pts"];
    const glow = input.glow[f.ring] ?? 0;
    if (!front) {
      tris.push({ pts, fill: 0, line: 0.13 * look.brightness, kind: "back" });
      return;
    }
    const lit = 0.55 + 0.45 * Math.max(0, dot(n, LIGHT));
    const fill = (0.02 + 0.3 * f.s ** 1.3 * lit) * look.brightness * (1 + glow);
    const line = 0.85 * f.s ** 0.8 * look.brightness * (1 + 0.6 * glow);
    tris.push({
      pts,
      fill: Math.min(1, fill),
      line: Math.min(1, line),
      kind: isGold ? "gold" : "front",
    });
    if (isGold && look.goldPop > 0) {
      goldOutline = f.v.flatMap((vi) =>
        project(position(mesh, mesh.vertices[vi] as Vertex, spin), [0, 0, 0], [0, 0]),
      ) as Tri["pts"];
    }
  });
  const dots = mesh.vertices
    .filter((v) => v.z > 0 && v.s > 0.6)
    .map((v) => {
      const [x, y] = project(position(mesh, v, spin), [0, 0, 0], [0, 0]);
      return { x, y, alpha: Math.min(1, 0.8 * v.s * look.brightness) };
    });
  return goldOutline ? { tris, dots, goldOutline } : { tris, dots };
}

/** Colours read from the theme tokens (--desk-eris-*) once per mount and again per theme. */
export interface Palette {
  frost: string;
  gold: string;
  goldLight: string;
  goldDeep: string;
  goldDimLight: string;
  goldDimDeep: string;
  white: string;
  moonDark: string;
  moonLit: string;
  shade: string;
}

export function paint(
  ctx: CanvasRenderingContext2D,
  model: FrameModel,
  look: Look,
  palette: Palette,
  g: Geometry,
): void {
  ctx.clearRect(0, 0, g.width, g.height);
  const width = Math.max(0.6, 1.3 * (g.R / 200));
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  const lineColor = look.lines === "gold" ? palette.gold : palette.frost;
  const path = (p: Tri["pts"]) => {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2], p[3]);
    ctx.lineTo(p[4], p[5]);
    ctx.closePath();
  };
  for (const t of model.tris) {
    path(t.pts);
    if (t.kind === "gold") {
      const dim = look.gold === "dim";
      const grad = ctx.createLinearGradient(t.pts[0], t.pts[1], t.pts[4], t.pts[5]);
      grad.addColorStop(0, dim ? palette.goldDimLight : palette.goldLight);
      grad.addColorStop(1, dim ? palette.goldDimDeep : palette.goldDeep);
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = dim ? palette.goldDimLight : palette.goldLight;
      ctx.stroke();
      continue;
    }
    if (t.fill > 0) {
      ctx.globalAlpha = t.fill;
      ctx.fillStyle = palette.frost;
      ctx.fill();
    }
    ctx.globalAlpha = t.line;
    ctx.strokeStyle = lineColor;
    ctx.stroke();
  }
  if (model.goldOutline) {
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = palette.gold;
    path(model.goldOutline);
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = palette.white;
  for (const d of model.dots) {
    ctx.globalAlpha = d.alpha;
    ctx.beginPath();
    ctx.arc(d.x, d.y, 1.5 * Math.max(0.5, g.R / 200), 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** A short, OS-independent fingerprint of a frame: counts plus an FNV-1a hash of rounded numbers. */
export function digest(model: FrameModel): string {
  let h = 0x811c9dc5;
  const mix = (n: number) => {
    h ^= n & 0xffff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const t of model.tris) {
    for (const p of t.pts) mix(Math.round(p * 2));
    mix(Math.round(t.fill * 50));
    mix(Math.round(t.line * 50));
  }
  const front = model.tris.filter((t) => t.kind !== "back").length;
  return `faces=${front} back=${model.tris.length - front} dots=${model.dots.length} h=${h.toString(16)}`;
}

/** Dysnomia, a small octahedron turned by (25°, -35°, 15°), shaded towards the light. */
export function paintMoon(ctx: CanvasRenderingContext2D, size: number, palette: Palette): void {
  const rad = Math.PI / 180;
  const rot = (p: Vec3): Vec3 => {
    const [ax, ay, az] = [25 * rad, -35 * rad, 15 * rad];
    let [x, y, z] = p;
    [y, z] = [y * Math.cos(ax) - z * Math.sin(ax), y * Math.sin(ax) + z * Math.cos(ax)];
    [x, z] = [x * Math.cos(ay) + z * Math.sin(ay), -x * Math.sin(ay) + z * Math.cos(ay)];
    [x, y] = [x * Math.cos(az) - y * Math.sin(az), x * Math.sin(az) + y * Math.cos(az)];
    return [x, y, z];
  };
  const v: Vec3[] = (
    [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1.25, 0],
      [0, -1.25, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as Vec3[]
  ).map(rot);
  const faces = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ] as const;
  const s = size / 2.8;
  const c = size / 2;
  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 0.6;
  for (const [a, b, d] of faces) {
    const [p, q, r] = [v[a], v[b], v[d]] as [Vec3, Vec3, Vec3];
    const e1: Vec3 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
    const e2: Vec3 = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n: Vec3 = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const len = Math.hypot(...n) || 1;
    const nz = n[2] / len;
    if (nz <= 0) continue;
    const lit = Math.max(0, dot([n[0] / len, n[1] / len, nz], LIGHT));
    ctx.beginPath();
    ctx.moveTo(c + p[0] * s, c - p[1] * s);
    ctx.lineTo(c + q[0] * s, c - q[1] * s);
    ctx.lineTo(c + r[0] * s, c - r[1] * s);
    ctx.closePath();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.moonDark;
    ctx.fill();
    ctx.globalAlpha = lit;
    ctx.fillStyle = palette.moonLit;
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = palette.frost;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
