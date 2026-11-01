// The HFS+ catalog as entries: one pass over its leaves gathers every folder and file record by
// parent; paths are built down from the root folder (ID 2). File hard links ("hlnk") read the
// "iNode<n>" file of the private folder, folder hard links ("fdrp") list the "dir_<n>" folder of
// the private folder for directories; both private folders and the journal's files stay hidden,
// as macOS hides them. Files kept compressed read through their com.apple.decmpfs attribute.
import { part } from "../disk/archive.js";
import { text, u32be } from "../disk/bytes.js";
import { damaged } from "../disk/work.js";
import {
  decmpfsHeader,
  decmpfsInFork,
  decmpfsMethod,
  decmpfsRead,
  decmpfsRefusal,
} from "./decmpfs.js";
import { leafRecords, split } from "./hfs-btree.js";
import { DATA, forkData, RESOURCE, uniName } from "./hfs-fork.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/work.js").Work} Work */
/** @typedef {import("../disk/archive.js").FileEntry} FileEntry */
/** @typedef {import("./hfs-fork.js").Fork} Fork */
/** @typedef {import("./hfs-btree.js").Tree} Tree */
/**
 * @typedef {{ disk: Source, blockSize: number, catalog: Tree, attrs?: Promise<Tree>, journaled: boolean,
 *   open(id: number, type: number, fork: Fork, what: string): Promise<Source> }} Volume
 * @typedef {{ node: number, record: number, type: number, size: number, length: number }} Attr
 * @typedef {{ id: number, data: Fork, rsrc: Fork, decmpfs?: Attr }} Ref
 * @typedef {{ parent: number, name: string, id: number, folder: boolean, date?: Date, flags: number,
 *   mode: number, type: string, special: number, data?: Fork, rsrc?: Fork }} Item
 */

const ROOT = 2;
const FILE_PRIVATE = "\0\0\0\0HFS+ Private Data";
const DIR_PRIVATE = ".HFS+ Private Directory Data\r";
const UF_COMPRESSED = 0x20;
const PIECE = 4 * 1024 * 1024;

/** HFS+ dates count seconds from 1904. @param {number} seconds */
const date = (seconds) => (seconds ? new Date((seconds - 2082844800) * 1000) : undefined);

/** A catalog record as an Item, or undefined for threads. @param {Uint8Array} record @returns {Item | undefined} */
function item(record) {
  const { key, data } = split(record);
  const kind = ((data[0] ?? 0) << 8) | (data[1] ?? 0);
  if (kind !== 1 && kind !== 2) return undefined;
  const folder = kind === 1;
  if (data.length < (folder ? 88 : 248))
    throw damaged("The HFS+ catalog file is damaged: a record is cut short.");
  const name = uniName(key, 4).normalize("NFC");
  /** @type {Item} */
  const found = {
    parent: u32be(key, 0),
    name,
    id: u32be(data, 8),
    folder,
    date: date(u32be(data, 16)),
    flags: data[41] ?? 0,
    mode: ((data[42] ?? 0) << 8) | (data[43] ?? 0),
    type: folder ? "" : String.fromCharCode(...data.subarray(48, 56)),
    special: u32be(data, 44),
  };
  if (!folder) {
    found.data = forkData(data, 88);
    found.rsrc = forkData(data, 168);
  }
  return found;
}

/**
 * Where each compressed file's com.apple.decmpfs attribute is, by file ID.
 * @param {Tree} tree @param {Set<number>} ids @param {Work} work
 */
async function decmpfsAttrs(tree, ids, work) {
  /** @type {Map<number, Attr>} */
  const found = new Map();
  const want = "com.apple.decmpfs";
  for (let index = tree.first, seen = 0; index && seen <= tree.total; seen++) {
    await work.tick();
    const node = await tree.node(index);
    if (node.kind !== -1)
      throw damaged("The HFS+ attributes file is damaged: a leaf is not a leaf.");
    node.records.forEach((record, i) => {
      const { key, data } = split(record);
      const id = u32be(key, 2);
      if (!ids.has(id) || uniName(key, 10) !== want || u32be(key, 6) !== 0) return;
      const kind = u32be(data, 0);
      if (kind === 0x10) {
        const header = decmpfsHeader(data.subarray(16, 16 + u32be(data, 12)));
        if (header) found.set(id, { node: index, record: i, ...header, length: u32be(data, 12) });
      } else if (kind === 0x20)
        found.set(id, { node: index, record: i, type: -1, size: 0, length: 0 });
    });
    index = node.next;
  }
  return found;
}

/**
 * The bytes of a decmpfs attribute.
 * @param {Volume} volume @param {Attr} attr @param {number} id
 */
async function attrBytes(volume, attr, id) {
  const tree = /** @type {Promise<Tree>} */ (volume.attrs);
  const record = (await (await tree).node(attr.node)).records[attr.record];
  if (!record) throw damaged("The HFS+ attributes file is damaged: a record moved.");
  const { data } = split(record);
  if (u32be(data, 0) === 0x10) return data.slice(16, 16 + u32be(data, 12));
  const fork = forkData(data, 8);
  return (await volume.open(id, 0, fork, "attribute")).read(0, fork.size);
}

