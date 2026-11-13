// PNG decoding for the pixel oracles (`pixels.ts`) and the motion gate (`e2e/perf/motion.ts`), with
// no WebDriver: 8-bit RGB or RGBA, not interlaced, as Chromium and the shell's captures write them.
import { inflateSync } from "node:zlib";

export interface Image {
  width: number;
  height: number;
  /** RGBA, row by row. */
  data: Uint8Array;
  /** Device pixels per CSS pixel. */
  scale: number;
}

/** Decode a PNG of 8-bit RGB or RGBA, not interlaced. */
export function decodePng(png: Buffer, cssWidth?: number): Image {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const kind = png.toString("ascii", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = [body[8], body[9], body[10], body[11], body[12]];
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0)
        throw new Error(`PNG depth ${depth} colour ${color} interlace ${interlace} not read here`);
      channels = color === 6 ? 4 : 3;
    } else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? (row[i - channels] ?? 0) : 0;
      const b = previous[i] ?? 0;
      const c = i >= channels ? (previous[i - channels] ?? 0) : 0;
      const v = line[i] ?? 0;
      const predicted =
        filter === 1
          ? a
          : filter === 2
            ? b
            : filter === 3
              ? (a + b) >> 1
              : filter === 4
                ? paeth(a, b, c)
                : 0;
      row[i] = (v + predicted) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      out[o] = row[x * channels] ?? 0;
      out[o + 1] = row[x * channels + 1] ?? 0;
      out[o + 2] = row[x * channels + 2] ?? 0;
      out[o + 3] = channels === 4 ? (row[x * channels + 3] ?? 255) : 255;
    }
    previous = row;
  }
  return { width, height, data: out, scale: cssWidth ? width / cssWidth : 1 };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}
