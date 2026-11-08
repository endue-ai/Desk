// Obfuscated OpenType fonts in XPS (.odttf): the first 32 bytes are XORed with the bytes of the GUID
// in the font's part name, last byte first (ECMA-388, 9.1.7.3). Undoing it gives the font back.

/**
 * @param {Uint8Array} bytes The obfuscated font.
 * @param {string} name The part name, e.g. /Resources/Fonts/0B1A2C3D-....odttf.
 * @returns {Uint8Array}
 */
export function deobfuscate(bytes, name) {
  const base = name.slice(name.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
  const hex = base.replace(/[^0-9a-f]/gi, "");
  if (hex.length !== 32 || bytes.length < 32) return bytes;
  const key = Array.from({ length: 16 }, (_, i) =>
    Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16),
  );
  const out = bytes.slice();
  for (let i = 0; i < 16; i++) {
    out[i] = (out[i] ?? 0) ^ (key[15 - i] ?? 0);
    out[i + 16] = (out[i + 16] ?? 0) ^ (key[15 - i] ?? 0);
  }
  return out;
}
