/**
 * Eris's body: a sphere seen along a tilted axis, meshed in rings that grow denser towards the rim and
 * leave the centre open. Pure and deterministic: the same options always give the same mesh.
 */

export type Vec3 = readonly [number, number, number];

export interface Density {
  rIn: number;
  rings: number;
  edgeRim: number;
}

export const DENSITIES = {
  airy: { rIn: 0.34, rings: 6, edgeRim: 0.1 },
  balanced: { rIn: 0.32, rings: 8, edgeRim: 0.075 },
  dense: { rIn: 0.3, rings: 10, edgeRim: 0.06 },
} as const satisfies Record<string, Density>;

export type DensityName = keyof typeof DENSITIES;

export interface MeshOptions extends Density {
  view: Vec3;
  /** Which front face turns gold: the one furthest towards this screen direction. */
  goldToward: readonly [number, number];
  seed?: number;
  q?: number;
}

export const VIEW_IDLE: Vec3 = [0.22, -0.2, 1];
export const VIEW_THINKING: Vec3 = [-0.18, 0.22, 1];
export const LIGHT: Vec3 = normalize([-0.55, 0.7, 0.75]);
/** Number of sound rings: 0 = innermost … 8 = the rim. */
export const SOUND_RINGS = 9;

export interface Vertex {
  /** Radius from the view axis, angle around it, height along it (sign: front or back). */
  r: number;
  phi: number;
  z: number;
  /** Sound ring 0..8. */
  ring: number;
  /** Rim weight: 0.02 at the inner ring … 1 at the rim. */
  s: number;
}

export interface Face {
  v: readonly [number, number, number];
  ring: number;
  s: number;
  /** Projected radius of the centroid from the view axis. */
  rc: number;
  /** Outward normal in the view basis (u1, u2, axis); rotate it with the vertices. */
  n: Vec3;
}

export interface Mesh {
  view: Vec3;
  basis: readonly [Vec3, Vec3, Vec3];
  rIn: number;
  vertices: Vertex[];
  faces: Face[];
  /** Index of the gold face. */
  gold: number;
}

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Seeded PRNG (mulberry32): values in [0, 1). */
export function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Orthonormal basis (u1, u2, view) with u1 roughly screen-right. */
export function basisFor(view: Vec3): readonly [Vec3, Vec3, Vec3] {
  const v = normalize(view);
  const u1 = normalize(cross([0, 1, 0], v));
  const u2 = cross(v, u1);
  return [u1, u2, v];
}

export function rimWeight(r: number, rIn: number): number {
  const t = Math.min(1, Math.max(0, (r - rIn) / (1 - rIn)));
  return 0.02 + 0.98 * t * t;
}

/** Ring radii r_0 … r_K: r_k = r_in + (1 - r_in)·(1 - (1 - k/K)^q). */
export function ringRadii(d: Density, q = 2): number[] {
  return Array.from(
    { length: d.rings + 1 },
    (_, k) => d.rIn + (1 - d.rIn) * (1 - (1 - k / d.rings) ** q),
  );
}

/** Vertices per ring: n_k = max(6, round(2π·r_k / edge_k)), never fewer than the ring inside. */
export function ringCounts(d: Density, radii: number[]): number[] {
  const counts: number[] = [];
  for (const r of radii) {
    const t = (r - d.rIn) / (1 - d.rIn);
    const edge = 0.5 + (d.edgeRim - 0.5) * t ** 0.9;
    counts.push(Math.max(6, Math.round((2 * Math.PI * r) / edge), counts.at(-1) ?? 0));
  }
  return counts;
}

/** Zip two rings (vertex indices sorted by angle) into triangles. */
function zip(a: number[], b: number[], phi: (i: number) => number): [number, number, number][] {
  const tris: [number, number, number][] = [];
  const at = (ring: number[], i: number) =>
    phi(ring[i % ring.length] ?? 0) + (i >= ring.length ? 2 * Math.PI : 0);
  let i = 0;
  let j = 0;
  const pick = (ring: number[], k: number) => ring[k % ring.length] ?? 0;
  while (i < a.length || j < b.length) {
    const advanceA = j >= b.length || (i < a.length && at(a, i + 1) < at(b, j + 1));
    if (advanceA) {
      tris.push([pick(a, i), pick(a, i + 1), pick(b, j)]);
      i++;
    } else {
      tris.push([pick(a, i), pick(b, j), pick(b, j + 1)]);
      j++;
    }
  }
  return tris;
}

export function position(mesh: Pick<Mesh, "basis">, v: Vertex, spin = 0): Vec3 {
  const [u1, u2, w] = mesh.basis;
  const c = Math.cos(v.phi + spin) * v.r;
  const s = Math.sin(v.phi + spin) * v.r;
  return [
    w[0] * v.z + u1[0] * c + u2[0] * s,
    w[1] * v.z + u1[1] * c + u2[1] * s,
    w[2] * v.z + u1[2] * c + u2[2] * s,
  ];
}

