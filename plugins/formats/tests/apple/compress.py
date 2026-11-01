"""Files compressed the way macOS keeps them (decmpfs): the com.apple.decmpfs attribute, the
resource fork for the larger types, and the UF_COMPRESSED flag, written through the public xattr
calls, with Apple's own encoders from libcompression. make-fixtures.py reads every file back
through the kernel, so a layout the kernel does not take fails the build."""
import ctypes
import os
import stat
import struct
import zlib

LIBC = ctypes.CDLL(None, use_errno=True)
LIBC.setxattr.argtypes = [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_void_p, ctypes.c_size_t,
                          ctypes.c_uint32, ctypes.c_int]
LIB = ctypes.CDLL("/usr/lib/libcompression.dylib")
LIB.compression_encode_buffer.restype = ctypes.c_size_t
LIB.compression_encode_buffer.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p,
                                          ctypes.c_size_t, ctypes.c_void_p, ctypes.c_int]
LZVN, LZFSE = 0x900, 0x801  # libcompression's algorithm numbers
NOFOLLOW, SHOWCOMPRESSION = 0x1, 0x20
BLOCK = 64 * 1024


def encode(data, algorithm):
    """Apple's encoder: raw LZVN (0x900) or an LZFSE stream (0x801)."""
    out = ctypes.create_string_buffer(len(data) * 2 + 4096)
    n = LIB.compression_encode_buffer(out, len(out), data, len(data), None, algorithm)
    if not n:
        raise SystemExit(f"libcompression could not encode with 0x{algorithm:x}")
    return out.raw[:n]


def setxattr(path, name, value):
    if LIBC.setxattr(path.encode(), name.encode(), value, len(value), 0, NOFOLLOW | SHOWCOMPRESSION):
        err = ctypes.get_errno()
        raise OSError(err, os.strerror(err), f"{name} on {path}")


def zlib_fork(data):
    """A resource fork holding one 'cmpf' resource: the block table, then zlib blocks of 64 KiB."""
    blocks = [zlib.compress(data[i:i + BLOCK], 9) for i in range(0, len(data), BLOCK)]
    table = struct.pack("<I", len(blocks))
    at = 4 + 8 * len(blocks)
    for block in blocks:
        table += struct.pack("<II", at, len(block))
        at += len(block)
    body = table + b"".join(blocks)
    resource = struct.pack(">I", len(body)) + body
    data_offset, data_length = 0x100, len(resource)
    map_offset = data_offset + data_length
    header = struct.pack(">IIII", data_offset, map_offset, data_length, 0x32)
    # The map: its copy of the header left zero (the kernel refuses a filled one), one 'cmpf' type.
    resource_map = (bytes(22) + struct.pack(">HHHH", 0, 0x1C, 0x32, 0) + b"cmpf"
                    + struct.pack(">HH", 0, 0x0A) + struct.pack(">hHI", 1, 0xFFFF, 0) + bytes(4))
    return header + bytes(data_offset - 16) + resource + resource_map


def table_fork(data, algorithm, raw_marker):
    """LZVN and LZFSE forks: the offsets of the blocks (one more than there are), then the blocks."""
    blocks = []
    for i in range(0, len(data), BLOCK):
        chunk = data[i:i + BLOCK]
        packed = encode(chunk, algorithm)
        blocks.append(packed if len(packed) < len(chunk) else raw_marker + chunk)
    offsets = [4 * (len(blocks) + 1)]
    for block in blocks:
        offsets.append(offsets[-1] + len(block))
    return struct.pack(f"<{len(offsets)}I", *offsets) + b"".join(blocks)


# type: (where the data goes, how it is made)
TYPES = {
    3: ("attr", lambda d: zlib.compress(d, 9)),
    4: ("fork", zlib_fork),
    7: ("attr", lambda d: encode(d, LZVN)),
    8: ("fork", lambda d: table_fork(d, LZVN, b"\x06")),
    11: ("attr", lambda d: encode(d, LZFSE)),
    12: ("fork", lambda d: table_fork(d, LZFSE, b"\xff")),
}


def compressed(path, data, kind):
    """Write `data` to `path` as a decmpfs file of `kind` (3, 4, 7, 8, 11 or 12)."""
    where, make = TYPES[kind]
    with open(path, "wb"):
        pass
    header = b"fpmc" + struct.pack("<IQ", kind, len(data))
    if where == "attr":
        setxattr(path, "com.apple.decmpfs", header + make(data))
    else:
        setxattr(path, "com.apple.ResourceFork", make(data))
        setxattr(path, "com.apple.decmpfs", header)
    os.chflags(path, stat.UF_COMPRESSED)
    with open(path, "rb") as f:
        back = f.read()
    if back != data or not os.lstat(path).st_flags & stat.UF_COMPRESSED:
        raise SystemExit(f"the kernel does not read {path} (decmpfs type {kind}) back")
