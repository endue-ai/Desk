#!/usr/bin/env python3
"""Writes the fixtures under tests/fixtures with real tools: Pillow, ffmpeg and sips (macOS).

Run from anywhere: python3 plugins/images/tests/make-fixtures.py. Every image is a small synthetic
pattern (no photos); the EXIF holds made-up values. Lossy or float formats get a sidecar decoded by
the tool itself, so the tests compare our decoders with an independent one:
  NAME.rgba  RGBA bytes, row by row, top row first (Pillow's decode)
  NAME.f32   RGBA float32 little-endian, row by row, top row first (ffmpeg's decode)
Formats nobody here writes (16-bit TGA, ICNS it32, KTX, DICOM, FITS -32, NIfTI, RAW containers,
Netpbm P1 to P3) are built in the tests' own code (tests/build.ts).
"""

import os
import shutil
import struct
import subprocess
import tempfile

from PIL import Image
from PIL.TiffImagePlugin import IFDRational as R

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")
W, H = 8, 4


def pattern(x, y):
    """The test pattern: a flat block on the left (runs for RLE), a gradient on the right."""
    if x < 4:
        return (10, 20, 30, 255)
    return ((x * 60) % 256, (y * 80) % 256, (x * 30 + y * 40) % 256, 255 if (x + y) % 3 else 128)


def source(mode="RGBA"):
    im = Image.new("RGBA", (W, H))
    for y in range(H):
        for x in range(W):
            im.putpixel((x, y), pattern(x, y))
    return im.convert(mode)


def out(name):
    return os.path.join(OUT, name)


def sidecar_rgba(name):
    with Image.open(out(name)) as im:
        open(out(name + ".rgba"), "wb").write(im.convert("RGBA").tobytes())


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def sidecar_f32(name, alpha):
    """ffmpeg decodes the file to planar float (G, B, R[, A]); written interleaved RGBA."""
    raw = out(name + ".raw")
    ffmpeg("-i", out(name), "-f", "rawvideo", "-pix_fmt", "gbrapf32le" if alpha else "gbrpf32le", raw)
    data = open(raw, "rb").read()
    os.remove(raw)
    n = W * H
    planes = [struct.unpack_from(f"<{n}f", data, i * n * 4) for i in range(4 if alpha else 3)]
    g, b, r = planes[0], planes[1], planes[2]
    a = planes[3] if alpha else [1.0] * n
    values = [v for i in range(n) for v in (r[i], g[i], b[i], a[i])]
    open(out(name + ".f32"), "wb").write(struct.pack(f"<{4 * n}f", *values))


def sidecar_half(name, source):
    """ffmpeg's EXR decoder rounds halves inexactly, so the uncompressed file's halves are read here
    with struct's IEEE half ("e"); every compression of the same pattern holds the same halves."""
    data = open(out(source), "rb").read()
    at = 8
    channels = []
    while True:
        end = data.index(b"\0", at)
        attr = data[at:end].decode()
        at = end + 1
        if not attr:
            break
        end = data.index(b"\0", at)
        at = end + 1
        size = struct.unpack_from("<I", data, at)[0]
        if attr == "channels":
            c = at + 4
            while data[c] != 0:
                stop = data.index(b"\0", c)
                channels.append(data[c:stop].decode())
                c = stop + 17
        at += 4 + size
    values = []
    for y in range(H):
        offset = struct.unpack_from("<Q", data, at + y * 8)[0]
        row = {}
        for i, channel in enumerate(channels):
            row[channel] = struct.unpack_from(f"<{W}e", data, offset + 8 + i * W * 2)
        for x in range(W):
            values += [row["R"][x], row["G"][x], row["B"][x], row["A"][x]]
    open(out(name + ".f32"), "wb").write(struct.pack(f"<{4 * W * H}f", *values))


