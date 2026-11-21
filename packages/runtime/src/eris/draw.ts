/**
 * Turn a mesh, a look and a ring frame into a list of projected triangles, paint it on a canvas, and
 * digest it for snapshots. The model is plain numbers, so its digest is the same on every OS.
 */
import { dot, fromBasis, LIGHT, type Mesh, position, type Vec3 } from "./mesh";
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
  kind: "front" | "back";
}

export interface FrameModel {
  tris: Tri[];
  dots: { x: number; y: number; alpha: number }[];
  /**
   * The opaque disc under the mesh: her body hides whatever UI sits behind it. It shrinks with the
   * rim when the user's voice pulls the rim in, so no band of ground shows outside her.
   */
  ground: { x: number; y: number; r: number };
}

export interface FrameInput {
  mesh: Mesh;
  look: Look;
  geometry: Geometry;
  /** Seconds-based spin angle about the view axis. */
  spin: number;
  disp: readonly number[];
  glow: readonly number[];
}

export function frameModel(input: FrameInput): FrameModel {
  const { mesh, look, geometry: g, spin } = input;
  const vertices = mesh.vertices.map((v) => position(mesh, v, spin));
  const tris: Tri[] = [];
  for (const face of mesh.faces) {
    const n = fromBasis(mesh, face.n, spin);
    const front = n[2] > 0.02;
    if (!front && (n[2] >= 0 || n[2] <= -0.45)) continue;
    const displacement = look.push * face.s + (input.disp[face.ring] ?? 0);
    const pts = face.v.flatMap((i) => {
      const p = vertices[i] as Vec3;
      return [g.cx + (p[0] + n[0] * displacement) * g.R, g.cy - (p[1] + n[1] * displacement) * g.R];
    }) as Tri["pts"];
    const shine = Math.max(0, dot(n, LIGHT));
    const wave = input.glow[face.ring] ?? 0;
    const fill = (0.025 + 0.13 * shine + 0.25 * shine ** 10) * (0.33 + 0.67 * face.s);
    const line = 0.035 + 0.39 * face.s ** 1.3 * (0.4 + 0.6 * shine);
    tris.push({
      pts,
      kind: front ? "front" : "back",
      fill: front ? Math.min(1, (fill + 0.19 * wave) * look.brightness) : 0,
      line: front ? Math.min(1, (line + 0.4 * wave) * look.brightness) : 0.045,
    });
  }
  const dots = mesh.vertices.flatMap((v, i) => {
    const p = vertices[i] as Vec3;
    return p[2] > 0 && v.s > 0.7
      ? [{ x: g.cx + p[0] * g.R, y: g.cy - p[1] * g.R, alpha: 0.19 * v.s }]
      : [];
  });
  const rim = Math.min(0, input.disp[8] ?? 0);
  const ground = { x: g.cx, y: g.cy, r: g.R * (1 + rim) };
  return { tris, dots, ground };
}

/** Colours read from the theme tokens (--desk-eris-*) once per mount and again per theme. */
export interface Palette {
  frost: string;
  warning: string;
  danger: string;
  white: string;
  moonDark: string;
  moonLit: string;
  shade: string;
  /** The desk's background: the opaque ground her translucent faces are blended over. */
  ground: string;
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
  const lineColor = palette[look.lines] || palette.frost;
  const path = (p: Tri["pts"]) => {
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
    ctx.lineTo(p[2], p[3]);
    ctx.lineTo(p[4], p[5]);
    ctx.closePath();
  };
  // Her body is opaque: the ground under the disc and under every face (faces pushed past the rim
  // included), then the faces' own translucent frost on top. The UI behind her never shows through.
  if (palette.ground) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.ground;
    ctx.beginPath();
    ctx.arc(model.ground.x, model.ground.y, Math.max(0, model.ground.r), 0, 2 * Math.PI);
    // One path, one fill: every face wound the way the arc runs, so nonzero filling unions them
    // with no seams, at the cost of a single draw call per frame.
    for (const t of model.tris) {
      const [x0, y0, x1, y1, x2, y2] = t.pts;
      const turn = (x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0);
      ctx.moveTo(x0, y0);
      if (turn >= 0) {
        ctx.lineTo(x1, y1);
        ctx.lineTo(x2, y2);
      } else {
        ctx.lineTo(x2, y2);
        ctx.lineTo(x1, y1);
      }
      ctx.closePath();
    }
    ctx.fill();
  }
  const { x, y, r } = model.ground;
  if (palette.moonDark && r > 0) {
    const glass = ctx.createRadialGradient(x - r * 0.3, y - r * 0.36, 0, x, y, r);
    glass.addColorStop(0, palette.moonLit);
    glass.addColorStop(0.34, palette.moonDark);
    glass.addColorStop(0.88, palette.moonDark);
    glass.addColorStop(1, palette.shade);
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = glass;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const t of model.tris) {
    path(t.pts);
    if (t.fill > 0) {
      ctx.globalAlpha = t.fill;
      ctx.fillStyle = look.lines === "frost" ? palette.white || palette.frost : lineColor;
      ctx.fill();
    }
    ctx.globalAlpha = Math.min(1, t.line * (look.lines === "frost" ? 1 : 1.8));
    ctx.strokeStyle = lineColor;
    ctx.stroke();
  }
  if (r > 0) {
    ctx.globalAlpha = look.lines === "frost" ? 0.65 : 0.94;
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = Math.max(0.8, g.R / 75);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
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

/** A dark, faceted octahedron. The broad silver facet points upper left before its orbital turn. */
export function paintMoon(ctx: CanvasRenderingContext2D, size: number, palette: Palette): void {
  const top = [-0.07, -0.48],
    left = [-0.42, 0.04],
    ridge = [0.035, 0.01],
    right = [0.34, -0.035],
    tip = [0.07, 0.5];
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.scale(size, size);
  const face = (points: number[][], light: string, dark: string) => {
    ctx.beginPath();
    for (const [i, p] of points.entries()) {
      if (i === 0) ctx.moveTo(p[0] ?? 0, p[1] ?? 0);
      else ctx.lineTo(p[0] ?? 0, p[1] ?? 0);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(-0.23, -0.36, 0.19, 0.33);
    g.addColorStop(0, light);
    g.addColorStop(1, dark);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = palette.shade;
    ctx.lineWidth = 0.022;
    ctx.stroke();
  };
  face([top, right, ridge], palette.moonLit, palette.moonDark);
  face([ridge, right, tip], palette.moonDark, palette.moonDark);
  face([left, ridge, tip], palette.moonLit, palette.moonDark);
  face([top, left, ridge], palette.white, palette.shade);
  ctx.restore();
}
