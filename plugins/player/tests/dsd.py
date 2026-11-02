"""Writes the DSD fixtures: a second-order sigma-delta modulation of two sines (1 kHz left, 500 Hz
right, half scale) at 2.8224 MHz, as DSF (Sony's DSD Stream File, LSB first in blocks of 4096 bytes
per channel) and as DSDIFF (Philips' DFF, bytes interleaved, MSB first). No third-party code.

    python3 -I dsd.py out.dsf out.dff
"""
import math
import struct
import sys

RATE = 2822400
SECONDS = 0.15
FREQUENCIES = (1000.0, 500.0)
BLOCK = 4096


def modulate(frequency, count):
    """One channel's bits: +1 as 1, -1 as 0."""
    bits = bytearray(count)
    first = second = 0.0
    out = -1.0
    step = 2 * math.pi * frequency / RATE
    for i in range(count):
        x = 0.5 * math.sin(step * i)
        first += x - out
        second += first - out
        out = 1.0 if second >= 0 else -1.0
        bits[i] = 1 if out > 0 else 0
    return bits


def pack(bits, lsb_first):
    out = bytearray((len(bits) + 7) // 8)
    for i, bit in enumerate(bits):
        if bit:
            out[i // 8] |= 1 << (i % 8 if lsb_first else 7 - i % 8)
    return bytes(out)


def dsf(channels, count):
    per_channel = [pack(bits, True) for bits in channels]
    blocks = -(-len(per_channel[0]) // BLOCK)
    # Padding is DSD silence (0x69), not zeros, which would be full-scale DC.
    padded = [data.ljust(blocks * BLOCK, b"\x69") for data in per_channel]
    data = b"".join(p[b * BLOCK:(b + 1) * BLOCK] for b in range(blocks) for p in padded)
    fmt = struct.pack("<IIIIIIQII", 1, 0, 2, len(channels), RATE, 1, count, BLOCK, 0)
    body = b"fmt " + struct.pack("<Q", 12 + len(fmt)) + fmt
    body += b"data" + struct.pack("<Q", 12 + len(data)) + data
    total = 28 + len(body)
    return b"DSD " + struct.pack("<QQQ", 28, total, 0) + body


def chunk(tag, payload):
    padded = payload + (b"\x00" if len(payload) % 2 else b"")
    return tag + struct.pack(">Q", len(payload)) + padded


def dff(channels):
    per_channel = [pack(bits, False) for bits in channels]
    data = bytes(b for frame in zip(*per_channel) for b in frame)
    name = b"not compressed"
    prop = b"SND " + chunk(b"FS  ", struct.pack(">I", RATE))
    prop += chunk(b"CHNL", struct.pack(">H", len(channels)) + b"SLFTSRGT"[: 4 * len(channels)])
    prop += chunk(b"CMPR", b"DSD " + bytes([len(name)]) + name)
    body = b"DSD " + chunk(b"FVER", struct.pack(">I", 0x01050000)) + chunk(b"PROP", prop)
    body += chunk(b"DSD ", data)
    return b"FRM8" + struct.pack(">Q", len(body)) + body


def main():
    count = int(RATE * SECONDS) // 8 * 8
    channels = [modulate(f, count) for f in FREQUENCIES]
    with open(sys.argv[1], "wb") as out:
        out.write(dsf(channels, count))
    with open(sys.argv[2], "wb") as out:
        out.write(dff([bits[: count // 3 // 8 * 8] for bits in channels]))


main()
