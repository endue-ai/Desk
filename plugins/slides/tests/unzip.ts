// Reads one entry of a ZIP the test writer made (stored or deflated), for tests that rework a fixture.
import { inflateRawSync } from "node:zlib";

export async function zipText(bytes: Uint8Array, name: string): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extra = view.getUint16(at + 28, true);
    const entry = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extra;
    const data = bytes.subarray(start, start + size);
    if (entry === name) return new TextDecoder().decode(method === 8 ? inflateRawSync(data) : data);
    at = start + size;
  }
  throw new Error(`no ${name}`);
}
