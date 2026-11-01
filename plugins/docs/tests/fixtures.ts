// The same small document (a heading, a bold run, a 2 by 2 table and an image) in ODF, flat ODF,
// OpenOffice 1.0, RTF and AbiWord, plus the text-only formats (WordPerfect, Works) and the
// packages that open as a preview or a card, all built in code.
import { makeCfb, utf16 } from "./cfb";
import { base64 } from "./model";
import { concat, hex, makeZip, PNG, utf8 } from "./zip";

const ODF_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:dc="http://purl.org/dc/elements/1.1/"',
].join(" ");

const ODF_STYLES = `<office:automatic-styles>
<style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout>
</office:automatic-styles>
<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>`;

const odfImage = (inner: string) =>
  `<text:p><draw:frame draw:name="Image1" svg:width="1in" svg:height="1in"><draw:image ${inner}/></draw:frame></text:p>`;

const odfBody = (image: string) => `<office:body><office:text>
<text:h text:outline-level="1">Annual report</text:h>
<text:p>Sales rose <text:span text:style-name="T1">sharply</text:span> this year.</text:p>
<table:table table:name="T"><table:table-column table:number-columns-repeated="2"/>
<table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>Total</text:p></table:table-cell></table:table-row>
<table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:table-cell><text:p>42</text:p></table:table-cell></table:table-row>
</table:table>
${odfImage(image)}
</office:text></office:body>`;

export function makeOdt(mimetype = "application/vnd.oasis.opendocument.text") {
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ODF_NS} office:version="1.3">${ODF_STYLES}${odfBody('xlink:href="Pictures/chart.png"')}</office:document-content>`;
  return makeZip({
    mimetype,
    "content.xml": content,
    "styles.xml": `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${ODF_NS}><office:styles/></office:document-styles>`,
    "Pictures/chart.png": PNG,
    "META-INF/manifest.xml": manifest(mimetype, [
      "content.xml",
      "styles.xml",
      "Pictures/chart.png",
    ]),
  });
}

const manifest = (mimetype: string, files: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="${mimetype}"/>${files
    .map(
      (f) =>
        `<manifest:file-entry manifest:full-path="${f}" manifest:media-type="${f.endsWith(".png") ? "image/png" : "text/xml"}"/>`,
    )
    .join("")}</manifest:manifest>`;

export const makeFodt = () =>
  utf8(
    `<?xml version="1.0" encoding="UTF-8"?><office:document ${ODF_NS} office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">${ODF_STYLES}${odfBody(
      "",
    ).replace(
      "<draw:image />",
      `<draw:image><office:binary-data>${base64(PNG)}</office:binary-data></draw:image>`,
    )}</office:document>`,
  );

/** OpenOffice.org 1.0 Writer: the same shapes in the old namespaces and element names. */
export function makeSxw() {
  const ns =
    'xmlns:office="http://openoffice.org/2000/office" xmlns:style="http://openoffice.org/2000/style" xmlns:text="http://openoffice.org/2000/text" xmlns:table="http://openoffice.org/2000/table" xmlns:draw="http://openoffice.org/2000/drawing" xmlns:fo="http://www.w3.org/1999/XSL/Format" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:svg="http://www.w3.org/2000/svg"';
  const content = `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${ns}>
<office:automatic-styles><style:style style:name="T1" style:family="text"><style:properties fo:font-weight="bold"/></style:style></office:automatic-styles>
<office:body><text:h text:level="1">Annual report</text:h><text:p>Sales rose <text:span text:style-name="T1">sharply</text:span> this year.</text:p>
<table:table table:name="T"><table:table-column table:number-columns-repeated="2"/><table:table-row><table:table-cell><text:p>Region</text:p></table:table-cell><table:table-cell><text:p>Total</text:p></table:table-cell></table:table-row><table:table-row><table:table-cell><text:p>North</text:p></table:table-cell><table:table-cell><text:p>42</text:p></table:table-cell></table:table-row></table:table>
<text:p><draw:image draw:name="I" xlink:href="#Pictures/chart.png" svg:width="1inch" svg:height="1inch"/></text:p></office:body></office:document-content>`;
  return makeZip({
    mimetype: "application/vnd.sun.xml.writer",
    "content.xml": content,
    "Pictures/chart.png": PNG,
    "META-INF/manifest.xml": manifest("application/vnd.sun.xml.writer", [
      "content.xml",
      "Pictures/chart.png",
    ]),
  });
}

export const makeRtf = () =>
  utf8(String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0\froman\fcharset0 Times New Roman;}}
{\colortbl;\red0\green0\blue0;}
{\stylesheet{\s0 Normal;}{\s1\outlinelevel0\b\fs32 heading 1;}}
\paperw11906\paperh16838\margl1134\margr1134\margt1134\margb1134
\pard\plain\s1\outlinelevel0\b\fs32 Annual report\par
\pard\plain Sales rose {\b sharply} this year.\par
\trowd\cellx2000\cellx4000\pard\intbl Region\cell Total\cell\row
\trowd\cellx2000\cellx4000\pard\intbl North\cell 42\cell\row
\pard{\pict\pngblip\picw2\pich2\picwgoal1440\pichgoal1440 ${hex(PNG)}}\par
}`);

/** Korean text two ways: code page 949 bytes after \ansicpg949, and \uN with a fallback. */
export const makeKoreanRtf = () =>
  utf8(String.raw`{\rtf1\ansi\ansicpg949\deff0{\fonttbl{\f0\fnil\fcharset129 Batang;}}
\pard\plain\f0 \'c7\'d1\'b1\'db \'b9\'ae\'bc\'ad\par
\pard\plain\uc1\u-10916?\u-20992?\par
}`);

export const makeAbw = () =>
  utf8(`<?xml version="1.0" encoding="UTF-8"?>
