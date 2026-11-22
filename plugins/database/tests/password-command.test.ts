// A password command and the pooler choice as a connection keeps them (PG-14, ADR 0354): the
// command's words read without a shell and kept in one spelling, the checks that refuse a command
// (a relative path, an open quote, one of the database clients), the keychain beside a command, and
// a connection of another engine that keeps neither. The manifest's named programs are the ones a
// command may not name.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { argvOf, commandOf, GRANTED, wordsOf } from "../ui/auth/command.js";
import { blank, normalize, SIGN_IN } from "../ui/connections.js";

const base = { ...blank("postgresql"), id: "c-pg", name: "Shop", user: "app" };

describe("a password command's words", () => {
  it("splits on spaces, keeps a quoted word whole and does nothing a shell would", () => {
    expect(wordsOf('tok  --user app "a b" "say \\"hi\\"" $HOME *.txt |')).toEqual([
      "tok",
      "--user",
      "app",
      "a b",
      'say "hi"',
      "$HOME",
      "*.txt",
      "|",
    ]);
    expect(wordsOf('a ""')).toEqual(["a", ""]);
    expect(wordsOf('a "open')).toMatch(/not closed/u);
  });

  it("keeps one spelling, and reads back the program and its arguments", () => {
    const kept = commandOf('  /opt/bin/tok   --label  "shop db"  ""  ');
    expect(kept).toBe('/opt/bin/tok --label "shop db" ""');
    expect(argvOf(kept)).toEqual({ program: "/opt/bin/tok", args: ["--label", "shop db", ""] });
    expect(commandOf("")).toBe("");
    expect(commandOf(undefined)).toBe("");
  });

  it("refuses what it cannot run as written", () => {
    expect(() => commandOf("bin/tok")).toThrow(/full path starting with \//u);
    expect(() => commandOf('tok "open')).toThrow(/Password command: a double quote/u);
    expect(() => commandOf("tok\n--x")).toThrow(/one line/u);
    expect(() => commandOf(5)).toThrow(/text expected/u);
    for (const client of GRANTED)
      expect(() => commandOf(`/usr/bin/${client} -c x`)).toThrow(/database clients/u);
  });

  it("the programs it refuses are the ones the manifest grants by name", () => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../plugin.json"), "utf8"),
    ) as { permissions: Array<{ permission: string; commands?: string[] }> };
    const named = manifest.permissions.find((p) => p.permission === "proc:spawn" && p.commands);
    expect(named?.commands).toEqual([...GRANTED]);
  });
});

describe("the connection's fields", () => {
  it("keeps a command and the pooler choice only when set, on PostgreSQL only", () => {
    const conn = normalize({ ...base, passwordCommand: "tok  --x", pooler: true });
    expect(conn).toMatchObject({ passwordCommand: "tok --x", pooler: true });
    const plain = normalize({ ...base, passwordCommand: "  ", pooler: false });
    expect("passwordCommand" in plain || "pooler" in plain).toBe(false);
    const lite = normalize({
      ...blank("sqlite"),
      id: "c-lite",
      file: "/tmp/a.db",
      passwordCommand: "tok",
      pooler: true,
    } as never);
    expect("passwordCommand" in lite || "pooler" in lite).toBe(false);
  });

  it("a command and the keychain do not go together", () => {
    expect(() => normalize({ ...base, keychain: true, passwordCommand: "tok" } as never)).toThrow(
      /Keychain: a connection with a password command/u,
    );
  });

  it("a change to either is a sign-in change", () => {
    expect(SIGN_IN).toEqual(expect.arrayContaining(["passwordCommand", "pooler"]));
  });
});