/** Turn a vector given in the view basis (a, b, c) into world space, spun by `spin` about the axis. */
export function fromBasis(mesh: Pick<Mesh, "basis">, n: Vec3, spin = 0): Vec3 {
  const [u1, u2, w] = mesh.basis;
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  const a = n[0] * cs - n[1] * sn;
  const b = n[0] * sn + n[1] * cs;
  return [
    u1[0] * a + u2[0] * b + w[0] * n[2],
    u1[1] * a + u2[1] * b + w[1] * n[2],
    u1[2] * a + u2[2] * b + w[2] * n[2],
  ];
}

export function generateMesh(options: MeshOptions): Mesh {
  const rand = random(options.seed ?? 3);
  const basis = basisFor(options.view);
  const radii = ringRadii(options, options.q ?? 2);
  const counts = ringCounts(options, radii);
  const K = options.rings;
  const rimCount = counts[K] ?? 6;
  const back = [0.96, 0.9];
  const vertices: Vertex[] = [];
  const rings: number[][] = [];
  const soundRing = (k: number) => (k >= K ? 8 : Math.round((k * 7) / Math.max(1, K - 1)));

  const addRing = (r: number, n: number, gap: number, side: 1 | -1, k: number) => {
    const step = (2 * Math.PI) / n;
    const offset = (k % 2) * (step / 2);
    const ring: Vertex[] = [];
    for (let i = 0; i < n; i++) {
      const phi = i * step + offset + (rand() * 2 - 1) * 0.3 * step;
      const jr = gap > 0 ? r + (rand() * 2 - 1) * 0.16 * gap : r;
      const rr = Math.min(1, jr);
      const z = side * Math.sqrt(Math.max(0, 1 - rr * rr));
      const wrapped = ((phi % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      ring.push({ r: rr, phi: wrapped, z, ring: soundRing(k), s: rimWeight(rr, options.rIn) });
    }
    ring.sort((a, b) => a.phi - b.phi);
    const indices = ring.map((v) => vertices.push(v) - 1);
    rings.push(indices);
  };

  radii.forEach((r, k) => {
    const next = radii[k + 1];
    addRing(r, counts[k] ?? 6, next === undefined ? 0 : next - r, 1, k);
  });
  back.forEach((r, i) => {
    addRing(r, Math.max(6, Math.round(rimCount * 0.6)), 0.06, -1, K + 1 + i);
  });

  const faces: Face[] = [];
  const phiOf = (i: number) => vertices[i]?.phi ?? 0;
  for (let k = 0; k + 1 < rings.length; k++) {
    for (const v of zip(rings[k] ?? [], rings[k + 1] ?? [], phiOf)) {
      faces.push(makeFace(v, k >= K ? 8 : soundRing(k), vertices, options.rIn));
    }
  }

  const [gx, gy] = options.goldToward;
  let gold = 0;
  let best = Number.NEGATIVE_INFINITY;
  const mesh: Mesh = { view: basis[2], basis, rIn: options.rIn, vertices, faces, gold };
  faces.forEach((f, i) => {
    if (f.rc < 0.5 || f.rc > 0.74 || f.n[2] <= 0) return;
    const c = centroid(mesh, f);
    const score = c[0] * gx + c[1] * gy;
    if (score > best) {
      best = score;
      gold = i;
    }
  });
  mesh.gold = gold;
  return mesh;
}

/** Normal and centroid are computed in the view basis, where vertex (r, φ, z) is (r·cosφ, r·sinφ, z). */
function makeFace(v: [number, number, number], ring: number, vs: Vertex[], rIn: number): Face {
  const p = v.map((i) => {
    const x = vs[i] as Vertex;
    return [Math.cos(x.phi) * x.r, Math.sin(x.phi) * x.r, x.z] as Vec3;
  }) as [Vec3, Vec3, Vec3];
  const c: Vec3 = [
    (p[0][0] + p[1][0] + p[2][0]) / 3,
    (p[0][1] + p[1][1] + p[2][1]) / 3,
    (p[0][2] + p[1][2] + p[2][2]) / 3,
  ];
  const e1: Vec3 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2: Vec3 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  let n = normalize(cross(e1, e2));
  if (dot(n, c) < 0) n = [-n[0], -n[1], -n[2]];
  const len = Math.hypot(c[0], c[1], c[2]) || 1;
  const rc = Math.hypot(c[0], c[1]) / len;
  return { v, ring, s: rimWeight(rc, rIn), rc, n };
}

export function centroid(mesh: Pick<Mesh, "basis" | "vertices">, f: Face, spin = 0): Vec3 {
  const ps = f.v.map((i) => position(mesh, mesh.vertices[i] as Vertex, spin));
  return [0, 1, 2].map((k) => ((ps[0]?.[k] ?? 0) + (ps[1]?.[k] ?? 0) + (ps[2]?.[k] ?? 0)) / 3) as [
    number,
    number,
    number,
  ];
}
