// AppImages: an ELF runtime with a SquashFS file system right after it (type 2), found by the
// "hsqs" magic past the ELF's last byte. The runtime's facts (architecture, update information,
// signature) and the desktop entry go into the details; the files are the file system's.
import { row } from "../disk/archive.js";
import { at, formatSize, u16, u16be, u32, u32be, u64, u64be } from "../disk/bytes.js";
import { sliceSource } from "../disk/source.js";
import { Work } from "../disk/work.js";
import { openSquashfs } from "./squashfs.js";

/** @typedef {import("../disk/source.js").Source} Source */
/** @typedef {import("../disk/archive.js").Archive} Archive */
/** @typedef {import("../disk/archive.js").Detail} Detail */

const MACHINES = /** @type {Record<number, string>} */ ({
  3: "x86",
  8: "MIPS",
  20: "PowerPC",
  21: "PowerPC 64-bit",
  22: "IBM S/390",
  40: "ARM",
  62: "x86-64",
  183: "ARM64",
  243: "RISC-V",
});
/** How far past the ELF's end the file system is looked for. */
const SEARCH = 1 << 20;
const TYPE_1 = "Type 1 AppImages are ISO 9660 images, which are not read as AppImages.";

/**
 * The ELF runtime's facts: where it ends, its class, machine and named sections.
 * @param {Source} source
 */
async function readElf(source) {
  const h = await source.read(0, 64);
  if (!at(h, 0, "\x7fELF") || (h[4] !== 1 && h[4] !== 2) || (h[5] !== 1 && h[5] !== 2))
    throw new Error("This is not an AppImage: it does not start with an ELF runtime.");
  const wide = h[4] === 2;
  const big = h[5] === 2;
  const r16 = big ? u16be : u16;
  const r32 = big ? u32be : u32;
  const rWord = wide ? (big ? u64be : u64) : r32;
  const word = wide ? 8 : 4;
  const phoff = rWord(h, wide ? 32 : 28);
  const shoff = rWord(h, wide ? 40 : 32);
  const base = wide ? 52 : 40;
  const [ehsize, phentsize, phnum, shentsize, shnum, shstrndx] = [0, 2, 4, 6, 8, 10].map((o) =>
    r16(h, base + o),
  );
  let end = Math.max(
    /** @type {number} */ (ehsize),
    phoff + phentsize * phnum,
    shoff + shentsize * shnum,
  );
  if (phnum && phnum < 256 && phentsize >= (wide ? 56 : 32)) {
    const table = await source.read(phoff, phentsize * phnum);
    for (let i = 0; i < phnum; i++) {
      const p = table.subarray(i * phentsize);
      end = Math.max(end, rWord(p, wide ? 8 : 4) + rWord(p, wide ? 32 : 16));
    }
  }
  /** @type {Map<string, { offset: number, size: number }>} */
  const sections = new Map();
  if (shnum && shnum < 4096 && shentsize >= (wide ? 64 : 40)) {
    const table = await source.read(shoff, shentsize * shnum);
    const list = Array.from({ length: shnum }, (_, i) => {
      const s = table.subarray(i * shentsize);
      return {
        name: r32(s, 0),
        type: r32(s, 4),
        offset: rWord(s, 8 + 2 * word),
        size: rWord(s, 8 + 3 * word),
      };
    });
    for (const s of list) if (s.type !== 8) end = Math.max(end, s.offset + s.size); // SHT_NOBITS
    const names = list[/** @type {number} */ (shstrndx)];
    if (names && names.size < 65536 && names.offset + names.size <= source.size) {
      const strings = await source.read(names.offset, names.size);
      for (const s of list) {
        const stop = strings.indexOf(0, s.name);
        const name = new TextDecoder().decode(
          strings.subarray(s.name, stop < 0 ? undefined : stop),
        );
        if (name) sections.set(name, { offset: s.offset, size: s.size });
      }
    }
  }
  return { end, wide, big, machine: r16(h, 18), type: at(h, 8, "AI") ? (h[10] ?? 0) : 0, sections };
}

