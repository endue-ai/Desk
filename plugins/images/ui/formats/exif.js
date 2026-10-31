// EXIF: where each container keeps it (JPEG APP1, PNG eXIf, WebP EXIF, the HEIF Exif item, TIFF
// itself, CR3's CMT boxes), and the fields the details show, in words: camera, lens, exposure,
// aperture, ISO, focal length, date taken, GPS position and software, and the orientation.
import { ascii, has, reader } from "../bytes.js";
import { boxes, child, heif } from "./isobmff.js";
import { openTiff } from "./tiff.js";

/**
 * @typedef {{ label: string, value: string }} Field
 * @typedef {{ orientation: number, fields: Field[] }} Exif
 * @typedef {import("./tiff.js").Ifd} Ifd
 */

/** Drop the "Exif\0\0" some writers put in front of the TIFF header. */
const tiffStart = (/** @type {Uint8Array} */ b) => (has(b, 0, "Exif\0\0") ? b.subarray(6) : b);

/** The APP1 Exif block of a JPEG, as TIFF bytes. */
export function jpegExif(/** @type {Uint8Array} */ bytes, start = 0) {
  const r = reader(bytes, false);
  let at = start + 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      at += marker === 0xff ? 1 : 2;
      continue;
    }
    const length = r.u16(at + 2);
    if (marker === 0xe1 && has(bytes, at + 4, "Exif\0\0"))
      return bytes.subarray(at + 10, at + 2 + length);
    at += 2 + length;
  }
  return undefined;
}

/** The eXIf chunk of a PNG. */
function pngExif(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes, false);
  for (let at = 8; at + 12 <= bytes.length; ) {
    const length = r.u32(at);
    const type = ascii(bytes, at + 4, 4);
    if (type === "eXIf") return tiffStart(bytes.subarray(at + 8, at + 8 + length));
    if (type === "IDAT" || type === "IEND") break;
    at += 12 + length;
  }
  return undefined;
}

/** The EXIF chunk of a WebP. */
function webpExif(/** @type {Uint8Array} */ bytes) {
  const r = reader(bytes);
  for (let at = 12; at + 8 <= bytes.length; ) {
    const length = r.u32(at + 4);
    if (ascii(bytes, at, 4) === "EXIF") return tiffStart(bytes.subarray(at + 8, at + 8 + length));
    at += 8 + length + (length % 2);
  }
  return undefined;
}

/** The Exif item of a HEIC or AVIF: four bytes give where its TIFF header starts. */
function heifExif(/** @type {Uint8Array} */ bytes) {
  const file = heif(bytes);
  const item = file?.byType("Exif");
  if (!file || !item) return undefined;
  const data = file.data(item);
  if (data.length < 4) return undefined;
  const skip = reader(data, false).u32(0);
  return data.subarray(4 + skip);
}

/** CR3's CMT1 (IFD0), CMT2 (EXIF IFD) and CMT4 (GPS IFD), each a TIFF of its own. */
function cr3Exif(/** @type {Uint8Array} */ bytes) {
  const moov = boxes(bytes).find((b) => b.type === "moov");
  const canon = moov
    ? boxes(bytes, moov.body, moov.end).find(
        (b) => b.type === "uuid" && has(bytes, b.body, [0x85, 0xc0, 0xb6, 0x87]),
      )
    : undefined;
  if (!canon) return undefined;
  const cmt = (/** @type {string} */ name) => {
    const box = child(bytes, canon, name, 16);
    return box ? bytes.subarray(box.body, box.end) : undefined;
  };
  return { ifd0: cmt("CMT1"), exif: cmt("CMT2"), gps: cmt("CMT4") };
}

/** The first IFD of a TIFF stream, or null. */
const firstIfd = (/** @type {Uint8Array | undefined} */ b) => {
  if (!b) return null;
  try {
    return openTiff(b).chain()[0] ?? null;
  } catch {
    return null;
  }
};

/** IFD0, EXIF and GPS IFDs of a TIFF stream. */
function ifdsOf(/** @type {Uint8Array} */ tiffBytes) {
  const tiff = openTiff(tiffBytes);
  const ifd0 = tiff.chain()[0] ?? null;
  return {
    ifd0,
    exif: ifd0 ? tiff.pointed(ifd0, 0x8769) : null,
    gps: ifd0 ? tiff.pointed(ifd0, 0x8825) : null,
  };
}

const trim = (/** @type {number} */ n, digits = 1) => String(Number(n.toFixed(digits)));

function exposure(/** @type {number | undefined} */ t) {
  if (!t || !Number.isFinite(t) || t <= 0) return undefined;
  return t >= 1 ? `${trim(t)} s` : `1/${Math.round(1 / t)} s`;
}

