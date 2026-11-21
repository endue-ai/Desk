// The DDL of PG-50's kinds (ui/schema/pg/), from catalog rows in PostgreSQL 17's shapes (the shop
// fixture): one statement per object and its comment after it, every name it builds quoted (what a
// pg_get_*def gives is kept as the server wrote it), the owner named on the first line, and no
// secret: a server's hidden options, a user mapping's options and a subscription's connection
// string are never in it. The live test (pg-kinds-live.test.ts) applies each one on a real server.
import { describe, expect, it } from "vitest";
import type { Part, SchemaObject } from "../ui/schema/common.js";
import { DATABASE, ddl, ddlQueries, lookupOf } from "../ui/schema/pg/index.js";
import { shopKinds } from "./pg-kinds-fixture";
import { shopLevel } from "./pg-level-fixture";

const schema = lookupOf(shopKinds() as never, "public");
const level = lookupOf((shopLevel().rows ?? {}) as never, DATABASE);
const object = (kind: string, name: string): SchemaObject => {
  const found = [...schema.objects, ...level.objects].find(
    (o) => o.kind === kind && o.name === name,
  );
  if (!found) throw new Error(`no ${kind} ${name}`);
  return found;
};
const part = (table: string, name: string): Part => {
  const found = (schema.parts.get(table) ?? []).find((p) => p.name === name);
  if (!found) throw new Error(`no part ${table}.${name}`);
  return found;
};
const shown = (o: SchemaObject | Part, results: (string | null)[][][] = []) =>
  ddl(o, results) ?? "";
const changed = (o: SchemaObject, def: Record<string, unknown>) => ({
  ...o,
  def: { ...o.def, ...def },
});

