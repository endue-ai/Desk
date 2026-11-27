import { t as messageText } from "../strings/index.js";

// JSON as text, without JavaScript's numbers: strict JSON (RFC 8259) cut into its tokens and checked,
// with the line and column of the first thing wrong; laid out two spaces a level by its tokens, so a
// number keeps its digits (12345678901234567890, 2.0) and a string its escapes; two texts the same
// but for space. Pure.

/** @typedef {{ kind: string, text: string, at: number }} Token */

const NUMBER = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?/uy;
// biome-ignore lint/suspicious/noControlCharactersInRegex: JSON refuses them raw in a string
const STRING = /"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/uy;
const WORD = /true|false|null/uy;

/** Where an offset is, as words: "line 2, column 5". */
const where = (/** @type {string} */ text, /** @type {number} */ at) => {
  const before = text.slice(0, at);
  const line = before.split("\n").length;
  return `line ${line}, column ${at - before.lastIndexOf("\n")}`;
};

/**
 * The tokens of a JSON text, or why it is not JSON.
 * @param {string} text
 * @returns {{ tokens: Token[] } | { error: string }}
 */
export function scanJson(text) {
  /** @type {Token[]} */
  const tokens = [];
  const fail = (/** @type {number} */ at, /** @type {string} */ why) => ({
    error: messageText("cellEditors.jsonText.notJsonAt", {
      value: String(where(text, at)),
      why: String(why),
    }),
  });
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    if (/\s/u.test(c)) {
      i++;
      continue;
    }
    if ("{}[]:,".includes(c)) {
      tokens.push({ kind: c, text: c, at: i++ });
      continue;
    }
    const match = [STRING, NUMBER, WORD].map((re) => {
      re.lastIndex = i;
      return re.exec(text)?.[0];
    });
    const [string, number, word] = match;
    const found = string ?? number ?? word;
    if (!found) {
      if (c === '"') return fail(i, "this string is not closed, or holds a bad escape");
      if (c === "'") return fail(i, "strings take double quotes");
      return fail(i, `"${c}" cannot stand here`);
    }
    tokens.push({ kind: string ? "string" : "value", text: found, at: i });
    i += found.length;
  }
  return checkTokens(text, tokens, fail);
}

/**
 * The grammar over the tokens, with a stack instead of recursion (any depth).
 * @param {string} text
 * @param {Token[]} tokens
 * @param {(at: number, why: string) => { error: string }} fail
 */
function checkTokens(text, tokens, fail) {
  /** @type {("{" | "[")[]} */
  const stack = [];
  // What may come next: a value, a key (or the end of an empty object), ...
  let want = "value";
  for (let t = 0; t < tokens.length; t++) {
    const token = /** @type {Token} */ (tokens[t]);
    const top = stack.at(-1);
    if (want === "end") return fail(token.at, "there is more after the value");
    if (want === "value" || want === "value or ]") {
      if (token.kind === "]" && want === "value or ]") {
        stack.pop();
        want = after(stack);
      } else if (token.kind === "{") {
        stack.push("{");
        want = "key or }";
      } else if (token.kind === "[") {
        stack.push("[");
        want = "value or ]";
      } else if (token.kind === "string" || token.kind === "value") want = after(stack);
      else return fail(token.at, `a value is wanted here, not "${token.text}"`);
    } else if (want === "key" || want === "key or }") {
      if (token.kind === "}" && want === "key or }") {
        stack.pop();
        want = after(stack);
      } else if (token.kind === "string") {
        if (tokens[t + 1]?.kind !== ":")
          return fail(tokens[t + 1]?.at ?? text.length, "a colon is wanted after the key");
        t++;
        want = "value";
      } else return fail(token.at, "a key in double quotes is wanted");
    } else if (token.kind === ",") want = top === "{" ? "key" : "value";
    else if (token.kind === (top === "{" ? "}" : "]")) {
      stack.pop();
      want = after(stack);
    } else return fail(token.at, `a comma or ${top === "{" ? "}" : "]"} is wanted`);
  }
  if (want !== "end") return fail(text.length, "it ends too soon");
  return { tokens };
}

/** What is wanted after a whole value: a comma or the close of what holds it, or the end. */
const after = (/** @type {string[]} */ stack) => (stack.length ? "comma or close" : "end");

/** A JSON text laid out two spaces a level, or undefined when it is not JSON. */
export function formatJson(/** @type {string} */ text) {
  const scanned = scanJson(text);
  if ("error" in scanned) return undefined;
  const { tokens } = scanned;
  let out = "";
  let depth = 0;
  const line = () => `\n${"  ".repeat(depth)}`;
  for (let t = 0; t < tokens.length; t++) {
    const token = /** @type {Token} */ (tokens[t]);
    const next = tokens[t + 1];
    if (token.kind === "{" || token.kind === "[") {
      const close = token.kind === "{" ? "}" : "]";
      if (next?.kind === close) {
        out += `${token.text}${close}`;
        t++;
      } else {
        depth++;
        out += `${token.text}${line()}`;
      }
    } else if (token.kind === "}" || token.kind === "]") {
      depth--;
      out += `${line()}${token.text}`;
    } else if (token.kind === ",") out += `,${line()}`;
    else if (token.kind === ":") out += ": ";
    else out += token.text;
  }
  return out;
}

/** Whether two texts are the same JSON but for the space between tokens. */
export function sameJson(/** @type {string} */ a, /** @type {string} */ b) {
  const [x, y] = [scanJson(a), scanJson(b)];
  if ("error" in x || "error" in y || x.tokens.length !== y.tokens.length) return false;
  return x.tokens.every((token, i) => token.text === y.tokens[i]?.text);
}
