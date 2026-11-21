// The overview's SQL for each server (ui/features/overview/sections.js): the columns each version
// of the statistics views has, a standby's own lag, pg_stat_statements read from where it was
// created, every statement a read, and how the extension is enabled when it is not there.
import { describe, expect, it } from "vitest";
import { serverOf } from "../ui/features/overview/probe.js";
import { sectionsFor } from "../ui/features/overview/sections.js";
import { classify } from "../ui/sql/classify.js";
import { split } from "../ui/sql/split.js";
import { probeAnswer, type ServerOptions } from "./overview-fixture";

const serverWith = (options: ServerOptions = {}) => serverOf(...probeAnswer(options));
const sections = (options: ServerOptions = {}) => sectionsFor(serverWith(options));
const sqlOf = (id: string, options: ServerOptions = {}) =>
  sections(options).find((s) => s.id === id)?.sql ?? "";

describe("picks each view's columns by the server's version", () => {
  it("reads checkpoints from pg_stat_bgwriter before 17 and pg_stat_checkpointer from 17", () => {
    for (const version of [13, 16] as const) {
      const sql = sqlOf("server", { version });
      expect(sql).toContain("FROM pg_stat_bgwriter");
      expect(sql).toContain("checkpoints_timed");
      expect(sql).not.toContain("pg_stat_checkpointer");
    }
    const sql = sqlOf("server", { version: 17 });
    expect(sql).toContain("FROM pg_stat_checkpointer");
    expect(sql).toMatch(/num_timed[\s\S]*num_requested/u);
    expect(sql).not.toContain("pg_stat_bgwriter");
  });

  it("adds the last scans from 16", () => {
    expect(sqlOf("unused", { version: 13 })).not.toContain("last_idx_scan");
    expect(sqlOf("seqscans", { version: 13 })).not.toContain("last_seq_scan");
    expect(sqlOf("unused", { version: 16 })).toContain("last_idx_scan");
    expect(sqlOf("seqscans", { version: 16 })).toContain("last_seq_scan");
    const unused = sections({ version: 16 }).find((s) => s.id === "unused");
    expect(unused?.columns.map((c) => c.key)).toContain("last_scan");
  });

  it("reads pg_stat_statements by its version", () => {
    const old = sqlOf("statements", { version: 13, pgss: "1.7" });
    expect(old).toContain("st.total_time");
    expect(old).toContain("st.mean_time");
    expect(old).not.toContain("exec_time");
    expect(old).not.toContain("pg_stat_statements_info");
    const v18 = sqlOf("statements", { version: 13, pgss: "1.8" });
    expect(v18).toContain("st.total_exec_time");
    expect(v18).toContain("st.mean_exec_time");
    expect(v18).not.toContain("pg_stat_statements_info");
    const now = sqlOf("statements", { pgss: "1.11" });
    expect(now).toContain("st.total_exec_time");
    expect(now).toContain('FROM "public".pg_stat_statements_info');
    expect(now).toContain("current_database()");
    expect(now).toContain("LIMIT 20");
  });

  it("reads pg_stat_statements from the schema it was created in", () => {
    const [names, values] = probeAnswer();
    values[names.indexOf("pgss_schema")] = 'mon"itor';
    const statements = sectionsFor(serverOf(names, values)).find((s) => s.id === "statements");
    expect(statements?.sql).toContain('FROM "mon""itor".pg_stat_statements st');
  });

  it("reads a standby's own lag and never the primary's WAL position", () => {
    const standby = sections({ standby: true });
    for (const section of standby) expect(section.sql ?? "").not.toContain("pg_current_wal_lsn");
    const replication = sqlOf("replication", { standby: true });
    expect(replication).toContain("pg_stat_wal_receiver");
    expect(replication).toContain("pg_last_wal_replay_lsn()");
    expect(replication).toContain("pg_last_xact_replay_timestamp()");
    expect(sqlOf("slots", { standby: true })).toContain("pg_last_wal_replay_lsn()");
    expect(sqlOf("replication")).toContain("FROM pg_stat_replication");
    expect(sqlOf("slots")).toContain("pg_current_wal_lsn()");
  });
});

describe("only reads", () => {
  const servers: ServerOptions[] = [
    { version: 13, pgss: "1.7" },
    { version: 13, pgss: "1.8" },
    { version: 16, pgss: "none" },
    { version: 17 },
    { version: 17, standby: true },
  ];
  const WRITES =
    /\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|GRANT|REVOKE|VACUUM|ANALYZE|REINDEX|COPY|CALL|LOCK)\b/iu;

  it("gives every section one statement that classifies as a read and names its statistic", () => {
    for (const options of servers) {
      const list = sections(options);
      expect(new Set(list.map((s) => s.id)).size).toBe(list.length);
      for (const section of list) {
        expect(section.title).not.toBe("");
        expect(section.source).not.toBe("");
        expect(section.columns.length).toBeGreaterThan(0);
        if (!section.sql) {
          expect(section.missing).toBeTruthy();
          continue;
        }
        const statements = split(section.sql, "postgresql");
        expect(statements, section.id).toHaveLength(1);
        const kind = classify(statements[0] as never, "postgresql");
        expect(kind.kind, section.id).toBe("read");
        expect(kind.refused).toBe("");
        expect(section.sql.replace(/'[^']*'/gu, "''"), section.id).not.toMatch(WRITES);
      }
    }
  });

  it("lists the sections in the panel's order", () => {
    expect(sections().map((s) => s.id)).toEqual([
      ...["server", "databases", "schemas", "tables", "indexes", "unused", "duplicates", "invalid"],
      ...["seqscans", "vacuum", "wraparound", "cache", "statements", "long", "replication"],
      ...["slots", "settings"],
    ]);
  });
});

describe("says how to enable pg_stat_statements", () => {
  const missing = (options: ServerOptions) => {
    const section = sections(options).find((s) => s.id === "statements");
    expect(section?.sql).toBeUndefined();
    return section?.missing ?? "";
  };

  it("names the steps for each state and never runs them", () => {
    const unavailable = missing({ pgss: "unavailable" });
    expect(unavailable).toMatch(/contrib/u);
    expect(unavailable).toMatch(/shared_preload_libraries/u);
    expect(unavailable).toMatch(/CREATE EXTENSION pg_stat_statements/u);
    const notLoaded = missing({ pgss: "none", preload: "auto_explain" });
    expect(notLoaded).toMatch(/add pg_stat_statements to shared_preload_libraries/u);
    expect(notLoaded).toMatch(/restart the server, then run CREATE EXTENSION/u);
    const loaded = missing({ pgss: "none", preload: "auto_explain, pg_stat_statements" });
    expect(loaded).toMatch(/^The server loads pg_stat_statements but it is not created/u);
    expect(loaded).not.toMatch(/restart/u);
    const hidden = missing({ pgss: "none", preload: null });
    expect(hidden).toMatch(/If the server does not load it yet/u);
    for (const text of [unavailable, notLoaded, loaded, hidden])
      expect(text).toMatch(/never installs it\.$/u);
  });
});
