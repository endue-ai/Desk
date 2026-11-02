#!/usr/bin/env python3
"""LZO1X streams made by the real liblzo2 (through ctypes, no code of it here), for the LZO decoder's
tests: deterministic inputs compressed with lzo1x_1 (what lzop uses) and lzo1x_999 (what mksquashfs
uses by default). Writes fixtures/lzo/<input>-<method>.lzo and fixtures/lzo/expected.json.
Run from anywhere: python3 plugins/formats/tests/packs/make-lzo.py [path to liblzo2]"""
import ctypes
import ctypes.util
import hashlib
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures", "lzo")
CANDIDATES = [
    "/opt/homebrew/lib/liblzo2.dylib",
    "/usr/local/lib/liblzo2.dylib",
    "/usr/lib/x86_64-linux-gnu/liblzo2.so.2",
    "/usr/lib/aarch64-linux-gnu/liblzo2.so.2",
]


def library():
    paths = sys.argv[1:] + [p for p in CANDIDATES if os.path.exists(p)]
    found = ctypes.util.find_library("lzo2")
    if found:
        paths.append(found)
    for path in paths:
        try:
            return ctypes.CDLL(path)
        except OSError:
            continue
    sys.exit("liblzo2 was not found; pass its path.")


def lcg(seed):
    state = seed
    while True:
        state = (state * 1664525 + 1013904223) % 2**32
        yield state


def text(n, seed=1):
    words = b"squashfs block fragment inode folder file link table id export lzo stream".split()
    out = bytearray()
    for r in lcg(seed):
        out += words[r % len(words)] + (b".\n" if r % 10 == 0 else b" ")
        if len(out) >= n:
            return bytes(out[:n])


def noise(n, seed=2):
    out = bytearray()
    for r in lcg(seed):
        out.append(r >> 24)
        if len(out) >= n:
            return bytes(out)


def mixed(n, seed=3):
    # Text with noise between, and far repeats, so matches reach every distance class.
    head = text(20000, seed) + noise(3000, seed) + b"z" * 300
    out = bytearray(head)
    for r in lcg(seed):
        start = r % (len(out) - 600)
        out += out[start : start + 20 + r % 500] + noise(3, r)
        if len(out) >= n:
            return bytes(out[:n])


INPUTS = {
    "text": text(48 * 1024),
    "noise": noise(8 * 1024),
    "runs": b"a" * 20000 + b"ab" * 5000 + bytes(range(256)) * 8,
    "mixed": mixed(64 * 1024),
    "tiny": b"lzo",
    "empty": b"",
}


def main():
    lzo = library()
    sizes = [2, 4, 8, 4, ctypes.sizeof(ctypes.c_size_t), 8, 8, 8, 48]
    if lzo.__lzo_init_v2(0x20A0, *sizes) != 0:
        sys.exit("lzo_init failed")
    work = ctypes.create_string_buffer(1 << 20)
    os.makedirs(OUT, exist_ok=True)
    expected = {}
    for name, data in INPUTS.items():
        expected[name] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        for method in ("1", "999"):
            compress = getattr(lzo, f"lzo1x_{method}_compress")
            dst = ctypes.create_string_buffer(len(data) + len(data) // 16 + 64 + 3)
            dst_len = ctypes.c_size_t(0)
            if compress(data, ctypes.c_size_t(len(data)), dst, ctypes.byref(dst_len), work) != 0:
                sys.exit(f"lzo1x_{method}_compress failed on {name}")
            with open(os.path.join(OUT, f"{name}-{method}.lzo"), "wb") as f:
                f.write(dst.raw[: dst_len.value])
    with open(os.path.join(OUT, "expected.json"), "w") as f:
        json.dump(expected, f, indent=2, sort_keys=True)
        f.write("\n")


main()
