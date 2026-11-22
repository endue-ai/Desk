// A role's new password as the SCRAM-SHA-256 verifier PostgreSQL stores (PG-54, ADR 0330), made in
// the page as psql's \password makes it: SASLprep (an ASCII password as it is; otherwise spaces
// mapped, what maps to nothing dropped and NFKC, or the password as typed when that holds a
// prohibited character), PBKDF2-HMAC-SHA-256 over a random 16-byte salt, 4096 iterations, then the
// stored and the server key. The server gets only the verifier, so its logs never hold the
// password. WebCrypto only; the password is never kept.

const enc = new TextEncoder();
const ITERATIONS = 4096;

/** RFC 4013's mapping and NFKC, or the password as typed when the result is prohibited. */
export function saslPrep(/** @type {string} */ password) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII is taken as it is, as PostgreSQL does.
  if (/^[\x00-\x7f]*$/u.test(password)) return password;
  const mapped = password
    .replace(/[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000]/gu, " ")
    .replace(
      /(?:\u00ad|\u034f|\u1806|[\u180b-\u180d]|\u200c|\u200d|\u2060|[\ufe00-\ufe0f]|\ufeff)/gu,
      "",
    )
    .normalize("NFKC");
  // Controls, private use, non-characters and surrogates are prohibited: the bytes as typed go.
  const prohibited = /[\p{Cc}\p{Co}\p{Cs}\ufffe\uffff\u2028\u2029\u200e\u200f\u202a-\u202e]/u;
  return prohibited.test(mapped) ? password : mapped;
}

const b64 = (/** @type {Uint8Array} */ bytes) => btoa(String.fromCharCode(...bytes));

/**
 * The verifier `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`.
 * @param {string} password
 * @param {{ salt?: Uint8Array, subtle?: SubtleCrypto }} [options] `salt` for a test vector.
 */
export async function scramVerifier(password, options = {}) {
  const subtle = options.subtle ?? globalThis.crypto?.subtle;
  if (!subtle) throw new Error("This page cannot make a password verifier: WebCrypto is missing.");
  const salt = options.salt ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  const key = await subtle.importKey("raw", enc.encode(saslPrep(password)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const salted = await subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    key,
    256,
  );
  const hmac = await subtle.importKey("raw", salted, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const clientKey = await subtle.sign("HMAC", hmac, enc.encode("Client Key"));
  const storedKey = new Uint8Array(await subtle.digest("SHA-256", clientKey));
  const serverKey = new Uint8Array(await subtle.sign("HMAC", hmac, enc.encode("Server Key")));
  return `SCRAM-SHA-256$${ITERATIONS}:${b64(salt)}$${b64(storedKey)}:${b64(serverKey)}`;
}
