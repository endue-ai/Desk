// Completion's feature (PG-31, ADR 0327) mounted beside the others: a PostgreSQL console completes
// in the parse worker over its schema cache (a join from the shop's foreign key), asking the server
// nothing; picks are kept in the plugin's store and rank what they picked; the person's snippets
// come from the setting; a SQLite console completes on the page from the catalog; the commands say
// when the editor has nothing to show. The worker's service runs in this thread.
import { beforeAll, describe, expect, it } from "vitest";
import type { Node } from "../ui/explorer.js";
import { PICKS_KEY } from "../ui/features/completion/picks.js";
import { provideSqlParser } from "../ui/sql/parse/client.js";
import { createService } from "../ui/sql/parse/worker.js";
import { type Mounted, mount, SAVED } from "./harness";
import { catalogScript, shop } from "./pg-catalog";
import { loadRaw } from "./problems-fixture";

type Item = { label: string; kind: string; insert: string; key: string };
type Found = { items: Item[]; from: number; to: number };

beforeAll(async () => {
  const raw = await loadRaw();
  provideSqlParser(() => {
    const service = createService(raw);
    const worker = {
      onmessage: null as ((event: { data: unknown }) => void) | null,
      onerror: null,
      postMessage(message: Parameters<typeof service.answer>[0]) {
        const sent = structuredClone(message);
        setTimeout(() => {
          const reply = service.answer(sent);
          if (reply) worker.onmessage?.({ data: structuredClone(reply) });
        });
      },
      terminate: () => {},
    };
    return worker as unknown as Worker;
  });
});

const complete = (m: Mounted, text: string, offset = 0) =>
  (m.app as unknown as { complete(...args: unknown[]): Promise<Found | undefined> }).complete(
    text.replace("|", ""),
    text.indexOf("|"),
    offset,
  );
const picked = (m: Mounted, key: string) =>
  (m.app as unknown as { picked(key: string): Promise<void> }).picked(key);
const row = (m: Mounted, label: string) => m.view.trees.at(-1)?.find((r) => r.label === label);
async function until(m: Mounted, test: () => unknown) {
  for (let i = 0; i < 60 && !test(); i++) await m.settle();
  expect(test()).toBeTruthy();
}

async function shopConsole(settings: Record<string, unknown> = {}) {
  const m = await mount({
    store: { connections: SAVED },
    script: catalogScript(() => shop()),
    settings,
  });
  await m.host.command("endue.database.console", { connection: "Shop" });
  await until(m, () => row(m, "Shop"));
  m.app.toggle(row(m, "Shop") as Node, true);
  await until(m, () => row(m, "public"));
  m.app.toggle(row(m, "public") as Node, true);
  await m.settle();
  return m;
}

describe("completion's feature", () => {
  it("a PostgreSQL console completes in the parse worker over its schema cache, asking the server nothing", async () => {
    const m = await shopConsole();
    const ran = () => m.sessions().flat().length;
    const before = { ran: ran(), spawned: m.clients.spawned.length };
    const found = await complete(m, "select * from people p join |");
    expect(found?.items[0]).toMatchObject({
      kind: "join",
      insert: "orders on orders.person = p.id",
    });
    const columns = await complete(m, "select o.| from orders o");
    expect(columns?.items.map((i) => i.label)).toContain("person");
    for (let i = 0; i < 20; i++) await complete(m, "select p.na| from people p");
    expect({ ran: ran(), spawned: m.clients.spawned.length }).toEqual(before);
  });

  it("a pick is kept in the plugin's store and ranks first among equals next time", async () => {
    const m = await shopConsole();
    const first = (await complete(m, "select | from people"))?.items[0];
    expect(first?.kind).toBe("column");
    await picked(m, "column:name");
    expect(m.store[PICKS_KEY]).toEqual({ "column:name": [1, expect.any(Number)] });
    expect((await complete(m, "select | from people"))?.items[0]?.label).toBe("name");
  });

  it("the person's snippets come from the setting", async () => {
    const m = await shopConsole({ snippets: { top: "SELECT * FROM ${table} LIMIT ${n}" } });
    const found = await complete(m, "to|");
    expect(found?.items.find((i) => i.kind === "snippet")).toMatchObject({
      label: "top",
      insert: "SELECT * FROM ${table} LIMIT ${n}",
    });
  });

  it("a SQLite console completes on the page from the catalog", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await m.host.command("endue.database.console", { connection: "Notes" });
    const found = await complete(m, "sel|");
    expect(found?.items.map((i) => i.label)).toContain("SELECT");
    expect(found?.items.some((i) => i.label === "sel" && i.kind === "snippet")).toBe(true);
  });

  it("the commands say when there is no call or star at the caret", async () => {
    const m = await mount({ store: { connections: SAVED } });
    await m.host.command("endue.database.signatures");
    await m.host.command("endue.database.expand-star");
    expect(m.view.said).toEqual([
      "Put the caret inside a function's parentheses to see its arguments.",
      "Put the caret after a * in a select list to write out its columns.",
    ]);
  });
});
