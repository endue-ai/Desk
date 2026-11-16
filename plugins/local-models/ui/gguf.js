// A GGUF model file's header, read without loading the model: the magic and version, then every
// metadata key and value (architecture, name, size, context length, layers, heads, quantization,
// chat template). Bytes are asked for in chunks as the reader needs them, so a multi-gigabyte file
// costs a few reads; long arrays (the tokenizer's vocabulary) are walked past, not kept.

/** GGUF value types. */
const T = {
  U8: 0,
  I8: 1,
  U16: 2,
  I16: 3,
  U32: 4,
  I32: 5,
  F32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  U64: 10,
  I64: 11,
  F64: 12,
};
const SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const CHUNK = 1 << 20;
/** Arrays longer than this are summarised, not kept. */
const KEEP = 64;

/** The quantization of a file, by general.file_type. */
export const FILE_TYPES = {
  0: "F32",
  1: "F16",
  2: "Q4_0",
  3: "Q4_1",
  7: "Q8_0",
  8: "Q5_0",
  9: "Q5_1",
  10: "Q2_K",
  11: "Q3_K_S",
  12: "Q3_K_M",
  13: "Q3_K_L",
  14: "Q4_K_S",
  15: "Q4_K_M",
  16: "Q5_K_S",
  17: "Q5_K_M",
  18: "Q6_K",
  19: "IQ2_XXS",
  20: "IQ2_XS",
  21: "Q2_K_S",
  22: "IQ3_XS",
  23: "IQ3_XXS",
  24: "IQ1_S",
  25: "IQ4_NL",
  26: "IQ3_S",
  27: "IQ3_M",
  28: "IQ2_S",
  29: "IQ2_M",
  30: "IQ4_XS",
  31: "IQ1_M",
  32: "BF16",
  36: "TQ1_0",
  37: "TQ2_0",
  38: "MXFP4",
};

/**
 * @typedef {(offset: number, length: number) => Promise<Uint8Array>} ReadAt
 * @typedef {string | number | boolean | bigint | { type: number, length: number, values?: unknown[] }} Value
 * @typedef {{ version: number, tensors: number, meta: Record<string, Value> }} Header
 */

export class GgufError extends Error {}

/** A cursor over a file read in chunks. @param {ReadAt} readAt */
function cursor(readAt) {
  let buf = new Uint8Array(0);
  let base = 0;
  let pos = 0;
  const decoder = new TextDecoder();
  /** Make sure `n` bytes from pos are in the buffer. @param {number} n */
  async function need(n) {
    if (pos - base + n <= buf.length) return;
    const keep = buf.subarray(pos - base);
    const more = await readAt(base + buf.length, Math.max(CHUNK, n - keep.length));
    if (keep.length + more.length < n) throw new GgufError("The file ends inside its header");
    const next = new Uint8Array(keep.length + more.length);
    next.set(keep);
    next.set(more, keep.length);
    buf = next;
    base = pos;
  }
  /** @param {number} n */
  const view = (n) => new DataView(buf.buffer, buf.byteOffset + pos - base, n);
  return {
    get pos() {
      return pos;
    },
    /** @param {number} n */
    async skip(n) {
      if (pos - base + n <= buf.length) pos += n;
      else {
        pos += n;
        buf = new Uint8Array(0);
        base = pos;
      }
    },
    async u32() {
      await need(4);
      const v = view(4).getUint32(0, true);
      pos += 4;
      return v;
    },
    async u64() {
      await need(8);
      const v = view(8).getBigUint64(0, true);
      pos += 8;
      if (v > BigInt(Number.MAX_SAFE_INTEGER))
        throw new GgufError("A count in the header is too large");
      return Number(v);
    },
    async string() {
      const n = await this.u64();
      if (n > 16 << 20) throw new GgufError("A string in the header is too long");
      await need(n);
      const s = decoder.decode(buf.subarray(pos - base, pos - base + n));
      pos += n;
      return s;
    },
    /** @param {number} type @returns {Promise<string | number | boolean | bigint>} */
    async scalar(type) {
      if (type === T.STRING) return this.string();
      const size = /** @type {Record<number, number>} */ (SIZE)[type];
      if (!size) throw new GgufError(`Unknown value type ${type}`);
      await need(size);
      const d = view(size);
      pos += size;
      switch (type) {
        case T.U8:
          return d.getUint8(0);
        case T.I8:
          return d.getInt8(0);
        case T.U16:
          return d.getUint16(0, true);
        case T.I16:
          return d.getInt16(0, true);
        case T.U32:
          return d.getUint32(0, true);
        case T.I32:
          return d.getInt32(0, true);
        case T.F32:
          return d.getFloat32(0, true);
        case T.BOOL:
          return d.getUint8(0) !== 0;
        case T.F64:
          return d.getFloat64(0, true);
        default: {
          const big = type === T.U64 ? d.getBigUint64(0, true) : d.getBigInt64(0, true);
          return big <= BigInt(Number.MAX_SAFE_INTEGER) && big >= -BigInt(Number.MAX_SAFE_INTEGER)
            ? Number(big)
            : big;
        }
      }
    },
  };
}

