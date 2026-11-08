// DDL for each object kind, from the rows each engine's catalog queries answer (fixtures captured
// from PostgreSQL 17, MySQL 8.4 and SQLite 3.50), and the objects and parts the explorer lists.
import { describe, expect, it } from "vitest";
import { objectsOf, partsOf } from "../ui/schema/common.js";
import { schemaOf } from "../ui/schema/index.js";

const pg = schemaOf("postgresql");
const my = schemaOf("mysql");
const lite = schemaOf("sqlite");
const object = (kind: string, name: string, fields: Record<string, unknown> = {}) =>
  ({ schema: "shop", name, kind, detail: "", rows: null, ident: "", ...fields }) as never;

describe("PostgreSQL DDL", () => {
  const constraints = [
    [
      "foreign key",
      "orders_customer_fk",
      "FOREIGN KEY (customer_id) REFERENCES shop.customers(id) ON DELETE CASCADE",
      "shop.customers",
    ],
    ["primary key", "orders_pkey", "PRIMARY KEY (id)", ""],
    ["check", "orders_total_check", "CHECK (total >= 0::numeric)", ""],
  ];
  const indexes = [
    [
      "index",
      "orders_pkey",
      "CREATE UNIQUE INDEX orders_pkey ON shop.orders USING btree (id)",
      "constraint",
    ],
    [
      "index",
      "orders_placed_idx",
      "CREATE INDEX orders_placed_idx ON shop.orders USING btree (placed_at DESC)",
      "",
    ],
  ];
  const triggers = [
    [
      "trigger",
      "orders_touch",
      "CREATE TRIGGER orders_touch BEFORE UPDATE ON shop.orders FOR EACH ROW EXECUTE FUNCTION shop.touch()",
      "",
    ],
  ];

  it("writes a table: columns with identity, generated and defaults, keys, then indexes, triggers and comments", () => {
    const columns = [
      ["id", "bigint", "YES", null, "a", "", null],
      ["customer_id", "integer", "YES", null, "", "", null],
      ["total", "numeric(10,2)", "NO", "0", "", "", "In euros, it's gross"],
      ["net", "numeric", "NO", "(total / 1.2)", "", "s", null],
      ["placed_at", "timestamp with time zone", "YES", "now()", "", "", null],
    ];
    const meta = [["r", "p", "Every order", null, null]];
    const queries = pg.ddlQueries(object("table", "orders"));
    expect(queries).toHaveLength(5);
    expect(queries.join("\n")).toContain("n.nspname = 'shop' AND c.relname = 'orders'");
    expect(pg.ddl(object("table", "orders"), [columns, constraints, indexes, triggers, meta])).toBe(
      [
        'CREATE TABLE "shop"."orders" (',
        '    "id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL,',
        '    "customer_id" integer NOT NULL,',
        '    "total" numeric(10,2) DEFAULT 0,',
        '    "net" numeric GENERATED ALWAYS AS ((total / 1.2)) STORED,',
        '    "placed_at" timestamp with time zone DEFAULT now() NOT NULL,',
        '    CONSTRAINT "orders_pkey" PRIMARY KEY (id),',
        '    CONSTRAINT "orders_total_check" CHECK (total >= 0::numeric),',
        '    CONSTRAINT "orders_customer_fk" FOREIGN KEY (customer_id) REFERENCES shop.customers(id) ON DELETE CASCADE',
        ");",
        "",
        "CREATE INDEX orders_placed_idx ON shop.orders USING btree (placed_at DESC);",
        "",
        "CREATE TRIGGER orders_touch BEFORE UPDATE ON shop.orders FOR EACH ROW EXECUTE FUNCTION shop.touch();",
        "",
        `COMMENT ON TABLE "shop"."orders" IS 'Every order';`,
        "",
        `COMMENT ON COLUMN "shop"."orders"."total" IS 'In euros, it''s gross';`,
        "",
      ].join("\n"),
    );
  });

  it("writes views, materialized views, sequences, routines and each part of a table", () => {
    const view = [[" SELECT o.id\n   FROM shop.orders o;"]];
    expect(pg.ddl(object("view", "recent"), [view])).toBe(
      'CREATE OR REPLACE VIEW "shop"."recent" AS\nSELECT o.id\n   FROM shop.orders o;\n',
    );
    expect(pg.ddl(object("materialized view", "totals"), [view, [indexes[1] ?? []]])).toBe(
      'CREATE MATERIALIZED VIEW "shop"."totals" AS\nSELECT o.id\n   FROM shop.orders o\nWITH DATA;\n\nCREATE INDEX orders_placed_idx ON shop.orders USING btree (placed_at DESC);\n',
    );
    const sequence = [["bigint", "1", "1", "1", "9223372036854775807", "1", "NO"]];
    expect(pg.ddl(object("sequence", "order_no"), [sequence])).toBe(
      'CREATE SEQUENCE "shop"."order_no"\n    AS bigint\n    INCREMENT BY 1\n    MINVALUE 1\n    MAXVALUE 9223372036854775807\n    START WITH 1\n    CACHE 1\n    NO CYCLE;\n',
    );
    const routine = object("function", "touch()", { ident: "16404" });
    expect(pg.ddlQueries(routine)).toEqual(["SELECT pg_catalog.pg_get_functiondef(16404::oid)"]);
    expect(() => pg.ddlQueries(object("function", "x()", { ident: "1; drop" }))).toThrow();
    const def =
      "CREATE OR REPLACE FUNCTION shop.touch()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$ begin new.at := now(); return new; end $function$\n";
    expect(pg.ddl(routine, [[[def]]])).toBe(`${def.trimEnd()};\n`);
    const table = { schema: "shop", name: "orders" };
    const [fk, , check] = partsOf(constraints, table);
    expect(fk && pg.ddl(fk, [])).toBe(
      'ALTER TABLE "shop"."orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY (customer_id) REFERENCES shop.customers(id) ON DELETE CASCADE;\n',
    );
    expect(check && pg.ddl(check, [])).toMatch(/ADD CONSTRAINT "orders_total_check" CHECK/u);
    const [index] = partsOf(indexes.slice(1), table);
    expect(index && pg.ddl(index, [])).toBe(`${indexes[1]?.[2]};\n`);
  });

  it("lists a schema's objects with row estimates, and a never-analysed table without one", () => {
    const rows = [
      ["orders", "table", "partitioned", "1200", "16390"],
      ["fresh", "table", "", null, "16391"],
      ["touch()", "function", "trigger", null, "16404"],
    ];
    expect(objectsOf(rows, "shop").map((o) => [o.name, o.kind, o.rows])).toEqual([
      ["orders", "table", 1200],
      ["fresh", "table", null],
      ["touch()", "function", null],
    ]);
    expect(pg.objects("o'brien").join(" ")).toContain("n.nspname = 'o''brien'");
  });
});

