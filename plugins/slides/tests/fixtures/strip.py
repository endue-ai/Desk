# Rewrites a compound file without its summary streams: LibreOffice's .ppt carries a 400 KB
# thumbnail there. Reads every stream of the root storage and writes a version 3 file again.
import struct
import sys

END, FREE, FATSECT = 0xFFFFFFFE, 0xFFFFFFFF, 0xFFFFFFFD


def read(data):
    shift, mini_shift = struct.unpack_from("<HH", data, 30)
    size, mini = 1 << shift, 1 << mini_shift
    nfat, first_dir = struct.unpack_from("<II", data, 44)
    cutoff, first_minifat = struct.unpack_from("<II", data, 56)
    fat = []
    for s in struct.unpack_from("<109I", data, 76)[:nfat]:
        fat += struct.unpack_from("<%dI" % (size // 4), data, size + s * size)

    def chain(s, table):
        out = []
        while s < 0xFFFFFFF0 and len(out) <= len(table):
            out.append(s)
            s = table[s]
        return out

    def sectors(s):
        return b"".join(data[size + i * size : size + (i + 1) * size] for i in chain(s, fat))

    directory = sectors(first_dir)
    entries = [directory[i : i + 128] for i in range(0, len(directory), 128)]
    root = entries[0]
    mini_stream = sectors(struct.unpack_from("<I", root, 116)[0])
    minifat_bytes = sectors(first_minifat) if first_minifat < 0xFFFFFFF0 else b""
    minifat = list(struct.unpack_from("<%dI" % (len(minifat_bytes) // 4), minifat_bytes))
    streams = {}
    for e in entries[1:]:
        length = struct.unpack_from("<H", e, 64)[0]
        if length == 0 or e[66] != 2:
            continue
        name = e[: length - 2].decode("utf-16le")
        start, n = struct.unpack_from("<II", e, 116)
        if n < cutoff:
            body = b"".join(mini_stream[i * mini : (i + 1) * mini] for i in chain(start, minifat))
        else:
            body = sectors(start)
        streams[name] = body[:n]
    return streams


def write(streams):
    names = sorted(streams, key=lambda n: (len(n), n.upper()))
    sectors, fat = [], []

    def place(body):
        if not body:
            return END
        first, count = len(sectors), (len(body) + 511) // 512
        for i in range(count):
            sectors.append(body[i * 512 : (i + 1) * 512].ljust(512, b"\0"))
            fat.append(END if i == count - 1 else first + i + 1)
        return first

    mini, minifat, starts = b"", [], {}
    for name in names:
        body = streams[name]
        if 0 < len(body) < 4096:
            first, count = len(mini) // 64, (len(body) + 63) // 64
            minifat += [END if i == count - 1 else first + i + 1 for i in range(count)]
            mini += body.ljust(count * 64, b"\0")
            starts[name] = first
    for name in names:
        if len(streams[name]) >= 4096:
            starts[name] = place(streams[name])
    mini_start = place(mini)
    raw = b"".join(struct.pack("<I", v) for v in minifat)
    minifat_start = place(raw.ljust(-(-len(raw) // 512) * 512, b"\xff")) if minifat else END
    minifat_count = -(-len(raw) // 512) if minifat else 0
    entries = [("Root Entry", 5, mini_start, len(mini))]
    entries += [(n, 2, starts.get(n, END), len(streams[n])) for n in names]
    directory = b""
    for i, (name, kind, start, n) in enumerate(entries):
        right = i + 1 if 0 < i < len(entries) - 1 else FREE
        child = 1 if i == 0 and len(entries) > 1 else FREE
        encoded = name.encode("utf-16le").ljust(64, b"\0")
        directory += encoded + struct.pack("<HBB3I", (len(name) + 1) * 2, kind, 1, FREE, right, child)
        directory += b"\0" * 36 + struct.pack("<III", start, n, 0)
    while len(directory) % 512:
        directory += b"\0" * 64 + struct.pack("<HBB3I", 0, 0, 0, FREE, FREE, FREE) + b"\0" * 48
    dir_start = place(directory)
    nfat = 1
    while (len(sectors) + nfat) * 4 > nfat * 512:
        nfat += 1
    fat_start = len(sectors)
    fat += [FATSECT] * nfat
    fat_bytes = b"".join(struct.pack("<I", v) for v in fat).ljust(nfat * 512, b"\xff")
    sectors += [fat_bytes[i * 512 : (i + 1) * 512] for i in range(nfat)]
    header = bytes.fromhex("d0cf11e0a1b11ae1") + b"\0" * 16
    header += struct.pack("<HHHHH", 0x3E, 3, 0xFFFE, 9, 6) + b"\0" * 10
    header += struct.pack("<II", nfat, dir_start) + b"\0" * 4
    header += struct.pack("<IIIII", 4096, minifat_start, minifat_count, END, 0)
    header += b"".join(struct.pack("<I", fat_start + i if i < nfat else FREE) for i in range(109))
    return header + b"".join(sectors)


path = sys.argv[1]
with open(path, "rb") as f:
    streams = read(f.read())
for name in ["\x05SummaryInformation", "\x05DocumentSummaryInformation"]:
    streams.pop(name, None)
with open(path, "wb") as f:
    f.write(write(streams))
