import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { missing, PAGES, render, ROOT, write } from "./spec-docs.mjs";

const SCRIPT = fileURLToPath(new URL("./spec-docs.mjs", import.meta.url));
const temp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

function tree(files) {
  const root = temp("spec-docs-");
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), typeof value === "string" ? value : JSON.stringify(value));
  }
  return root;
}

/** The text of one `### heading` section of a page, up to the next heading. */
function section(page, heading) {
  const start = page.indexOf(`\n### ${heading}\n`);
  assert.notEqual(start, -1, `no section ${heading}`);
  const rest = page.slice(start + heading.length + 6);
  const end = rest.search(/\n#{2,3} /);
  return end === -1 ? rest : rest.slice(0, end);
}

/** Every `"<key>": { "const": "<value>" }` in the JSON files of a folder, found without the renderer. */
function consts(folder, key) {
  const found = [];
  for (const name of readdirSync(folder).filter((n) => n.endsWith(".schema.json"))) {
    const text = readFileSync(join(folder, name), "utf8");
    for (const m of text.matchAll(new RegExp(`"${key}":\\s*\\{\\s*"const":\\s*"([^"]+)"`, "g")))
      found.push(m[1]);
  }
  return found;
}

const SCHEMA = "https://json-schema.org/draft/2020-12/schema";
const PERM_REF = "../../plugin/v0/permission.schema.json#/$defs/DemoUsePermission";
const request = (method, params) => ({
  type: "object",
  properties: {
    id: { $ref: "bridge.schema.json#/$defs/RequestId" },
    method: { const: method },
    params: { $ref: `#/$defs/${params}` },
  },
  required: ["id", "method", "params"],
});
const FIXTURE = {
  "specs/bridge/v0/bridge.schema.json": {
    $schema: SCHEMA,
    $id: "https://endue.ai/specs/bridge/v0/bridge.schema.json",
    $defs: {
      RequestId: { type: "integer", minimum: 0 },
      ErrorCode: { type: "string", enum: ["permission_denied", "invalid_params", "timeout"] },
    },
  },
  "specs/bridge/v0/demo.schema.json": {
    $schema: SCHEMA,
    $id: "https://endue.ai/specs/bridge/v0/demo.schema.json",
    title: "Desk bridge v0: demo",
    description: "A namespace for the tests.",
    $defs: {
      DemoEchoRequest: request("demo.echo", "DemoEchoParams"),
      DemoEchoParams: {
        type: "object",
        properties: {
          text: { description: "What to echo.", type: "string" },
          times: { description: "How often.", type: "integer", minimum: 1 },
          scope: { $ref: PERM_REF },
        },
        required: ["text", "scope"],
      },
      DemoEchoResult: {
        type: "object",
        properties: { echo: { description: "The same text.", type: "string" } },
        required: ["echo"],
      },
      DemoPingRequest: request("demo.ping", "DemoPingParams"),
      DemoPingParams: { type: "object", properties: {} },
      DemoPingResult: { type: "object", properties: { at: { $ref: "#/$defs/Instant" } } },
      Instant: { description: "A moment, in milliseconds.", type: "integer", minimum: 0 },
      DemoTickEvent: {
        description: "Time passed.",
        type: "object",
        properties: { event: { const: "demo.tick" }, data: { $ref: "#/$defs/DemoTickData" } },
      },
      DemoTickData: {
        type: "object",
        properties: { count: { description: "Ticks so far.", type: "integer" } },
        required: ["count"],
      },
    },
  },
  "specs/bridge/v0/README.md":
    "# Demo\n\n## Methods\n\n**demo.echo** answers with the same text. A missed deadline is\n`timeout`.\n\n**demo.ping** answers at once.\n",
  "specs/plugin/v0/permission.schema.json": {
    $schema: SCHEMA,
    $id: "https://endue.ai/specs/plugin/v0/permission.schema.json",
    $defs: {
      Permission: { oneOf: [{ $ref: "#/$defs/DemoUsePermission" }] },
      DemoUsePermission: {
        description: "Use the demo.",
        type: "object",
        properties: {
          permission: { const: "demo:use" },
          words: { description: "Words it may echo.", type: "array", items: { type: "string" } },
        },
        required: ["permission", "words"],
      },
    },
  },
  "specs/plugin/v0/plugin.schema.json": {
    $schema: SCHEMA,
    $id: "https://endue.ai/specs/plugin/v0/plugin.schema.json",
    $ref: "#/$defs/PluginManifest",
    $defs: {
      PluginManifest: {
        type: "object",
        properties: {
          id: { description: "The plugin id.", type: "string" },
          kind: { $ref: "#/$defs/PluginKind" },
        },
        required: ["id"],
      },
      PluginKind: { description: "How it runs.", type: "string", enum: ["ui", "tool"] },
    },
  },
  "specs/plugin/v0/README.md":
    "| Permission | Scope | Covers |\n| --- | --- | --- |\n| `demo:use` | `words` | `demo.echo`, `demo.tick` events |\n",
  "specs/brain/v0/openapi.yaml": [
    "openapi: 3.1.0",
    "info: { title: Demo brain, version: 0.0.0, description: For the tests. }",
    "paths:",
    "  /ping:",
    "    get:",
    "      operationId: ping",
    "      summary: Ping the brain",
    "      responses:",
    '        "200": { description: Alive. }',
    '        "503": { description: Asleep. }',
    "components: { schemas: {} }",
    "",
  ].join("\n"),
};

describe("spec-docs on the real specs", () => {
  const pages = render(ROOT);
  const bridge = join(ROOT, "specs/bridge/v0");

  it("renders every bridge method of the real specs with params, result, errors and permission", () => {
    const methods = consts(bridge, "method");
    assert.ok(methods.length >= 30, `found only ${methods.length} methods`);
    for (const method of methods) {
      const text = section(pages["bridge.md"], `\`${method}\``);
      for (const part of ["**Params**", "**Result**", "**Errors:**", "**Permission:**"])
        assert.ok(text.includes(part), `${method} has no ${part}`);
    }
  });

  it("renders every event of the real specs", () => {
    const events = consts(bridge, "event");
    assert.ok(events.length >= 10, `found only ${events.length} events`);
    for (const event of events) {
      const text = section(pages["bridge.md"], `\`${event}\``);
      assert.ok(text.includes("**Data**"), `${event} has no data`);
      assert.ok(text.includes("**Permission:**"), `${event} does not say who receives it`);
    }
  });

  it("renders the whole permission vocabulary", () => {
    const permissions = consts(join(ROOT, "specs/plugin/v0"), "permission");
    assert.ok(permissions.includes("fs:read") && permissions.includes("perm:manage"));
    for (const permission of permissions) {
      const text = section(pages["permissions.md"], `\`${permission}\``);
      assert.ok(text.includes("**Covers:**"), `${permission} does not say what it covers`);
    }
    assert.match(section(pages["permissions.md"], "`fs:read`"), /\| `paths` \|/);
    assert.match(section(pages["bridge.md"], "`fs.read`"), /\*\*Permission:\*\* `fs:read`/);
    assert.match(section(pages["bridge.md"], "`perm.revoke`"), /\*\*Permission:\*\* `perm:manage`/);
    assert.match(section(pages["bridge.md"], "`store.get`"), /\*\*Permission:\*\* none/);
  });

  it("renders every plugin manifest field", () => {
    const schema = JSON.parse(readFileSync(join(ROOT, "specs/plugin/v0/plugin.schema.json"), "utf8"));
    const manifest = schema.$defs.PluginManifest;
    for (const field of Object.keys(manifest.properties)) {
      const required = manifest.required.includes(field) ? "yes" : "no";
      assert.match(pages["manifest.md"], new RegExp(`\\| \`${field}\` \\| [^|]+ \\| ${required} \\|`));
    }
  });

  it("renders every brain endpoint", () => {
    const yaml = readFileSync(join(ROOT, "specs/brain/v0/openapi.yaml"), "utf8");
    const ids = [...yaml.matchAll(/operationId:\s*(\S+)/g)].map((m) => m[1]);
    assert.ok(ids.includes("createTurn") && ids.includes("acquireLease"));
    for (const id of ids) assert.ok(section(pages["brain.md"], `\`${id}\``).includes("| `"));
    const turn = section(pages["brain.md"], "`createTurn`");
    assert.ok(turn.includes("`POST /sessions/{sessionId}/turns`"));
    assert.match(turn, /\| `409` \|/);
  });

  it("names nothing missing from its own output", () => {
    const out = temp("spec-docs-out-");
    write(ROOT, out);
    assert.deepEqual(missing(ROOT, out), []);
  });
});

describe("spec-docs on a fixture", () => {
  const root = tree(FIXTURE);
  const pages = render(root);

  it("renders a small fixture exactly", () => {
    const echo = section(pages["bridge.md"], "`demo.echo`");
    assert.ok(echo.includes("**demo.echo** answers with the same text. A missed deadline is\n`timeout`."));
    assert.ok(echo.includes("**Permission:** `demo:use`, carried in `params.scope`."));
    assert.ok(echo.includes("| `text` | string | yes | What to echo. |"));
    assert.ok(echo.includes("| `times` | integer, at least 1 | no | How often. |"));
    assert.ok(echo.includes("| `scope` | `demo:use` scope | yes | Use the demo. |"));
    assert.ok(echo.includes("| `echo` | string | yes | The same text. |"));
    assert.ok(echo.includes("**Errors:** `permission_denied`, `timeout`."));

    const ping = section(pages["bridge.md"], "`demo.ping`");
    assert.ok(ping.includes("**Permission:** none"));
    assert.ok(ping.includes("**Errors:** none of its own."));
    assert.ok(ping.includes("None."), "empty params say so");
    assert.ok(ping.includes("| `at` | [Instant](#instant) | no | A moment, in milliseconds. |"));
    assert.ok(section(pages["bridge.md"], "Instant").includes("integer, at least 0"));

    const tick = section(pages["bridge.md"], "`demo.tick`");
    assert.ok(tick.includes("Time passed."));
    assert.ok(tick.includes("**Permission:** `demo:use`"));
    assert.ok(tick.includes("| `count` | integer | yes | Ticks so far. |"));

    const use = section(pages["permissions.md"], "`demo:use`");
    assert.ok(use.includes("| `words` | array of string | yes | Words it may echo. |"));
    assert.ok(use.includes("**Covers:** `demo.echo`, `demo.tick` events"));

    assert.ok(pages["manifest.md"].includes("| `id` | string | yes | The plugin id. |"));
    assert.ok(pages["manifest.md"].includes("| `kind` | [PluginKind](#pluginkind) | no | How it runs. |"));
    const ping2 = section(pages["brain.md"], "`ping`");
    assert.ok(ping2.includes("`GET /ping`") && ping2.includes("| `503` | Asleep. |"));
    for (const page of PAGES) assert.match(pages[page], /^---\ntitle: .+\n/);
  });

  it("names what is missing", () => {
    const out = temp("spec-docs-out-");
    write(root, out);
    assert.deepEqual(missing(root, out), []);
    const bridge = readFileSync(join(out, "bridge.md"), "utf8");
    writeFileSync(join(out, "bridge.md"), bridge.replace("### `demo.ping`", "### ping"));
    writeFileSync(join(out, "permissions.md"), "---\ntitle: Permissions\n---\n");
    assert.deepEqual(missing(root, out), [
      "bridge.md: method demo.ping",
      "permissions.md: permission demo:use",
    ]);
  });

  it("writes into the folder given on the command line", () => {
    const out = join(temp("spec-docs-cli-"), "api");
    execFileSync(process.execPath, [SCRIPT, out, "--root", root]);
    assert.deepEqual(readdirSync(out).sort(), [...PAGES].sort());
    const usage = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
    assert.equal(usage.status, 2);
    assert.match(usage.stderr, /usage: .*spec-docs\.mjs <out>/);
  });

  it("just docs-api runs the renderer", () => {
    const justfile = readFileSync(join(ROOT, "justfile"), "utf8");
    assert.match(justfile, /^docs-api out:\n\s+node scripts\/spec-docs\.mjs \{\{out\}\}$/m);
  });
});
