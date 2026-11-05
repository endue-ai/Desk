// brain-echo's propose_universal_view: a universal view (UniversalView of
// specs/view/v0/universal.schema.json, without the id and provenance the desk writes) from the words
// of the person's sentence, so making a view from a sentence runs and is tested without endue AI. The
// sentence is the first quoted text of the prompt (“…”, as desk.propose asks), and the corrections
// after it are read in order, a later shape winning; without quotes, the prompt's last line.
//   shape:  board or kanban, timeline, calendar, chat, document or text, agent run, list (the default)
//   source: an http(s) URL, a .yaml/.yml/.json path (a file), another path (a folder, listed by
//           desk.universal.folder), or the desk's items of the kinds it names (issues, tasks, events,
//           notes, messages, files, people); every item without one of those
// The same sentence always gives the same view, and the shape can always change later (types).

const SHAPES = [
  { type: "kanban", words: ["board", "boards", "kanban", "columns"], label: "board" },
  { type: "timeline", words: ["timeline", "timelines", "history"], label: "timeline" },
  { type: "calendar", words: ["calendar", "calendars", "month"], label: "calendar" },
  { type: "chat", words: ["chat", "conversation", "thread"], label: "chat" },
  { type: "text", words: ["document", "doc", "text", "page"], label: "document" },
  { type: "agent", words: ["agent", "run", "steps"], label: "run" },
  { type: "list", words: ["list", "lists", "table"], label: "list" },
];
const KINDS = [
  { kind: "task", words: ["issue", "issues", "task", "tasks", "todo", "todos", "pr", "prs"] },
  { kind: "event", words: ["event", "events", "meeting", "meetings", "schedule"] },
  { kind: "note", words: ["note", "notes"] },
  { kind: "message", words: ["message", "messages", "mail", "email", "emails", "inbox"] },
  { kind: "file", words: ["file", "files", "document", "documents"] },
  { kind: "person", words: ["people", "person", "contacts"] },
];
/** The presentations every view may switch to, after its own. */
const SWITCH = ["list", "kanban", "timeline", "calendar"];
const URL_RE = /https?:\/\/[^\s"”'<>]+/;
const PATH_RE = /(?:^|\s)((?:~|\$\{home\})?\/[^\s"”'<>]*)/;
const DATA_FILE = /\.(ya?ml|json)$/i;

/** The sentence and its corrections, oldest first, from a desk.propose prompt. */
export function saidIn(prompt) {
  const lines = String(prompt)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const quoted = (line) => [...line.matchAll(/“([^”]*)”/g)].map((m) => m[1]);
  const said = [
    ...quoted(lines[0] ?? ""),
    ...(/^Then they asked/.test(lines[1] ?? "") ? quoted(lines[1]) : []),
  ];
  return said.length ? said : [lines.at(-1) ?? ""];
}

const wordsOf = (text) => new Set(text.toLowerCase().match(/[a-z]+/g) ?? []);
const trim = (text) => text.replace(/[.,;:!?)\]]+$/, "");
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** The shape the sentences ask for: the last one named wins. */
function shapeOf(said) {
  let shape = SHAPES.find((s) => s.type === "list");
  for (const text of said) {
    const words = wordsOf(text);
    const named = SHAPES.find((s) => s.words.some((w) => words.has(w)));
    if (named) shape = named;
  }
  return shape;
}

/** The source the sentences name, and the words that name what it holds. */
function sourceOf(said) {
  const all = said.join(" ");
  const url = URL_RE.exec(all);
  if (url) {
    const href = trim(url[0]);
    return { source: { url: href }, what: new URL(href).host };
  }
  const path = PATH_RE.exec(all);
  if (path) {
    const at = trim(path[1]).replace(/\/+$/, "") || "/";
    const name = at.split("/").filter(Boolean).at(-1) ?? at;
    if (DATA_FILE.test(at)) return { source: { file: at }, what: name.replace(DATA_FILE, "") };
    return { source: { command: "desk.universal.folder", args: { path: at } }, what: name };
  }
  const words = wordsOf(all);
  const kinds = KINDS.filter((k) => k.words.some((w) => words.has(w)));
  if (kinds.length === 0) return { source: { items: {} }, what: "everything" };
  const named = kinds.map(
    (k) => k.words.find((w) => words.has(w) && w.endsWith("s")) ?? `${k.kind}s`,
  );
  return { source: { items: { kinds: kinds.map((k) => k.kind) } }, what: named.join(" and ") };
}

/** propose_universal_view's arguments for `prompt`. */
export function proposeUniversalView(prompt) {
  const said = saidIn(prompt).map((text) => text.slice(0, 2000));
  const shape = shapeOf(said);
  const { source, what } = sourceOf(said);
  const title = capital(`${what} ${shape.label}`).slice(0, 200);
  const types = [shape.type, ...SWITCH.filter((t) => t !== shape.type)];
  const view = {
    title,
    description: `brain-echo made this from: ${said.join("; ")}`.slice(0, 500),
    type: shape.type,
    types,
    source,
    empty: "Nothing here yet.",
  };
  if (shape.type === "kanban" && "items" in source && source.items.kinds?.includes("task"))
    view.options = { groups: ["open", "done", "cancelled"] };
  return view;
}
