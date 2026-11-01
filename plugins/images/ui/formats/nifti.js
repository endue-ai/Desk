// NIfTI-1 single-file volumes (.nii, n+1): one axial slice at a time, the middle one first, every
// slice stretched over the whole volume's range so they compare. Rows are shown with the first one
// at the bottom, as radiology viewers do.
import { fail, has, reader } from "../bytes.js";
import { canvasFor, enough, range, stretch } from "./pixels.js";

const TYPES = /** @type {Record<number, [string, number]>} */ ({
  2: ["uint8", 1],
  4: ["int16", 2],
  8: ["int32", 4],
  16: ["float32", 4],
  64: ["float64", 8],
  256: ["int8", 1],
  512: ["uint16", 2],
  768: ["uint32", 4],
  128: ["rgb24", 3],
});

/** @returns {import("./pixels.js").Pixels} */
export function decodeNifti(/** @type {Uint8Array} */ bytes) {
  const le = reader(bytes).u32(0) === 348;
  const r = reader(bytes, le);
  if (r.u32(0) !== 348)
    fail(
      r.u32(0) === 540 || reader(bytes, !le).u32(0) === 540
        ? "It is NIfTI-2; Images reads NIfTI-1."
        : "Its NIfTI header is damaged.",
    );
  if (has(bytes, 344, "ni1\0"))
    fail("Its voxels are in a separate .img file; Images reads single-file .nii volumes.");
  const dims = Array.from({ length: 8 }, (_, i) => r.i16(40 + i * 2));
  const [nx = 0, ny = 0] = [dims[1], dims[2]];
  const nz = Math.max(1, (dims[0] ?? 0) >= 3 ? (dims[3] ?? 1) : 1);
  const code = r.i16(70);
  const [type, size] =
    TYPES[code] ?? fail(`Its voxels are of NIfTI type ${code}, which Images does not read.`);
  const offset = Math.max(352, Math.floor(r.f32(108)));
  canvasFor(nx, ny);
  const count = nx * ny * nz;
  enough(bytes, offset, count * size);
  const slope = r.f32(112);
  const inter = r.f32(116);
  const scaled = Number.isFinite(slope) && slope !== 0;
  const get = (/** @type {number} */ at) => {
    switch (type) {
      case "uint8":
        return r.u8(at);
      case "int8":
        return r.i8(at);
      case "int16":
        return r.i16(at);
      case "uint16":
        return r.u16(at);
      case "int32":
        return r.i32(at);
      case "uint32":
        return r.u32(at);
      case "float32":
        return r.f32(at);
      default:
        return r.f64(at);
    }
  };
  const plane = nx * ny;
  /** @type {Float64Array | null} */
  let values = null;
  let lo = 0;
  let hi = 0;
  if (type !== "rgb24") {
    values = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const v = get(offset + i * size);
      values[i] = scaled ? v * slope + (Number.isFinite(inter) ? inter : 0) : v;
    }
    [lo, hi] = range(values);
  }
  const flip = (/** @type {number} */ i) => (ny - 1 - Math.floor(i / nx)) * nx + (i % nx);
  const at = (/** @type {number} */ z) => {
    const out = canvasFor(nx, ny);
    if (values) return stretch(values.subarray(z * plane, (z + 1) * plane), lo, hi, out, flip);
    for (let i = 0; i < plane; i++) {
      const p = offset + (z * plane + flip(i)) * 3;
      out.set([bytes[p] ?? 0, bytes[p + 1] ?? 0, bytes[p + 2] ?? 0, 255], i * 4);
    }
    return out;
  };
  const index = Math.floor(nz / 2);
  return {
    width: nx,
    height: ny,
    rgba: at(index),
    depth: `${type}, stretched`,
    rows: [
      {
        label: "Volume",
        value: `${nx} × ${ny} × ${nz}${(dims[4] ?? 1) > 1 && (dims[0] ?? 0) >= 4 ? ` × ${dims[4]}` : ""}`,
      },
    ],
    slices: { count: nz, index, at: (z) => at(Math.max(0, Math.min(nz - 1, z))) },
  };
}
