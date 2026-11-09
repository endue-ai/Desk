// Bytes to base64 and back, as net.send and net.data carry them. No DOM. The engine's own
// Uint8Array.toBase64 and fromBase64 when it has them; else btoa and atob over 32 KiB slices, so a
// large screen update never builds one huge argument list.

const SLICE = 0x8000;

/** @param {Uint8Array} bytes */
export function toBase64(bytes) {
  const own = /** @type {{ toBase64?: () => string }} */ (/** @type {unknown} */ (bytes));
  if (typeof own.toBase64 === "function") return own.toBase64();
  let text = "";
  for (let at = 0; at < bytes.length; at += SLICE) {
    text += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  }
  return btoa(text);
}

/** @param {string} text */
export function fromBase64(text) {
  const from = /** @type {{ fromBase64?: (text: string) => Uint8Array }} */ (
    /** @type {unknown} */ (Uint8Array)
  );
  if (typeof from.fromBase64 === "function") return from.fromBase64(text);
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** One array from several, in order. @param {Uint8Array[]} parts */
export function concat(parts) {
  if (parts.length === 1) return /** @type {Uint8Array} */ (parts[0]);
  const out = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
