// Completion and the db:connect question (PG-01g, ADR 0335): while the plugin holds no grant for a
// PostgreSQL connection's server, completing at the caret reads nothing of the catalog (no schemas,
// objects or columns, so no db.open and no question) and offers what is cached already; once the
// grant is held it reads as before. Whether it is held is asked with perm.query, which asks nothing.
import { describe, expect, it } from "vitest";
import { createCompletion } from "../ui/features/completion/controller.js";
import { PG } from "./session-helpers";

type Call = { method: string; params?: unknown };

function completing(granted: boolean, conn = PG) {
  const calls: Call[] = [];
  const reads: string[] = [];
  const bridge = {
    async call(method: string, params?: unknown) {
      calls.push({ method, params });
      if (method === "perm.query") return { grants: granted ? [params] : [] };
      if (method === "store.get") return { value: null };
      return {};
    },
  };
  const read = (what: string) => async () => void reads.push(what);
  const catalog = {
    snapshot: () => ({
      defaultSchema: "public",
      schemas: () => ["public"],
      tables: (schema: string) => (schema === "public" ? [{ name: "orders", type: "table" }] : []),
      columns: () => undefined,
      types: () => [],
    }),
    schemas: read("schemas"),
    objects: read("objects"),
    columns: read("columns"),
    cache: { view: () => undefined },
  };
  const { complete } = createCompletion(
    {
      consoles: { current: () => ({ id: "k1", connection: conn.id }) },
      manager: { get: () => conn },
      catalog,
      settings: () => ({ snippets: [] }),
      bridge,
    } as never,
    () => null as never,
  );
  return { complete, calls, reads };
}

const labels = (found: unknown) =>
  ((found as { items?: { label: string }[] } | undefined)?.items ?? []).map((i) => i.label);

describe("completion and the db:connect question (PG-01g)", () => {
  it("without the grant, typing reads nothing of the server and completes from the cache", async () => {
    const t = completing(false);
    const typed = "select * from or";
    const found = await t.complete(typed, typed.length);
    expect(t.reads).toEqual([]);
    expect(t.calls.map((c) => c.method)).not.toContain("perm.request");
    expect(t.calls.filter((c) => c.method === "perm.query")).toHaveLength(1);
    expect(labels(found)).toContain("orders");
  });

  it("with the grant, it reads the catalog as before", async () => {
    const t = completing(true);
    await t.complete("select * from or", 16);
    expect(t.reads).toEqual(expect.arrayContaining(["schemas", "objects"]));
    expect(t.calls.map((c) => c.method)).not.toContain("perm.request");
  });

  it("a connection another engine runs needs no grant and asks nothing", async () => {
    const t = completing(false, { ...PG, id: "c-lite", engine: "sqlite", path: "/x.db" } as never);
    await t.complete("select * from or", 16);
    expect(t.reads).toContain("schemas");
    expect(t.calls.map((c) => c.method)).not.toContain("perm.query");
  });
});
