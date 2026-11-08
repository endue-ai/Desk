// Shared by the DjVu tests: fixtures, a minimal IFF walk to pull chunks out of them, image
// comparisons, and pacers that record or force yields.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "fixtures");

export const fixture = (name: string) => new Uint8Array(readFileSync(join(dir, name)));

export type Chunk = { id: string; data: Uint8Array; path: string };

/** Every leaf chunk of a DjVu file in order; `path` names the FORMs around it ("DJVM/DJVU"). */
export function chunks(bytes: Uint8Array): Chunk[] {
  const out: Chunk[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const latin1 = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  const walk = (start: number, end: number, path: string) => {
    for (let at = start; at + 8 <= end; ) {
      const id = latin1(at);
      const size = view.getUint32(at + 4);
      const body = at + 8;
      if (id === "FORM")
        walk(body + 4, body + size, path ? `${path}/${latin1(body)}` : latin1(body));
      else out.push({ id, data: bytes.subarray(body, body + size), path });
      at = body + size + (size & 1);
    }
  };
  const start = latin1(0) === "AT&T" ? 4 : 0;
  walk(start, bytes.length, "");
  return out;
}

/** The data of every chunk called `id`, in order. */
export const chunksOf = (bytes: Uint8Array, id: string) =>
  chunks(bytes)
    .filter((c) => c.id === id)
    .map((c) => c.data);

/** The data of the `index`-th chunk called `id`; throws when there is none. */
export function chunkOf(bytes: Uint8Array, id: string, index = 0): Uint8Array {
  const found = chunksOf(bytes, id)[index];
  if (!found) throw new Error(`no chunk ${id} #${index}`);
  return found;
}

/** Peak signal-to-noise ratio in dB between two RGB(A) images of the same size. */
export function psnr(
  a: Uint8Array,
  aStride: number,
  b: Uint8Array,
  bStride: number,
  pixels: number,
) {
  let sum = 0;
  for (let i = 0; i < pixels; i++) {
    for (let c = 0; c < 3; c++) {
      const d = (a[i * aStride + c] ?? 0) - (b[i * bStride + c] ?? 0);
      sum += d * d;
    }
  }
  const mse = sum / (pixels * 3);
  return mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse);
}

/** A pacer that asks for a rest at every check and counts them. */
export function eagerPacer(signal?: AbortSignal) {
  const pace = {
    rests: 0,
    signal,
    due: () => true,
    async rest() {
      pace.rests++;
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
      await Promise.resolve();
    },
    check() {
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
    },
  };
  return pace;
}
