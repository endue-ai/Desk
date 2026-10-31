// Which format a file is, from its first bytes and then its extension, and the parser that reads
// it. A file it cannot show (empty, not text, a variant it does not read, or a binary file damaged
// from its first byte) opens as details: the format and one sentence saying why. Nothing a parser
// throws gets past openFile.

import { parseBplist } from "./parse/bplist.js";
import { parseBson } from "./parse/bson.js";
import { parseCbor } from "./parse/cbor.js";
import { parseEnv } from "./parse/env.js";
import { parseHcl } from "./parse/hcl.js";
import { parseIni, parseProperties } from "./parse/ini.js";
import { parseJson } from "./parse/json.js";
import { parseJsonLines } from "./parse/jsonl.js";
import { parseMsgpack } from "./parse/msgpack.js";
import { parsePlist } from "./parse/plist.js";
import { parseToml } from "./parse/toml.js";
import { parseXml } from "./parse/xml.js";
import { parseYaml } from "./parse/yaml.js";

/**
 * @typedef {import("./tree.js").DataDoc} DataDoc
 * @typedef {"json" | "jsonc" | "json5" | "jsonl" | "yaml" | "toml" | "xml" | "plist" | "bplist" | "ini"
 *   | "properties" | "env" | "hcl" | "msgpack" | "cbor" | "bson" | "text"} FormatId
 * @typedef {object} Opened
 * @property {FormatId} format
 * @property {string} label What the format is called, for people
 * @property {DataDoc} [doc] The tree; absent for details and raw-only files
 * @property {string} [text] The text, for the raw view of text formats
 * @property {Uint8Array} [bytes] The bytes, for the hex dump of binary formats
 * @property {string} [note] Said above the raw view (a .conf that is not INI, a guessed encoding)
 * @property {string} [reason] Why the file opens as details only
 * @typedef {{ DOMParser?: typeof DOMParser }} OpenOptions
 */

/** File names VS Code reads as JSON with comments, though they end in .json. */
const JSONC_NAMES =
  /^(?:tsconfig|jsconfig)(?:\..+)?\.json$|^(?:settings|launch|tasks|extensions|keybindings|devcontainer|argv)\.json$|^\.?(?:eslintrc|babelrc|swcrc|jshintrc)(?:\.json)?$|^(?:tslint|api-extractor|typedoc|deno|turbo|nest-cli)\.json$/i;

/** @type {Record<string, [FormatId, string]>} */
const EXTENSIONS = {
  json: ["json", "JSON"],
  jsonc: ["jsonc", "JSONC"],
  json5: ["json5", "JSON5"],
  jsonl: ["jsonl", "JSON Lines"],
  ndjson: ["jsonl", "NDJSON"],
  yaml: ["yaml", "YAML"],
  yml: ["yaml", "YAML"],
  toml: ["toml", "TOML"],
  xml: ["xml", "XML"],
  xsd: ["xml", "XML Schema"],
  xsl: ["xml", "XSLT"],
  xslt: ["xml", "XSLT"],
  plist: ["plist", "Property list (XML)"],
  ini: ["ini", "INI"],
  cfg: ["ini", "INI"],
  conf: ["ini", "INI"],
  properties: ["properties", "Java properties"],
  env: ["env", "dotenv"],
  hcl: ["hcl", "HCL"],
  tf: ["hcl", "Terraform (HCL)"],
  tfvars: ["hcl", "Terraform variables (HCL)"],
  msgpack: ["msgpack", "MessagePack"],
  bson: ["bson", "BSON"],
  cbor: ["cbor", "CBOR"],
};

/** The format a name says, by its extension; `.env` and `.env.local` are dotenv. */
export function formatOf(/** @type {string} */ name) {
  const lower = name.toLowerCase();
  if (lower === ".env" || lower.startsWith(".env."))
    return /** @type {[FormatId, string]} */ (["env", "dotenv"]);
  const dot = lower.lastIndexOf(".");
  return (
    EXTENSIONS[dot < 0 ? "" : lower.slice(dot + 1)] ??
    /** @type {[FormatId, string]} */ (["text", "Text"])
  );
}

/**
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {OpenOptions} [options]
 * @returns {Opened}
 */
