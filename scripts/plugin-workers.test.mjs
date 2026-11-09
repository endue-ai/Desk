import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  framePlugins,
  OFF_MAIN,
  offMainProblems,
  PLUGINS,
  pluginGraphs,
  ROOT,
  scan,
} from "./plugin-workers.mjs";

// The audit of main-thread work (#38) is the table under this heading in docs/qa/TESTING.md.
const HEADING = "## Main-thread work in plugins";

function auditRows() {
  const text = readFileSync(join(ROOT, "docs/qa/TESTING.md"), "utf8");
  const start = text.indexOf(HEADING);
  assert.ok(start >= 0, `docs/qa/TESTING.md has a "${HEADING}" section`);
  const end = text.indexOf("\n## ", start + HEADING.length);
  const section = text.slice(start, end < 0 ? undefined : end);
  return [...section.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
}

/** A plugin folder under a temp root, from relative paths to sources. */
function fixturePlugin(/** @type {Record<string, string>} */ files) {
  const root = mkdtempSync(join(tmpdir(), "plugin-workers-"));
  for (const [path, source] of Object.entries(files)) {
    const file = join(root, "p", path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return root;
}

describe("plugin-workers", () => {
  it("the audit table has one row for every plugin folder", () => {
    const rows = auditRows();
    const folders = readdirSync(PLUGINS).filter((name) =>
      statSync(join(PLUGINS, name)).isDirectory(),
    );
    assert.deepEqual([...rows].sort(), [...new Set(rows)].sort(), "a plugin has two rows");
    assert.deepEqual([...rows].sort(), folders.sort());
  });

  it("a parser or decoder the audit put in a worker is loaded by that worker only", () => {
    const problems = Object.entries(OFF_MAIN).flatMap(([name, declared]) =>
      offMainProblems(name, declared),
    );
    assert.deepEqual(problems, []);
  });

  it("a worker module imports only by URL: import maps do not reach workers", () => {
    const found = framePlugins().flatMap((name) => {
      const { workers, rel } = pluginGraphs(name);
      return [...workers.values()].flatMap((worker) =>
        worker.bares.map(({ file, spec }) => `${name}/${rel(file)} imports ${spec}`),
      );
    });
    assert.deepEqual(found, []);
  });

  it("reads imports, dynamic imports and worker URLs, and not the types in comments", () => {
    const source = [
      '/** @typedef {import("./types.js").T} T */',
      'import { a } from "./a.js";',
      "import {",
      "  b,",
      "  c as d,",
      '} from "../b.js";',
      'import "./side.js"; // import "./commented.js"',
      'export * from "./again.js";',
      'const lazy = () => import("./lazy.js");',
      'const url = "https://example.test/x.js";',
      'const worker = start(new URL("./worker.js", import.meta.url));',
      'const wasm = new URL("./decoder.wasm", import.meta.url);',
    ].join("\n");
    assert.deepEqual(scan(source), {
      imports: ["./a.js", "../b.js", "./side.js", "./again.js", "./lazy.js"],
      workers: ["./worker.js"],
    });
  });

  it("names a parser the main thread loads, through any module, and passes once it moves", () => {
    const worker =
      'import { parse } from "./parse.js";\nonmessage = (e) => postMessage(parse(e.data));';
    const client = 'export const start = (s) => s(new URL("./worker.js", import.meta.url));';
    const declared = { worker: "ui/worker.js", modules: ["ui/worker.js", "ui/parse.js"] };
    const broken = fixturePlugin({
      "ui/main.js": 'import "./view.js";\nimport "./client.js";',
      "ui/view.js":
        '/** @typedef {import("./parse.js").Doc} Doc */\nimport { parse } from "./parse.js";',
      "ui/client.js": client,
      "ui/worker.js": worker,
      "ui/parse.js": "export const parse = (text) => text;",
    });
    const fixed = fixturePlugin({
      "ui/main.js": 'import "./view.js";\nimport "./client.js";',
      "ui/view.js": '/** @typedef {import("./parse.js").Doc} Doc */\nexport const draw = () => {};',
      "ui/client.js": client,
      "ui/worker.js": worker,
      "ui/parse.js": "export const parse = (text) => text;",
    });
    try {
      assert.deepEqual(offMainProblems("p", declared, broken), [
        "p: the main thread loads ui/parse.js",
      ]);
      assert.deepEqual(offMainProblems("p", declared, fixed), []);
      assert.deepEqual(offMainProblems("p", { ...declared, worker: "ui/other.js" }, fixed), [
        "p: ui/main.js never starts ui/other.js",
      ]);
    } finally {
      rmSync(broken, { recursive: true, force: true });
      rmSync(fixed, { recursive: true, force: true });
    }
  });
});
