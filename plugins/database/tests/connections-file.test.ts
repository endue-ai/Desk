// Connections exported to a file and imported from one (#452, PG-15, ADR 0332), on the SDK's test
// host: the chosen connections written where the save dialog says, with their groups, colours, tags
// and options, read back the same into another plugin; no password from any way one reaches the
// plugin ever in the file; and a file that is not ours, a newer one or one whose field fails
// refused with the field named, nothing stored and nothing run.
import { describe, expect, it } from "vitest";
import type { Connection } from "../ui/engines/common.js";
import { FORMAT, MAX_BYTES } from "../ui/features/connections-file/file.js";
import { mounted, tickAsShown } from "./connections-file-harness";
import { SAVED } from "./harness";

const SHOP = SAVED[1] as Connection;
const NOTES = SAVED[0] as Connection;
const DRESSED: Connection[] = [
  {
    ...SHOP,
    group: "Shop",
    color: "chart-2",
    readOnly: true,
    ssl: "verify-full",
    sslCa: "~/certs/ca.pem",
    sslCert: "~/certs/client.crt",
    sslKey: "~/certs/client.key",
    keychain: true,
  } as Connection,
  { ...NOTES, group: "Local", color: "chart-5", tag: "development" },
  { ...NOTES, id: "c-other", name: "Other", file: "~/other.db" },
];
const written = (files: Record<string, string>) => {
  const path = Object.keys(files).find((p) => p.startsWith("~/Transfer/"));
  if (!path) throw new Error("nothing written");
  return { path, text: files[path] as string };
};
const fileOf = (connections: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ format: FORMAT, version: 1, connections, ...extra });

