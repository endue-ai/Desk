// One throwaway PostgreSQL server per major version for `just test-pg-versions` (PG-101, ADR 0351):
// the official image in a container of its own, published on a loopback port Docker picks, with a
// random password and no named volume (its anonymous one goes with it). On it three databases, one
// per variant the matrix runs: `desk_versions` as the superuser; `desk_versions_app` owned by a role
// that is not one, whose search_path starts at a schema of its own; `desk_versions_cert` that only a
// TLS session with a client certificate the matrix's own CA signed may reach (pg_hba `cert`).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

/** Every container the matrix starts carries this label: `docker ps --filter label=...` finds them. */
export const LABEL = "ai.endue.desk.test=pg-versions";
export const DATABASES = {
  main: "desk_versions",
  app: "desk_versions_app",
  cert: "desk_versions_cert",
};
export const APP_ROLE = "versions_app";
export const APP_SCHEMA = "app";
export const CERT_ROLE = "versions_cert";

/** Run a program; its trimmed standard output, or an Error with what it printed. */
export function run(program, args, options = {}) {
  const done = spawnSync(program, args, { encoding: "utf8", ...options });
  if (done.error) throw done.error;
  if (done.status !== 0) {
    const said = `${done.stderr ?? ""}${done.stdout ?? ""}`.trim();
    throw new Error(`${program} ${args.slice(0, 2).join(" ")} failed (${done.status}): ${said}`);
  }
  return (done.stdout ?? "").trim();
}

/** Why this machine cannot run the matrix ("" when it can): no Docker, or no daemon answering. */
export function runtimeMissing(docker = "docker") {
  const done = spawnSync(docker, ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8" });
  if (done.error) return `no container runtime (${docker} is not installed)`;
  if (done.status !== 0)
    return `no container runtime (${docker} answers: ${firstLine(done.stderr)})`;
  return "";
}

const firstLine = (text) =>
  String(text ?? "")
    .trim()
    .split("\n")[0] ?? "";

/** The SQL that sets up the variants' roles and databases, run as the superuser in `postgres`. */
export function setupSql(appPassword) {
  return [
    `CREATE DATABASE ${DATABASES.main}`,
    `CREATE ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${appPassword}'`,
    `CREATE DATABASE ${DATABASES.app} OWNER ${APP_ROLE}`,
    `ALTER ROLE ${APP_ROLE} IN DATABASE ${DATABASES.app} SET search_path = ${APP_SCHEMA}, public`,
    `CREATE ROLE ${CERT_ROLE} LOGIN NOSUPERUSER`,
    `CREATE DATABASE ${DATABASES.cert} OWNER ${CERT_ROLE}`,
  ];
}

/** The pg_hba lines put first: the certificate database by a verified client certificate only. */
export const HBA_FIRST = [
  `hostssl ${DATABASES.cert} all all cert`,
  `host ${DATABASES.cert} all all reject`,
];

/** Start `image` as `name`; answers the server once it takes TCP sessions. */
export function startServer({ docker = "docker", image, name, tls }) {
  const password = randomBytes(12).toString("hex");
  const appPassword = randomBytes(12).toString("hex");
  run(docker, [
    "run",
    "-d",
    "--rm",
    "--name",
    name,
    "--label",
    LABEL,
    "-e",
    `POSTGRES_PASSWORD=${password}`,
    "-p",
    "127.0.0.1::5432",
    image,
  ]);
  const server = { docker, name, image, password, appPassword, port: 0, version: "" };
  try {
    waitReady(server);
    server.port = Number(run(docker, ["port", name, "5432/tcp"]).split("\n")[0].split(":").pop());
    server.version = psql(server, "postgres", "SHOW server_version");
    psql(server, "postgres", ...setupSql(appPassword));
    psql(server, DATABASES.app, `CREATE SCHEMA ${APP_SCHEMA} AUTHORIZATION ${APP_ROLE}`);
    if (tls) enableTls(server, tls);
    return server;
  } catch (error) {
    stopServer(server);
    throw error;
  }
}

/** The entrypoint's first server listens on its socket only: ready once 127.0.0.1 answers. */
function waitReady(server, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const done = spawnSync(server.docker, [
      "exec",
      server.name,
      "pg_isready",
      "-q",
      "-h",
      "127.0.0.1",
      "-U",
      "postgres",
    ]);
    if (done.status === 0) return;
    spawnSync("sleep", ["0.5"]);
  }
  throw new Error(`${server.image} did not take sessions within ${seconds} s`);
}

/** Statements run by psql inside the container as the superuser, one -c each; the last's value. */
export function psql(server, database, ...sqls) {
  const args = ["exec", server.name, "psql", "-qAtX", "-v", "ON_ERROR_STOP=1", "-U", "postgres"];
  args.push("-d", database, ...sqls.flatMap((sql) => ["-c", sql]));
  return run(server.docker, args);
}

/** The server's key, certificate and CA copied in, ssl on, the certificate database's rules first. */
function enableTls(server, tls) {
  const { docker, name } = server;
  run(docker, ["cp", tls.serverDir, `${name}:/tmp/tls`]);
  run(docker, ["exec", "-u", "root", name, "sh", "-c", TLS_FILES]);
  const hba = psql(server, "postgres", "SHOW hba_file");
  const rules = HBA_FIRST.join("\\n");
  run(docker, ["exec", "-u", "root", name, "sh", "-c", hbaFirst(hba, rules)]);
  psql(
    server,
    "postgres",
    "ALTER SYSTEM SET ssl_cert_file = '/tmp/tls/server.crt'",
    "ALTER SYSTEM SET ssl_key_file = '/tmp/tls/server.key'",
    "ALTER SYSTEM SET ssl_ca_file = '/tmp/tls/ca.crt'",
    "ALTER SYSTEM SET ssl = on",
    "SELECT pg_reload_conf()",
  );
  // A reload that could not read the key keeps ssl off: say so here, not as a test's refusal.
  const deadline = Date.now() + 10_000;
  while (psql(server, "postgres", "SHOW ssl") !== "on") {
    if (Date.now() > deadline) throw new Error(`${server.image}: ssl did not turn on`);
    spawnSync("sleep", ["0.2"]);
  }
}

const TLS_FILES = "chown -R postgres:postgres /tmp/tls && chmod 600 /tmp/tls/server.key";
const hbaFirst = (hba, rules) =>
  `{ printf '${rules}\\n'; cat '${hba}'; } > /tmp/hba && cat /tmp/hba > '${hba}' && rm /tmp/hba`;

/** Remove the container and its anonymous volume; quiet when it is already gone. */
export function stopServer(server) {
  spawnSync(server.docker, ["rm", "-f", "-v", server.name], { stdio: "ignore" });
}

/** The URIs the variants run with (the certificate's only when `tls` gave its files). */
export function uris(server, tls) {
  const at = `127.0.0.1:${server.port}`;
  const out = {
    main: `postgresql://postgres:${server.password}@${at}/${DATABASES.main}`,
    app: `postgresql://${APP_ROLE}:${server.appPassword}@${at}/${DATABASES.app}`,
  };
  if (tls) {
    const query = new URLSearchParams({
      sslmode: "verify-full",
      sslrootcert: join(tls.clientDir, "ca.crt"),
      sslcert: join(tls.clientDir, "client.crt"),
      sslkey: join(tls.clientDir, "client.key"),
    });
    out.cert = `postgresql://${CERT_ROLE}@${at}/${DATABASES.cert}?${query}`;
  }
  return out;
}