def exif_block(orientation):
    exif = Image.Exif()
    exif[0x010F] = "Example"
    exif[0x0110] = "Example Camera 1"
    exif[0x0112] = orientation
    exif[0x0131] = "fixture-maker 1.0"
    ifd = exif.get_ifd(0x8769)
    ifd[0x829A] = R(1, 250)
    ifd[0x829D] = R(28, 10)
    ifd[0x8827] = 400
    ifd[0x9003] = "2026:10:31 12:34:56"
    ifd[0x920A] = R(35, 1)
    ifd[0xA434] = "Example Lens 35mm F2.8"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[3] = "N", "E"
    gps[2] = (R(37, 1), R(33, 1), R(5994, 100))
    gps[4] = (R(126, 1), R(58, 1), R(408, 10))
    return exif.tobytes()


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    tmp = tempfile.mkdtemp()
    png = os.path.join(tmp, "source.png")
    source().save(png)

    # Formats the webview decodes, with EXIF: the photo is 64 x 48 and stored rotated (orientation 6).
    photo = Image.new("RGB", (64, 48), (200, 80, 40))
    exif = exif_block(6)
    photo.save(out("exif.jpg"), exif=exif, quality=80)
    photo.save(out("exif.png"), exif=exif)
    photo.save(out("exif.webp"), exif=exif, quality=80)
    photo.save(out("exif.avif"), exif=exif, quality=60)
    subprocess.run(["sips", "-s", "format", "heic", out("exif.jpg"), "--out", out("exif.heic")],
                   check=True, capture_output=True)
    # Two plain JPEGs for the RAW containers the tests build: a thumbnail and a larger preview.
    Image.new("RGB", (16, 12), (40, 120, 200)).save(out("small.jpg"), quality=70)
    Image.new("RGB", (64, 48), (40, 200, 120)).save(out("large.jpg"), quality=70)
    # A one-channel JPEG larger than both, as older PowerShot CRWs keep sensor data.
    Image.new("L", (128, 96), 128).save(out("grey.jpg"), quality=70)
    # Animated GIF, APNG and WebP: three frames each.
    frames = [Image.new("RGB", (8, 8), c) for c in ((255, 0, 0), (0, 255, 0), (0, 0, 255))]
    frames[0].save(out("anim.gif"), save_all=True, append_images=frames[1:], duration=100, loop=0)
    frames[0].save(out("anim.png"), save_all=True, append_images=frames[1:], duration=100)
    frames[0].save(out("anim.webp"), save_all=True, append_images=frames[1:], duration=100,
                   lossless=True)

    # TGA, raw and RLE; colour-mapped; greyscale.
    source("RGB").save(out("raw24.tga"))
    source().save(out("rle32.tga"), compression="tga_rle")
    source("RGB").quantize(16).save(out("mapped.tga"), compression="tga_rle")
    sidecar_rgba("mapped.tga")
    source("L").save(out("grey.tga"))
    sidecar_rgba("grey.tga")
    # Netpbm binary P4, P5 (8 and 16 bit), P6 from Pillow; P7 (PAM) from ffmpeg.
    source("1").save(out("p4.pbm"))
    sidecar_rgba("p4.pbm")
    source("L").save(out("p5.pgm"))
    sidecar_rgba("p5.pgm")
    source("L").convert("I").point(lambda v: v * 257).convert("I;16").save(out("p5-16.pgm"))
    source("RGB").save(out("p6.ppm"))
    ffmpeg("-i", png, "-pix_fmt", "rgba", out("p7.pam"))
    # QOI from Pillow.
    source().save(out("rgba.qoi"))
    # DDS: uncompressed RGBA, BC1 (DXT1), BC2 (DXT3), BC3 (DXT5) and BC3 behind a DX10 header.
    source().save(out("rgba.dds"))
    source("RGB").save(out("bc1.dds"), pixel_format="DXT1")
    source().save(out("bc2.dds"), pixel_format="DXT3")
    source().save(out("bc3.dds"), pixel_format="DXT5")
    source().save(out("bc3-dx10.dds"), pixel_format="BC3")
    for name in ("bc1.dds", "bc2.dds", "bc3.dds", "bc3-dx10.dds"):
        sidecar_rgba(name)
    # Radiance HDR and OpenEXR from ffmpeg (values are the pattern / 255, all at most 1).
    ffmpeg("-i", png, "-pix_fmt", "gbrpf32le", out("rgbe.hdr"))
    sidecar_f32("rgbe.hdr", False)
    for compression in ("none", "rle", "zip1", "zip16"):
        for kind in ("half", "float"):
            name = f"{compression}-{kind}.exr"
            ffmpeg("-i", png, "-pix_fmt", "gbrapf32le", "-compression", compression, "-format", kind,
                   out(name))
            if kind == "float":
                sidecar_f32(name, True)
            else:
                sidecar_half(name, "none-half.exr")
    # ICNS with PNG entries, from Pillow.
    Image.new("RGBA", (64, 64), (90, 60, 200, 255)).save(out("png.icns"), sizes=[(16, 16), (32, 32)])

    shutil.rmtree(tmp)
    total = sum(os.path.getsize(out(n)) for n in os.listdir(OUT))
    print(f"{len(os.listdir(OUT))} fixtures, {total} bytes")


if __name__ == "__main__":
    main()
