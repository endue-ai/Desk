// The formats Docs opens: the name the header shows and the noun a reason uses.

/** @type {Record<string, [name: string, noun: string]>} */
export const FORMATS = {
  docx: ["Word document", "a Word document"],
  docm: ["Word macro-enabled document", "a Word document"],
  dotx: ["Word template", "a Word template"],
  dotm: ["Word macro-enabled template", "a Word template"],
  doc: ["Word 97-2003 document", "a Word document"],
  dot: ["Word 97-2003 template", "a Word template"],
  odt: ["OpenDocument text", "an OpenDocument text"],
  ott: ["OpenDocument text template", "an OpenDocument template"],
  fodt: ["Flat OpenDocument text", "an OpenDocument text"],
  sxw: ["OpenOffice.org 1.0 text", "an OpenOffice.org text"],
  rtf: ["Rich Text Format", "an RTF document"],
  pages: ["Pages document", "a Pages document"],
  hwp: ["Hangul document (HWP 5.0)", "a Hangul document"],
  hwpx: ["Hangul document (HWPX)", "a Hangul document"],
  abw: ["AbiWord document", "an AbiWord document"],
  wpd: ["WordPerfect document", "a WordPerfect document"],
  wps: ["Microsoft Works document", "a Works document"],
  gdoc: ["Google Docs shortcut", "a Google Docs shortcut"],
};

export const formatName = (/** @type {string} */ format) =>
  FORMATS[format]?.[0] ?? "Unknown format";

export const noun = (/** @type {string} */ format) => FORMATS[format]?.[1] ?? "a document";