/** @param {Volume} volume @param {Item} file @param {Work} work */
async function linkTarget(volume, file, work) {
  await work.tick();
  const fork = /** @type {Fork} */ (file.data);
  const source = await volume.open(file.id, DATA, fork, "link");
  return text(await source.read(0, Math.min(fork.size, 4096)));
}

/**
 * Every folder, file and link on the volume.
 * @param {Volume} volume @param {Work} work @returns {Promise<FileEntry[]>}
 */
export async function list(volume, work) {
  /** @type {Map<number, Item[]>} */
  const children = new Map();
  /** @type {Map<string, Item>} */
  const named = new Map();
  for await (const record of leafRecords(volume.catalog, work)) {
    const found = item(record);
    if (!found) continue;
    const siblings = children.get(found.parent) ?? [];
    siblings.push(found);
    children.set(found.parent, siblings);
    if (found.parent !== ROOT && found.name.startsWith("iNode"))
      named.set(`${found.parent}/${found.name}`, found);
  }
  const top = children.get(ROOT) ?? [];
  const filePrivate = top.find((i) => i.folder && i.name === FILE_PRIVATE.normalize("NFC"))?.id;
  const dirPrivate = top.find((i) => i.folder && i.name === DIR_PRIVATE)?.id;
  const dirs = new Map((children.get(dirPrivate ?? -1) ?? []).map((i) => [i.name, i.id]));
  const hidden = new Set([FILE_PRIVATE.normalize("NFC"), DIR_PRIVATE]);
  if (volume.journaled) for (const name of [".journal", ".journal_info_block"]) hidden.add(name);
  /** The file an item stands for: itself, or the iNode file a hard link names. @param {Item} i */
  const target = (i) => (i.type === "hlnkhfs+" ? named.get(`${filePrivate}/iNode${i.special}`) : i);
  const compressed = new Set();
  for (const siblings of children.values())
    for (const i of siblings) if (!i.folder && i.flags & UF_COMPRESSED) compressed.add(i.id);
  const attrs =
    compressed.size && volume.attrs
      ? await decmpfsAttrs(await volume.attrs, compressed, work)
      : new Map();
  /** @type {FileEntry[]} */
  const entries = [];
  /** @type {[number, string, Set<number>][]} */
  const stack = [[ROOT, "", new Set([ROOT])]];
  while (stack.length) {
    const [id, path, above] = /** @type {[number, string, Set<number>]} */ (stack.pop());
    for (const i of children.get(id) ?? []) {
      if (id === ROOT && hidden.has(i.name)) continue;
      const name = part(i.name);
      const at = path ? `${path}/${name}` : name;
      if (entries.length % 2048 === 0) await work.tick();
      const folder = i.folder
        ? i.id
        : i.type === "fdrpMACS"
          ? dirs.get(`dir_${i.special}`)
          : undefined;
      if (folder !== undefined) {
        entries.push({ path: at, kind: "folder", size: 0, date: i.date, ref: undefined });
        if (!above.has(folder)) stack.push([folder, at, new Set([...above, folder])]);
        continue;
      }
      const file = target(i);
      if (!file?.data || !file.rsrc) {
        const refusal = "The file this hard link names is missing.";
        entries.push({ path: at, kind: "file", size: 0, date: i.date, refusal, ref: undefined });
        continue;
      }
      if ((file.mode & 0xf000) === 0xa000 || file.type === "slnkrhap") {
        const link = await linkTarget(volume, file, work);
        const size = new TextEncoder().encode(link).length;
        entries.push({ path: at, kind: "link", size, date: file.date, link, ref: undefined });
        continue;
      }
      /** @type {Ref} */
      const ref = { id: file.id, data: file.data, rsrc: file.rsrc };
      /** @type {FileEntry} */
      const entry = { path: at, kind: "file", size: file.data.size, date: file.date, ref };
      const attr = file.flags & UF_COMPRESSED ? attrs.get(file.id) : undefined;
      if (attr) {
        ref.decmpfs = attr;
        if (attr.type < 0) {
          const header = decmpfsHeader(await attrBytes(volume, attr, file.id));
          if (!header) throw damaged("The HFS+ volume is damaged: a decmpfs attribute is not one.");
          Object.assign(attr, header);
        }
        entry.size = attr.size;
        entry.method = decmpfsMethod(attr);
        entry.packed = decmpfsInFork(attr) ? file.rsrc.size : attr.length - 16;
        const refusal = decmpfsRefusal(attr);
        if (refusal) entry.refusal = refusal;
      }
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * The first `limit` bytes of a file.
 * @param {Volume} volume @param {Ref} ref @param {number} limit @param {Work} work
 */
export async function readFile(volume, ref, limit, work) {
  if (ref.decmpfs) {
    const attr = await attrBytes(volume, ref.decmpfs, ref.id);
    const fork = decmpfsInFork(ref.decmpfs)
      ? await volume.open(ref.id, RESOURCE, ref.rsrc, "resource fork")
      : undefined;
    return decmpfsRead(attr, fork, limit, work);
  }
  const want = Math.min(limit, ref.data.size);
  const source = await volume.open(ref.id, DATA, ref.data, "file");
  if (want <= PIECE) return source.read(0, want);
  const out = new Uint8Array(want);
  for (let pos = 0; pos < want; pos += PIECE) {
    await work.tick();
    out.set(await source.read(pos, Math.min(PIECE, want - pos)), pos);
  }
  return out;
}
