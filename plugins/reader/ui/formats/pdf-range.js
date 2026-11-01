// pdf.js asks for offsets, never an eager download. Delivery stops with the document's signal.
export function pdfRange(lib, source, signal, failed) {
  let stopped = false;
  class Transport extends lib.PDFDataRangeTransport {
    constructor() {
      super(source.size, new Uint8Array(), false);
    }
    requestDataRange(begin, end) {
      if (stopped || signal?.aborted) return;
      source
        .read(begin, end - begin)
        .then((bytes) => {
          if (stopped || signal?.aborted) return;
          if (bytes.length !== Math.min(end, source.size) - begin)
            throw new Error("The PDF got shorter while it was read.");
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