export function openFile(name, bytes, options = {}) {
  const [format, label] = formatOf(name);
  try {
    return open(name, bytes, format, label, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { format, label, reason: `It could not be read: ${message}` };
  }
}

/**
 * @param {string} name
 * @param {Uint8Array} bytes
 * @param {FormatId} format
 * @param {string} label
 * @param {OpenOptions} options
 * @returns {Opened}
 */
function open(name, bytes, format, label, options) {
  if (bytes.length === 0) return { format, label, reason: "The file is empty." };
  const head = String.fromCharCode(...bytes.subarray(0, 8));
  if (head.startsWith("bplist")) {
    const binary = { format: /** @type {FormatId} */ ("bplist"), label: "Property list (binary)" };
    if (head !== "bplist00")
      return {
        ...binary,
        reason: `It is a binary property list of a later kind (${head}), which Data does not read.`,
      };
    return binaryResult(binary, bytes, parseBplist(bytes));
  }
  if (bytes[0] === 0xd9 && bytes[1] === 0xd9 && bytes[2] === 0xf7)
    return binaryResult({ format: "cbor", label: "CBOR" }, bytes, parseCbor(bytes));
  if (format === "msgpack") return binaryResult({ format, label }, bytes, parseMsgpack(bytes));
  if (format === "cbor") return binaryResult({ format, label }, bytes, parseCbor(bytes));
  if (format === "bson") return binaryResult({ format, label }, bytes, parseBson(bytes));
  const decoded = decodeText(bytes);
  if (decoded.text === undefined) return { format, label, reason: decoded.reason };
  const { text, note } = decoded;
  const start = text.trimStart();
  const extra = note ? { note } : {};
  if (start.startsWith("<")) {
    const plist =
      /^(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE plist|<plist[\s>])/.test(start);
    if (plist)
      return {
        format: "plist",
        label: "Property list (XML)",
        text,
        doc: parsePlist(text, options),
        ...extra,
      };
    if (format === "xml" || format === "plist" || format === "text")
      return {
        format: "xml",
        label: format === "xml" ? label : "XML",
        text,
        doc: parseXml(text, options),
        ...extra,
      };
  }
  if (format === "plist")
    return {
      format,
      label,
      reason: "It is an old-style (OpenStep) property list, which Data does not read.",
    };
  const doc = parseText(name, text, format, label);
  if (doc === "raw") {
    const note =
      format === "ini"
        ? `This file does not read as INI (line ${iniLine(text)}), so it opens as raw text.`
        : "Data does not know this file's format, so it opens as raw text.";
    return { format: "text", label: "Text", text, note };
  }
  return { format: doc.format, label: doc.label, text, doc: doc.doc, ...extra };
}

/** The line where a CFG or CONF file stops reading as INI. */
const iniLine = (/** @type {string} */ text) => parseIni(text).errors[0]?.line ?? 1;

/**
 * @param {string} name
 * @param {string} text
 * @param {FormatId} format
 * @param {string} label
 * @returns {{ format: FormatId, label: string, doc: DataDoc } | "raw"}
 */
function parseText(name, text, format, label) {
  const lower = name.toLowerCase();
  switch (format) {
    case "json": {
      if (JSONC_NAMES.test(name))
        return { format: "jsonc", label: "JSONC", doc: parseJson(text, "jsonc") };
      return { format, label, doc: parseJson(text, "json") };
    }
    case "jsonc":
    case "json5":
      return { format, label, doc: parseJson(text, format) };
    case "jsonl":
      return { format, label, doc: parseJsonLines(text) };
    case "yaml":
      return { format, label, doc: parseYaml(text) };
    case "toml":
      return { format, label, doc: parseToml(text) };
    case "ini": {
      const doc = parseIni(text);
      if (doc.errors.length > 0 && !lower.endsWith(".ini")) return "raw";
      return { format, label, doc };
    }
    case "properties":
      return { format, label, doc: parseProperties(text) };
    case "env":
      return { format, label, doc: parseEnv(text) };
    case "hcl":
      return { format, label, doc: parseHcl(text) };
    default: {
      const first = text.trimStart()[0];
      if (first === "{" || first === "[")
        return { format: "json", label: "JSON", doc: parseJson(text, "json") };
      return "raw";
    }
  }
}

/**
 * @param {{ format: FormatId, label: string }} kind
 * @param {Uint8Array} bytes
 * @param {DataDoc} doc
 * @returns {Opened}
 */
function binaryResult(kind, bytes, doc) {
  const error = doc.errors[0];
  if (doc.roots.length === 0 && error) return { ...kind, reason: damaged(error.message) };
  return { ...kind, bytes, doc };
}

const damaged = (/** @type {string} */ message) =>
  /damaged|ends early|too deep|loop|does not know/i.test(message)
    ? message
    : `It is damaged: ${message}`;

/**
 * The file's text: UTF-8 (with or without a BOM) or UTF-16 with a BOM; other bytes that are not
 * UTF-8 are read as Windows-1252, and NUL bytes mean the file is not text.
 * @param {Uint8Array} bytes
 * @returns {{ text: string, note?: string } | { text?: undefined, reason: string }}
 */
export function decodeText(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return { text: new TextDecoder("utf-16le").decode(bytes.subarray(2)) };
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return { text: new TextDecoder("utf-16be").decode(bytes.subarray(2)) };
  const body =
    bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes;
  if (body.subarray(0, 8192).includes(0))
    return { reason: "It holds binary data: it is not text." };
  try {
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(body) };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(body),
      note: "This file is not UTF-8; it is read as Windows-1252.",
    };
  }
}
