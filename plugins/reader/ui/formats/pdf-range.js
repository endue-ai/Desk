// pdf.js asks for offsets, never an eager download. Delivery stops with the document's signal.
// Match the desk's file URL response limit; a PDF image can request many MiB in one range.
const CHUNK = 2 * 1024 * 1024;

export function pdfRange(lib, source, signal, failed) {
  let stopped = false;
  const read = async (begin, end) => {
    const until = Math.min(end, source.size);
    const bytes = new Uint8Array(until - begin);
    for (let at = begin; at < until; ) {
      if (stopped || signal?.aborted) return;
      const length = Math.min(CHUNK, until - at);
      const part = await source.read(at, length);
      if (stopped || signal?.aborted) return;
      if (part.length !== length) throw new Error("The PDF got shorter while it was read.");
      bytes.set(part, at - begin);
      at += length;
    }
    return bytes;
  };
  class Transport extends lib.PDFDataRangeTransport {
    constructor() {
      super(source.size, new Uint8Array(), false);
    }
    requestDataRange(begin, end) {
      if (stopped || signal?.aborted) return;
      read(begin, end)
        .then((bytes) => {
          if (!bytes || stopped || signal?.aborted) return;
          this.onDataRange(begin, bytes);
        })
        .catch((error) => {
          if (!stopped) failed(error);
        });
    }
    abort() {
      stopped = true;
    }
  }
  return new Transport();
}
