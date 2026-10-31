// Builds small PresentationML packages for tests: one theme, one master with title and body
// placeholders and text styles, one layout that places the title, and slides from XML fragments.
import { type Entry, zip } from "./zip";

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PKG = "http://schemas.openxmlformats.org/package/2006/relationships";

/** A 1 x 1 PNG. */
export const PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

export const EMU = 12700;

const rels = (list: Array<[id: string, type: string, target: string]>) =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${PKG}">${list
    .map(
      ([id, type, target]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"/>`,
    )
    .join("")}</Relationships>`;

export const THEME = `<?xml version="1.0" encoding="UTF-8"?>
<a:theme ${NS} name="Test"><a:themeElements>
<a:clrScheme name="Test"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Test"><a:majorFont><a:latin typeface="Georgia"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Verdana"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Test"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme>
</a:themeElements></a:theme>`;

const ph = (type: string, idx: string, xfrm: string, extra = "") =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${idx}0" name="${type} ${idx}"/><p:cNvSpPr/><p:nvPr><p:ph type="${type}"${idx === "0" ? "" : ` idx="${idx}"`}/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm}</p:spPr><p:txBody><a:bodyPr anchor="b"/>${extra}<a:p><a:r><a:t>Master ${type}</a:t></a:r></a:p></p:txBody></p:sp>`;

export const xfrm = (x: number, y: number, w: number, h: number, attrs = "") =>
  `<a:xfrm${attrs}><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>`;

export const MASTER = `<?xml version="1.0" encoding="UTF-8"?>
<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FAFAFA"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
${ph("title", "0", xfrm(838200, 365125, 10515600, 1325563))}
${ph("body", "1", xfrm(838200, 1825625, 10515600, 4351338))}
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="4400" b="1"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr marL="228600" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="&#8226;"/><a:defRPr sz="2800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>
<a:lvl2pPr marL="685800" indent="-228600"><a:buFont typeface="Arial"/><a:buChar char="&#8211;"/><a:defRPr sz="2400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl2pPr></p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr></p:otherStyle>
</p:txStyles></p:sldMaster>`;

/** The layout moves the title (and nothing else) and gives it no font. */
export const LAYOUT_TITLE = { x: 457200, y: 228600, w: 9144000, h: 914400 };

const LAYOUT = `<?xml version="1.0" encoding="UTF-8"?>
<p:sldLayout ${NS} type="titleOnly"><p:cSld name="Title Only"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title 1"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>
<p:spPr>${xfrm(LAYOUT_TITLE.x, LAYOUT_TITLE.y, LAYOUT_TITLE.w, LAYOUT_TITLE.h)}</p:spPr><p:txBody><a:bodyPr/><a:p><a:r><a:t>Layout title</a:t></a:r></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Body 2"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:t>Layout body</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

export interface SlideSpec {
  /** Shapes inside the slide's spTree. */
  shapes: string;
  notes?: string;
  hidden?: boolean;
  background?: string;
}

const slideXml = (spec: SlideSpec) => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld ${NS}${spec.hidden ? ' show="0"' : ""}><p:cSld>${spec.background ?? ""}<p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>${spec.shapes}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;

const notesXml = (text: string) => `<?xml version="1.0" encoding="UTF-8"?>
<p:notes ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image 1"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes 2"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/>${text
  .split("\n")
  .map((line) => `<a:p><a:r><a:t>${line}</a:t></a:r></a:p>`)
  .join("")}</p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="4" name="Slide Number 3"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:spPr/>
<p:txBody><a:bodyPr/><a:p><a:fld id="{1}" type="slidenum"><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;

/** A deck of 16:9 slides (12192000 x 6858000 EMU, 960 x 540 points). Every slide may use rId9 for PNG. */
export function pptx(slides: SlideSpec[], extra: Record<string, Entry> = {}): Uint8Array {
  const files: Record<string, Entry> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>`,
    "_rels/.rels": rels([["rId1", "officeDocument", "ppt/presentation.xml"]]),
    "ppt/presentation.xml": `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides
      .map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`)
      .join(
        "",
      )}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": rels([
      ["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
      ["rId2", "theme", "theme/theme1.xml"],
      ...slides.map((_, i): [string, string, string] => [
        `rId${i + 10}`,
        "slide",
        `slides/slide${i + 1}.xml`,
      ]),
    ]),
    "ppt/theme/theme1.xml": THEME,
    "ppt/slideMasters/slideMaster1.xml": MASTER,
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId2", "theme", "../theme/theme1.xml"],
    ]),
    "ppt/slideLayouts/slideLayout1.xml": LAYOUT,
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([
      ["rId1", "slideMaster", "../slideMasters/slideMaster1.xml"],
    ]),
    "ppt/media/image1.png": PNG,
  };
  slides.forEach((spec, i) => {
    const n = i + 1;
    files[`ppt/slides/slide${n}.xml`] = slideXml(spec);
    const list: Array<[string, string, string]> = [
      ["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
      ["rId9", "image", "../media/image1.png"],
    ];
    if (spec.notes !== undefined) {
      list.push(["rId2", "notesSlide", `../notesSlides/notesSlide${n}.xml`]);
      files[`ppt/notesSlides/notesSlide${n}.xml`] = notesXml(spec.notes);
    }
    files[`ppt/slides/_rels/slide${n}.xml.rels`] = rels(list);
  });
  return zip({ ...files, ...extra });
}

let ids = 100;
/** A shape with preset geometry, at EMU coordinates. */
export const shape = (
  geometry: string,
  box: [number, number, number, number],
  inner = "",
  text = "",
) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++ids}" name="${geometry} ${ids}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(...box)}<a:prstGeom prst="${geometry}"><a:avLst/></a:prstGeom>${inner}</p:spPr>${
    text
      ? `<p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody>`
      : ""
  }</p:sp>`;

/** The slide's title placeholder with no position and no font of its own. */
export const title = (text: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="${++ids}" name="Title"/><p:cNvSpPr/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>`;
