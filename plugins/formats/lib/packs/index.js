// Packs: file systems and images that hold a tree of files in one file. SquashFS 4.0 (alone, as a
// Snap, or after an AppImage's runtime) and WIM (Windows images), each answered as an Archive, and
// the decoders they bring that lib/codecs does not have: LZO1X, XPRESS Huffman and LZX.
export { openAppImage } from "./appimage.js";
export { lzo1x } from "./lzo.js";
export { lzxWim } from "./lzx.js";
export { openSquashfs } from "./squashfs.js";
export { openWim } from "./wim.js";
export { xpressHuffman } from "./xpress.js";
