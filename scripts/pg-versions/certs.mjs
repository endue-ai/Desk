// The TLS files of the matrix's certificate variant (PG-101): a CA made for this run, a server
// certificate for 127.0.0.1 and a client certificate whose CN is the role pg_hba's `cert` rule
// lets in, all from the machine's openssl, valid two days and removed with the run's folder. The
// client's copies (CA, certificate, key) and the server's (CA, certificate, key) go in folders of
// their own, so the server's key never sits beside what the client reads.
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./server.mjs";

/** The extensions each certificate needs: verifiers refuse a CA without CA:TRUE, a host without a SAN. */
export const EXTENSIONS = `[req]
distinguished_name = dn
[dn]
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1, DNS:localhost
[client]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
`;

/** Why the certificate variant cannot run here ("" when it can): no openssl on the path. */
export function opensslMissing(openssl = "openssl") {
  const done = spawnSync(openssl, ["version"], { encoding: "utf8" });
  return done.error || done.status !== 0 ? "openssl is not installed" : "";
}

/** Make the files under `dir`; answers `{ serverDir, clientDir }`. */
export function makeCerts(dir, clientRole, openssl = "openssl") {
  const work = join(dir, "work");
  const serverDir = join(dir, "server");
  const clientDir = join(dir, "client");
  for (const folder of [work, serverDir, clientDir]) mkdirSync(folder, { recursive: true });
  const cnf = join(work, "openssl.cnf");
  writeFileSync(cnf, EXTENSIONS);
  const at = (file) => join(work, file);
  const ssl = (...args) => run(openssl, args);
  const key = (file) => ssl("genrsa", "-out", at(file), "2048");

  key("ca.key");
  ssl(...caArgs(cnf, at));
  for (const [name, cn] of [
    ["server", "127.0.0.1"],
    ["client", clientRole],
  ]) {
    key(`${name}.key`);
    ssl(...csrArgs(cnf, at, name, cn));
    ssl(...signArgs(cnf, at, name));
  }
  // PKCS#8, which every client reads; genrsa may write PKCS#1.
  ssl("pkcs8", "-topk8", "-nocrypt", "-in", at("client.key"), "-out", at("client.p8"));

  copyFileSync(at("ca.crt"), join(serverDir, "ca.crt"));
  copyFileSync(at("server.crt"), join(serverDir, "server.crt"));
  copyFileSync(at("server.key"), join(serverDir, "server.key"));
  copyFileSync(at("ca.crt"), join(clientDir, "ca.crt"));
  copyFileSync(at("client.crt"), join(clientDir, "client.crt"));
  copyFileSync(at("client.p8"), join(clientDir, "client.key"));
  // libpq refuses a key others may read.
  chmodSync(join(clientDir, "client.key"), 0o600);
  return { serverDir, clientDir };
}

const caArgs = (cnf, at) => [
  "req",
  "-config",
  cnf,
  "-new",
  "-x509",
  "-days",
  "2",
  "-key",
  at("ca.key"),
  "-subj",
  "/CN=desk pg-versions test CA",
  "-extensions",
  "ca",
  "-out",
  at("ca.crt"),
];

const csrArgs = (cnf, at, name, cn) => [
  "req",
  "-config",
  cnf,
  "-new",
  "-key",
  at(`${name}.key`),
  "-subj",
  `/CN=${cn}`,
  "-out",
  at(`${name}.csr`),
];

const signArgs = (cnf, at, name) => [
  "x509",
  "-req",
  "-days",
  "2",
  "-in",
  at(`${name}.csr`),
  "-CA",
  at("ca.crt"),
  "-CAkey",
  at("ca.key"),
  "-set_serial",
  String(Date.now() + (name === "server" ? 1 : 2)),
  "-extfile",
  cnf,
  "-extensions",
  name,
  "-out",
  at(`${name}.crt`),
];