/** Where the SquashFS starts: at the ELF's end, or the first "hsqs" of version 4 after it. @param {Source} source @param {number} end */
async function superblockAt(source, end) {
  if (end >= source.size) return -1;
  const head = await source.read(end, Math.min(SEARCH, source.size - end));
  for (let i = head.indexOf(0x68); i >= 0 && i + 96 <= head.length; i = head.indexOf(0x68, i + 1))
    if (at(head, i, "hsqs") && u16(head, i + 28) === 4) return end + i;
  return -1;
}

/** A section's text, up to its first NUL. @param {Source} source @param {{ offset: number, size: number } | undefined} s */
async function sectionText(source, s) {
  if (!s || s.size === 0 || s.size > 65536) return "";
  const bytes = await source.read(s.offset, s.size);
  const stop = bytes.indexOf(0);
  return new TextDecoder().decode(bytes.subarray(0, stop < 0 ? undefined : stop)).trim();
}

/**
 * Open an AppImage as an Archive: the runtime's facts, then the files of its file system.
 * @param {Source} source @param {{ signal?: AbortSignal }} [options] @returns {Promise<Archive>}
 */
export async function openAppImage(source, options = {}) {
  const work = new Work(options.signal);
  await work.tick();
  const elf = await readElf(source);
  /** @type {Detail[]} */
  const details = [];
  if (elf.type) details.push(row("AppImage type", elf.type));
  const machine = MACHINES[elf.machine] ?? `machine ${elf.machine}`;
  details.push(row("Architecture", machine));
  details.push(
    row(
      "Runtime",
      `ELF ${elf.wide ? 64 : 32}-bit ${elf.big ? "big" : "little"}-endian, ${formatSize(elf.end)}`,
    ),
  );
  const update = await sectionText(source, elf.sections.get(".upd_info"));
  if (update) details.push(row("Update information", update));
  const signature = elf.sections.get(".sha256_sig");
  if (signature && signature.size > 0 && signature.size <= 65536) {
    const bytes = await source.read(signature.offset, signature.size);
    details.push(row("Signed", bytes.some((b) => b !== 0) ? "Yes" : "No"));
  }
  const offset = await superblockAt(source, elf.end);
  if (offset < 0) {
    if (elf.type === 1 || at(await source.read(0x8001, 5), 0, "CD001"))
      return refusedWith(details, TYPE_1);
    throw new Error("The AppImage holds no SquashFS file system after its runtime.");
  }
  if (offset !== elf.end)
    details.push(row("File system at", `byte ${offset.toLocaleString("en-US")}`));
  const fs = await openSquashfs(sliceSource(source, offset, source.size - offset), {
    signal: work.signal,
    format: "AppImage",
  });
  details.push(...(await desktopEntry(fs)), ...fs.details);
  fs.details = details;
  return fs;
}

/** @param {Detail[]} details @param {string} sentence @returns {Archive} */
const refusedWith = (details, sentence) => ({
  format: "AppImage",
  entries: [],
  details,
  note: sentence,
  refusal: sentence,
  read: () => Promise.reject(new Error(sentence)),
});

/** The name, version and summary from the desktop file at the top of the file system. @param {Archive} fs */
async function desktopEntry(fs) {
  let file = fs.entries.find((e) => !e.path.includes("/") && e.path.endsWith(".desktop"));
  // Often a link into usr/share/applications: follow it (relative to the top) once.
  if (file?.kind === "link") {
    const parts = [];
    for (const step of (file.link ?? "").split("/"))
      if (step === "..") parts.pop();
      else if (step && step !== ".") parts.push(step);
    const target = parts.join("/");
    file = fs.entries.find((e) => e.path === target);
  }
  if (file?.kind !== "file" || file.size > 1 << 20) return [];
  let text;
  try {
    text = new TextDecoder().decode(await fs.read(file, 65536));
  } catch {
    return [];
  }
  const section = /\[Desktop Entry\]([\s\S]*?)(?:\n\[|$)/.exec(text)?.[1] ?? "";
  const value = (/** @type {string} */ key) =>
    new RegExp(`^${key}=(.*)$`, "m").exec(section)?.[1]?.trim() ?? "";
  return [
    ["Name", value("Name")],
    ["Version", value("X-AppImage-Version")],
    ["Comment", value("Comment")],
  ]
    .filter(([, v]) => v)
    .map(([label, v]) => row(/** @type {string} */ (label), v));
}
