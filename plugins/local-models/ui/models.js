// A model as the window shows it, whichever server lists it: a readable name, its family, size in
// parameters, quantization, bytes on disk, context length and what it can do (see images, call
// tools, reason, embed). Servers say some of this; the rest is read from the model's name.

/**
 * @typedef {"vision" | "tools" | "reasoning" | "embedding" | "code"} Capability
 * @typedef {{
 *   id: string,
 *   name: string,
 *   serverId: string,
 *   family?: string,
 *   params?: string,
 *   quant?: string,
 *   size?: number,
 *   ctx?: number,
 *   caps: Capability[],
 *   loaded?: boolean,
 *   vram?: number,
 *   format?: string,
 *   modified?: string,
 * }} Model
 */

const WORDS = new Map([
  ["llama", "Llama"],
  ["qwen", "Qwen"],
  ["gemma", "Gemma"],
  ["mistral", "Mistral"],
  ["mixtral", "Mixtral"],
  ["phi", "Phi"],
  ["deepseek", "DeepSeek"],
  ["gpt", "GPT"],
  ["oss", "OSS"],
  ["smollm", "SmolLM"],
  ["olmo", "OLMo"],
  ["granite", "Granite"],
  ["coder", "Coder"],
  ["instruct", "Instruct"],
  ["it", "IT"],
  ["vl", "VL"],
  ["moe", "MoE"],
  ["r1", "R1"],
  ["qwq", "QwQ"],
  ["llava", "LLaVA"],
  ["nomic", "Nomic"],
  ["embed", "Embed"],
  ["text", "Text"],
  ["hf", "HF"],
]);

/** "qwen2.5-coder:7b-instruct-q4_K_M" → "Qwen2.5 Coder 7B Instruct". @param {string} id */
export function prettyName(id) {
  let base = id.replace(/^hf\.co\//, "").replace(/\.gguf$/i, "");
  base = base.split("/").pop() ?? base;
  const [rawName, tag = ""] = base.split(":");
  const name = rawName.replace(/[-_.]?gguf$/i, "");
  const cleanTag = tag === "latest" ? "" : tag.replace(QUANT, "").replace(/[-_]+$/, "");
  const words = `${name.replace(QUANT, "")} ${cleanTag}`
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (WORDS.has(lower)) return WORDS.get(lower);
      const known = [...WORDS.keys()].find(
        (k) => lower.startsWith(k) && /^[\d.]+$/.test(lower.slice(k.length)),
      );
      if (known) return `${WORDS.get(known)}${lower.slice(known.length)}`;
      if (/^\d+(\.\d+)?[bmk]$/i.test(word)) return word.toUpperCase();
      if (/^\d+x\d+(\.\d+)?b$/i.test(word)) return word.toUpperCase().replace("X", "x");
      if (/^a\d+(\.\d+)?b$/i.test(word)) return word.toUpperCase();
      if (/^v\d/i.test(word)) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    });
  return words.join(" ").trim() || id;
}

const QUANT =
  /(?:^|[-_.:])((?:i?q\d(?:_[a-z0-9]+)*)|f16|f32|bf16|fp16|fp8|int4|int8|mxfp4|\d+bit)(?=$|[-_.\s])/i;

/** The quantization a name carries ("Q4_K_M", "F16"), if any. @param {string} id */
export function quantOf(id) {
  const match = QUANT.exec(id.replace(/\.gguf$/i, ""));
  return match ? match[1].toUpperCase() : undefined;
}

/** The parameter count a name carries ("7B", "8x7B", "135M"). @param {string} id */
export function paramsOf(id) {
  const match = /(?:^|[-_:.\s])(\d+x)?(\d+(?:\.\d+)?)([bm])(?=$|[-_:.\s])/i.exec(id);
  return match ? `${match[1] ?? ""}${match[2]}${match[3].toUpperCase()}` : undefined;
}

/** What a model can do, read from its name. @param {string} id @returns {Capability[]} */
export function capsFromName(id) {
  const n = id.toLowerCase();
  /** @type {Capability[]} */
  const caps = [];
  if (/embed|bge-|\be5-|minilm|gte-|snowflake-arctic-embed|mxbai/.test(n)) return ["embedding"];
  if (
    /vision|-vl|vl:|llava|gemma3|gemma-3|minicpm-v|pixtral|moondream|bakllava|llama3\.2-vision|mistral-small3\.[12]|qwen2\.5vl|internvl|smolvlm/.test(
      n,
    )
  )
    caps.push("vision");
  if (
    /qwen|llama3\.[1-3]|llama-3\.[1-3]|mistral|mixtral|hermes|functionary|command-r|gpt-oss|granite|firefunction|devstral/.test(
      n,
    )
  )
    caps.push("tools");
  if (
    /deepseek-r1|qwq|qwen3|think|reason|gpt-oss|magistral|phi4-reasoning|r1-|exaone-deep|openthinker/.test(
      n,
    )
  )
    caps.push("reasoning");
  if (/coder|code|starcoder|devstral|codestral|codegemma/.test(n)) caps.push("code");
  return caps;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 4_683_000_000 → "4.7 GB". @param {number | undefined} bytes */
export function formatBytes(bytes) {
  if (bytes === undefined || !Number.isFinite(bytes)) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** 131072 → "128K". @param {number | undefined} tokens */
export function formatContext(tokens) {
  if (!tokens) return "";
  if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`;
  return String(tokens);
}

/** A model's key across servers. @param {{ serverId: string, id: string }} m */
export const modelKey = (m) => `${m.serverId}|${m.id}`;

/** @param {string} key */
export function splitKey(key) {
  const at = key.indexOf("|");
  return at < 0 ? { serverId: "", id: key } : { serverId: key.slice(0, at), id: key.slice(at + 1) };
}
