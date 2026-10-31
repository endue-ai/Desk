// Windows Shell Links (.lnk, MS-SHLLINK): the header, the LinkInfo's local or network path and the
// StringData (description, relative path, working folder, arguments, icon location). Without
// LinkInfo, the target comes from the ID list's drive and file entries, or the environment block.

const CLSID = "0114020000000000c000000000000046";
const FLAGS = {
  idList: 0x1,
  info: 0x2,
  name: 0x4,
  relative: 0x8,
  workingDir: 0x10,
  args: 0x20,
  icon: 0x40,
  unicode: 0x80,
};

/**
 * @typedef {{ target?: string, network?: string, description?: string, relative?: string,
 *   workingDir?: string, arguments?: string, icon?: string }} ShellLink
 */

/** @param {Uint8Array} bytes @returns {ShellLink} */
export function readShellLink(bytes) {
  const damaged = () => new Error("The shortcut is damaged.");
  const u16 = (/** @type {number} */ at) => {
    if (at + 2 > bytes.length) throw damaged();
    return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
  };
  const u32 = (/** @type {number} */ at) => (u16(at) | (u16(at + 2) << 16)) >>> 0;
  /** A NUL-terminated string in the system code page (read as Windows-1252) or UTF-16. */
  const terminated = (/** @type {number} */ at, unicode = false) => {
    let end = at;
    if (unicode) while (end + 1 < bytes.length && (bytes[end] || bytes[end + 1])) end += 2;
    else while (end < bytes.length && bytes[end]) end++;
    if (end >= bytes.length) throw damaged();
    return new TextDecoder(unicode ? "utf-16le" : "windows-1252").decode(bytes.subarray(at, end));
  };
  if (u32(0) !== 0x4c) throw new Error("This is not a Windows shortcut.");
  const clsid = [...bytes.subarray(4, 20)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (clsid !== CLSID) throw new Error("This is not a Windows shortcut.");
  const flags = u32(20);
  let at = 0x4c;
  let listed;
  if (flags & FLAGS.idList) {
    try {
      listed = idListPath(bytes, at + 2, at + 2 + u16(at), u16, u32, terminated);
    } catch {
      // An ID list Web cannot follow: LinkInfo or the strings may still name the target.
    }
    at += 2 + u16(at);
  }
  /** @type {ShellLink} */
  const link = {};
  if (flags & FLAGS.info) {
    const size = u32(at);
    const headerSize = u32(at + 4);
    const infoFlags = u32(at + 8);
    if (at + size > bytes.length || headerSize < 0x1c) throw damaged();
    const unicode = headerSize >= 0x24;
    const suffixAt = unicode && u32(at + 0x20) ? u32(at + 0x20) : u32(at + 0x18);
    const suffix = suffixAt ? terminated(at + suffixAt, unicode && u32(at + 0x20) > 0) : "";
    if (infoFlags & 1) {
      const localAt = unicode && u32(at + 0x1c) ? u32(at + 0x1c) : u32(at + 0x10);
      link.target = terminated(at + localAt, unicode && u32(at + 0x1c) > 0) + suffix;
    }
    if (infoFlags & 2) {
      const network = at + u32(at + 0x14);
      const share = terminated(network + u32(network + 8));
      link.network = suffix ? `${share.replace(/\\$/, "")}\\${suffix}` : share;
    }
    at += size;
  }
  const unicode = (flags & FLAGS.unicode) !== 0;
  /** @type {Array<[number, keyof ShellLink]>} */
  const strings = [
    [FLAGS.name, "description"],
    [FLAGS.relative, "relative"],
    [FLAGS.workingDir, "workingDir"],
    [FLAGS.args, "arguments"],
    [FLAGS.icon, "icon"],
  ];
  for (const [flag, field] of strings) {
    if (!(flags & flag)) continue;
    const count = u16(at);
    const length = unicode ? count * 2 : count;
    if (at + 2 + length > bytes.length) throw damaged();
    link[field] = new TextDecoder(unicode ? "utf-16le" : "windows-1252").decode(
      bytes.subarray(at + 2, at + 2 + length),
    );
    at += 2 + length;
  }
  if (!link.target && !link.network && listed) link.target = listed;
  // ExtraData: the EnvironmentVariableDataBlock names the target as %VAR%\path.
  while (!link.target && !link.network && at + 8 <= bytes.length) {
    const size = u32(at);
    if (size < 4) break;
    if (u32(at + 4) === 0xa0000001 && size >= 0x314) {
      const wide = terminated(at + 8 + 260, true);
      link.target = wide || terminated(at + 8);
    }
    at += size;
  }
  return link;
}

/**
 * The file-system path an ID list spells: a drive item ("C:\\") and file entry items, each
 * with its long name from the 0xBEEF0004 extension block when it has one (MS-SHLLINK, libfwsi).
 * @param {Uint8Array} bytes @param {number} start @param {number} end
 * @param {(at: number) => number} u16 @param {(at: number) => number} u32
 * @param {(at: number, unicode?: boolean) => string} terminated
 */
function idListPath(bytes, start, end, u16, u32, terminated) {
  let drive = "";
  /** @type {string[]} */
  const names = [];
  for (let at = start; at + 2 < end; ) {
    const size = u16(at);
    if (size < 3 || at + size > end) break;
    const type = bytes[at + 2] ?? 0;
    if ((type & 0x70) === 0x20) drive = terminated(at + 3);
    else if ((type & 0x70) === 0x30) {
      const unicode = (type & 0x04) !== 0;
      const short = terminated(at + 14, unicode);
      let ext = at + 14 + (unicode ? (short.length + 1) * 2 : short.length + 1);
      if ((ext - at) % 2) ext++;
      let name = short;
      if (ext + 8 <= at + size && u32(ext + 4) === 0xbeef0004) {
        const version = u16(ext + 2);
        const offset =
          version >= 9 ? 46 : version >= 8 ? 42 : version >= 7 ? 38 : version >= 3 ? 20 : 0;
        if (offset && ext + offset < at + size) name = terminated(ext + offset, true) || short;
      }
      names.push(name);
    }
    at += size;
  }
  if (!drive && names.length === 0) return undefined;
  return `${drive}${drive && !drive.endsWith("\\") ? "\\" : ""}${names.join("\\")}`;
}
