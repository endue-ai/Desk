// A presentation written the way PowerPoint writes one, built in test code: placeholders that take
// their boxes and styles from the master, text in the outline, the master's own shapes and footers,
// a gradient with a focus, colours of the shape's own, a link, automatic numbering, a group, a
// slide with its own scheme and background, a metafile and a PNG, notes and a hidden slide.
import {
  atom,
  box,
  cfRun,
  drawing,
  group,
  le,
  pfRun,
  presentation,
  shape,
  text,
  utf16,
} from "./records";

const MASTER = 0x80000000;
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
/** A colour scheme from 0xRRGGBB values (stored red, green, blue, unused). */
const scheme = (...colors: number[]) =>
  atom(
    0x07f0,
    le(
      ...colors.map((c): [number, 4] => [
        ((c >> 16) & 0xff) | (c & 0xff00) | ((c & 0xff) << 16),
        4,
      ]),
    ),
    1,
  );
const slideAtom = (master: number, notes: number, flags: number) =>
  atom(0x03ef, le([1, 4], new Uint8Array(8), [master, 4], [notes, 4], [flags, 2], [0, 2]), 0, 2);
const persist = (ref: number, id: number) =>
  atom(0x03f3, le([ref, 4], [0, 4], [0, 4], [id, 4], [0, 4]));
const font = (name: string) => atom(0x0fb7, le(utf16(name), new Uint8Array(68 - name.length * 2)));
const showInfo = (hidden: boolean) =>
  atom(0x03f9, le([0, 4], [0, 4], [0, 1], [0, 1], [hidden ? 4 : 0, 2], [0, 4]));
const NO_FILL: [number, number] = [0x01bf, 0x100000];
const NO_LINE: [number, number] = [0x01ff, 0x80000];

/** The master's text styles: a centred bold title, and a body with two bullet levels. */
const TITLE_STYLE = le(
  [1, 2],
  [0x800, 4],
  [1, 2],
  [0x70001, 4],
  [1, 2],
  [2, 2],
  [40, 2],
  [0x03000000, 4],
);
const BODY_STYLE = le(
  ...([
    [2, 2],
    ...[
      [0x2022, 216, 0, 28],
      [0x2013, 432, 216, 24],
    ].flatMap(
      ([char = 0, margin = 0, indent = 0, size = 0]): Array<[number, 2 | 4]> => [
        [0x581, 4],
        [1, 2],
        [char, 2],
        [margin, 2],
        [indent, 2],
        [0x20000, 4],
        [size, 2],
      ],
    ),
  ] as Array<[number, 2 | 4]>),
);

