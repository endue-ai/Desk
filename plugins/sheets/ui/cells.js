// Compact cell records: shared formatting metadata is interned once, numbers stay binary and
// display strings equal to the value are not duplicated. No SheetJS object graph crosses threads.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function cellWriter() {
  let data = new Uint8Array(65536);
  let view = new DataView(data.buffer);
  let used = 0;
  const metadata = [];
  const ids = new Map();
  const reserve = (n) => {
    if (used + n <= data.length) return;
    const next = new Uint8Array(Math.max(data.length * 2, used + n));
    next.set(data);
    data = next;
    view = new DataView(data.buffer);
  };
  const byte = (n) => {
    reserve(1);
    data[used++] = n;
  };
  const string = (text) => {
    const bytes = encoder.encode(text);
    reserve(4 + bytes.length);
    view.setUint32(used, bytes.length, true);
    used += 4;
    data.set(bytes, used);
    used += bytes.length;
  };
  const value = (val) => {
    if (typeof val === "number") {
      byte(1);
      reserve(8);
      view.setFloat64(used, val, true);
      used += 8;
    } else if (typeof val === "string") {
      byte(2);
      string(val);
    } else if (val === true || val === false) byte(val ? 3 : 4);
    else if (val === null) byte(5);
    else {
      byte(6);
      string(JSON.stringify(val));
    }
  };
  return {
    get length() {
      return used;
    },
    finish: () => ({ data: data.subarray(0, used), metadata }),
    write(cell, style, text) {
      // Only the declared cell model crosses the boundary. SheetJS's rich-text HTML, shared
      // string XML and fill objects are parser internals, not cell data the grid consumes.
      const rest = cell ? { t: cell.t, ...(cell.z !== undefined ? { z: cell.z } : {}) } : null;
      const key = JSON.stringify([rest, style]);
      let id = ids.get(key);
      if (id === undefined) {
        id = metadata.length;
        ids.set(key, id);
        metadata.push([rest, style]);
      }
      const hasValue = cell?.v !== undefined;
      const hasText = typeof cell?.w === "string";
      const repeat = hasText && cell.w === String(cell.v);
      const formula = typeof cell?.f === "string";
      const display = cell && !hasText;
      byte(
        Number(hasValue) |
          (hasText && !repeat ? 2 : 0) |
          (formula ? 4 : 0) |
          (display ? 8 : 0) |
          (repeat ? 16 : 0),
      );
      if (hasValue) value(cell.v);
      if (hasText && !repeat) string(cell.w);
      if (formula) string(cell.f);
      if (display) string(text);
      return id;
    },
  };
}

/** Decode one requested cell. The rest of the sheet remains encoded. */
export function readCell(data, at, metadata) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const flags = data[at++];
  const string = () => {
    const length = view.getUint32(at, true);
    at += 4;
    const text = decoder.decode(data.subarray(at, at + length));
    at += length;
    return text;
  };
  const value = () => {
    const kind = data[at++];
    if (kind === 1) {
      const n = view.getFloat64(at, true);
      at += 8;
      return n;
    }
    if (kind === 2) return string();
    if (kind === 3 || kind === 4) return kind === 3;
    if (kind === 5) return null;
    return JSON.parse(string());
  };
  const cell = metadata[0] ? { ...metadata[0] } : undefined;
  if (cell) {
    if (flags & 1) cell.v = value();
    if (flags & 2) cell.w = string();
    if (flags & 16) cell.w = String(cell.v);
    if (flags & 4) cell.f = string();
  }
  return [cell, metadata[1] ?? undefined, flags & 8 ? string() : undefined];
}
