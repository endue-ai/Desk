import { expect, it, vi } from "vitest";
import { pdfRange } from "../ui/formats/pdf-range.js";

const CHUNK = 2 * 1024 * 1024;
class Range {
  onDataRange = vi.fn();
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

it("assembles a large PDF range from bounded native-sized reads at exact offsets", async () => {
  const begin = 123;
  const length = 2 * CHUNK + 321;
  const failed = vi.fn();
  const read = vi.fn(async (offset: number, asked: number) => {
    // The native file URL sends at most 2 MiB in one response.
    const bytes = new Uint8Array(Math.min(asked, CHUNK));
    for (let i = 0; i < bytes.length; i++) bytes[i] = (offset + i) % 251;
    return bytes;
  });
  const transport = pdfRange(
    { PDFDataRangeTransport: Range },
    { size: begin + length, read },
    undefined,
    failed,
  );
  transport.requestDataRange(begin, begin + length + 100);
  await settle();
  expect(read.mock.calls).toEqual([
    [begin, CHUNK],
    [begin + CHUNK, CHUNK],
    [begin + 2 * CHUNK, 321],
  ]);
  expect(transport.onDataRange).toHaveBeenCalledOnce();
  const [offset, bytes] = transport.onDataRange.mock.calls[0] ?? [];
  expect(offset).toBe(begin);
  expect(bytes).toHaveLength(length);
  for (const i of [0, CHUNK - 1, CHUNK, 2 * CHUNK - 1, 2 * CHUNK, length - 1])
    expect(bytes[i]).toBe((begin + i) % 251);
  expect(failed).not.toHaveBeenCalled();
});

it.each(["signal", "transport"])("stops between chunks when %s cancels", async (kind) => {
  const stop = new AbortController();
  const failed = vi.fn();
  const read = vi.fn(async (_offset: number, length: number) => {
    if (kind === "signal") stop.abort();
    else transport.abort();
    return new Uint8Array(length);
  });
  const transport = pdfRange(
    { PDFDataRangeTransport: Range },
    { size: 3 * CHUNK, read },
    stop.signal,
    failed,
  );
  transport.requestDataRange(7, 3 * CHUNK);
  await settle();
  expect(read).toHaveBeenCalledExactlyOnceWith(7, CHUNK);
  expect(transport.onDataRange).not.toHaveBeenCalled();
  expect(failed).not.toHaveBeenCalled();
});

it.each([0, CHUNK - 1])("reports a short read of %i bytes without another request", async (sent) => {
  const failed = vi.fn();
  const read = vi.fn(async () => new Uint8Array(sent));
  const transport = pdfRange(
    { PDFDataRangeTransport: Range },
    { size: 3 * CHUNK, read },
    undefined,
    failed,
  );
  transport.requestDataRange(1, 3 * CHUNK);
  await settle();
  expect(failed).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ message: "The PDF got shorter while it was read." }),
  );
  expect(read).toHaveBeenCalledOnce();
  expect(transport.onDataRange).not.toHaveBeenCalled();
});
