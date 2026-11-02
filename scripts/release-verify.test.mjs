import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { signedVersion, verifyFile } from "./release-verify.mjs";

const SCRIPT = fileURLToPath(new URL("../e2e/smoke/verify-signature.sh", import.meta.url));
const b64 = (text) => Buffer.from(text).toString("base64");

/** A minisign key made for the test, in the encoding `tauri signer generate` writes. */
function key() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ type: "spki", format: "der" }).subarray(-32);
  const id = randomBytes(8);
  const line = Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64");
  const name = Buffer.from(id).reverse().toString("hex").toUpperCase();
  return {
    public: b64(`untrusted comment: minisign public key: ${name}\n${line}\n`),
    /** A signature as `tauri signer sign` writes it: prehashed, the version in the trusted comment. */
    sign(bytes, { version, legacy = false } = {}) {
      const covered = legacy ? bytes : createHash("blake2b512").update(bytes).digest();
      const signature = sign(null, covered, privateKey);
      const algorithm = legacy ? "Ed" : "ED";
      const trusted = `timestamp:1763629920\tfile:artifact${version ? `\tversion:${version}` : ""}`;
      const global = sign(null, Buffer.concat([signature, Buffer.from(trusted)]), privateKey);
      const sigLine = Buffer.concat([Buffer.from(algorithm), id, signature]).toString("base64");
      return b64(
        `untrusted comment: signature from tauri secret key\n${sigLine}\ntrusted comment: ${trusted}\n${global.toString("base64")}\n`,
      );
    },
  };
}

function file(bytes = "endue Desk 0.2.0 for linux-x86_64\n".repeat(500)) {
  const dir = mkdtempSync(join(tmpdir(), "release-verify-"));
  const path = join(dir, "endue-desk_0.2.0_linux-x86_64.deb");
  writeFileSync(path, bytes);
  return { dir, path };
}

const run = (args, env = {}) => {
  try {
    const out = execFileSync("bash", [SCRIPT, ...args], {
      encoding: "utf8",
      env: { ...process.env, DESK_UPDATER_PUBKEY: "", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status, out: `${error.stdout}${error.stderr}` };
  }
};

describe("release-verify", () => {
  it("a_tauri_signature_verifies_with_its_public_key", async () => {
    const signer = key();
    const { dir, path } = file();
    const bytes = readFileSync(path);
    const trusted = await verifyFile(path, signer.sign(bytes, { version: "0.2.0" }), signer.public);
    assert.match(trusted, /version:0\.2\.0/u);
    await verifyFile(path, signer.sign(bytes, { legacy: true }), signer.public);
    rmSync(dir, { recursive: true });
  });

  it("another_key_a_flipped_byte_or_a_missing_sig_is_refused", async () => {
    const signer = key();
    const { dir, path } = file();
    const bytes = readFileSync(path);
    const sig = signer.sign(bytes);
    await assert.rejects(verifyFile(path, sig, key().public), /another key/u);
    bytes[bytes.length >> 1] ^= 1;
    writeFileSync(path, bytes);
    await assert.rejects(verifyFile(path, sig, signer.public), /does not match the file/u);
    await assert.rejects(
      verifyFile(path, "bm90IGEgc2lnbmF0dXJl", signer.public),
      /not a minisign signature/u,
    );
    await assert.rejects(verifyFile(path, sig, "not base64!"), /not base64/u);
    rmSync(dir, { recursive: true });
  });

  it("the_signed_version_is_read_from_the_trusted_comment", async () => {
    const signer = key();
    const { dir, path } = file();
    const bytes = readFileSync(path);
    assert.equal(signedVersion("timestamp:1\tfile:x\tversion:0.2.1-pre.48"), "0.2.1-pre.48");
    assert.equal(signedVersion("timestamp:1\tfile:x"), undefined);
    const old = signer.sign(bytes, { version: "0.1.0" });
    await assert.rejects(
      verifyFile(path, old, signer.public, "0.2.0"),
      /signed for 0\.1\.0, not 0\.2\.0/u,
    );
    await assert.rejects(
      verifyFile(path, signer.sign(bytes), signer.public, "0.2.0"),
      /names no version/u,
    );
    rmSync(dir, { recursive: true });
  });

  it("verify_signature_sh_checks_a_deb_against_the_key_and_says_unsigned_without_one", () => {
    const signer = key();
    const { dir, path } = file();
    writeFileSync(`${path}.sig`, signer.sign(readFileSync(path), { version: "0.2.0" }));

    const signed = run([path, signer.public]);
    assert.equal(signed.code, 0, signed.out);
    assert.match(signed.out, /ok/u);
    const fromEnv = run([path], { DESK_UPDATER_PUBKEY: signer.public });
    assert.equal(fromEnv.code, 0, fromEnv.out);

    const unsigned = run([path]);
    assert.equal(unsigned.code, 0, unsigned.out);
    assert.match(unsigned.out, /unsigned build/u);

    assert.equal(run([path, key().public]).code, 1, "another key");
    const bytes = readFileSync(path);
    bytes[0] ^= 1;
    writeFileSync(path, bytes);
    assert.equal(run([path, signer.public]).code, 1, "a tampered .deb");
    rmSync(`${path}.sig`);
    assert.equal(run([path, signer.public]).code, 1, "a missing .sig");
    rmSync(dir, { recursive: true });
  });
});
