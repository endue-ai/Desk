#!/usr/bin/env node
// Check a file against its minisign signature in the Tauri updater's encoding (ADR 0054), with Node's
// own crypto, so neither the release workflows nor their tests need the minisign or tauri binaries.
// The public key and the signature are the base64 of their minisign files, as `tauri signer` writes
// them. A prehashed signature (ED, what `tauri signer sign` makes) covers the BLAKE2b-512 of the file;
// a legacy one (Ed) covers the bytes. Either way the global signature covers the signature and the
// trusted comment, which names the signed version (`version:<v>`).
//   node scripts/release-verify.mjs <file> --pubkey <base64 key> [--sig <file.sig>] [--version V]
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** The SPKI DER prefix of a raw Ed25519 public key (RFC 8410). */
const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

const fromBase64 = (text, what) => {
  const trimmed = String(text).trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(trimmed)) throw new Error(`${what} is not base64`);
  return Buffer.from(trimmed, "base64");
};

/** The lines of a minisign file wrapped in base64, as Tauri keeps them. */
const unwrap = (text, what) => fromBase64(text, what).toString("utf8").split(/\r?\n/u);

/** A Tauri public key: its key id and the Ed25519 key. */
export function publicKey(text) {
  const [comment, line] = unwrap(text, "the public key");
  const bin = line === undefined ? Buffer.alloc(0) : fromBase64(line, "the public key's key line");
  if (
    !comment?.startsWith("untrusted comment:") ||
    bin.length !== 42 ||
    bin.toString("latin1", 0, 2) !== "Ed"
  ) {
    throw new Error("the public key is not a minisign public key");
  }
  return {
    id: bin.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI, bin.subarray(10)]),
      format: "der",
      type: "spki",
    }),
  };
}

/** A Tauri signature: algorithm, key id, the signature, the trusted comment and the global signature. */
export function signature(text) {
  const [comment, line, trusted, global] = unwrap(text, "the signature");
  const bin = line === undefined ? Buffer.alloc(0) : fromBase64(line, "the signature line");
  const globalBin =
    global === undefined ? Buffer.alloc(0) : fromBase64(global, "the global signature");
  if (
    !comment?.startsWith("untrusted comment:") ||
    !trusted?.startsWith("trusted comment: ") ||
    bin.length !== 74 ||
    globalBin.length !== 64
  ) {
    throw new Error("the signature is not a minisign signature");
  }
  const algorithm = bin.toString("latin1", 0, 2);
  if (algorithm !== "ED" && algorithm !== "Ed")
    throw new Error(`unknown signature algorithm ${algorithm}`);
  return {
    prehashed: algorithm === "ED",
    id: bin.subarray(2, 10),
    signature: bin.subarray(10),
    trusted: trusted.slice("trusted comment: ".length),
    global: globalBin,
  };
}

/** The `version` field of a trusted comment: tab-separated `key:value` pairs. */
export function signedVersion(trusted) {
  return trusted
    .split("\t")
    .find((field) => field.startsWith("version:"))
    ?.slice("version:".length);
}

/** What the signature covers for `path`: the BLAKE2b-512 of the file, or the file itself. */
async function message(path, prehashed) {
  if (!prehashed) return readFileSync(path);
  const hash = createHash("blake2b512");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest();
}

/**
 * Check `path` against `sigText` made by `pubkeyText`. With `version`, the trusted comment must name
 * it, so an old artifact cannot pass for a newer one. Answers the trusted comment; throws on a mismatch.
 */
export async function verifyFile(path, sigText, pubkeyText, version) {
  const key = publicKey(pubkeyText);
  const sig = signature(sigText);
  if (!key.id.equals(sig.id)) throw new Error("the signature was made by another key");
  if (!verify(null, await message(path, sig.prehashed), key.key, sig.signature)) {
    throw new Error("the signature does not match the file");
  }
  const global = Buffer.concat([sig.signature, Buffer.from(sig.trusted, "utf8")]);
  if (!verify(null, global, key.key, sig.global)) {
    throw new Error("the trusted comment does not match the signature");
  }
  if (version !== undefined) {
    const signed = signedVersion(sig.trusted);
    if (signed !== version) {
      throw new Error(
        signed
          ? `signed for ${signed}, not ${version}`
          : `the signature names no version (${version} expected)`,
      );
    }
  }
  return sig.trusted;
}

async function main(args) {
  const [path] = args;
  const value = (name) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  const pubkey = value("--pubkey");
  if (!path || path.startsWith("--") || !pubkey) {
    throw new Error(
      "usage: release-verify.mjs <file> --pubkey <base64 key> [--sig <file.sig>] [--version V]",
    );
  }
  const sigPath = value("--sig") ?? `${path}.sig`;
  if (!existsSync(path)) throw new Error(`${path} does not exist`);
  if (!existsSync(sigPath)) throw new Error(`${path} has no signature (${sigPath})`);
  const trusted = await verifyFile(path, readFileSync(sigPath, "utf8"), pubkey, value("--version"));
  console.log(`release-verify: ${path} ok (${trusted})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`release-verify: ${error.message}`);
    process.exit(1);
  });
}