<abiword template="false" xmlns="http://www.abisource.com/awml.dtd" xmlns:xlink="http://www.w3.org/1999/xlink" version="3.0.4" fileformat="1.1">
<styles><s type="P" name="Normal" followedby="Current Settings" props="font-family:Times New Roman; font-size:12pt"/>
<s type="P" name="Heading 1" basedon="Normal" followedby="Normal" props="font-weight:bold; font-size:17pt; margin-top:22pt"/></styles>
<pagesize pagetype="A4" orientation="portrait" width="210.000000" height="297.000000" units="mm" page-scale="1.000000"/>
<section props="page-margin-left:1in; page-margin-right:1in; page-margin-top:1in; page-margin-bottom:1in">
<p style="Heading 1">Annual report</p>
<p style="Normal">Sales rose <c props="font-weight:bold">sharply</c> this year.</p>
<table props="table-column-props:2in/2in/">
<cell props="left-attach:0; right-attach:1; top-attach:0; bot-attach:1"><p>Region</p></cell>
<cell props="left-attach:1; right-attach:2; top-attach:0; bot-attach:1"><p>Total</p></cell>
<cell props="left-attach:0; right-attach:1; top-attach:1; bot-attach:2"><p>North</p></cell>
<cell props="left-attach:1; right-attach:2; top-attach:1; bot-attach:2"><p>42</p></cell>
</table>
<p><image dataid="image1" props="width:1in; height:1in"/></p>
</section>
<data><d name="image1" mime-type="image/png" base64="yes">${base64(PNG)}</d></data>
</abiword>`);

/** WordPerfect 6: the prefix, then text with hard returns, a bold pair and an extended char. */
export function makeWpd() {
  const prefix = new Uint8Array(16);
  prefix.set([0xff, 0x57, 0x50, 0x43, 16, 0, 0, 0, 1, 10, 2, 1]);
  const text = (s: string) => utf8(s);
  const body = concat([
    text("First paragraph of "),
    new Uint8Array([0xf2, 12, 0xf2]),
    text("WordPerfect"),
    new Uint8Array([0xf3, 12, 0xf3]),
    text(" text."),
    new Uint8Array([0xcc]),
    text("Caf"),
    new Uint8Array([0xf0, 41, 1, 0xf0]),
    text(" second."),
    new Uint8Array([0xcc]),
  ]);
  return concat([prefix, body]);
}

/** Works 2000 (WPS 8): a compound file whose CONTENTS stream indexes a UTF-16 TEXT chunk. */
export function makeWps() {
  const text = utf16("Works first line\rWorks second line\r");
  // "CHNKWKS ", a 24-byte header, then 24-byte index entries: flags, name, id, count, name,
  // offset and length.
  const header = new Uint8Array(56);
  header.set(utf8("CHNKWKS "));
  header.set([4, 0, 1, 0, 1, 0, 0, 3], 8);
  const entry = new DataView(header.buffer, 32, 24);
  entry.setUint16(0, 0x18, true);
  header.set(utf8("TEXT"), 34);
  entry.setUint32(8, 1, true);
  header.set(utf8("TEXT"), 44);
  entry.setUint32(16, 512, true);
  entry.setUint32(20, text.length, true);
  const contents = new Uint8Array(512 + text.length);
  contents.set(header);
  contents.set(text, 512);
  return makeCfb({ CONTENTS: contents });
}

/** A Pages package: the document in IWA (not read) and two preview sizes. */
export const makePages = (big: Uint8Array, small: Uint8Array) =>
  makeZip({
    "Index/Document.iwa": new Uint8Array(64),
    "preview-micro.jpg": small,
    "preview.jpg": big,
    "Metadata/DocumentIdentifier": "0000",
  });

export const makeGdoc = () =>
  utf8(
    JSON.stringify({
      url: "https://docs.google.com/document/d/1AbCdEf/edit",
      doc_id: "1AbCdEf",
      email: "someone@example.com",
      resource_id: "document:1AbCdEf",
    }),
  );

/** An encrypted Word document: a compound file holding the encrypted package. */
export const makeEncryptedDocx = () =>
  makeCfb({ EncryptionInfo: new Uint8Array(64).fill(4), EncryptedPackage: new Uint8Array(600) });

/** An ODF package whose manifest says its content is encrypted. */
export const makeEncryptedOdt = () =>
  makeZip({
    mimetype: "application/vnd.oasis.opendocument.text",
    "content.xml": new Uint8Array(200).fill(7),
    "META-INF/manifest.xml": `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"><manifest:encryption-data manifest:checksum-type="SHA1/1K" manifest:checksum="xxxx"><manifest:algorithm manifest:algorithm-name="Blowfish CFB" manifest:initialisation-vector="xxxx"/></manifest:encryption-data></manifest:file-entry></manifest:manifest>`,
  });
