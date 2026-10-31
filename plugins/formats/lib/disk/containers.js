// The container around a virtual disk, told by its signature: VHD (a footer, "conectix"), VHDX
// ("vhdxfile"), VMDK ("KDMV", or a text descriptor), QCOW2 ("QFI\xfb"); anything else is a raw
// image. Each container answers its details and the virtual disk as a Source.
import { at, latin1, sizeDetail } from "./bytes.js";
import { openQcow2 } from "./qcow2.js";
import { openVhd } from "./vhd.js";
import { openVhdx } from "./vhdx.js";
import { openVmdk } from "./vmdk.js";
import { Refusal } from "./work.js";

/** @typedef {import("./source.js").Source} Source */
/** @typedef {import("./archive.js").Detail} Detail */
/**
 * @typedef {{ format: string, details: Detail[], disk: Source }} Container
 * @typedef {{ open?: (name: string) => Promise<Source | undefined> }} ContainerOptions `open` gives
 * a file beside the image by its name (a VMDK's extent file), when the caller can.
 */

/** Which container the image is. @param {Source} source */
export async function containerKind(source) {
  const head = await source.read(0, 512);
  if (at(head, 0, "vhdxfile")) return "vhdx";
  if (at(head, 0, "QFI\xfb")) return "qcow2";
  if (at(head, 0, "KDMV") || at(head, 0, "COWD")) return "vmdk";
  if (/^\s*#\s*Disk DescriptorFile/i.test(latin1(head.subarray(0, 64)))) return "vmdk";
  const tail = await source.read(Math.max(0, source.size - 512), 512);
  if (at(tail, 0, "conectix") || at(tail, 1, "conectix") || at(head, 0, "conectix")) return "vhd";
  return "raw";
}

/**
 * The virtual disk inside `source`. Throws a Refusal for images that need other files or use what
 * is not read here, and an Error with a sentence when the container is damaged.
 * @param {Source} source @param {ContainerOptions} [options] @returns {Promise<Container>}
 */
export async function openContainer(source, options = {}) {
  const kind = await containerKind(source);
  if (kind === "vhd") return openVhd(source);
  if (kind === "vhdx") return openVhdx(source);
  if (kind === "vmdk") return openVmdk(source, options);
  if (kind === "qcow2") return openQcow2(source);
  return {
    format: "Disk image",
    details: [{ label: "Size", value: sizeDetail(source.size) }],
    disk: source,
  };
}

export { Refusal };
