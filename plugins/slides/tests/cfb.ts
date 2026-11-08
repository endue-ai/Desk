// A small compound file (CFB, version 3) writer for test fixtures and make.sh: streams in the root
// storage, small ones in the mini stream, the directory as one sorted chain of right siblings.
const SECTOR = 512;
const MINI = 64;
const CUTOFF = 4096;
const END = 0xfffffffe;
const FREE = 0xffffffff;
const FAT_SECTOR = 0xfffffffd;

const utf16 = (name: string) => {
  const out = new Uint8Array(64);
  for (let i = 0; i < name.length && i < 31; i++) {
    out[i * 2] = name.charCodeAt(i) & 0xff;
    out[i * 2 + 1] = name.charCodeAt(i) >> 8;
  }
  return out;
};

/** CFB's order for siblings: shorter names first, then by upper case. */
const order = (a: string, b: string) =>
  a.length - b.length ||
  (a.toUpperCase() < b.toUpperCase() ? -1 : a.toUpperCase() > b.toUpperCase() ? 1 : 0);

export function cfb(streams: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(streams).sort(order);
  const sectors: Uint8Array[] = [];
  const fat: number[] = [];
  /** Put bytes in whole sectors, chained in the FAT; returns the first sector. */
  const place = (bytes: Uint8Array) => {
    if (bytes.length === 0) return END;
    const first = sectors.length;
    const count = Math.ceil(bytes.length / SECTOR);
    for (let i = 0; i < count; i++) {
      const sector = new Uint8Array(SECTOR);
      sector.set(bytes.subarray(i * SECTOR, (i + 1) * SECTOR));
      sectors.push(sector);
      fat.push(i === count - 1 ? END : first + i + 1);
    }
    return first;
  };
  // Small streams go to the mini stream, in 64-byte mini sectors chained in the mini FAT.
  const mini: number[] = [];
  const miniFat: number[] = [];
  const starts = new Map<string, number>();
  for (const name of names) {
    const data = streams[name] ?? new Uint8Array();
    if (data.length >= CUTOFF || data.length === 0) continue;
    const first = mini.length / MINI;
    const count = Math.ceil(data.length / MINI);
    for (let i = 0; i < count; i++) miniFat.push(i === count - 1 ? END : first + i + 1);
    const padded = new Uint8Array(count * MINI);
    padded.set(data);
    mini.push(...padded);
    starts.set(name, first);
  }
  for (const name of names) {
    const data = streams[name] ?? new Uint8Array();
    if (data.length >= CUTOFF) starts.set(name, place(data));
  }
  const miniStart = place(new Uint8Array(mini));
  const miniFatBytes = new Uint8Array(
    Math.max(1, Math.ceil((miniFat.length * 4) / SECTOR)) * SECTOR,
  ).fill(0xff);
  const miniView = new DataView(miniFatBytes.buffer);
  for (const [i, v] of miniFat.entries()) miniView.setUint32(i * 4, v, true);
  const miniFatStart = miniFat.length ? place(miniFatBytes) : END;
  const miniFatCount = miniFat.length ? miniFatBytes.length / SECTOR : 0;

  // The directory: the root, then every stream as a right-sibling chain in CFB order.
  const entries = [{ name: "Root Entry", type: 5, start: miniStart, size: mini.length }];
  for (const name of names)
    entries.push({
      name,
      type: 2,
      start: starts.get(name) ?? END,
      size: streams[name]?.length ?? 0,
    });
  const dir = new Uint8Array(Math.ceil((entries.length * 128) / SECTOR) * SECTOR);
  const dv = new DataView(dir.buffer);
  entries.forEach((entry, i) => {
    const at = i * 128;
    dir.set(utf16(entry.name), at);
    dv.setUint16(at + 64, (entry.name.length + 1) * 2, true);
    dir[at + 66] = entry.type;
    dir[at + 67] = 1;
    dv.setUint32(at + 68, FREE, true);
    dv.setUint32(at + 72, i > 0 && i < entries.length - 1 ? i + 1 : FREE, true);
    dv.setUint32(at + 76, i === 0 && entries.length > 1 ? 1 : FREE, true);
    dv.setUint32(at + 116, entry.start, true);
    dv.setUint32(at + 120, entry.size, true);
  });
  for (let i = entries.length; i < dir.length / 128; i++) {
    dv.setUint32(i * 128 + 68, FREE, true);
    dv.setUint32(i * 128 + 72, FREE, true);
    dv.setUint32(i * 128 + 76, FREE, true);
  }
  const dirStart = place(dir);

  // The FAT covers every sector, its own included.
  let fatCount = 1;
  while ((sectors.length + fatCount) * 4 > fatCount * SECTOR) fatCount++;
  if (fatCount > 109) throw new Error("too large for this writer");
  const fatStart = sectors.length;
  for (let i = 0; i < fatCount; i++) fat.push(FAT_SECTOR);
  const fatBytes = new Uint8Array(fatCount * SECTOR).fill(0xff);
  const fv = new DataView(fatBytes.buffer);
  for (const [i, v] of fat.entries()) fv.setUint32(i * 4, v, true);
  for (let i = 0; i < fatCount; i++) sectors.push(fatBytes.subarray(i * SECTOR, (i + 1) * SECTOR));

  const header = new Uint8Array(SECTOR);
  const hv = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  hv.setUint16(24, 0x3e, true);
  hv.setUint16(26, 3, true);
  hv.setUint16(28, 0xfffe, true);
  hv.setUint16(30, 9, true);
  hv.setUint16(32, 6, true);
  hv.setUint32(44, fatCount, true);
  hv.setUint32(48, dirStart, true);
  hv.setUint32(56, CUTOFF, true);
  hv.setUint32(60, miniFatStart, true);
  hv.setUint32(64, miniFatCount, true);
  hv.setUint32(68, END, true);
  for (let i = 0; i < 109; i++) hv.setUint32(76 + i * 4, i < fatCount ? fatStart + i : FREE, true);
  const out = new Uint8Array(SECTOR * (1 + sectors.length));
  out.set(header);
  for (const [i, sector] of sectors.entries()) out.set(sector, SECTOR * (i + 1));
  return out;
}
