// A two-page PDF written by hand: Helvetica text on each page, an outline (One, Two > Two, a
// section), a link on page 1 that jumps to page 2 and one to a web page. With a password it is
// encrypted with the standard security handler (RC4, 128-bit, revision 3) as Acrobat 5 wrote it.
import { createHash } from "node:crypto";

const PAD = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
const ID = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
const P = -3904;

const md5 = (...parts: Uint8Array[]) => {
  const hash = createHash("md5");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

function rc4(key: Uint8Array, data: Uint8Array): Uint8Array {
  const s = Array.from({ length: 256 }, (_, i) => i);
  const at = (i: number) => s[i] ?? 0;
  const swap = (i: number, j: number) => {
    const t = at(i);
    s[i] = at(j);
    s[j] = t;
  };
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + at(i) + (key[i % key.length] ?? 0)) & 255;
    swap(i, j);
  }
  const out = new Uint8Array(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 255;
    j = (j + at(i)) & 255;
    swap(i, j);
    out[n] = (data[n] ?? 0) ^ at((at(i) + at(j)) & 255);
  }
  return out;
}

const padded = (password: string) =>
  Buffer.concat([Buffer.from(password, "latin1"), PAD]).subarray(0, 32);

/** Revision 3: RC4 once, then 19 more times with the key XORed by the round. */
const rounds = (key: Uint8Array, data: Uint8Array) => {
  let out = rc4(key, data);
  for (let i = 1; i <= 19; i++)
    out = rc4(
      key.map((b) => b ^ i),
      out,
    );
  return out;
};

function security(user: string, owner: string) {
  let ownerKey = md5(padded(owner));
  for (let i = 0; i < 50; i++) ownerKey = md5(ownerKey);
  const o = rounds(ownerKey.subarray(0, 16), padded(user));
  const p = Buffer.alloc(4);
  p.writeInt32LE(P);
  let key = md5(padded(user), o, p, ID);
  for (let i = 0; i < 50; i++) key = md5(key.subarray(0, 16));
  const fileKey = key.subarray(0, 16);
  const u = Buffer.concat([rounds(fileKey, md5(PAD, ID)), Buffer.alloc(16)]);
  return { o, u, fileKey };
}

const hex = (bytes: Uint8Array) => `<${Buffer.from(bytes).toString("hex")}>`;
const escaped = (text: string) => `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;

export interface PdfOptions {
  /** Encrypt with this user password (the owner password is "owner"). */
  password?: string;
}

export function pdf(options: PdfOptions = {}): Uint8Array {
  const sec = options.password === undefined ? undefined : security(options.password, "owner");
  const objectKey = (num: number) => {
    if (!sec) return undefined;
    const tail = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
    return md5(sec.fileKey, tail).subarray(0, 16);
  };
  /** A string, encrypted with its object's key when the file is. */
  const str = (num: number, text: string) => {
    const key = objectKey(num);
    return key ? hex(rc4(key, Buffer.from(text, "latin1"))) : escaped(text);
  };
  const stream = (num: number, text: string) => {
    const key = objectKey(num);
    const body = key ? Buffer.from(rc4(key, Buffer.from(text, "latin1"))) : Buffer.from(text);
    return Buffer.concat([
      Buffer.from(`<< /Length ${body.length} >>\nstream\n`),
      body,
      Buffer.from("\nendstream"),
    ]);
  };
  const page1 =
    "BT /F1 18 Tf 72 720 Td (First page of the fixture) Tj ET\nBT /F1 12 Tf 72 680 Td (Go to the second page) Tj ET\nBT /F1 12 Tf 72 650 Td (A web page) Tj ET";
  const page2 = "BT /F1 18 Tf 72 720 Td (The second page holds the lantern) Tj ET";
  const objects: Array<(num: number) => Buffer> = [
    () => Buffer.from("<< /Type /Catalog /Pages 2 0 R /Outlines 7 0 R /PageMode /UseOutlines >>"),
    () => Buffer.from("<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>"),
    () =>
      Buffer.from(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 11 0 R >> >> /Annots [12 0 R 13 0 R] >>",
      ),
    () =>
      Buffer.from(
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 6 0 R /Resources << /Font << /F1 11 0 R >> >> >>",
      ),
    (num) => stream(num, page1),
    (num) => stream(num, page2),
    () => Buffer.from("<< /Type /Outlines /First 8 0 R /Last 9 0 R /Count 3 >>"),
    (num) =>
      Buffer.from(
        `<< /Title ${str(num, "One")} /Parent 7 0 R /Next 9 0 R /Dest [3 0 R /XYZ 0 792 0] >>`,
      ),
    (num) =>
      Buffer.from(
        `<< /Title ${str(num, "Two")} /Parent 7 0 R /Prev 8 0 R /First 10 0 R /Last 10 0 R /Count 1 /Dest [4 0 R /XYZ 0 792 0] >>`,
      ),
    (num) =>
      Buffer.from(
        `<< /Title ${str(num, "Two, a section")} /Parent 9 0 R /Dest [4 0 R /XYZ 0 700 0] >>`,
      ),
    () =>
      Buffer.from(
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      ),
    () =>
      Buffer.from(
        "<< /Type /Annot /Subtype /Link /Rect [70 675 220 695] /Border [0 0 0] /Dest [4 0 R /XYZ 0 792 0] >>",
      ),
    (num) =>
      Buffer.from(
        `<< /Type /Annot /Subtype /Link /Rect [70 645 160 665] /Border [0 0 0] /A << /S /URI /URI ${str(num, "https://example.com/")} >> >>`,
      ),
  ];
  if (sec) {
    objects.push(() =>
      Buffer.from(
        `<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O ${hex(sec.o)} /U ${hex(sec.u)} >>`,
      ),
    );
  }
  const head = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1");
  const parts: Buffer[] = [head];
  let length = head.length;
  const offsets: number[] = [];
  objects.forEach((make, i) => {
    const body = Buffer.concat([
      Buffer.from(`${i + 1} 0 obj\n`),
      make(i + 1),
      Buffer.from("\nendobj\n"),
    ]);
    offsets.push(length);
    parts.push(body);
    length += body.length;
  });
  const size = objects.length + 1;
  const xref = [
    "xref",
    `0 ${size}`,
    "0000000000 65535 f ",
    ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n `),
  ].join("\n");
  const encrypt = sec ? ` /Encrypt ${objects.length} 0 R` : "";
  const trailer = `\ntrailer\n<< /Size ${size} /Root 1 0 R${encrypt} /ID [${hex(ID)} ${hex(ID)}] >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref + trailer));
  return new Uint8Array(Buffer.concat(parts));
}
