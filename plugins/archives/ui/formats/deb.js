// Debian packages: an ar archive with debian-binary, control.tar.* (the control file, shown as
// details above the files) and data.tar.* (the files the package installs).
import { text } from "../bytes.js";
import { CODEC_NAMES, decodedInput } from "../codecs/index.js";
import { sliceSource } from "../source.js";
import { arMembers, memberCodec } from "./ar.js";
import { row } from "./archive.js";
import { openTar, openTarIn } from "./tar.js";

/** @typedef {import("../source.js").Source} Source */
/** @typedef {import("./archive.js").Archive} Archive */
/** @typedef {import("./ar.js").Member} Member */

/** A tar member of the package, plain or compressed. @param {Source} source @param {Member} member @param {string} format */
async function tarMember(source, member, format) {
  const codec = memberCodec(member.name);
  if (codec === null)
    throw new Error(`${member.name} is compressed in a way this package reader does not know.`);
  const slice = sliceSource(source, member.offset, member.size);
  if (codec === "") return openTar(slice, member.name, { label: format });
  return openTarIn(() => decodedInput(codec, slice), format);
}

/**
 * The control file's fields in their order; a field's continuation lines are dropped, so the
 * description shows its first line.
 * @param {string} control
 */
export function controlFields(control) {
  /** @type {Array<{ label: string, value: string }>} */
  const fields = [];
  for (const line of control.split("\n")) {
    if (!line || /^\s/.test(line)) continue;
    const colon = line.indexOf(":");
    if (colon > 0) fields.push(row(line.slice(0, colon), line.slice(colon + 1).trim()));
  }
  return fields;
}

/** @param {Source} source @param {string} name @returns {Promise<Archive>} */
export async function openDeb(source, name) {
  const members = await arMembers(source);
  const control = members.find((m) => m.name.startsWith("control.tar"));
  const data = members.find((m) => m.name.startsWith("data.tar"));
  if (!members.some((m) => m.name === "debian-binary") || !data)
    throw new Error(`${name} is an ar archive without a Debian package's members.`);
  const format = "Debian package";
  /** @type {Array<{ label: string, value: string }>} */
  let details = [];
  if (control) {
    const tar = await tarMember(source, control, format);
    const file = tar.entries.find((e) => e.path === "control");
    if (file) details = controlFields(text(await tar.read(file)));
  }
  const codec = memberCodec(data.name);
  details.push(row("Data", `tar${codec ? ` (${CODEC_NAMES[codec] ?? codec})` : ""}`));
  const files = await tarMember(source, data, format);
  return { ...files, format, details };
}
