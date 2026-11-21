// Every catalog the desk ships beside its modules (`<module>/messages/<lang>.json`, ADR 0250), and
// the shell's, is a valid catalog, and Korean says nothing English does not: no id and no
// parameter of its own.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const repo = join(import.meta.dirname, "../../../..");
const schema = JSON.parse(
  readFileSync(join(repo, "specs/plugin/v0/messages.schema.json"), "utf8"),
) as object;
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

function folders(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory() || name === "node_modules") continue;
    if (name === "messages") out.push(path);
    else folders(path, out);
  }
  return out;
}

const read = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
const texts = (message: unknown): string[] =>
  typeof message === "string" ? [message] : Object.values(message as Record<string, string>);
const params = (message: unknown) =>
  new Set(texts(message).flatMap((text) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1])));

/** A module's prefix: its folder under src/ in camelCase (settings-ui reads settingsUi). */
const prefixOf = (folder: string) =>
  relative(join(repo, "packages/runtime/src"), join(folder, ".."))
    .split(/[\\/]/)[0]
    ?.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());

// The app's page and its Rust shell (`apps/desk/shell/messages`, ADR 0276) ship catalogs too.
const found = ["packages/runtime/src", "apps/desk/src", "apps/desk/shell"].flatMap((dir) =>
  folders(join(repo, dir)),
);

describe("the runtime's catalogs", () => {
  it("every runtime catalog is valid and Korean holds no id English lacks", () => {
    expect(found.length).toBeGreaterThan(0);
    for (const folder of found) {
      const where = relative(repo, folder);
      expect(existsSync(join(folder, "en.json")), `${where}/en.json`).toBe(true);
      for (const file of readdirSync(folder)) {
        expect(file, where).toMatch(/^(en|ko)\.json$/);
        const catalog = read(join(folder, file));
        expect(validate(catalog), `${where}/${file}: ${JSON.stringify(validate.errors)}`).toBe(
          true,
        );
      }
      const en = read(join(folder, "en.json"));
      const ko = existsSync(join(folder, "ko.json")) ? read(join(folder, "ko.json")) : {};
      for (const [id, message] of Object.entries(ko)) {
        expect(Object.hasOwn(en, id), `${where}/ko.json: ${id} is not in en.json`).toBe(true);
        for (const name of params(message))
          expect(params(en[id]).has(name), `${where}/ko.json: ${id} has {${name}}`).toBe(true);
      }
    }
  });

  it("an id lives in one module and starts with that module's name", () => {
    const ids = new Map<string, string>();
    for (const folder of found.filter((f) => f.includes(join("packages", "runtime")))) {
      for (const id of Object.keys(read(join(folder, "en.json")))) {
        expect(ids.get(id), `${id} in ${folder} and ${ids.get(id)}`).toBeUndefined();
        ids.set(id, folder);
        expect(id.split(".")[0], `${id} in ${folder}`).toBe(prefixOf(folder));
      }
    }
  });
});
