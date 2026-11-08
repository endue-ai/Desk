// Builds PowerPoint 97-2003 files in test code, written the way PowerPoint writes them ([MS-PPT],
// [MS-ODRAW]): record headers, atoms and containers, OfficeArt shapes with their property tables,
// text with style runs, and the persist directory, user edit and Current User stream that make a
// stream a presentation. No personal data.
import { cfb } from "../../cfb";

/** Little-endian fields: [value, size in bytes] pairs, or raw bytes. */
export function le(...fields: Array<[number, 1 | 2 | 4] | Uint8Array>): Uint8Array {
  const parts = fields.map((f) => {
    if (f instanceof Uint8Array) return f;
    const [v, size] = f;
    const out = new Uint8Array(size);
    for (let i = 0; i < size; i++) out[i] = (v >>> (8 * i)) & 0xff;
    return out;
  });
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** An atom: a record header with version 0 (or `ver`) and a body. */
export const atom = (type: number, body: Uint8Array, inst = 0, ver = 0) =>
  concat([le([ver | (inst << 4), 2], [type, 2], [body.length, 4]), body]);

/** A container: version 0xF and its children. */
export const box = (type: number, children: Uint8Array[], inst = 0) =>
  atom(type, concat(children), inst, 0xf);

export const utf16 = (text: string) =>
  le(...[...text].map((c): [number, 2] => [c.charCodeAt(0), 2]));

/** An OfficeArtFOPT: [property id, value] pairs; a complex value is its bytes. */
export function fopt(props: Array<[number, number | Uint8Array]>, type = 0xf00b): Uint8Array {
  const table = props.map(([pid, v]) =>
    typeof v === "number" ? le([pid, 2], [v, 4]) : le([pid | 0x8000, 2], [v.length, 4]),
  );
  const data = props.flatMap(([, v]) => (typeof v === "number" ? [] : [v]));
  return atom(type, concat([...table, ...data]), props.length, 3);
}

export interface ShapeSpec {
  type?: number;
  spid: number;
  flags?: number;
  props?: Array<[number, number | Uint8Array]>;
  /** left, top, right, bottom in master units (576 an inch). */
  anchor?: [number, number, number, number];
  child?: boolean;
  placement?: number;
  textbox?: Uint8Array[];
  data?: Uint8Array[];
}

/** An OfficeArtSpContainer. */
export function shape(s: ShapeSpec): Uint8Array {
  const [l = 0, t = 0, r = 0, b = 0] = s.anchor ?? [];
  const parts = [atom(0xf00a, le([s.spid, 4], [s.flags ?? 0xa00, 4]), s.type ?? 1, 2)];
  if (s.props?.length) parts.push(fopt(s.props));
  if (s.anchor)
    parts.push(
      s.child
        ? atom(0xf00f, le([l, 4], [t, 4], [r, 4], [b, 4]))
        : atom(0xf010, le([t, 2], [l, 2], [r, 2], [b, 2])),
    );
  const data = [...(s.data ?? [])];
  if (s.placement) data.unshift(atom(0x0bc3, le([0, 4], [s.placement, 1], [0, 1], [0, 2])));
  if (data.length) parts.push(box(0xf011, data));
  if (s.textbox) parts.push(box(0xf00d, s.textbox));
  return box(0xf004, parts);
}

/** A group: its own shape (with its child frame), then its children. */
export function group(
  spid: number,
  anchor: [number, number, number, number],
  frame: [number, number, number, number],
  children: Uint8Array[],
  props: Array<[number, number | Uint8Array]> = [],
  child = false,
) {
  const [l, t, r, b] = frame;
  const own = box(0xf004, [
    atom(0xf009, le([l, 4], [t, 4], [r, 4], [b, 4]), 0, 1),
    atom(0xf00a, le([spid, 4], [0x201 | (child ? 2 : 0), 4]), 0, 2),
    ...(props.length ? [fopt(props)] : []),
    child
      ? atom(0xf00f, le([anchor[0], 4], [anchor[1], 4], [anchor[2], 4], [anchor[3], 4]))
      : atom(0xf010, le([anchor[1], 2], [anchor[0], 2], [anchor[2], 2], [anchor[3], 2])),
  ]);
  return box(0xf003, [own, ...children]);
}

/** A DrawingContainer: the patriarch group with the shapes, and a background shape. */
export function drawing(shapes: Uint8Array[], background: Array<[number, number]> = []) {
  const patriarch = box(0xf004, [
    atom(0xf009, new Uint8Array(16), 0, 1),
    atom(0xf00a, le([1, 4], [5, 4]), 0, 2),
  ]);
  return box(0x040c, [
    box(0xf002, [
      atom(0xf008, le([shapes.length + 1, 4], [0, 4])),
      box(0xf003, [patriarch, ...shapes]),
      shape({ spid: 2, flags: 0xc00, props: background }),
    ]),
  ]);
}

/** A text: its header, characters and, given runs, a StyleTextPropAtom. */
export function text(type: number, chars: string, style?: Uint8Array): Uint8Array[] {
  return [
    atom(0x0f9f, le([type, 4])),
    atom(0x0fa0, utf16(chars)),
    ...(style ? [atom(0x0fa1, style)] : []),
  ];
}

/** A TextPFRun or TextCFRun body: a count, an indent level (PF only), masks and fields. */
export const pfRun = (
  count: number,
  level: number,
  masks: number,
  ...fields: Array<[number, 1 | 2 | 4]>
) => le([count, 4], [level, 2], [masks, 4], ...fields);
export const cfRun = (count: number, masks: number, ...fields: Array<[number, 1 | 2 | 4]>) =>
  le([count, 4], [masks, 4], ...fields);

/**
 * A PowerPoint Document stream from its top-level records, persist id n + 1 for records[n] (the
 * document is persist id 1), and a Current User stream naming its user edit.
 */
export function presentation(records: Uint8Array[], streams: Record<string, Uint8Array> = {}) {
  const offsets: number[] = [];
  let at = 0;
  for (const r of records) {
    offsets.push(at);
    at += r.length;
  }
  const dir = atom(
    0x1772,
    le([1 | (records.length << 20), 4], ...offsets.map((o): [number, 4] => [o, 4])),
  );
  const edit = atom(
    0x0ff5,
    le(
      [0, 4],
      [0, 2],
      [0, 1],
      [3, 1],
      [0, 4],
      [at, 4],
      [1, 4],
      [records.length + 1, 4],
      [1, 2],
      [0, 2],
    ),
  );
  const doc = concat([...records, dir, edit]);
  const user = atom(
    0x0ff6,
    le(
      [0x14, 4],
      [0xe391c05f, 4],
      [at + dir.length, 4],
      [0, 2],
      [0x03f4, 2],
      [3, 1],
      [0, 1],
      [0, 2],
    ),
  );
  return cfb({ "Current User": user, "PowerPoint Document": doc, ...streams });
}
