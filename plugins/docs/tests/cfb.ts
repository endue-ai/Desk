// A small compound file (CFB, MS-CFB version 3) writer for test fixtures: 512-byte sectors, streams
// under 4096 bytes in the mini stream as the format requires, storages from "a/b" paths. Builds
// .hwp, .wps and encrypted-package fixtures in code.

const FREE = 0xffffffff;
const END = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;
const NONE = 0xffffffff;
const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;

interface Entry {
  name: string;
  type: 1 | 2 | 5;
  data?: Uint8Array;
  children: Entry[];
  id: number;
  start: number;
}

/** The CFB order of names: shorter first, then by upper-cased UTF-16 code units. */
const order = (a: Entry, b: Entry) =>
  a.name.length - b.name.length ||
  (a.name.toUpperCase() < b.name.toUpperCase()
    ? -1
    : a.name.toUpperCase() > b.name.toUpperCase()
      ? 1
      : 0);

export function makeCfb(streams: Record<string, Uint8Array>): Uint8Array {
  const root: Entry = { name: "Root Entry", type: 5, children: [], id: 0, start: END };
  for (const [path, data] of Object.entries(streams)) {
    const parts = path.split("/");
    let at = root;
    for (const [i, name] of parts.entries()) {
      const last = i === parts.length - 1;
      let next = at.children.find((c) => c.name === name);
      if (!next) {
        next = { name, type: last ? 2 : 1, children: [], id: 0, start: END };
        at.children.push(next);
      }
      if (last) next.data = data;
      at = next;
    }
  }
  const entries: Entry[] = [];
  const visit = (entry: Entry) => {
    entry.id = entries.length;
    entries.push(entry);
    entry.children.sort(order);
    for (const child of entry.children) visit(child);
  };
  visit(root);

  // The mini stream: every small stream in 64-byte mini sectors, chained in the mini FAT.
  const miniFat: number[] = [];
  const miniParts: Uint8Array[] = [];
  for (const entry of entries) {
    const data = entry.data;
    if (entry.type !== 2 || !data || data.length >= CUTOFF) continue;
    const count = Math.ceil(data.length / MINI);
    entry.start = count === 0 ? END : miniFat.length;
    for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? END : miniFat.length + 1);
    const padded = new Uint8Array(count * MINI);
    padded.set(data);
    miniParts.push(padded);
  }
  const miniStream = join(miniParts);

  // Regular sectors: directory, mini FAT, mini stream, then each big stream.
  const dirBytes = new Uint8Array(Math.ceil(entries.length / 4) * SECTOR);
  const miniFatBytes = words(miniFat, FREE);
  const blobs: Array<{ bytes: Uint8Array; set(start: number): void }> = [
    { bytes: dirBytes, set: () => {} },
    { bytes: miniFatBytes, set: () => {} },
    { bytes: miniStream, set: (s) => (root.start = miniStream.length ? s : END) },
    ...entries
      .filter((e) => e.type === 2 && e.data && e.data.length >= CUTOFF)
      .map((e) => ({ bytes: e.data as Uint8Array, set: (s: number) => (e.start = s) })),
  ];
  const counts = blobs.map((b) => Math.ceil(b.bytes.length / SECTOR));
  const dataSectors = counts.reduce((a, b) => a + b, 0);
  let fatSectors = 1;
  while (fatSectors * (SECTOR / 4) < fatSectors + dataSectors) fatSectors++;
  if (fatSectors > 109) throw new Error("fixture too large for this writer");
  const fat: number[] = Array(fatSectors).fill(FAT_SECTOR);
  const starts: number[] = [];
  for (const count of counts) {
    starts.push(count === 0 ? END : fat.length);
    for (let i = 0; i < count; i++) fat.push(i === count - 1 ? END : fat.length + 1);
  }
  for (const [i, blob] of blobs.entries()) blob.set(starts[i] ?? END);

  for (const entry of entries) dirBytes.set(dirEntry(entry, root), entry.id * 128);

  const header = new DataView(new ArrayBuffer(SECTOR));
  for (const [i, b] of [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].entries())
    header.setUint8(i, b);
  header.setUint16(24, 0x3e, true);
  header.setUint16(26, 3, true);
  header.setUint16(28, 0xfffe, true);
  header.setUint16(30, 9, true);
  header.setUint16(32, 6, true);
  header.setUint32(44, fatSectors, true);
  header.setUint32(48, starts[0] ?? END, true);
  header.setUint32(56, CUTOFF, true);
  header.setUint32(60, miniFat.length ? (starts[1] ?? END) : END, true);
  header.setUint32(64, Math.ceil(miniFatBytes.length / SECTOR), true);
  header.setUint32(68, END, true);
  for (let i = 0; i < 109; i++) header.setUint32(76 + i * 4, i < fatSectors ? i : FREE, true);

  const sectors = [words(fat, FREE, fatSectors * SECTOR)];
  for (const blob of blobs) {
    const padded = new Uint8Array(Math.ceil(blob.bytes.length / SECTOR) * SECTOR);
    padded.set(blob.bytes);
    sectors.push(padded);
  }
  return join([new Uint8Array(header.buffer), ...sectors]);
}

function dirEntry(entry: Entry, root: Entry): Uint8Array {
  const view = new DataView(new ArrayBuffer(128));
  const name = entry.name.slice(0, 31);
  for (let i = 0; i < name.length; i++) view.setUint16(i * 2, name.charCodeAt(i), true);
  view.setUint16(64, (name.length + 1) * 2, true);
  view.setUint8(66, entry.type);
  view.setUint8(67, 1);
  view.setUint32(68, NONE, true);
  // Siblings as a right-leaning chain: a valid (if unbalanced) tree in the CFB order.
  const parent = findParent(root, entry);
  const siblings = parent?.children ?? [];
  const next = siblings[siblings.indexOf(entry) + 1];
  view.setUint32(72, next ? next.id : NONE, true);
  view.setUint32(76, entry.children[0]?.id ?? NONE, true);
  view.setUint32(116, entry.start, true);
  const size = entry.type === 5 ? undefined : entry.data?.length;
  view.setUint32(120, size ?? (entry.type === 5 ? rootSize(root) : 0), true);
  return new Uint8Array(view.buffer);
}

const rootSize = (root: Entry): number => {
  let size = 0;
  const walk = (e: Entry) => {
    if (e.type === 2 && e.data && e.data.length < CUTOFF) size += Math.ceil(e.data.length / MINI);
    e.children.forEach(walk);
  };
  walk(root);
  return size * MINI;
};

function findParent(at: Entry, entry: Entry): Entry | undefined {
  if (at.children.includes(entry)) return at;
  for (const child of at.children) {
    const found = findParent(child, entry);
    if (found) return found;
  }
  return undefined;
}

function words(values: number[], fill: number, size?: number): Uint8Array {
  const length = size ?? Math.ceil((values.length * 4) / SECTOR) * SECTOR;
  const view = new DataView(new ArrayBuffer(length));
  for (let i = 0; i < length / 4; i++) view.setUint32(i * 4, values[i] ?? fill, true);
  return new Uint8Array(view.buffer);
}

function join(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** UTF-16LE bytes of `text`. */
export function utf16(text: string): Uint8Array {
  const out = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    out[i * 2] = text.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
}
