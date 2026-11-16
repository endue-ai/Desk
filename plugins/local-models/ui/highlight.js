// Colours for code in answers: one small tokenizer per family of languages (comments, strings,
// numbers, keywords, types, calls), drawn as spans whose classes the theme colours. Unknown languages
// get the C-like rules, which read most code well enough.

const KEYWORDS = {
  js: "async await break case catch class const continue debugger default delete do else export extends false finally for from function get if import in instanceof let new null of return set static super switch this throw true try typeof undefined var void while with yield interface type enum implements private public protected readonly as satisfies keyof declare namespace abstract",
  py: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield match case self print",
  rust: "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
  c: "auto break case char const continue default do double else enum extern float for goto if inline int long register return short signed sizeof static struct switch typedef union unsigned void volatile while class namespace template typename public private protected virtual override new delete this true false nullptr using bool std include define import package extends implements final throws throw try catch boolean byte String var val fun when object",
  sh: "if then else elif fi for while do done case esac in function return export local echo cd ls cat grep sed awk sudo apt brew npm pnpm yarn pip git curl wget make cargo docker set unset source",
  sql: "select from where and or not insert into values update set delete create table index view drop alter add primary key foreign references join left right inner outer on group by order having limit offset as distinct union all null is in like between case when then else end exists returning with",
  css: "important",
};

/** @type {Record<string, keyof typeof KEYWORDS | "json" | "html" | "yaml" | "plain">} */
const FAMILY = {
  js: "js",
  javascript: "js",
  jsx: "js",
  ts: "js",
  typescript: "js",
  tsx: "js",
  mjs: "js",
  cjs: "js",
  py: "py",
  python: "py",
  rust: "rust",
  rs: "rust",
  go: "go",
  golang: "go",
  c: "c",
  h: "c",
  cpp: "c",
  "c++": "c",
  cc: "c",
  hpp: "c",
  java: "c",
  kotlin: "c",
  kt: "c",
  cs: "c",
  csharp: "c",
  swift: "c",
  scala: "c",
  dart: "c",
  php: "c",
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  shell: "sh",
  console: "sh",
  powershell: "sh",
  ps1: "sh",
  sql: "sql",
  css: "css",
  scss: "css",
  less: "css",
  json: "json",
  jsonc: "json",
  json5: "json",
  html: "html",
  xml: "html",
  svg: "html",
  vue: "html",
  yaml: "yaml",
  yml: "yaml",
  toml: "yaml",
  ini: "yaml",
  text: "plain",
  txt: "plain",
  plaintext: "plain",
  markdown: "plain",
  md: "plain",
};

/** @type {Map<string, Set<string>>} */
const sets = new Map();
/** @param {keyof typeof KEYWORDS} family */
function words(family) {
  let set = sets.get(family);
  if (!set) {
    set = new Set(KEYWORDS[family].split(" "));
    sets.set(family, set);
  }
  return set;
}

