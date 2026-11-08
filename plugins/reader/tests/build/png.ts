// Tiny solid-colour PNGs for the fixtures' images.
import { crc32, deflateSync } from "node:zlib";
import { concat } from "./archive";

function chunk(type: string, data: Uint8Array): Uint8Array {
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, data.length);
  const typed = concat([new TextEncoder().encode(type), data]);
  const tail = new DataView(new ArrayBuffer(4));
  tail.setUint32(0, crc32(typed));
  return concat([new Uint8Array(head.buffer, 0, 4), typed, new Uint8Array(tail.buffer)]);
}

/** A width x height PNG of one RGB colour. */
export function png(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const ihdr = new DataView(new ArrayBuffer(13));
  ihdr.setUint32(0, width);
  ihdr.setUint32(4, height);
  ihdr.setUint8(8, 8);
  ihdr.setUint8(9, 2);
  const rows = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) rows.set(rgb, y * (1 + width * 3) + 1 + x * 3);
  }
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", new Uint8Array(ihdr.buffer)),
    chunk("IDAT", new Uint8Array(deflateSync(rows))),
    chunk("IEND", new Uint8Array(0)),
  ]);
}
