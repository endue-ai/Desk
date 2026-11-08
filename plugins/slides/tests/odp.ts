// Builds a small ODF presentation for tests: a master page with a solid background and a logo
// shape, a title style, and pages from XML fragments.
import { PNG } from "./pptx";
import { type Entry, zip } from "./zip";

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"',
].join(" ");

export const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles ${NS} office:version="1.3">
<office:styles>
<style:style style:name="Default-title" style:family="presentation"><style:graphic-properties draw:fill="none" draw:stroke="none" draw:textarea-vertical-align="middle"/>
<style:paragraph-properties fo:text-align="center"/><style:text-properties fo:font-size="44pt" fo:font-family="Georgia" fo:color="#1f1f1f"/></style:style>
<style:style style:name="Default-outline1" style:family="presentation"><style:graphic-properties draw:fill="none" draw:stroke="none"/><style:text-properties fo:font-size="32pt"/></style:style>
<style:style style:name="Default-outline2" style:family="presentation" style:parent-style-name="Default-outline1"><style:text-properties fo:font-size="28pt"/></style:style>
<style:style style:name="Default-notes" style:family="presentation"><style:text-properties fo:font-size="20pt"/></style:style>
</office:styles>
<office:automatic-styles>
<style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout>
<style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:background-size="full" draw:fill="solid" draw:fill-color="#123456"/></style:style>
<style:style style:name="Mgr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#ff9900" draw:stroke="none"/></style:style>
</office:automatic-styles>
<office:master-styles>
<style:master-page style:name="Default" style:page-layout-name="PM1" draw:style-name="Mdp1">
<draw:frame presentation:style-name="Default-title" presentation:class="title" presentation:placeholder="true" svg:x="1cm" svg:y="1cm" svg:width="26cm" svg:height="3cm"><draw:text-box/></draw:frame>
<draw:custom-shape draw:style-name="Mgr1" svg:x="26cm" svg:y="14cm" svg:width="1cm" svg:height="1cm"><draw:enhanced-geometry draw:type="ellipse"/></draw:custom-shape>
</style:master-page>
</office:master-styles></office:document-styles>`;

export const page = (name: string, inner: string, notes = "", attrs = "") =>
  `<draw:page draw:name="${name}" draw:master-page-name="Default"${attrs}>${inner}${
    notes
      ? `<presentation:notes><draw:frame presentation:style-name="Default-notes" presentation:class="notes" svg:x="2cm" svg:y="14cm" svg:width="17cm" svg:height="12cm"><draw:text-box>${notes
          .split("\n")
          .map((line) => `<text:p>${line}</text:p>`)
          .join("")}</draw:text-box></draw:frame></presentation:notes>`
      : ""
  }</draw:page>`;

export function odp(pages: string, automatic = "", extra: Record<string, Entry> = {}): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${NS} office:version="1.3"><office:automatic-styles>
<style:style style:name="dp2" style:family="drawing-page"><style:drawing-page-properties presentation:visibility="hidden"/></style:style>
<style:style style:name="gr1" style:family="graphic"><style:graphic-properties draw:fill="solid" draw:fill-color="#3366cc" svg:stroke-color="#000000" svg:stroke-width="0.1cm" draw:stroke="solid"/></style:style>
<style:style style:name="pr1" style:family="presentation" style:parent-style-name="Default-title"/>
<style:style style:name="pr2" style:family="presentation" style:parent-style-name="Default-outline1"/>
<style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/></style:style>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#cc0000"/></style:style>
<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="●"><style:list-level-properties text:space-before="0.6cm" text:min-label-width="0.9cm"/></text:list-level-style-bullet>
<text:list-level-style-bullet text:level="2" text:bullet-char="–"><style:list-level-properties text:space-before="1.6cm" text:min-label-width="0.8cm"/></text:list-level-style-bullet></text:list-style>
${automatic}</office:automatic-styles><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`;
  return zip({
    mimetype: "application/vnd.oasis.opendocument.presentation",
    "META-INF/manifest.xml": `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest ${NS}><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/></manifest:manifest>`,
    "content.xml": content,
    "styles.xml": STYLES,
    "Pictures/dot.png": PNG,
    ...extra,
  });
}