/** @param {string} family */
function rules(family) {
  const hashComment = family === "py" || family === "sh" || family === "yaml";
  const comment =
    family === "sql"
      ? /--[^\n]*|\/\*[\s\S]*?\*\//
      : hashComment
        ? /#[^\n]*/
        : /\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/;
  const string =
    family === "py"
      ? /"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|[rbfu]{0,2}"(?:\\.|[^"\\\n])*"?|[rbfu]{0,2}'(?:\\.|[^'\\\n])*'?/
      : family === "js"
        ? /`(?:\\.|[^`\\])*`?|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/
        : /"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?/;
  return new RegExp(
    [
      `(${comment.source})`,
      `(${string.source})`,
      "(\\b(?:0x[\\da-fA-F_]+|\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?)[a-zA-Z]*\\b)",
      family === "sh"
        ? "(\\$\\{?[\\w@#?*!-]+\\}?)"
        : family === "css"
          ? "(#[\\da-fA-F]{3,8}\\b|-{0,2}[a-zA-Z][\\w-]*(?=\\s*:))"
          : "(@[\\w.]+)",
      "([A-Za-z_][\\w$]*!?)(\\s*\\()?",
    ].join("|"),
    "g",
  );
}

/** @param {string} cls @param {string} text */
function span(cls, text) {
  const el = document.createElement("span");
  el.className = `lm-tk-${cls}`;
  el.textContent = text;
  return el;
}

/** JSON: keys, strings, numbers, literals. @param {string} code */
function json(code) {
  /** @type {Node[]} */
  const out = [];
  const re =
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|(\/\/[^\n]*)/g;
  let at = 0;
  for (const m of code.matchAll(re)) {
    if (m.index > at) out.push(document.createTextNode(code.slice(at, m.index)));
    if (m[1]) {
      out.push(span(m[2] ? "prop" : "string", m[1]));
      if (m[2]) out.push(document.createTextNode(m[2]));
    } else if (m[3]) out.push(span("number", m[3]));
    else if (m[4]) out.push(span("keyword", m[4]));
    else if (m[5]) out.push(span("comment", m[5]));
    at = m.index + m[0].length;
  }
  if (at < code.length) out.push(document.createTextNode(code.slice(at)));
  return out;
}

/** HTML and XML: tags, attributes, values, comments. @param {string} code */
function markup(code) {
  /** @type {Node[]} */
  const out = [];
  const re = /(<!--[\s\S]*?(?:-->|$))|(<\/?)([\w:-]+)|([\w:-]+)(=)("[^"]*"?|'[^']*'?)|(\/?>)/g;
  let at = 0;
  for (const m of code.matchAll(re)) {
    if (m.index > at) out.push(document.createTextNode(code.slice(at, m.index)));
    if (m[1]) out.push(span("comment", m[1]));
    else if (m[2]) out.push(span("punct", m[2]), span("tag", m[3]));
    else if (m[4])
      out.push(span("attr", m[4]), document.createTextNode(m[5]), span("string", m[6]));
    else if (m[7]) out.push(span("punct", m[7]));
    at = m.index + m[0].length;
  }
  if (at < code.length) out.push(document.createTextNode(code.slice(at)));
  return out;
}

/** YAML and TOML: keys, comments, strings, numbers. @param {string} code */
function yaml(code) {
  /** @type {Node[]} */
  const out = [];
  const re =
    /(#[^\n]*)|^(\s*-?\s*)([\w.-]+)(\s*[:=])|("(?:\\.|[^"\\\n])*"|'[^'\n]*')|\b(\d+(?:\.\d+)?|true|false|null|yes|no)\b|^(\s*\[[^\]\n]+\])/gm;
  let at = 0;
  for (const m of code.matchAll(re)) {
    if (m.index > at) out.push(document.createTextNode(code.slice(at, m.index)));
    if (m[1]) out.push(span("comment", m[1]));
    else if (m[3])
      out.push(document.createTextNode(m[2]), span("prop", m[3]), document.createTextNode(m[4]));
    else if (m[5]) out.push(span("string", m[5]));
    else if (m[6]) out.push(span("number", m[6]));
    else if (m[7]) out.push(span("type", m[7]));
    at = m.index + m[0].length;
  }
  if (at < code.length) out.push(document.createTextNode(code.slice(at)));
  return out;
}

/** The code as coloured nodes. @param {string} code @param {string} lang @returns {Node[]} */
export function highlight(code, lang) {
  const family = FAMILY[lang] ?? (lang ? "c" : "plain");
  if (family === "plain" || code.length > 200_000) return [document.createTextNode(code)];
  if (family === "json") return json(code);
  if (family === "html") return markup(code);
  if (family === "yaml") return yaml(code);
  const keys = words(family);
  const sql = family === "sql";
  /** @type {Node[]} */
  const out = [];
  let at = 0;
  for (const m of code.matchAll(rules(family))) {
    if (m.index > at) out.push(document.createTextNode(code.slice(at, m.index)));
    if (m[1]) out.push(span("comment", m[1]));
    else if (m[2]) out.push(span("string", m[2]));
    else if (m[3]) out.push(span("number", m[3]));
    else if (m[4])
      out.push(span(family === "sh" ? "variable" : family === "css" ? "prop" : "attr", m[4]));
    else if (m[5]) {
      const word = m[5];
      const key = sql ? word.toLowerCase() : word;
      if (keys.has(key)) out.push(span("keyword", word));
      else if (m[6]) out.push(span("call", word));
      else if (/^[A-Z][A-Za-z0-9]*[a-z]/.test(word)) out.push(span("type", word));
      else out.push(document.createTextNode(word));
      if (m[6]) out.push(document.createTextNode(m[6]));
    }
    at = m.index + m[0].length;
  }
  if (at < code.length) out.push(document.createTextNode(code.slice(at)));
  return out;
}
