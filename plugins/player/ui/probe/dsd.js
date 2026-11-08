// DSD audio: DSF (the fmt chunk, and the ID3v2 tag its metadata pointer names) and DSDIFF (the PROP
// chunk's rate, channels and compression, the DSD or DST sound chunk, and DIIN's title and artist).
import { Cursor, latin1 } from "../bytes.js";
import { readId3v2 } from "./id3.js";

/**
 * @typedef {import("./index.js").Read} Read
 * @typedef {import("./index.js").Tags} Tags
 */

/** @type {Read} */
export async function readDsf(source, head) {
  const c = new Cursor(head, 20, true);
  const metadata = c.u64();
  c.skip(12 + 4 + 4 + 4);
  const channels = c.u32();
  const rate = c.u32();
  const bits = c.u32();
  const samples = c.u64();
  if (!rate || latin1(head.subarray(28, 32)) !== "fmt ")
    throw new Error("The DSF format chunk is damaged.");
  let found = { tags: {}, cover: undefined };
  if (metadata > 0 && metadata < source.size) {
    const tag = await source.read(metadata, Math.min(source.size - metadata, 1 << 24));
    if (latin1(tag.subarray(0, 3)) === "ID3") found = readId3v2(tag);
  }
  return {
    duration: samples / rate,
    tracks: [{ kind: "audio", codec: "DSD", channels, sampleRate: rate, bits }],
    tags: found.tags,
    cover: found.cover,
  };
}

/** @type {Read} */
export async function readDff(source) {
  let rate = 0;
  let channels = 0;
  let codec = "DSD";
  let duration;
  let soundBytes = 0;
  /** @type {Tags} */
  const tags = {};
  /** The chunks in [start, end): id, content start, size (big-endian 64-bit), padded to even. */
  const chunks = async (/** @type {number} */ start, /** @type {number} */ end) => {
    const out = [];
    for (let at = start; at + 12 <= end && out.length < 256; ) {
      const h = new Cursor(await source.read(at, 12));
      const id = h.ascii(4);
      const size = h.u64();
      out.push({ id, at: at + 12, size });
      at += 12 + size + (size % 2);
    }
    return out;
  };
  for (const chunk of await chunks(16, source.size)) {
    if (chunk.id === "PROP") {
      const b = await source.read(chunk.at, Math.min(chunk.size, 1 << 16));
      const c = new Cursor(b, 4);
      while (c.left >= 12) {
        const id = c.ascii(4);
        const size = c.u64();
        const body = new Cursor(b, c.pos);
        if (id === "FS  ") rate = body.u32();
        else if (id === "CHNL") channels = body.u16();
        else if (id === "CMPR") codec = body.ascii(4) === "DST " ? "DST" : "DSD";
        c.skip(size + (size % 2));
      }
    } else if (chunk.id === "DSD ") soundBytes = chunk.size;
    else if (chunk.id === "DST ") {
      const frames = (await chunks(chunk.at, chunk.at + chunk.size)).find((c) => c.id === "FRTE");
      if (frames) {
        const f = new Cursor(await source.read(frames.at, 6));
        const count = f.u32();
        const perSecond = f.u16();
        if (perSecond) duration = count / perSecond;
      }
    } else if (chunk.id === "DIIN") {
      for (const part of await chunks(chunk.at, chunk.at + chunk.size)) {
        if (part.id !== "DITI" && part.id !== "DIAR") continue;
        const b = await source.read(part.at, Math.min(part.size, 4096));
        const length = new Cursor(b).u32();
        const text = latin1(b.subarray(4, 4 + length)).trim();
        if (text) tags[part.id === "DITI" ? "title" : "artist"] = text;
      }
    } else if (chunk.id === "ID3 ") {
      Object.assign(
        tags,
        readId3v2(await source.read(chunk.at, Math.min(chunk.size, 1 << 24))).tags,
      );
    }
  }
  if (!rate) throw new Error("The DSDIFF property chunk is damaged.");
  if (duration === undefined && channels > 0 && soundBytes > 0)
    duration = (soundBytes * 8) / channels / rate;
  return {
    duration,
    tracks: [{ kind: "audio", codec, channels, sampleRate: rate, bits: 1 }],
    tags,
  };
}