describe("MySQL DDL", () => {
  it("is the server's SHOW CREATE for tables, views, routines, triggers and events", () => {
    expect(my.ddlQueries(object("table", "or`ders"))).toEqual([
      "SHOW CREATE TABLE `shop`.`or``ders`",
    ]);
    expect(my.ddlQueries(object("procedure", "refill"))).toEqual([
      "SHOW CREATE PROCEDURE `shop`.`refill`",
    ]);
    const create =
      "CREATE TABLE `orders` (\n  `id` int NOT NULL AUTO_INCREMENT,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB";
    expect(
      my.ddl(object("table", "orders"), [[["orders", create]]], [["Table", "Create Table"]]),
    ).toBe(`${create};\n`);
    const proc = "CREATE DEFINER=`root`@`%` PROCEDURE `refill`()\nBEGIN\n  SELECT 1;\nEND";
    expect(
      my.ddl(
        object("procedure", "refill"),
        [
          [
            [
              "refill",
              "STRICT_TRANS_TABLES",
              proc,
              "utf8mb4",
              "utf8mb4_0900_ai_ci",
              "utf8mb4_0900_ai_ci",
            ],
          ],
        ],
        [
          [
            "Procedure",
            "sql_mode",
            "Create Procedure",
            "character_set_client",
            "collation_connection",
            "Database Collation",
          ],
        ],
      ),
    ).toBe(`${proc};\n`);
    const trigger = object("trigger", "touch", { table: "orders", extra: "" });
    expect(
      my.ddl(
        trigger,
        [
          [
            [
              "touch",
              "",
              "CREATE TRIGGER touch BEFORE UPDATE ON orders FOR EACH ROW SET NEW.at = NOW()",
            ],
          ],
        ],
        [["Trigger", "sql_mode", "SQL Original Statement"]],
      ),
    ).toMatch(/^CREATE TRIGGER touch .*;\n$/u);
    expect(
      my.ddl(
        object("procedure", "secret"),
        [[["secret", "", null]]],
        [["Procedure", "sql_mode", "Create Procedure"]],
      ),
    ).toMatch(/privilege/u);
  });

  it("writes an index, the primary key and a foreign key from the catalog", () => {
    const table = { schema: "shop", name: "orders" };
    const [primary, unique, fk] = partsOf(
      [
        ["index", "PRIMARY", "UNIQUE (id) BTREE", ""],
        ["index", "by_customer", "UNIQUE (customer_id, placed_at) BTREE", ""],
        [
          "foreign key",
          "orders_fk",
          "(customer_id) REFERENCES customers (id) ON UPDATE RESTRICT ON DELETE CASCADE",
          "shop.customers",
        ],
      ],
      table,
    );
    expect(primary && my.ddl(primary, [])).toBe(
      "ALTER TABLE `shop`.`orders` ADD PRIMARY KEY (`id`);\n",
    );
    expect(unique && my.ddl(unique, [])).toBe(
      "CREATE UNIQUE INDEX `by_customer` ON `shop`.`orders` (`customer_id`, `placed_at`);\n",
    );
    expect(fk && my.ddl(fk, [])).toBe(
      "ALTER TABLE `shop`.`orders` ADD CONSTRAINT `orders_fk` FOREIGN KEY (`customer_id`) REFERENCES `shop`.`customers` (`id`) ON UPDATE RESTRICT ON DELETE CASCADE;\n",
    );
  });
});

