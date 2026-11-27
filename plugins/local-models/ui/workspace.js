// A chat's work folder, for questions about code: its files (found once, the usual build and vendor
// folders skipped), one file's text, the folder as a tree, the changes git sees, and the rules the
// folder keeps for models (AGENTS.md, .endue/rules/*.md), which go in the system prompt.
import { docOf, TEXT_EXT } from "./attach.js";

const SKIP = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "target",
  ".next",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  "coverage",
  "vendor",
  ".idea",
  ".gradle",
  "out",
  "Pods",
]);
const LIMIT = 4000;
const FILE_LIMIT = 300_000;
const CODEBASE_LIMIT = 3_000_000;

/**
 * @typedef {import("./net.js").Bridge} Bridge
 * @typedef {{ path: string, rel: string, size: number }} WorkFile
 */

/** @param {string} path */
export const folderName = (path) => path.replace(/\/+$/, "").split("/").pop() ?? path;

/** @param {Bridge} bridge @param {import("./proc.js").Procs} procs */
export function createWorkspace(bridge, procs) {
  /** @type {Map<string, { at: number, files: WorkFile[] }>} */
  const lists = new Map();

  /** Every file of a folder, by its path inside it. @param {string} root @returns {Promise<WorkFile[]>} */
  async function files(root) {
    const cached = lists.get(root);
    if (cached && Date.now() - cached.at < 30_000) return cached.files;
    /** @type {WorkFile[]} */
    const out = [];
    /** @param {string} dir @param {string} rel @param {number} depth */
    const walk = async (dir, rel, depth) => {
      if (out.length >= LIMIT || depth > 12) return;
      const answer = await bridge.call("fs.list", { path: dir }).catch(() => undefined);
      const entries = [...(answer?.entries ?? [])].sort((x, y) =>
        String(x.name).localeCompare(String(y.name)),
      );
      for (const e of entries) {
        if (out.length >= LIMIT) return;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.kind === "dir") {
          if (
            !SKIP.has(e.name) &&
            !(e.name.startsWith(".") && e.name !== ".endue" && e.name !== ".github")
          )
            await walk(`${dir}/${e.name}`, childRel, depth + 1);
        } else if (e.kind === "file")
          out.push({ path: `${dir}/${e.name}`, rel: childRel, size: e.size ?? 0 });
      }
    };
    await walk(root.replace(/\/+$/, ""), "", 0);
    lists.set(root, { at: Date.now(), files: out });
    return out;
  }

  /** Files whose path holds the letters typed, in order, the best first. @param {string} root @param {string} q */
  async function find(root, q, limit = 30) {
    const all = await files(root);
    const needle = q.toLowerCase();
    if (!needle) return all.filter((f) => TEXT_EXT.test(f.rel)).slice(0, limit);
    /** @param {string} s */
    const score = (s) => {
      const hay = s.toLowerCase();
      const direct = hay.indexOf(needle);
      if (direct >= 0)
        return (
          1000 -
          direct -
          hay.length / 10 +
          (hay.endsWith(needle) ? 50 : 0) +
          (hay.split("/").pop()?.startsWith(needle) ? 200 : 0)
        );
      let at = 0;
      for (const ch of needle) {
        at = hay.indexOf(ch, at);
        if (at < 0) return -1;
        at++;
      }
      return 100 - hay.length / 10;
    };
    return all
      .map((f) => ({ f, s: score(f.rel) }))
      .filter((x) => x.s >= 0)
      .sort((x, y) => y.s - x.s)
      .slice(0, limit)
      .map((x) => x.f);
  }

  /** One file as a document. @param {string} root @param {string} rel */
  async function readFile(root, rel) {
    const path = `${root.replace(/\/+$/, "")}/${rel}`;
    const answer = await bridge.call("fs.read", { path, encoding: "utf8" });
    if (answer.size > FILE_LIMIT) throw new Error(`${rel} is too long to send whole`);
    return { ...docOf(rel, answer.content, path), original: answer.content };
  }

  /** A folder's files as a tree of names. @param {string} root @param {string} [rel] */
  async function tree(root, rel = "") {
    const all = (await files(root)).filter((f) => !rel || f.rel.startsWith(`${rel}/`));
    const lines = all
      .slice(0, 400)
      .map(
        (f) =>
          `${"  ".repeat(f.rel.split("/").length - 1 - (rel ? rel.split("/").length : 0))}${f.rel.split("/").pop()}`,
      );
    return docOf(
      `${rel || folderName(root)}/ (tree)`,
      lines.join("\n") + (all.length > 400 ? `\n… ${all.length - 400} more` : ""),
    );
  }

  /** What git sees changed, staged or not. @param {string} root */
  async function gitDiff(root) {
    const run = (/** @type {string[]} */ args) => procs.runIn("git", args, root);
    const [unstaged, staged] = await Promise.all([
      run(["diff", "--no-color", "--no-ext-diff"]),
      run(["diff", "--cached", "--no-color", "--no-ext-diff"]),
    ]);
    if (unstaged.code !== 0 && staged.code !== 0)
      throw new Error(unstaged.stderr.trim() || "This folder is not a git repository");
    const text = [staged.stdout, unstaged.stdout].filter((t) => t.trim()).join("\n");
    return docOf("git diff", text.trim() || "(no changes)");
  }

  /** The text files of a folder, as documents to search. @param {string} root */
  async function codebase(root) {
    const all = (await files(root)).filter(
      (f) => TEXT_EXT.test(f.rel) && f.size < FILE_LIMIT && !/lock|\.min\./i.test(f.rel),
    );
    /** @type {import("./attach.js").Doc[]} */
    const docs = [];
    let total = 0;
    for (const f of all) {
      if (total + f.size > CODEBASE_LIMIT) break;
      const answer = await bridge
        .call("fs.read", { path: f.path, encoding: "utf8" })
        .catch(() => undefined);
      if (!answer) continue;
      total += f.size;
      docs.push(docOf(f.rel, answer.content, f.path));
    }
    return docs;
  }

  /** The folder's rules for models: AGENTS.md and .endue/rules/*.md. @param {string} root */
  async function rules(root) {
    const base = root.replace(/\/+$/, "");
    /** @type {{ name: string, text: string }[]} */
    const out = [];
    const agents = await bridge
      .call("fs.read", { path: `${base}/AGENTS.md`, encoding: "utf8" })
      .catch(() => undefined);
    if (agents?.content) out.push({ name: "AGENTS.md", text: agents.content.slice(0, 12000) });
    const listed = await bridge
      .call("fs.list", { path: `${base}/.endue/rules` })
      .catch(() => undefined);
    for (const e of (listed?.entries ?? [])
      .filter((x) => /\.md$/i.test(x.name))
      .sort((x, y) => String(x.name).localeCompare(String(y.name)))) {
      const r = await bridge
        .call("fs.read", { path: `${base}/.endue/rules/${e.name}`, encoding: "utf8" })
        .catch(() => undefined);
      if (r?.content) out.push({ name: e.name, text: r.content.slice(0, 6000) });
    }
    return out;
  }

  /** Write an edit back, as the person accepted it. @param {string} path @param {string} content */
  async function write(path, content) {
    await bridge.call("fs.write", { path, content, encoding: "utf8" });
    lists.clear();
  }

  return {
    files,
    find,
    readFile,
    tree,
    gitDiff,
    codebase,
    rules,
    write,
    forget: () => lists.clear(),
  };
}

/** @typedef {ReturnType<typeof createWorkspace>} Workspace */