describe("the connections file", () => {
  it("writes the chosen connections with their groups, colours, tags and options, and reads them back the same", async () => {
    const out = await mounted({
      connections: DRESSED,
      answer: (type, model) =>
        type === "connectionsExport"
          ? { ids: model.ticked.filter((id: string) => id !== "c-other") }
          : undefined,
    });
    const done = await out.m.host.command("endue.database.export-connections");
    const { path, text } = written(out.files);
    expect(path).toMatch(/^~\/Transfer\/connections-\d{4}-\d\d-\d\d\.json$/u);
    expect(done).toEqual({ path, count: 2 });
    expect(out.shown[0]?.model.ticked).toEqual(["c-prod", "c-lite", "c-other"]);
    const file = JSON.parse(text);
    expect(file).toMatchObject({ format: FORMAT, version: 1 });
    expect(typeof file.exported).toBe("string");
    expect(file.connections.map((c: Connection) => c.name)).toEqual(["Shop", "Notes"]);
    expect(text).not.toContain("keychain");
    const save = out.m.host.calls.find((c) => c.method === "dialog.save")?.params;
    expect(save).toMatchObject({ filters: [{ name: "Connections", extensions: ["json"] }] });

    const into = await mounted({ files: { [path]: text }, open: path, answer: tickAsShown });
    const imported = await into.m.host.command("endue.database.import-connections");
    expect(imported).toEqual({ added: 2, changed: 0, skipped: 0 });
    const { keychain: _keychain, ...shop } = DRESSED[0] as Connection & { keychain?: boolean };
    expect(into.stored()).toEqual([shop, { ...DRESSED[1], sslCert: "", sslKey: "" }]);
    expect(
      into.m.host.calls.some((c) => ["db.open", "db.run", "proc.spawn"].includes(c.method)),
    ).toBe(false);
    expect(into.m.view.said.at(-1)).toBe(`Imported from ${path.slice(11)}: 2 added.`);
  });

  it("never writes a password", async () => {
    const SECRETS = [
      "uri-secret-1",
      "form-secret-2",
      "form-secret-3",
      "form-secret-4",
      "store-secret-5",
      "store-secret-6",
      "typed-secret-7",
    ];
    const f = await mounted({
      connections: [{ ...SHOP, password: SECRETS[4], sslpassword: SECRETS[5] }],
      script: () => ({ rows: [["?column?"], ["1"]] }),
      password: SECRETS[6],
      pick: () => "yes",
      answer: (type, model) => (type === "connectionsExport" ? { ids: model.ticked } : undefined),
    });
    // A URI's password, kept in the keychain on Save.
    await f.m.host.command("endue.database.import-uri", {
      uri: `postgresql://app:${SECRETS[0]}@db.example:5433/orders`,
    });
    await f.m.app.formSave({ ...f.m.view.forms.at(-1)?.fields, name: "Orders", keychain: true });
    await f.m.settle();
    // Password fields handed to the form.
    await f.m.host.command("endue.database.new-connection", {});
    await f.m.app.formSave({
      ...f.m.view.forms.at(-1)?.fields,
      name: "Typed",
      host: "db.example",
      password: SECRETS[1],
      passphrase: SECRETS[2],
      passwordRef: SECRETS[3],
    } as Partial<Connection>);
    await f.m.settle();
    // A password typed at the prompt, kept in the keychain.
    await f.m.host.command("endue.database.console", { connection: "Shop" });
    f.m.view.text = "select 1";
    const running = f.m.host.command("endue.database.run");
    await f.m.settle();
    f.m.app.password(SECRETS[6], true);
    await running;
    await f.m.settle();
    expect(f.stored().find((c) => c.id === "c-prod")).toMatchObject({ keychain: true });

    await f.m.host.command("endue.database.export-connections");
    const { text } = written(f.files);
    expect(JSON.parse(text).connections).toHaveLength(3);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/pass|keychain|secret|token/iu);
  });

  it("refuses a file that is not ours, a newer version and a field that fails, naming the field", async () => {
    const cases: Array<[string, RegExp]> = [
      [
        "hello, not a file of ours",
        /neither a connections file of Database nor a pg_service\.conf/u,
      ],
      [JSON.stringify({ name: "x" }), /JSON, but not a connections file: it has no "format"/u],
      [fileOf([], { version: 2 }), /version 2, written by a newer Database.*update the desk/u],
      [fileOf([], { version: "1" }), /version: a whole number/u],
      [
        fileOf([{ ...SHOP, port: 70000 }]),
        /Connection 1 \(Shop\): Port: a number from 1 to 65535/u,
      ],
      [fileOf([{ ...SHOP, readOnly: "yes" }]), /Connection 1 \(Shop\): readOnly: true or false/u],
      [
        fileOf([{ ...SHOP, password: "p" }]),
        /Connection 1 \(Shop\): password: a connections file carries no passwords/u,
      ],
      [fileOf([{ ...SHOP, engine: "oracle" }]), /Connection 1 \(Shop\): Engine:/u],
      [
        fileOf([NOTES, { ...SHOP, id: NOTES.id }]),
        /Connection 2 \(Shop\): id: c-lite is in the file twice/u,
      ],
      [
        fileOf([NOTES, { ...SHOP, name: "notes" }]),
        /Connection 2 \(notes\): Name: "notes" is in the file twice/u,
      ],
      [fileOf([{ ...SHOP, id: "Not An Id" }]), /Connection 1 \(Shop\): id: lowercase letters/u],
      [fileOf([]), /holds no connections/u],
      [fileOf([SHOP], { padding: "x".repeat(MAX_BYTES) }), /KiB at most/u],
    ];
    for (const [text, why] of cases) {
      const f = await mounted({
        connections: [NOTES],
        files: { "~/in.json": text },
        open: "~/in.json",
        answer: tickAsShown,
      });
      await expect(f.m.host.command("endue.database.import-connections")).rejects.toThrow(why);
      expect(f.m.view.said.at(-1), text.slice(0, 40)).toMatch(/^in\.json /u);
      expect(f.shown).toEqual([]);
      expect(f.stored()).toEqual([NOTES]);
    }
  });
});