/** A PowerPoint-style deck: placeholders take their styles from the master, text from the outline. */
export function powerPointDeck() {
  const ninth = (n: number) =>
    le(
      ...Array.from({ length: n }, () =>
        le([0x03000000, 4], [1, 2], [3, 2], [1, 2], [0, 4], [0, 4]),
      ),
    );
  const tag = box(0x1388, [
    box(0x138a, [atom(0x0fba, utf16("___PPT9")), box(0x138b, [atom(0x0fac, ninth(2))])]),
  ]);
  const master = box(0x03f8, [
    slideAtom(0, 0, 0),
    scheme(0xffffff, 0x202020, 0x808080, 0x1f3864, 0xe2efda, 0xc00000, 0x0563c1, 0x954f72),
    atom(0x0fa3, TITLE_STYLE, 0),
    atom(0x0fa3, BODY_STYLE, 1),
    drawing(
      [
        shape({
          spid: 0x401,
          placement: 1,
          anchor: [288, 216, 5472, 864],
          props: [[0x0087, 1], NO_FILL, NO_LINE],
          textbox: text(0, "Click to edit"),
        }),
        shape({
          spid: 0x402,
          placement: 2,
          anchor: [288, 1152, 5472, 3888],
          props: [NO_FILL, NO_LINE],
          textbox: text(1, "Body"),
        }),
        shape({
          type: 3,
          spid: 0x403,
          anchor: [5184, 3600, 5616, 4032],
          props: [[0x0181, 0x08000005], NO_LINE],
        }),
        shape({
          spid: 0x404,
          placement: 8,
          anchor: [4608, 3888, 5472, 4176],
          props: [NO_FILL, NO_LINE],
          textbox: [...text(4, "*"), atom(0x0fd8, le([0, 4]))],
        }),
      ],
      [[0x0181, 0x08000000]],
    ),
  ]);
  const slide1 = box(0x03ee, [
    slideAtom(MASTER, 0x101, 7),
    showInfo(false),
    box(0x0fd9, [atom(0x0fda, le([0, 2], [8, 2]))], 0),
    drawing([
      shape({
        spid: 0x801,
        flags: 0x220,
        placement: 13,
        anchor: [288, 144, 5472, 720],
        props: [[0x0301, 0x401]],
        textbox: [atom(0x0f9e, le([0, 4]))],
      }),
      shape({
        spid: 0x802,
        flags: 0x220,
        placement: 14,
        anchor: [288, 1008, 5472, 3456],
        props: [[0x0301, 0x402]],
        textbox: [atom(0x0f9e, le([1, 4]))],
      }),
      shape({
        spid: 0x803,
        anchor: [288, 3600, 2016, 4176],
        props: [
          [0x0180, 4],
          [0x0181, 0x0000ff],
          [0x0183, 0xff0000],
          [0x018c, 50],
          [0x01c0, 0x108001f0],
          [0x01cb, 25400],
          [0x01ff, 0x80008],
        ],
      }),
      shape({
        type: 202,
        spid: 0x804,
        anchor: [2304, 3600, 5472, 4176],
        props: [NO_FILL, NO_LINE],
        data: [tag],
        textbox: [
          ...text(
            4,
            "First\rSecond",
            le(pfRun(6, 0, 1, [1, 2]), pfRun(7, 0, 1, [1, 2]), cfRun(13, 0)),
          ),
          box(0x0ff2, [atom(0x0ff3, new Uint8Array(16))]),
          atom(0x0fdf, le([0, 4], [5, 4])),
        ],
      }),
      group(
        0x805,
        [3600, 1008, 4752, 1584],
        [0, 0, 200, 100],
        [
          shape({
            spid: 0x806,
            child: true,
            anchor: [0, 0, 100, 100],
            props: [
              [0x0181, 0x00ff00],
              [0x0004, 30 << 16],
            ],
          }),
        ],
      ),
    ]),
  ]);
  const slide2 = box(0x03ee, [
    slideAtom(MASTER, 0, 0),
    showInfo(true),
    scheme(0xffffff, 0x336699, 0x808080, 0x000000, 0xffffff, 0x333399, 0x009999, 0x99cc00),
    drawing(
      [
        shape({
          type: 202,
          spid: 0xc01,
          anchor: [288, 288, 2880, 864],
          props: [NO_FILL, NO_LINE],
          textbox: text(4, "Plain"),
        }),
        shape({
          type: 75,
          spid: 0xc02,
          anchor: [288, 1152, 1440, 2304],
          props: [[0x0104, 1], NO_LINE],
        }),
        shape({
          type: 75,
          spid: 0xc03,
          anchor: [2880, 1152, 4032, 2304],
          props: [[0x0104, 2], NO_LINE],
        }),
      ],
      [[0x0181, 0xccffff]],
    ),
  ]);
  const notes = box(0x03f0, [
    atom(0x03f1, le([256, 4], [0, 2], [0, 2]), 0, 1),
    drawing([
      shape({
        type: 202,
        spid: 0x1001,
        placement: 12,
        anchor: [0, 0, 100, 100],
        textbox: text(2, "Speak.\rSmile."),
      }),
    ]),
  ]);
  const bse = (kind: number, blip: Uint8Array = new Uint8Array()) =>
    atom(
      0xf007,
      le(
        [kind, 1],
        [kind, 1],
        new Uint8Array(16),
        [0, 2],
        [blip.length, 4],
        [1, 4],
        [0, 4],
        [0, 4],
        blip,
      ),
      kind,
      2,
    );
  const document = box(0x03e8, [
    atom(
      0x03e9,
      le(
        [5760, 4],
        [4320, 4],
        [4320, 4],
        [5760, 4],
        [1, 4],
        [2, 4],
        [0, 4],
        [0, 4],
        [1, 2],
        [0, 2],
        [0, 4],
      ),
      0,
      1,
    ),
    box(0x03f2, [
      box(0x07d5, [font("Arial"), font("Wingdings"), font("Georgia")]),
      atom(0x0fa4, le([0x60000, 4], [18, 2], [0x01000000, 4])),
    ]),
    box(0x040b, [
      box(0xf000, [
        box(0xf001, [bse(3), bse(6, atom(0xf01e, le(new Uint8Array(17), PNG), 0x6e0))], 2),
      ]),
    ]),
    box(0x0ff0, [persist(2, MASTER)], 1),
    box(0x0ff0, [
      persist(3, 256),
      ...text(0, "Hello", le(pfRun(6, 0, 0), cfRun(6, 0))),
      ...text(1, "One\rTwo", le(pfRun(4, 0, 0), pfRun(4, 1, 0), cfRun(8, 0))),
      persist(4, 257),
    ]),
    box(0x0ff0, [persist(5, 0x101)], 2),
    atom(0x03ea, new Uint8Array()),
  ]);
  return presentation([document, master, slide1, slide2, notes]);
}