/** @param {ReturnType<typeof cursor>} c @param {number} type @returns {Promise<Value>} */
async function value(c, type) {
  if (type !== T.ARRAY) return c.scalar(type);
  const inner = await c.u32();
  const length = await c.u64();
  if (length <= KEEP) {
    const values = [];
    for (let i = 0; i < length; i++) values.push(await value(c, inner));
    return { type: inner, length, values };
  }
  const size = /** @type {Record<number, number>} */ (SIZE)[inner];
  if (size) await c.skip(size * length);
  else if (inner === T.STRING) for (let i = 0; i < length; i++) await c.skip(await c.u64());
  else for (let i = 0; i < length; i++) await value(c, inner);
  return { type: inner, length };
}

/** Read a GGUF header. @param {ReadAt} readAt @returns {Promise<Header>} */
export async function readGguf(readAt) {
  const c = cursor(readAt);
  const magic = await c.u32();
  if (magic !== 0x46554747) throw new GgufError("Not a GGUF file");
  const version = await c.u32();
  if (version < 2 || version > 3) throw new GgufError(`GGUF version ${version} is not read here`);
  const tensors = await c.u64();
  const count = await c.u64();
  /** @type {Record<string, Value>} */
  const meta = {};
  for (let i = 0; i < count; i++) {
    const key = await c.string();
    const type = await c.u32();
    meta[key] = await value(c, type);
  }
  return { version, tensors, meta };
}

/**
 * What a header says about its model, in the window's words.
 * @param {Header} header @param {{ size?: number, name?: string }} [file]
 */
export function describeGguf(header, file = {}) {
  const m = header.meta;
  const arch =
    typeof m["general.architecture"] === "string" ? m["general.architecture"] : "unknown";
  /** @param {string} k */
  const num = (k) => (typeof m[k] === "number" ? /** @type {number} */ (m[k]) : undefined);
  /** @param {string} k */
  const str = (k) => (typeof m[k] === "string" ? /** @type {string} */ (m[k]) : undefined);
  const heads = num(`${arch}.attention.head_count`);
  const embd = num(`${arch}.embedding_length`);
  const kvHeads = num(`${arch}.attention.head_count_kv`) ?? heads;
  const fileType = num("general.file_type");
  return {
    arch,
    name: str("general.name") ?? file.name,
    basename: str("general.basename"),
    sizeLabel: str("general.size_label"),
    finetune: str("general.finetune"),
    license: str("general.license"),
    author: str("general.organization") ?? str("general.author"),
    quant:
      fileType !== undefined
        ? /** @type {Record<number, string>} */ (FILE_TYPES)[fileType]
        : undefined,
    ctx: num(`${arch}.context_length`),
    layers: num(`${arch}.block_count`),
    embd,
    heads,
    kvHeads,
    headDim: num(`${arch}.attention.key_length`) ?? (heads && embd ? embd / heads : undefined),
    experts: num(`${arch}.expert_count`),
    chatTemplate: str("tokenizer.chat_template"),
    vocab: (() => {
      const tokens = m["tokenizer.ggml.tokens"];
      return typeof tokens === "object" && tokens && "length" in tokens ? tokens.length : undefined;
    })(),
    projector: arch === "clip" || Boolean(str("clip.projector_type")),
    size: file.size,
    tensors: header.tensors,
  };
}

/** @typedef {ReturnType<typeof describeGguf>} GgufInfo */
