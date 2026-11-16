// GGUF files for the preview and the tests: a real header (version 3, the metadata given, a long
// vocabulary array so readers must walk past it) and, when a size is asked for, a sparse tail, so a
// "4.9 GB" model takes no disk space.
import { closeSync, ftruncateSync, mkdirSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";

const T = { U32: 4, F32: 6, BOOL: 7, STRING: 8, ARRAY: 9, U64: 10 };

/** @param {string} s */
function str(s) {
  const bytes = Buffer.from(s, "utf8");
  const len = Buffer.alloc(8);
  len.writeBigUInt64LE(BigInt(bytes.length));
  return Buffer.concat([len, bytes]);
}
/** @param {number} n */
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
/** @param {number} n */
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};

/** One metadata value with its type. @param {unknown} v */
function typed(v) {
  if (typeof v === "string") return Buffer.concat([u32(T.STRING), str(v)]);
  if (typeof v === "boolean") return Buffer.concat([u32(T.BOOL), Buffer.from([v ? 1 : 0])]);
  if (typeof v === "number" && Number.isInteger(v))
    return v > 0xffffffff
      ? Buffer.concat([u32(T.U64), u64(v)])
      : Buffer.concat([u32(T.U32), u32(v)]);
  if (typeof v === "number") {
    const b = Buffer.alloc(4);
    b.writeFloatLE(v);
    return Buffer.concat([u32(T.F32), b]);
  }
  if (Array.isArray(v)) {
    const strings = v.every((x) => typeof x === "string");
    const items = v.map((x) => (strings ? str(String(x)) : u32(Number(x))));
    return Buffer.concat([u32(T.ARRAY), u32(strings ? T.STRING : T.U32), u64(v.length), ...items]);
  }
  throw new Error(`cannot write ${typeof v}`);
}

/** A GGUF header with the metadata given. @param {Record<string, unknown>} meta @param {number} [tensors] */
export function ggufBytes(meta, tensors = 291) {
  const entries = Object.entries(meta);
  return Buffer.concat([
    Buffer.from("GGUF", "ascii"),
    u32(3),
    u64(tensors),
    u64(entries.length),
    ...entries.map(([k, v]) => Buffer.concat([str(k), typed(v)])),
  ]);
}

/** A tokenizer's vocabulary to pad a header like a real one. @param {number} n */
export const vocabulary = (n) => Array.from({ length: n }, (_, i) => `tok${i}`);

/** Write a GGUF file, sparse up to `size` bytes when given. @param {string} path @param {Record<string, unknown>} meta @param {number} [size] */
export function writeGguf(path, meta, size) {
  mkdirSync(dirname(path), { recursive: true });
  const head = ggufBytes(meta);
  const fd = openSync(path, "w");
  try {
    writeSync(fd, head);
    if (size && size > head.length) ftruncateSync(fd, size);
  } finally {
    closeSync(fd);
  }
}

/** Metadata the way llama.cpp's converter writes it for a model. @param {{ arch: string, name: string, sizeLabel: string, fileType: number, ctx: number, layers: number, embd: number, heads: number, kvHeads: number, vocab?: number, license?: string, org?: string }} m */
export function modelMeta(m) {
  return {
    "general.architecture": m.arch,
    "general.type": "model",
    "general.name": m.name,
    "general.size_label": m.sizeLabel,
    "general.license": m.license ?? "apache-2.0",
    ...(m.org ? { "general.organization": m.org } : {}),
    "general.file_type": m.fileType,
    [`${m.arch}.context_length`]: m.ctx,
    [`${m.arch}.block_count`]: m.layers,
    [`${m.arch}.embedding_length`]: m.embd,
    [`${m.arch}.attention.head_count`]: m.heads,
    [`${m.arch}.attention.head_count_kv`]: m.kvHeads,
    "tokenizer.ggml.model": "gpt2",
    "tokenizer.ggml.tokens": vocabulary(m.vocab ?? 2000),
    "tokenizer.chat_template":
      "{%- for message in messages %}{{ '<|im_start|>' + message.role + '\\n' + message.content + '<|im_end|>\\n' }}{%- endfor %}{%- if add_generation_prompt %}{{ '<|im_start|>assistant\\n' }}{%- endif %}",
  };
}
