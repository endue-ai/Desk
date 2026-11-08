// A Word (OOXML) document built in code: styles with inheritance, numbering, a merged table, an
// inline image, a comment, a footnote, a header, a hyperlink, a page break and tracked changes.
import { makeZip, PNG } from "./zip";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const DRAW =
  'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${W}>
  <w:docDefaults>
    <w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Heading1"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:sz w:val="26"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:ind w:left="720"/></w:pPr></w:style>
  <w:style w:type="character" w:styleId="Strong"><w:name w:val="Strong"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>
    <w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const p = (style: string, body: string, extra = "") =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extra}</w:pPr>${body}</w:p>`;
const r = (text: string, props = "") =>
  `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const item = (level: number, text: string) =>
  p("ListParagraph", r(text), `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr>`);
const cell = (text: string, props = "") =>
  `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/>${props}</w:tcPr><w:p>${r(text)}</w:p></w:tc>`;

const image = `<w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="457200"/><wp:docPr id="1" name="Picture 1" descr="A chart"/>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdImage"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;

const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} ${R} ${DRAW}><w:body>
${p("Heading1", r("Introduction"))}
<w:p>${r("Plain text, then ")}<w:r><w:rPr><w:rStyle w:val="Strong"/></w:rPr><w:t>strong text</w:t></w:r>${r(" and ")}<w:hyperlink r:id="rIdLink"><w:r><w:t>a link</w:t></w:r></w:hyperlink>${r(".")}</w:p>
${p("Heading2", r("Details"))}
${item(0, "First")}
${item(0, "Second")}
${item(1, "Nested")}
<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
<w:tr>${cell("Both columns", '<w:gridSpan w:val="2"/>').replace('w:w="3000"', 'w:w="6000"')}</w:tr>
<w:tr>${cell("Tall", '<w:vMerge w:val="restart"/>')}${cell("B2")}</w:tr>
<w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc>${cell("B3")}</w:tr>
</w:tbl>
<w:p>${image}</w:p>
<w:p>${r("This was ")}<w:commentRangeStart w:id="7"/>${r("reviewed")}<w:commentRangeEnd w:id="7"/><w:r><w:commentReference w:id="7"/></w:r>${r(" by a person.")}</w:p>
<w:p>${r("Text ")}<w:ins w:id="1" w:author="Ana"><w:r><w:t>added</w:t></w:r></w:ins><w:del w:id="2" w:author="Ana"><w:r><w:delText>removed</w:delText></w:r></w:del>${r(" here.")}<w:r><w:footnoteReference w:id="1"/></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r>${r("Second page")}</w:p>
<w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708"/></w:sectPr>
</w:body></w:document>`;

const comments = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:comments ${W}><w:comment w:id="7" w:author="Ana Lee" w:date="2026-10-01T09:00:00Z" w:initials="AL"><w:p>${r("Check this number.")}</w:p></w:comment></w:comments>`;

const footnotes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes ${W}><w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/></w:r>${r(" A footnote.")}</w:p></w:footnote></w:footnotes>`;

const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr ${W}><w:p>${r("Company confidential")}</w:p></w:hdr>`;

const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="${REL}/styles" Target="styles.xml"/>
<Relationship Id="rIdNumbering" Type="${REL}/numbering" Target="numbering.xml"/>
<Relationship Id="rIdComments" Type="${REL}/comments" Target="comments.xml"/>
<Relationship Id="rIdFootnotes" Type="${REL}/footnotes" Target="footnotes.xml"/>
<Relationship Id="rIdHeader" Type="${REL}/header" Target="header1.xml"/>
<Relationship Id="rIdImage" Type="${REL}/image" Target="media/image1.png"/>
<Relationship Id="rIdLink" Type="${REL}/hyperlink" Target="https://example.com/report" TargetMode="External"/>
</Relationships>`;

const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;

const packageRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/></Relationships>`;

export function makeDocx(): Promise<Uint8Array> {
  return makeZip({
    "[Content_Types].xml": contentTypes,
    "_rels/.rels": packageRels,
    "word/document.xml": document,
    "word/_rels/document.xml.rels": rels,
    "word/styles.xml": styles,
    "word/numbering.xml": numbering,
    "word/comments.xml": comments,
    "word/footnotes.xml": footnotes,
    "word/header1.xml": header,
    "word/media/image1.png": PNG,
  });
}
