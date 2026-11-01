// A tiny ELF runtime for the AppImage tests: header, one loadable segment, the sections an AppImage
// runtime carries (.upd_info, .sha256_sig, .shstrtab) and the section table last, so the file system
// starts at the ELF's end. 32- or 64-bit, little- or big-endian, with the "AI" type mark.

export interface Stub {
  wide?: boolean;
  big?: boolean;
  machine?: number;
  type?: number;
  update?: string;
  signed?: boolean;
}

export function elfStub({
  wide = true,
  big = false,
  machine = 62,
  type = 2,
  update = "",
  signed = false,
}: Stub = {}) {
  const ehsize = wide ? 64 : 52;
  const phentsize = wide ? 56 : 32;
  const shentsize = wide ? 64 : 40;
  const code = 512;
  const names = "\0.upd_info\0.sha256_sig\0.shstrtab\0";
  const sections = [
    { name: 0, type: 0, size: 0, fill: new Uint8Array(0) },
    { name: 1, type: 7, size: 1024, fill: new TextEncoder().encode(update) },
    {
      name: 11,
      type: 7,
      size: 1024,
      fill: signed ? new Uint8Array(64).fill(0x5a) : new Uint8Array(0),
    },
    { name: 23, type: 3, size: names.length, fill: new TextEncoder().encode(names) },
  ];
  let at = ehsize + phentsize + code;
  const placed = sections.map((s) => {
    const offset = s.size ? at : 0;
    at += s.size;
    return { ...s, offset };
  });
  const shoff = at;
  const total = shoff + shentsize * sections.length;
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  const le = !big;
  const w16 = (o: number, x: number) => v.setUint16(o, x, le);
  const w32 = (o: number, x: number) => v.setUint32(o, x, le);
  const word = (o: number, x: number) => (wide ? v.setBigUint64(o, BigInt(x), le) : w32(o, x));
  out.set([0x7f, 0x45, 0x4c, 0x46, wide ? 2 : 1, big ? 2 : 1, 1, 0]);
  if (type) out.set([0x41, 0x49, type], 8);
  w16(16, 2); // ET_EXEC
  w16(18, machine);
  w32(20, 1);
  word(24, 0x400000 + ehsize); // entry
  word(wide ? 32 : 28, ehsize); // phoff
  word(wide ? 40 : 32, shoff); // shoff
  const fields = wide ? 52 : 40;
  [ehsize, phentsize, 1, shentsize, sections.length, 3].forEach((x, i) => {
    w16(fields + 2 * i, x);
  });
  // The one PT_LOAD segment: the header and the code.
  const ph = ehsize;
  w32(ph, 1);
  if (wide) {
    w32(ph + 4, 5);
    word(ph + 8, 0);
    word(ph + 16, 0x400000);
    word(ph + 24, 0x400000);
    word(ph + 32, ehsize + phentsize + code);
    word(ph + 40, ehsize + phentsize + code);
    word(ph + 48, 0x1000);
  } else {
    w32(ph + 4, 0);
    w32(ph + 8, 0x400000);
    w32(ph + 12, 0x400000);
    w32(ph + 16, ehsize + phentsize + code);
    w32(ph + 20, ehsize + phentsize + code);
    w32(ph + 24, 5);
    w32(ph + 28, 0x1000);
  }
  out.fill(0x90, ehsize + phentsize, ehsize + phentsize + code);
  for (const [i, s] of placed.entries()) {
    out.set(s.fill, s.offset);
    const o = shoff + i * shentsize;
    w32(o, s.name);
    w32(o + 4, s.type);
    const step = wide ? 8 : 4;
    word(o + 8 + 2 * step, s.offset);
    word(o + 8 + 3 * step, s.size);
  }
  return out;
}

export function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
