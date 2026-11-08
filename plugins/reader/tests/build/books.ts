// EPUB 2 and 3 and FictionBook 2 fixtures, built here: no personal data, a few words of prose.
import { zip } from "./archive";
import { png } from "./png";

const CONTAINER = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const chapter = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="../styles/book.css"/>
<style>p.lead { font-weight: bold; } @import url("https://example.com/remote.css");</style>
<script>window.parent.postMessage("escaped", "*")</script></head>
<body>${body}</body>
</html>`;

const BOOK_CSS = `body { margin: 0 5%; color: #222; }
h1 { font-size: 1.6em; background: url("../images/dot.png") no-repeat; }
.remote { background: url(https://example.com/track.png); }
@font-face { font-family: "Fixture Serif"; src: url("../fonts/missing.otf"); }`;

const CHAPTERS: Array<[id: string, file: string, title: string, body: string]> = [
  [
    "intro",
    "text/intro.xhtml",
    "Introduction",
    `<h1 id="top">Introduction</h1>
<p class="lead" onclick="steal()" onmouseover="steal()">The lantern was lit at dusk.</p>
<p><img src="../images/dot.png" alt="A dot"/> <img src="https://example.com/pixel.png" alt="Remote"/></p>
<p><a href="road.xhtml#bend">To the bend in the road</a> and <a href="https://example.com/">a web page</a>
and <a href="javascript:steal()">a script link</a>.</p>
<script type="text/javascript">steal()</script>
<iframe src="https://example.com/"></iframe>
<form action="https://example.com/"><input name="q"/></form>`,
  ],
  [
    "road",
    "text/road.xhtml",
    "The Road",
    `<h1>The Road</h1><p>They walked on.</p><h2 id="bend">The bend</h2><p>The lantern swung.</p>`,
  ],
  ["end", "text/end.xhtml", "The End", `<h1>The End</h1><p>Morning came.</p>`],
];

const NAV = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head>
<body>
<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="text/intro.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>
  <li><a href="text/intro.xhtml">Introduction</a></li>
  <li><a href="text/road.xhtml">The Road</a><ol><li><a href="text/road.xhtml#bend">The bend</a></li></ol></li>
  <li><a href="text/end.xhtml">The End</a></li>
</ol></nav>
</body></html>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="urn:uuid:fixture"/></head>
<docTitle><text>Two Roads</text></docTitle>
<navMap>
  <navPoint id="n1" playOrder="1"><navLabel><text>Introduction</text></navLabel><content src="text/intro.xhtml"/></navPoint>
  <navPoint id="n2" playOrder="2"><navLabel><text>The Road</text></navLabel><content src="text/road.xhtml"/>
    <navPoint id="n3" playOrder="3"><navLabel><text>The bend</text></navLabel><content src="text/road.xhtml#bend"/></navPoint>
  </navPoint>
  <navPoint id="n4" playOrder="4"><navLabel><text>The End</text></navLabel><content src="text/end.xhtml"/></navPoint>
</navMap>
</ncx>`;

/** An EPUB 3 (nav.xhtml) or EPUB 2 (toc.ncx) book. Its manifest lists the chapters out of order. */
export function epub(version: 2 | 3): Uint8Array {
  const items = [...CHAPTERS]
    .reverse()
    .map(([id, file]) => `<item id="${id}" href="${file}" media-type="application/xhtml+xml"/>`);
  const nav =
    version === 3
      ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`
      : `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`;
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:identifier id="uid">urn:uuid:fixture</dc:identifier><dc:title>Two Roads</dc:title>
  <dc:creator>Fixture Author</dc:creator><dc:language>en</dc:language>
</metadata>
<manifest>
  ${nav}
  ${items.join("\n  ")}
  <item id="css" href="styles/book.css" media-type="text/css"/>
  <item id="dot" href="images/dot.png" media-type="image/png"/>
</manifest>
<spine${version === 2 ? ' toc="ncx"' : ""}>
  ${CHAPTERS.map(([id]) => `<itemref idref="${id}"/>`).join("\n  ")}
</spine>
</package>`;
  return zip([
    ["mimetype", "application/epub+zip", { store: true }],
    ["META-INF/container.xml", CONTAINER],
    ["OEBPS/content.opf", opf],
    version === 3 ? ["OEBPS/nav.xhtml", NAV] : ["OEBPS/toc.ncx", NCX],
    ...CHAPTERS.map(([, file, title, body]): [string, string] => [
      `OEBPS/${file}`,
      chapter(title, body),
    ]),
    ["OEBPS/styles/book.css", BOOK_CSS],
    ["OEBPS/images/dot.png", png(2, 2, [200, 40, 40])],
  ]);
}

/** A FictionBook 2 book: two sections, emphasis, a note and a base64 image. */
export function fb2(): Uint8Array {
  const image = Buffer.from(png(3, 2, [40, 120, 200])).toString("base64");
  return new TextEncoder().encode(`<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><genre>prose</genre><author><first-name>Fixture</first-name><last-name>Author</last-name></author>
<book-title>The Lantern Keeper</book-title><lang>en</lang></title-info></description>
<body>
<title><p>The Lantern Keeper</p></title>
<section id="s1"><title><p>Chapter One</p></title>
<p>The <emphasis>lantern</emphasis> hung by the door.<a l:href="#n1" type="note">[1]</a></p>
<p>She lit the lantern at <strong>dusk</strong>.</p>
<image l:href="#pic"/>
<empty-line/>
<poem><stanza><v>A light, a line.</v></stanza></poem>
</section>
<section id="s2"><title><p>Chapter Two</p></title>
<section><title><p>A smaller part</p></title><p>The road bent east and the lantern swung.</p></section>
<p onclick="steal()">Morning came.</p>
</section>
</body>
<body name="notes"><title><p>Notes</p></title>
<section id="n1"><title><p>1</p></title><p>An old brass lantern.</p></section>
</body>
<binary id="pic" content-type="image/png">${image}</binary>
</FictionBook>`);
}
