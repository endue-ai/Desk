// The fixture data the live cases measure on, made in the database ENDUE_DB_TEST_POSTGRES names
// (a scratch one) on the desk core's sessions, and dropped after: 10,000 tables of five columns in
// `public`, every tenth with a foreign key to the one before it, and four tables of 1,000
// columns with 1,000 rows. Made in batches of their own transactions, since one transaction would lock more
// relations than the server's lock table holds.
import { server } from "./live";

export const TABLES = 10_000;
export const COLUMNS = 1_000;
const BATCH = 250;

export const tableName = (n: number) => `perf_t${String(n).padStart(5, "0")}`;

const inBatches = async (each: (from: number, to: number) => string) => {
  for (let from = 1; from <= TABLES; from += BATCH)
    await server.admin(each(from, Math.min(TABLES, from + BATCH - 1)));
};

/** The 10,000 tables, unless the last of them is there already. */
export async function seedTables() {
  const last = await server.admin(
    `SELECT count(*)::text FROM pg_class WHERE relname = '${tableName(TABLES)}'`,
  );
  if (last === "1") return;
  await dropTables();
  await inBatches(
    (from, to) => `DO $$ BEGIN FOR n IN ${from}..${to} LOOP
      EXECUTE format('CREATE TABLE %I (id int PRIMARY KEY, name text NOT NULL, email text, total numeric(10,2), ref int)', 'perf_t' || lpad(n::text, 5, '0'));
      IF n % 10 = 0 THEN
        EXECUTE format('ALTER TABLE %I ADD FOREIGN KEY (ref) REFERENCES %I (id)', 'perf_t' || lpad(n::text, 5, '0'), 'perf_t' || lpad((n - 1)::text, 5, '0'));
      END IF;
    END LOOP; END $$`,
  );
}

export const dropTables = () =>
  inBatches(
    (from, to) => `DO $$ BEGIN FOR n IN REVERSE ${to}..${from} LOOP
      EXECUTE format('DROP TABLE IF EXISTS %I CASCADE', 'perf_t' || lpad(n::text, 5, '0'));
    END LOOP; END $$`,
  );

/** Four tables of 1,000 columns and 1,000 rows, `perf_wide_1` to `perf_wide_4`. */
export async function seedWide() {
  await dropWide();
  const columns = Array.from({ length: COLUMNS }, (_, i) => `c${i + 1} text`).join(", ");
  await server.admin(`CREATE TABLE perf_wide_1 (${columns})`);
  // Short values: a row is kept on one page of the server's, 8 kB at most.
  const values = Array.from({ length: COLUMNS }, () => "g::text").join(", ");
  await server.admin(`INSERT INTO perf_wide_1 SELECT ${values} FROM generate_series(1, 1000) g`);
  for (const n of [2, 3, 4])
    await server.admin(`CREATE TABLE perf_wide_${n} AS SELECT * FROM perf_wide_1`);
}

export const dropWide = () =>
  server.admin("DROP TABLE IF EXISTS perf_wide_1, perf_wide_2, perf_wide_3, perf_wide_4");
