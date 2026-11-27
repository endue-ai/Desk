// The requirements document (docs/ko/database-plugin-requirements.md) agrees with the manifest and
// carries the PostgreSQL plan's stage (#438, PG-106): what it says the plugin declares is what
// plugin.json declares, and every task of the plan has its row with its issue number.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const folder = join(__dirname, "..");
const root = join(folder, "../..");
const read = (path: string) => readFileSync(path, "utf8");
const doc = () => read(join(root, "docs/ko/database-plugin-requirements.md"));

type Scope = {
  permission: string;
  commands?: string[];
  paths?: string[];
  ids?: string[];
  hosts?: string[];
};
type Manifest = {
  permissions: Scope[];
  contributes: { settings: Record<string, unknown>; files: { pattern: string }[] };
};
const manifest = () => JSON.parse(read(join(folder, "plugin.json"))) as Manifest;

/** The text between two markers of the document. */
const between = (text: string, from: string, to: string) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start + from.length);
  expect(start, from).toBeGreaterThanOrEqual(0);
  expect(end, to).toBeGreaterThan(start);
  return text.slice(start, end);
};

/** A section by its `## ` heading, up to the next one. */
const section = (text: string, heading: string) => {
  const start = text.indexOf(`\n## ${heading}\n`);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const next = text.indexOf("\n## ", start + heading.length + 4);
  return text.slice(start, next < 0 ? undefined : next);
};

/** Every task of epic #438, with its issue. */
const PLAN: [string, number][] = [
  ["PG-00", 506],
  ["PG-01a", 439],
  ["PG-01b", 440],
  ["PG-01c", 441],
  ["PG-01d", 540],
  ["PG-01e", 541],
  ["PG-01f", 562],
  ["PG-01g", 563],
  ["PG-01h", 564],
  ...(
    [
      [2, 442],
      [3, 443],
      [4, 444],
      [5, 445],
      [6, 446],
      [10, 447],
      [11, 448],
      [12, 449],
      [13, 450],
      [14, 451],
      [15, 452],
      [20, 453],
      [21, 454],
      [22, 455],
      [23, 456],
      [24, 457],
      [25, 458],
      [26, 459],
      [30, 460],
      [31, 461],
      [32, 462],
      [33, 463],
      [34, 464],
      [35, 465],
      [36, 466],
      [40, 467],
      [41, 468],
      [42, 469],
      [43, 470],
      [44, 471],
      [45, 472],
      [46, 473],
      [50, 474],
      [51, 475],
      [52, 476],
      [53, 477],
      [54, 478],
      [55, 479],
      [56, 480],
      [60, 481],
      [61, 482],
      [62, 483],
      [63, 484],
      [64, 485],
      [70, 486],
      [71, 487],
      [72, 488],
      [73, 489],
      [80, 490],
      [81, 491],
      [82, 492],
      [90, 493],
      [91, 494],
      [100, 495],
      [101, 496],
      [102, 497],
      [103, 498],
      [104, 499],
      [105, 500],
      [106, 501],
      [107, 502],
      [108, 503],
      [109, 504],
    ] as [number, number][]
  ).map(([n, issue]): [string, number] => [`PG-${String(n).padStart(2, "0")}`, issue]),
];

describe("the database requirements document", () => {
  it("names every permission the manifest declares", () => {
    const part = between(doc(), "**권한**", "**표면**");
    for (const scope of manifest().permissions) {
      const values = scope.commands ?? scope.paths ?? scope.ids ?? scope.hosts ?? [];
      expect(part, scope.permission).toContain(`\`${scope.permission}`);
      for (const value of values) expect(part, `${scope.permission} ${value}`).toContain(value);
    }
  });

  it("says the manifest's settings and file patterns", () => {
    const line = between(doc(), "**기여**", "\n- **");
    const { settings, files } = manifest().contributes;
    expect(line).toContain(`설정 ${Object.keys(settings).length}`);
    for (const { pattern } of files) expect(line, pattern).toContain(`\`${pattern}\``);
  });

  it("has the plan's stage with an issue per task", () => {
    const text = doc();
    const stage = section(text, "요구사항");
    for (const [id, issue] of PLAN) {
      const row = stage.split("\n").find((line) => line.startsWith(`| ${id} · #${issue} |`));
      expect(row, id).toBeDefined();
      expect(row?.trimEnd().endsWith("| D |"), id).toBe(true);
    }
    expect(section(text, "단계")).toMatch(/^\| D \|/mu);
  });

  it("moves the answered open questions to decisions", () => {
    const text = doc();
    const open = section(text, "열린 질문");
    expect(open).not.toMatch(/세션 유지\(DB-21\)/u);
    expect(open).not.toMatch(/재시작 뒤에도/u);
    expect(open).not.toMatch(/64 MiB 상한 너머/u);
    const decided = section(text, "가정과 결정 (뒤집으려면 거절에 한 줄로)");
    for (const adr of ["0281", "0282", "0283", "0311", "0352", "0365"])
      expect(decided, adr).toContain(`ADR ${adr}`);
  });

  it("keeps the desk requirements row and the README in step", () => {
    const row = read(join(root, "docs/ko/desk-requirements.md"))
      .split("\n")
      .find((line) => line.startsWith("| `database` |"));
    expect(row).toContain("ADR 0281");
    expect(row).toContain("database-plugin-requirements.md");
    expect(read(join(folder, "README.md"))).toContain("docs/ko/database-plugin-requirements.md");
  });
});
