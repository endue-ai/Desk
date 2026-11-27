const png = [137, 80, 78, 71, 13, 10, 26, 10];
const isPng = (bytes) => png.every((byte, i) => bytes[i] === byte);
const isJpeg = (bytes) => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
const isWebp = (bytes) =>
  String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
  String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";

export async function decode(bytes) {
  const type = isPng(bytes)
    ? "image/png"
    : isJpeg(bytes)
      ? "image/jpeg"
      : isWebp(bytes)
        ? "image/webp"
        : null;
  if (!type) throw new Error("Choose a PNG, JPEG or WebP image.");
  const bitmap = await createImageBitmap(new Blob([bytes], { type }), {
    imageOrientation: "from-image",
    premultiplyAlpha: "none",
  }).catch(() => {
    throw new Error("The file could not be decoded. Try opening another PNG, JPEG or WebP.");
  });
  try {
    const { width, height } = bitmap;
    if (width * height > 16_000_000 || Math.max(width, height) > 16_384) {
      throw new Error("Use an image up to 16 megapixels and 16,384 pixels on each side.");
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    return { width, height, pixels: context.getImageData(0, 0, width, height).data };
  } finally {
    bitmap.close();
  }
}
