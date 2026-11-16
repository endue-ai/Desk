// Will a model fit? Its weights (about the file's size), the key-value cache its context needs
// (layers × context × kv heads × head size × 2 for keys and values × the cache type's bytes) and some
// room for the runtime, against this computer's memory: on Apple silicon the GPU shares it, about
// three quarters of it usable for a model.

/** Bytes per cache element for each cache type. */
export const CACHE_BYTES = { f16: 2, q8_0: 1.0625, q4_0: 0.5625 };
const OVERHEAD = 600_000_000;

/**
 * @typedef {{ layers?: number, kvHeads?: number, headDim?: number, size?: number }} Shape
 * @typedef {{ total: number, gpu?: number, kind: "unified" | "discrete" | "unknown" }} Memory
 * @typedef {"fits" | "tight" | "partial" | "too-big" | "unknown"} Fit
 */

/** The cache a context needs. @param {Shape} s @param {number} ctx @param {keyof typeof CACHE_BYTES} [type] */
export function kvBytes(s, ctx, type = "f16") {
  if (!s.layers || !s.kvHeads || !s.headDim) return 0;
  return 2 * s.layers * ctx * s.kvHeads * s.headDim * CACHE_BYTES[type];
}

/** What loading a model takes. @param {Shape} s @param {{ ctx: number, cache?: keyof typeof CACHE_BYTES }} o */
export function needBytes(s, o) {
  return (s.size ?? 0) + kvBytes(s, o.ctx, o.cache) + OVERHEAD;
}

/** How a need sits in this computer's memory. @param {number} need @param {Memory | undefined} mem @returns {Fit} */
export function fitOf(need, mem) {
  if (!mem?.total || !need) return "unknown";
  const usable = mem.kind === "unified" ? mem.total * 0.75 : (mem.gpu ?? 0);
  if (need <= usable * 0.85) return "fits";
  if (need <= usable) return "tight";
  if (need <= mem.total * 0.9) return "partial";
  return "too-big";
}

/** @type {Record<Fit, string>} */
export const FIT_WORDS = {
  fits: "Fits in memory",
  tight: "Fits, with little room",
  partial: "Partly on the CPU: slower",
  "too-big": "Likely too large",
  unknown: "",
};

/**
 * This computer's memory: macOS answers `sysctl -n hw.memsize hw.optional.arm64`; elsewhere the
 * total is not known and fits are not judged.
 * @param {(command: string, args: string[]) => Promise<{ code: number, stdout: string }>} run
 * @returns {Promise<Memory | undefined>}
 */
export async function systemMemory(run) {
  const mac = await run("sysctl", ["-n", "hw.memsize", "hw.optional.arm64"]).catch(() => undefined);
  if (mac?.code === 0) {
    const [total, arm] = mac.stdout.trim().split(/\s+/).map(Number);
    if (total > 0) return { total, kind: arm === 1 ? "unified" : "discrete" };
  }
  const nv = await run("nvidia-smi", [
    "--query-gpu=memory.total",
    "--format=csv,noheader,nounits",
  ]).catch(() => undefined);
  if (nv?.code === 0) {
    const gpu = nv.stdout
      .trim()
      .split("\n")
      .reduce((sum, line) => sum + Number(line.trim()) * 1024 * 1024, 0);
    return { total: gpu * 2, gpu, kind: "discrete" };
  }
  return undefined;
}

/** How many layers to put on the GPU so a model fits: all when it does, fewer when not. @param {Shape} s @param {number} need @param {Memory | undefined} mem */
export function gpuLayersFor(s, need, mem) {
  const layers = s.layers ?? 0;
  if (!mem || !layers) return undefined;
  const usable = mem.kind === "unified" ? mem.total * 0.75 : (mem.gpu ?? 0);
  if (need <= usable) return layers;
  return Math.max(0, Math.floor((usable / need) * layers));
}
