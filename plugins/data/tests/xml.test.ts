// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { parseXml } from "../ui/parse/xml.js";
import { childrenOf, type DataNode } from "../ui/tree.js";
import { at } from "./harness";
import { nth, rootOf, where } from "./nodes";

/** An element as [name, ...children], attributes as "@name=value", text as its string. */
type Outline = string | [string, ...Outline[]];
const outline = (node: DataNode): Outline => {
  if (node.kind === "element") return [String(node.key), ...childrenOf(node).map(outline)];
  if (node.tag === "attribute") return `${String(node.key)}=${String(node.value)}`;
  if (node.tag === "cdata") return `cdata:${String(node.value)}`;
  return String(node.value);
};

const CATALOG = `<?xml version="1.0" encoding="UTF-8"?>
<catalog xmlns:xs="http://www.w3.org/2001/XMLSchema" xml:lang="en">
  <!-- a comment -->
  <book id="b1" xs:type="novel">
    <title>Desk &amp; Data</title>
    <note><![CDATA[<raw> & text]]></note>
  </book>
  <empty/>
</catalog>
`;

describe("XML with DOMParser", () => {
  it("elements, attributes with their prefixes, text and CDATA, with positions", () => {
    const doc = parseXml(CATALOG);
    expect(doc.errors).toEqual([]);
    const root = rootOf(doc);
    expect(outline(root)).toEqual([
      "catalog",
      "@xmlns:xs=http://www.w3.org/2001/XMLSchema",
      "@xml:lang=en",
      [
        "book",
        "@id=b1",
        "@xs:type=novel",
        ["title", "Desk & Data"],
        ["note", "cdata:<raw> & text"],
      ],
      ["empty"],
    ]);
    const book = nth(root, 2);
    expect(where(root)).toEqual(at(CATALOG, "<catalog"));
    expect(where(book)).toEqual(at(CATALOG, "<book"));
    expect(where(nth(book, 0))).toEqual(at(CATALOG, 'id="b1"'));
    expect(where(nth(nth(book, 2), 0))).toEqual(at(CATALOG, "Desk &amp;"));
    expect(childrenOf(book)[1]).toMatchObject({ kind: "string", prefix: "xs" });
    expect(book.prefix).toBeUndefined();
  });

  it("reads XSD and XSLT, whose names carry their prefix", () => {
    const xsd = parseXml(`<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema">
  <xs:element name="note" type="xs:string"/>
</xs:schema>`);
    expect(outline(rootOf(xsd))).toEqual([
      "xs:schema",
      "@xmlns:xs=http://www.w3.org/2001/XMLSchema",
      ["xs:element", "@name=note", "@type=xs:string"],
    ]);
    expect(xsd.roots[0]?.prefix).toBe("xs");
    const xsl =
      parseXml(`<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">
  <xsl:template match="/"><p>hi</p></xsl:template>
</xsl:stylesheet>`);
    expect(outline(rootOf(xsl))).toEqual([
      "xsl:stylesheet",
      "@version=1.0",
      "@xmlns:xsl=http://www.w3.org/1999/XSL/Transform",
      ["xsl:template", "@match=/", ["p", "hi"]],
    ]);
  });

  it("an error says its line and the tree shows what parsed before it", () => {
    const text = "<root>\n  <a>one</a>\n  <b>\n</root>\n";
    const doc = parseXml(text);
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]?.line).toBe(4);
    expect(doc.errors[0]?.message).not.toBe("");
    const root = rootOf(doc);
    expect(outline(root).slice(0, 2)).toEqual(["root", ["a", "one"]]);
  });
});