describe("SQLite DDL", () => {
  it("is the CREATE text SQLite kept, a table's with its indexes and triggers", () => {
    expect(lite.ddlQueries(object("table", "it's"))[0]).toContain("tbl_name = 'it''s'");
    const rows = [
      ["CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)"],
      ["CREATE INDEX items_name ON items (name)"],
      ["CREATE TRIGGER items_log AFTER INSERT ON items BEGIN INSERT INTO log VALUES (new.id); END"],
    ];
    expect(lite.ddl(object("table", "items"), [rows])).toBe(
      [
        "CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);",
        "",
        "CREATE INDEX items_name ON items (name);",
        "",
        "CREATE TRIGGER items_log AFTER INSERT ON items BEGIN INSERT INTO log VALUES (new.id); END;",
        "",
      ].join("\n"),
    );
    const [auto, made] = partsOf(
      [
        ["unique", "sqlite_autoindex_items_1", "UNIQUE", "constraint"],
        ["index", "items_name", "CREATE INDEX items_name ON items (name)", ""],
      ],
      { schema: "main", name: "items" },
    );
    expect(made && lite.ddl(made, [])).toBe("CREATE INDEX items_name ON items (name);\n");
    expect(auto && lite.ddl(auto, [])).toMatch(/part of the table's CREATE TABLE/u);
  });
});
