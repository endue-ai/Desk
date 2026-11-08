// Separate top-level OpenDocument tables while retaining the document's automatic styles and
// workbook settings. SheetJS can then parse one table before the next table's cells are read.
/** @param {string} xml */
export function* odsParts(xml) {
  const spans = [];
  let depth = 0;
  let start = 0;
  for (const match of xml.matchAll(
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?table:table(?=[\s/>])[^>]*>/gu,
  )) {
    const tag = match[0];
    if (tag.startsWith("<!")) continue;
    if (tag.startsWith("</")) {
      if (--depth === 0) spans.push([start, match.index + tag.length]);
    } else if (tag.endsWith("/>")) {
      if (!depth) spans.push([match.index, match.index + tag.length]);
    } else if (depth++ === 0) start = match.index;
  }
  if (!spans.length || depth) {
    yield xml;
    return;
  }
  const prefix = xml.slice(0, spans[0][0]);
  const suffix = xml.slice(spans.at(-1)[1]);
  for (const [from, to] of spans) yield prefix + xml.slice(from, to) + suffix;
}
