import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { expect, it } from "vitest";
import { type DiskMeta, denied, disk, mount, NOTES_READ, note } from "./harness";

const root = join(import.meta.dirname, "../../..");
const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

/** specs/plugin/v0's PaletteResults: what the palette takes from a provider. */
function resultsValidator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: false });
  for (const spec of ["plugin/v0", "item/v0", "view/v0", "connector/v0"]) {
    const dir = join(root, "specs", spec);
    for (const name of readdirSync(dir)
      .filter((n) => n.endsWith(".schema.json"))
      .sort())
      ajv.addSchema(readJson(join(dir, name)) as object);
  }
  const id = "https://endue.ai/specs/plugin/v0/contributes.schema.json#/$defs/PaletteResults";
  const validate = ajv.getSchema(id);
  if (!validate) throw new Error("cannot compile PaletteResults");
  return validate;
}

const TRIP = "~/Notes/trip.md";
const PLAN = "~/Notes/work/plan.md";
const TODO = "~/Notes/work/todo.txt";

/** ~/Notes with notes, and what must never be found: a hidden folder, a link out, another file. */
const library = (): Record<string, string> => ({
  [TRIP]: "서울 출장\n회의 메모\n",
  [PLAN]: "# Q4\nquarterly roadmap for the desk\n",
  [TODO]: "call the plumber\n",
  "~/Notes/.obsidian/plan.md": "secret plan\n",
  "~/Notes/elsewhere/plan.md": "secret plan\n",
  "~/Notes/plan.png": "secret plan\n",
});
const META: DiskMeta = { links: ["~/Notes/elsewhere"] };

const open = (path: string) => ({
  command: "endue.notes.search-open",
  title: "Open in Notes",
  args: { path },
});

const find = (
  m: { host: { command(n: string, a: unknown): Promise<unknown> } },
  query: string,
  limit = 5,
) => m.host.command("endue.notes.find", { query, limit });

it("finds a note on disk that is not open by its title and by its text, and opens it", async () => {
  const valid = resultsValidator();
  const m = await mount({
    handlers: disk(library(), META),
    commands: { "desk.files.open": () => "file:x", "desk.buffers.switch": () => ({}) },
  });

  const byTitle = await find(m, "plan");
  expect(valid(byTitle), JSON.stringify(valid.errors)).toBe(true);
  expect(byTitle).toEqual({
    results: [{ id: PLAN, title: "plan.md", detail: PLAN, kind: "note", actions: [open(PLAN)] }],
  });
  const byText = await find(m, "Roadmap");
  expect(valid(byText), JSON.stringify(valid.errors)).toBe(true);
  expect(byText).toEqual({
    results: [
      {
        id: PLAN,
        title: "plan.md",
        detail: `quarterly roadmap for the desk · ${PLAN}`,
        kind: "note",
        actions: [open(PLAN)],
      },
    ],
  });
  expect(await find(m, "출장")).toMatchObject({
    results: [{ id: TRIP, title: "trip.md", detail: `서울 출장 · ${TRIP}` }],
  });
  expect(m.params("fs.list")[0]).toEqual({ path: "~/Notes", scope: NOTES_READ });
  expect(m.params("fs.read")).toContainEqual({ path: PLAN, encoding: "utf8", scope: NOTES_READ });

  await m.host.command("endue.notes.search-open", { path: PLAN });
  expect(m.ran("desk.files.open")).toEqual([{ path: PLAN }]);
  expect(m.ran("desk.buffers.switch")).toEqual([]);
});

it("every word must match, title matches come first, and at most limit results", async () => {
  const files = {
    ...library(),
    "~/Notes/ideas.md": "desk ideas: a roadmap for plugins\n",
    "~/Notes/desk roadmap.md": "",
    "~/Notes/old/roadmap.txt": "last year\n",
  };
  const times = {
    [PLAN]: "2026-11-07T10:00:00Z",
    "~/Notes/ideas.md": "2026-11-01T10:00:00Z",
    "~/Notes/desk roadmap.md": "2026-01-01T10:00:00Z",
  };
  const m = await mount({ handlers: disk(files, { ...META, times }) });
  const ids = async (query: string, limit = 5) =>
    ((await find(m, query, limit)) as { results: Array<{ id: string }> }).results.map((r) => r.id);

  expect(await ids("roadmap desk", 2)).toEqual(["~/Notes/desk roadmap.md", PLAN]);
  expect(await ids("roadmap desk")).toEqual(["~/Notes/desk roadmap.md", PLAN, "~/Notes/ideas.md"]);
  expect(await ids("roadmap nowhere")).toEqual([]);
  expect(await ids("secret")).toEqual([]);
  expect(m.params("fs.list").map((p) => (p as { path: string }).path)).not.toContain(
    "~/Notes/elsewhere",
  );
  expect(m.params("fs.read").map((p) => (p as { path: string }).path)).not.toContain(
    "~/Notes/plan.png",
  );
});

it("leaves open notes to their published search documents", async () => {
  const m = await mount({
    handlers: { ...disk(library(), META), "search.replace": () => ({}) },
  });
  await m.host.command("desk.files.visit", note(TRIP));
  await m.settle();
  expect(m.params("search.replace").at(-1)).toMatchObject({ documents: [{ id: TRIP }] });

  expect(await find(m, "출장")).toEqual({ results: [] });
  expect(await find(m, "roadmap")).toMatchObject({ results: [{ id: PLAN }] });
});

it("answers no results without asking when ~/Notes is missing or not granted", async () => {
  const missing = await mount({ handlers: disk({}) });
  expect(await find(missing, "plan")).toEqual({ results: [] });
  expect(missing.params("perm.request")).toEqual([]);

  const refused = await mount({
    handlers: {
      ...disk(library()),
      "fs.list": () => {
        throw denied("fs:read over ~/Notes");
      },
    },
  });
  expect(await find(refused, "plan")).toEqual({ results: [] });
  expect(refused.params("perm.request")).toEqual([]);
  expect(refused.params("fs.read")).toEqual([]);
});

it("reads a note again only when its size or modification time changed", async () => {
  const files = library();
  const times: Record<string, string> = {
    [TRIP]: "2026-11-01T10:00:00Z",
    [PLAN]: "2026-11-02T10:00:00Z",
    [TODO]: "2026-11-03T10:00:00Z",
  };
  const m = await mount({ handlers: disk(files, { ...META, times }) });

  await Promise.all([find(m, "roadmap"), find(m, "plumber")]);
  expect(
    m.params("fs.list").filter((p) => (p as { path: string }).path === "~/Notes"),
  ).toHaveLength(1);
  const reads = m.params("fs.read").length;
  expect(reads).toBe(3);

  expect(await find(m, "desk")).toMatchObject({ results: [{ id: PLAN }] });
  expect(m.params("fs.read")).toHaveLength(reads);

  files[PLAN] = "# Q4\nquarterly roadmap, revised\n";
  times[PLAN] = "2026-11-08T09:00:00Z";
  expect(await find(m, "revised")).toMatchObject({ results: [{ id: PLAN }] });
  expect(m.params("fs.read").slice(reads)).toEqual([
    { path: PLAN, encoding: "utf8", scope: NOTES_READ },
  ]);
});
