// Test files built in code: ZIP (for MAFF), WARC records and Windows Shell Links (MS-SHLLINK).
import { crc32, deflateRawSync } from "node:zlib";

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
export const pngData = `data:image/png;base64,${PNG.toString("base64")}`;
export const utf8 = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n);
  return b;
};
const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** A ZIP archive: deflated entries unless `stored` names them. */
export function zip(files: Record<string, Uint8Array | string>, stored: string[] = []) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(typeof content === "string" ? utf8(content) : content);
    const store = stored.includes(name);
    const packed = store ? data : deflateRawSync(data);
    const nameBytes = Buffer.from(name, "utf8");
    const common = [
      u16(20),
      u16(0x0800),
      u16(store ? 0 : 8),
      u16(0),
      u16(0x21),
      u32(crc32(data)),
      u32(packed.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
    ];
    const local = Buffer.concat([u32(0x04034b50), ...common, nameBytes, packed]);
    centrals.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        ...common,
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(centrals.length),
    u16(centrals.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return new Uint8Array(Buffer.concat([...locals, central, end]));
}

/** One WARC record, its block given whole. */
export function warcRecord(version: string, headers: Record<string, string>, block: Uint8Array) {
  const head = Object.entries({ ...headers, "Content-Length": String(block.length) })
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  return Buffer.concat([
    Buffer.from(`WARC/${version}\r\n${head}\r\n`, "latin1"),
    Buffer.from(block),
    Buffer.from("\r\n\r\n", "latin1"),
  ]);
}

/** An HTTP response as a WARC response record carries it. */
export function httpResponse(type: string, body: Uint8Array, extra = "") {
  const head = `HTTP/1.1 200 OK\r\nContent-Type: ${type}\r\n${extra}Content-Length: ${body.length}\r\n\r\n`;
  return new Uint8Array(Buffer.concat([Buffer.from(head, "latin1"), Buffer.from(body)]));
}

const utf16 = (text: string) => Buffer.from(text, "utf16le");
const counted = (text: string) => Buffer.concat([u16(text.length), utf16(text)]);
const z = (text: string) => Buffer.concat([Buffer.from(text, "latin1"), Buffer.from([0])]);

export interface ShellLink {
  local?: string;
  network?: { share: string; suffix: string };
  description?: string;
  relative?: string;
  workingDir?: string;
  arguments?: string;
  icon?: string;
}

/** A Shell Link (.lnk) per MS-SHLLINK: header, LinkInfo and Unicode StringData, no ID list. */
export function shellLink(link: ShellLink) {
  const strings: Array<[number, string | undefined]> = [
    [0x04, link.description],
    [0x08, link.relative],
    [0x10, link.workingDir],
    [0x20, link.arguments],
    [0x40, link.icon],
  ];
  const hasInfo = Boolean(link.local || link.network);
  let flags = 0x80 | (hasInfo ? 0x02 : 0);
  for (const [flag, value] of strings) if (value !== undefined) flags |= flag;
  const clsid = Buffer.from("0114020000000000c000000000000046", "hex");
  const header = Buffer.concat([
    u32(0x4c),
    clsid,
    u32(flags),
    u32(0x20),
    Buffer.alloc(24),
    u32(1234),
    u32(0),
    u32(1),
    u16(0),
    Buffer.alloc(10),
  ]);
  const parts: Buffer[] = [header];
  if (hasInfo) parts.push(linkInfo(link));
  for (const [, value] of strings) if (value !== undefined) parts.push(counted(value));
  parts.push(u32(0));
  return new Uint8Array(Buffer.concat(parts));
}

function linkInfo(link: ShellLink) {
  const headerSize = 0x1c;
  // VolumeID: size, a fixed drive, a serial number, the label right after these 16 bytes.
  const volume = Buffer.concat([u32(0x15), u32(3), u32(0x1234abcd), u32(0x10), z("DATA")]);
  // CommonNetworkRelativeLink: size, ValidNetType, the share name after these 20 bytes, LANMAN.
  const share = link.network ? z(link.network.share) : Buffer.alloc(0);
  const network = link.network
    ? Buffer.concat([u32(0x14 + share.length), u32(0x02), u32(0x14), u32(0), u32(0x20000), share])
    : Buffer.alloc(0);
  const local = link.local ? z(link.local) : Buffer.alloc(0);
  const suffix = z(link.network?.suffix ?? "");
  const volumeAt = link.local ? headerSize : 0;
  const localAt = link.local ? headerSize + volume.length : 0;
  const networkAt = link.network ? headerSize + (link.local ? volume.length + local.length : 0) : 0;
  const suffixAt = headerSize + (link.local ? volume.length + local.length : 0) + network.length;
  const body = Buffer.concat([link.local ? volume : Buffer.alloc(0), local, network, suffix]);
  const infoFlags = (link.local ? 1 : 0) | (link.network ? 2 : 0);
  return Buffer.concat([
    u32(headerSize + body.length),
    u32(headerSize),
    u32(infoFlags),
    u32(volumeAt),
    u32(localAt),
    u32(networkAt),
    u32(suffixAt),
    body,
  ]);
}