describe("the DDL of PostgreSQL's other kinds", () => {
  it("an enum type", () => {
    expect(shown(object("type", "mood"))).toBe(
      "-- Owner: app\n" +
        `CREATE TYPE "public"."mood" AS ENUM (\n    'sad',\n    'ok',\n    'so so'\n);\n` +
        `COMMENT ON TYPE "public"."mood" IS 'How it went';\n`,
    );
  });

  it("a composite type", () => {
    expect(shown(object("type", "pair"))).toBe(
      "-- Owner: app\n" +
        `CREATE TYPE "public"."pair" AS (\n    "x" integer,\n    "Y z" text COLLATE "C"\n);\n`,
    );
  });

  it("a domain", () => {
    expect(object("type", "positive").detail).toBe("domain of numeric(10,2)");
    expect(shown(object("type", "positive"))).toBe(
      "-- Owner: app\n" +
        `CREATE DOMAIN "public"."positive" AS numeric(10,2)\n    DEFAULT 1\n    NOT NULL\n` +
        `    CONSTRAINT "positive_check" CHECK (VALUE > 0::numeric);\n`,
    );
  });

  it("a range type", () => {
    expect(shown(object("type", "span"))).toBe(
      "-- Owner: app\n" +
        `CREATE TYPE "public"."span" AS RANGE (\n    SUBTYPE = integer,\n` +
        `    MULTIRANGE_TYPE_NAME = "public"."span_multirange"\n);\n`,
    );
  });

  it("a base type", () => {
    const four = object("type", "four");
    const queries = ddlQueries(four) ?? [];
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/pg_get_functiondef\(p\.oid\).*t\.oid = 16409::oid/su);
    const fn = (name: string, arg: string, result: string, symbol: string) =>
      `CREATE OR REPLACE FUNCTION public.${name}(${arg})\n RETURNS ${result}\n LANGUAGE internal\n IMMUTABLE STRICT\nAS $function$${symbol}$function$\n`;
    const results = [
      [
        [fn("four_in", "cstring", "four", "int4in")],
        [fn("four_out", "four", "cstring", "int4out")],
      ],
    ];
    expect(shown(four, results)).toBe(
      "-- Owner: app\n" +
        `CREATE TYPE "public"."four";\n` +
        `${fn("four_in", "cstring", "four", "int4in").trimEnd()};\n` +
        `${fn("four_out", "four", "cstring", "int4out").trimEnd()};\n` +
        `CREATE TYPE "public"."four" (\n    INPUT = four_in,\n    OUTPUT = four_out,\n` +
        "    INTERNALLENGTH = 4,\n    PASSEDBYVALUE,\n    ALIGNMENT = int4,\n    STORAGE = plain\n);\n",
    );
  });

  it("an aggregate", () => {
    expect(shown(object("aggregate", "total(integer)"))).toBe(
      "-- Owner: app\n" +
        `CREATE AGGREGATE "public"."total"(integer) (\n    SFUNC = add_int,\n    STYPE = integer,\n` +
        "    INITCOND = '0'\n);\n" +
        `COMMENT ON AGGREGATE "public"."total"(integer) IS 'Sums';\n`,
    );
  });

  it("an operator", () => {
    expect(shown(object("operator", "###(integer, integer)"))).toBe(
      "-- Owner: app\n" +
        `CREATE OPERATOR "public".### (\n    FUNCTION = add_int,\n    LEFTARG = integer,\n` +
        `    RIGHTARG = integer,\n    COMMUTATOR = OPERATOR("public".###)\n);\n`,
    );
  });

  it("a collation", () => {
    expect(shown(object("collation", "plain"))).toBe(
      `-- Owner: app\nCREATE COLLATION "public"."plain" (provider = libc, locale = 'C');\n`,
    );
  });

  it("a text search configuration", () => {
    expect(shown(object("text search configuration", "words"))).toBe(
      "-- Owner: app\n" +
        `CREATE TEXT SEARCH CONFIGURATION "public"."words" (PARSER = "pg_catalog"."default");\n` +
        `ALTER TEXT SEARCH CONFIGURATION "public"."words"\n    ADD MAPPING FOR asciiword, word WITH english_stem;\n` +
        `ALTER TEXT SEARCH CONFIGURATION "public"."words"\n    ADD MAPPING FOR email WITH simple;\n`,
    );
  });

  it("a partition", () => {
    expect(part("events", "events_2026").detail).toBe(
      "FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') · partitioned",
    );
    expect(shown(part("events", "events_2026"))).toBe(
      `CREATE TABLE "public"."events_2026" PARTITION OF "public"."events"\n` +
        "    FOR VALUES FROM ('2026-01-01') TO ('2027-01-01') PARTITION BY LIST (id);\n",
    );
    // A partition of a partition is listed under the root, and says whose it is.
    expect(part("events", "events_2026_one").detail).toBe("FOR VALUES IN (1) · of events_2026");
    expect(shown(part("events", "events_2026_one"))).toBe(
      `CREATE TABLE "public"."events_2026_one" PARTITION OF "public"."events_2026"\n    FOR VALUES IN (1);\n`,
    );
    expect(shown(part("events", "events_rest"))).toMatch(
      /PARTITION OF "public"."events"\n {4}DEFAULT;\n$/u,
    );
  });

  it("a parent it inherits from", () => {
    expect(shown(part("people_archive", "people"))).toBe(
      `ALTER TABLE "public"."people_archive" INHERIT "public"."people";\n`,
    );
  });

  it("a policy", () => {
    const policy = part("people", "own_rows");
    expect(shown(policy)).toBe(
      `CREATE POLICY "own_rows" ON "public"."people"\n    AS PERMISSIVE\n    FOR SELECT\n` +
        `    TO "app"\n    USING ((id > 0));\n`,
    );
    const open = {
      ...policy,
      def: {
        ...policy.def,
        roles: [null],
        permissive: false,
        cmd: "w",
        using: null,
        check: "(id > 0)",
        comment: "Mine",
      },
    };
    expect(shown(open)).toBe(
      `CREATE POLICY "own_rows" ON "public"."people"\n    AS RESTRICTIVE\n    FOR UPDATE\n` +
        `    TO PUBLIC\n    WITH CHECK ((id > 0));\n` +
        `COMMENT ON POLICY "own_rows" ON "public"."people" IS 'Mine';\n`,
    );
  });

  it("a rule", () => {
    expect(shown(part("people", "no_delete"))).toBe(
      "CREATE RULE no_delete AS\n    ON DELETE TO people DO INSTEAD NOTHING;\n",
    );
  });

  it("an extension and what it owns", () => {
    const plpgsql = object("extension", "plpgsql");
    expect(plpgsql.detail).toBe("1.0 · 2 objects");
    expect(shown(plpgsql)).toBe(
      "-- Owner: app\n" +
        `CREATE EXTENSION IF NOT EXISTS "plpgsql" WITH SCHEMA "pg_catalog" VERSION '1.0';\n` +
        "-- It owns:\n--   language plpgsql\n--   function plpgsql_call_handler()\n" +
        `COMMENT ON EXTENSION "plpgsql" IS 'PL/pgSQL procedural language';\n`,
    );
  });

  it("a foreign data wrapper, a server and a user mapping", () => {
    expect(shown(object("foreign data wrapper", "files"))).toBe(
      `-- Owner: app\nCREATE FOREIGN DATA WRAPPER "files";\n`,
    );
    expect(shown(object("foreign server", "archive"))).toBe(
      "-- Owner: app\n-- 1 option is not shown: it may hold a secret.\n" +
        `CREATE SERVER "archive" FOREIGN DATA WRAPPER "files" OPTIONS ("host" 'archive');\n`,
    );
    expect(shown(object("user mapping", "app @ archive"))).toBe(
      "-- Its options are never read: they may hold a password.\n" +
        `CREATE USER MAPPING FOR "app" SERVER "archive";\n`,
    );
  });

  it("a publication", () => {
    const pub = object("publication", "shop_pub");
    expect(pub.detail).toBe("1 table");
    expect(shown(pub)).toBe(
      "-- Owner: app\n" +
        `CREATE PUBLICATION "shop_pub" FOR TABLE ONLY "public"."people"\n    WITH (publish = 'insert, update');\n`,
    );
    const wide = changed(pub, {
      tables: [
        { schema: "public", table: "orders", columns: ["id", "total"], where: "(total > 0)" },
      ],
      schemas: ["sales"],
      delete: true,
      viaRoot: true,
    });
    expect(shown(wide)).toBe(
      "-- Owner: app\n" +
        `CREATE PUBLICATION "shop_pub" FOR TABLE ONLY "public"."orders" ("id", "total") WHERE ((total > 0)),\n` +
        `    TABLES IN SCHEMA "sales"\n` +
        "    WITH (publish = 'insert, update, delete', publish_via_partition_root = true);\n",
    );
  });

  it("a subscription", () => {
    const sub = object("subscription", "shop_sub");
    expect(shown(sub)).toBe(
      "-- Owner: app\n" +
        "-- The connection string is never read: it may hold a password. Set it with ALTER\n" +
        "-- SUBSCRIPTION ... CONNECTION.\n" +
        `CREATE SUBSCRIPTION "shop_sub" CONNECTION '' PUBLICATION "shop_pub"\n` +
        "    WITH (connect = false, slot_name = NONE);\n",
    );
    const running = changed(sub, {
      enabled: true,
      slot: "shop_slot",
      binary: true,
      streaming: "p",
      origin: "none",
      failover: true,
    });
    expect(shown(running)).toBe(
      "-- Owner: app\n" +
        "-- The connection string is never read: it may hold a password. Set it with ALTER\n" +
        "-- SUBSCRIPTION ... CONNECTION, then ENABLE it.\n" +
        `CREATE SUBSCRIPTION "shop_sub" CONNECTION '' PUBLICATION "shop_pub"\n` +
        "    WITH (connect = false, slot_name = 'shop_slot', binary = true, streaming = parallel, " +
        "origin = 'none', failover = true);\n",
    );
  });

  it("an event trigger", () => {
    const trigger = object("event trigger", "audit_ddl");
    expect(shown(trigger)).toBe(
      "-- Owner: app\n" +
        `CREATE EVENT TRIGGER "audit_ddl" ON ddl_command_end\n    WHEN TAG IN ('CREATE TABLE')\n` +
        "    EXECUTE FUNCTION audit();\n",
    );
    expect(shown(changed(trigger, { enabled: "D", tags: null }))).toBe(
      "-- Owner: app\n" +
        `CREATE EVENT TRIGGER "audit_ddl" ON ddl_command_end\n    EXECUTE FUNCTION audit();\n` +
        `ALTER EVENT TRIGGER "audit_ddl" DISABLE;\n`,
    );
  });

  it("a cast", () => {
    const cast = object("cast", "pair AS text");
    expect(shown(cast)).toBe("CREATE CAST (pair AS text) WITH INOUT AS ASSIGNMENT;\n");
    expect(
      shown(changed(cast, { method: "f", function: "public.pair_text(pair)", context: "i" })),
    ).toBe("CREATE CAST (pair AS text) WITH FUNCTION public.pair_text(pair) AS IMPLICIT;\n");
  });

  it("a language", () => {
    expect(shown(object("language", "plsample"))).toBe(
      `-- Owner: app\nCREATE OR REPLACE LANGUAGE "plsample"\n    HANDLER plpgsql_call_handler;\n`,
    );
  });

  it("a role", () => {
    const app = object("role", "app");
    expect(shown(app)).toBe(
      `CREATE ROLE "app" WITH NOSUPERUSER INHERIT NOCREATEROLE NOCREATEDB LOGIN NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;\n` +
        `GRANT "reader" TO "app";\n` +
        `COMMENT ON ROLE "app" IS 'The shop';\n`,
    );
    const admin = changed(app, { inherit: false, in: [["reader", true, "true", "false"]] });
    expect(shown(admin)).toMatch(
      /\nGRANT "reader" TO "app" WITH ADMIN TRUE, INHERIT TRUE, SET FALSE;\n/u,
    );
    // Before PostgreSQL 16 a membership has no options but ADMIN.
    expect(shown(changed(app, { in: [["reader", true, null, null]] }))).toMatch(
      /\nGRANT "reader" TO "app" WITH ADMIN OPTION;\n/u,
    );
    expect(JSON.stringify(level.objects)).not.toMatch(/password|SCRAM|md5[0-9a-f]{32}/iu);
  });

  it("a tablespace", () => {
    const fast = object("tablespace", "fast");
    expect(shown(fast)).toBe(
      "-- Owner: app\n" +
        `CREATE TABLESPACE "fast" LOCATION '/srv/fast' WITH ("random_page_cost" = '1.1');\n`,
    );
    expect(shown(changed(fast, { location: "pg_tblspc/16442", options: null }))).toBe(
      "-- Owner: app\n-- In place: SET allow_in_place_tablespaces = on first.\n" +
        `CREATE TABLESPACE "fast" LOCATION '';\n`,
    );
  });
});