function position(/** @type {Ifd | null} */ gps) {
  if (!gps) return undefined;
  const angle = (
    /** @type {number} */ tag,
    /** @type {number} */ refTag,
    /** @type {string} */ negative,
  ) => {
    const [d = Number.NaN, m = 0, s = 0] = gps.numbers(tag);
    const ref = gps.text(refTag) ?? "";
    const value = d + m / 60 + s / 3600;
    return Number.isFinite(value) ? { value, ref: ref || (value < 0 ? negative : "") } : undefined;
  };
  const lat = angle(2, 1, "S");
  const lon = angle(4, 3, "W");
  if (!lat || !lon) return undefined;
  const text = `${Math.abs(lat.value).toFixed(5)}° ${lat.ref || "N"}, ${Math.abs(lon.value).toFixed(5)}° ${lon.ref || "E"}`;
  const altitude = gps.number(6);
  if (altitude === undefined || !Number.isFinite(altitude)) return text;
  return `${text}, ${trim(gps.number(5) === 1 ? -altitude : altitude)} m`;
}

/** The fields the details show, from IFD0, the EXIF IFD and the GPS IFD. */
function fieldsOf(
  /** @type {Ifd | null} */ ifd0,
  /** @type {Ifd | null} */ exif,
  /** @type {Ifd | null} */ gps,
) {
  /** @type {Field[]} */
  const fields = [];
  const add = (/** @type {string} */ label, /** @type {string | undefined} */ value) => {
    if (value) fields.push({ label, value });
  };
  const make = ifd0?.text(0x10f);
  const model = ifd0?.text(0x110);
  const brand = make?.split(" ")[0]?.toLowerCase() ?? "";
  add(
    "Camera",
    model && make && !model.toLowerCase().startsWith(brand) ? `${make} ${model}` : (model ?? make),
  );
  add("Lens", exif?.text(0xa434));
  add("Exposure time", exposure(exif?.number(0x829a)));
  const f =
    exif?.number(0x829d) ?? (exif?.has(0x9202) ? 2 ** ((exif.number(0x9202) ?? 0) / 2) : undefined);
  add("Aperture", f && Number.isFinite(f) ? `f/${trim(f)}` : undefined);
  const iso = exif?.number(0x8827) ?? exif?.number(0x8833);
  add("ISO", iso ? String(iso) : undefined);
  const focal = exif?.number(0x920a);
  const film = exif?.number(0xa405);
  const filmText =
    film && focal !== undefined && Math.round(film) !== Math.round(focal)
      ? ` (${film} mm in 35 mm film)`
      : "";
  add("Focal length", focal ? `${trim(focal)} mm${filmText}` : undefined);
  const date = exif?.text(0x9003) ?? exif?.text(0x9004) ?? ifd0?.text(0x132);
  const offset = exif?.text(0x9011);
  add(
    "Date taken",
    date
      ? `${date.replace(/^(\d{4}):(\d\d):(\d\d)/, "$1-$2-$3")}${offset ? ` ${offset}` : ""}`
      : undefined,
  );
  add("GPS position", position(gps));
  add("Software", ifd0?.text(0x131));
  return fields;
}

/**
 * The EXIF of a file, or undefined when it carries none. `format` is what sniff() said.
 * @param {Uint8Array} bytes
 * @param {string} format
 * @param {Uint8Array} [jpeg] for RAW: the embedded JPEG, whose EXIF a RAF keeps
 * @returns {Exif | undefined}
 */
export function readExif(bytes, format, jpeg) {
  try {
    /** @type {{ ifd0: Ifd | null, exif: Ifd | null, gps: Ifd | null }} */
    let ifds = { ifd0: null, exif: null, gps: null };
    const tiffShaped = has(bytes, 0, "II") || has(bytes, 0, "MM");
    if (format === "raw" && has(bytes, 4, "ftypcrx ")) {
      const cmt = cr3Exif(bytes);
      if (cmt)
        ifds = { ifd0: firstIfd(cmt.ifd0), exif: firstIfd(cmt.exif), gps: firstIfd(cmt.gps) };
    } else if ((format === "tiff" || format === "raw") && tiffShaped) ifds = ifdsOf(bytes);
    else {
      const block =
        format === "jpeg"
          ? jpegExif(bytes)
          : format === "png"
            ? pngExif(bytes)
            : format === "webp"
              ? webpExif(bytes)
              : format === "heic" || format === "avif"
                ? heifExif(bytes)
                : format === "raw" && jpeg
                  ? jpegExif(jpeg)
                  : undefined;
      if (block) ifds = ifdsOf(block);
    }
    if (!ifds.ifd0) return undefined;
    const orientation = ifds.ifd0.number(0x112) ?? 1;
    const fields = fieldsOf(ifds.ifd0, ifds.exif, ifds.gps);
    if (fields.length === 0 && orientation === 1) return undefined;
    return { orientation: orientation >= 1 && orientation <= 8 ? orientation : 1, fields };
  } catch {
    // EXIF that does not parse is EXIF the details go without.
    return undefined;
  }
}
