// A unified diff (`git diff`, `git show --format=`) into files, hunks and lines with their numbers,
// and one hunk back into a patch `git apply` takes. Pure functions over the program's output.

/**
 * @typedef {"modified" | "added" | "deleted" | "renamed" | "copied"} FileStatus
 * @typedef {"context" | "add" | "del" | "note"} LineKind
 * @typedef {{ kind: LineKind, text: string, oldNo: number | null, newNo: number | null }} Line
 * @typedef {{ header: string, oldStart: number, oldCount: number, newStart: number, newCount: number, heading: string, lines: Line[] }} Hunk
 * @typedef {{ path: string, oldPath: string | null, status: FileStatus, binary: boolean, hunks: Hunk[] }} DiffFile
 */

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/**
 * @param {string} text
 * @returns {DiffFile[]}
 */
export function parseDiff(text) {
  /** @type {DiffFile[]} */
  const files = [];
  /** @type {DiffFile | undefined} */
  let file;
  /** @type {Hunk | undefined} */
  let hunk;
  let oldNo = 0;
  let newNo = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const [oldPath, path] = namesOf(line.slice("diff --git ".length));
      file = { path, oldPath, status: "modified", binary: false, hunks: [] };
      files.push(file);
      hunk = undefined;
      continue;
    }
    if (!file) continue;
    if (hunk && line !== "" && " +-\\".includes(line[0] ?? "")) {
      hunk.lines.push(lineOf(line, oldNo, newNo));
      if (line[0] !== "+" && line[0] !== "\\") oldNo++;
      if (line[0] !== "-" && line[0] !== "\\") newNo++;
      continue;
    }
    const header = HUNK.exec(line);
    if (header) {
      oldNo = Number(header[1]);
      newNo = Number(header[3]);
      hunk = {
        header: line,
        oldStart: oldNo,
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: newNo,
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        heading: header[5] ?? "",
        lines: [],
      };
      file.hunks.push(hunk);
      continue;
    }
    hunk = undefined;
    if (line.startsWith("new file mode")) file.status = "added";
    else if (line.startsWith("deleted file mode")) file.status = "deleted";
    else if (line.startsWith("rename from ")) {
      file.status = "renamed";
      file.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
    else if (line.startsWith("copy from ")) {
      file.status = "copied";
      file.oldPath = line.slice("copy from ".length);
    } else if (line.startsWith("copy to ")) file.path = line.slice("copy to ".length);
    else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
    else if (line.startsWith("--- ")) file.oldPath = pathOf(line.slice(4), "a/");
    else if (line.startsWith("+++ ")) file.path = pathOf(line.slice(4), "b/") ?? file.path;
  }
  return files;
}

/**
 * @param {string} line
 * @param {number} oldNo
 * @param {number} newNo
 * @returns {Line}
 */
function lineOf(line, oldNo, newNo) {
  const text = line.slice(1);
  switch (line[0]) {
    case "+":
      return { kind: "add", text, oldNo: null, newNo };
    case "-":
      return { kind: "del", text, oldNo, newNo: null };
    case "\\":
      return { kind: "note", text: text.trim(), oldNo: null, newNo: null };
    default:
      return { kind: "context", text, oldNo, newNo };
  }
}

/** `a/path` without its prefix; `/dev/null` is no path. A trailing tab (timestamps) is dropped. */
function pathOf(/** @type {string} */ field, /** @type {string} */ prefix) {
  const name = field.split("\t")[0] ?? "";
  if (name === "/dev/null") return null;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

/**
 * `a/x b/x` from a `diff --git` line. Names with spaces are read when both are the same (the usual
 * case); otherwise the first " b/" splits them, and the ---/+++ or rename lines correct it later.
 * @param {string} rest
 * @returns {[string | null, string]}
 */
function namesOf(rest) {
  if (rest.startsWith("a/") && (rest.length - 5) % 2 === 0) {
    const name = rest.slice(2, 2 + (rest.length - 5) / 2);
    if (rest === `a/${name} b/${name}`) return [name, name];
  }
  const split = rest.indexOf(" b/");
  if (split < 0) return [null, rest];
  return [rest.slice(2, split), rest.slice(split + 3)];
}

/**
 * One hunk as a patch of its own, for `git apply --cached` (stage) or `--reverse` (unstage).
 * @param {DiffFile} file
 * @param {Hunk} hunk
 */
export function hunkPatch(file, hunk) {
  const oldPath = file.oldPath ?? file.path;
  const body = hunk.lines
    .map((line) => (line.kind === "note" ? `\\ ${line.text}` : `${MARK[line.kind]}${line.text}`))
    .join("\n");
  return [
    `diff --git a/${oldPath} b/${file.path}`,
    `--- ${file.status === "added" ? "/dev/null" : `a/${oldPath}`}`,
    `+++ ${file.status === "deleted" ? "/dev/null" : `b/${file.path}`}`,
    hunk.header,
    body,
    "",
  ].join("\n");
}

/** @type {Record<Exclude<LineKind, "note">, string>} */
const MARK = { context: " ", add: "+", del: "-" };

/** Files, additions and deletions, as `--stat` would count them. */
export function stats(/** @type {DiffFile[]} */ files) {
  let additions = 0;
  let deletions = 0;
  for (const file of files)
    for (const hunk of file.hunks)
      for (const line of hunk.lines) {
        if (line.kind === "add") additions++;
        else if (line.kind === "del") deletions++;
      }
  return { files: files.length, additions, deletions };
}
