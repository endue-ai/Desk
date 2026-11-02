import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkKeysFile, checkProfileFile, readDeskYaml } from "./desk-yaml";

type Vector = { target: string; instance: unknown; description: string };

const vectors = join(import.meta.dirname, "../../../specs/init/v0/vectors");
const checks = { ProfileFile: checkProfileFile, KeysFile: checkKeysFile } as const;

function read(kind: "valid" | "invalid"): Array<[string, Vector]> {
  return readdirSync(join(vectors, kind))
    .sort()
    .map((name): [string, Vector] => [
      `${kind}/${name}`,
      JSON.parse(readFileSync(join(vectors, kind, name), "utf8")) as Vector,
    ])
    .filter(([, vector]) => vector.target in checks);
}

describe("the runtime's checks judge every profile-file and keys-file vector as its folder says", () => {
  const all = [...read("valid"), ...read("invalid")];

  it("there are vectors of both kinds for both files", () => {
    for (const target of Object.keys(checks)) {
      const of = all.filter(([, vector]) => vector.target === target);
      expect(of.filter(([file]) => file.startsWith("valid/")).length, target).toBeGreaterThan(2);
      expect(of.filter(([file]) => file.startsWith("invalid/")).length, target).toBeGreaterThan(2);
    }
  });

  for (const [file, vector] of all) {
    it(`${file} (${vector.description})`, () => {
      const problems = checks[vector.target as keyof typeof checks](vector.instance);
      expect(problems.length === 0, JSON.stringify(problems)).toBe(file.startsWith("valid/"));
    });
  }
});

describe("a problem names the line of the YAML node it is about", () => {
  it("names the line of a bad setting key", () => {
    const text = "name: Late\nsettings:\n  desk.theme.scheme: dark\n  Desk.Notify: true\n";
    const read = readDeskYaml("profiles/late.yaml", text, checkProfileFile);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problem).toMatch(/^line 4: /);
  });

  it("names the line of a binding without a command", () => {
    const text =
      "# mine\nbindings:\n  - key: Mod+J\n    command: desk.palette.open\n  - key: Mod+L\n";
    const read = readDeskYaml("keys.yaml", text, checkKeysFile);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problem).toMatch(/^line 5: /);
  });

  it("names the line of a YAML syntax error", () => {
    const read = readDeskYaml("keys.yaml", "bindings:\n  - key: [Mod+J\n", checkKeysFile);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.problem).toMatch(/^line \d+: /);
  });

  it("reads an empty file, or one with only comments, as the empty mapping", () => {
    expect(readDeskYaml("keys.yaml", "", checkKeysFile)).toEqual({ ok: true, value: {} });
    expect(readDeskYaml("keys.yaml", "# none yet\n", checkKeysFile)).toEqual({
      ok: true,
      value: {},
    });
  });
});
