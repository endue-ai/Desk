#!/usr/bin/env python3
"""Makes the archives plugin's test fixtures with the real tools, into tests/fixtures/.

  python3 plugins/archives/tests/make-fixtures.py

macOS tools: zip, tar (bsdtar), gzip, bzip2, xz, lzma, zstd, lz4, compress, hdiutil, xar, pkgbuild.
Linux tools run in Docker (make-fixtures-linux.sh): 7-Zip, dpkg-deb, rpmbuild, gem, gcab, wixl, rar,
arj, lha, sfdisk, qemu-img, wimlib, mksquashfs and mktorrent. A few files are built here byte by byte
where no tool writes the variant (a ZIP with the xz and zstd methods, a CP437 name, CRX headers, RAR 4).
Disk images are mostly zeros and are kept gzipped (`*.gz` beside the name); tests gunzip them.
The fixtures hold generated words only, no personal data.
"""
import bz2, gzip, hashlib, json, lzma, os, random, shutil, struct, subprocess, tempfile, zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "fixtures"
WHEN = 1790856000  # 2026-10-01T12:00:00Z


def words(seed, size):
    """Deterministic lines of words: compressible like text, not like one repeated phrase."""
    r = random.Random(seed)
    vocab = ("archive folder entry stream block header table index window literal match offset "
             "length the a of to and in is it that for on with as by at from this be are was or "
             "an not which have has desk plugin file read write extract preview tree size date "
             "method compressed stored deflate bzip2 lzma zstd huffman symbol bits code range "
             "coder dictionary checksum frame sequence repeat copy value byte bytes north south "
             "east west river mountain valley city harbour light morning evening quiet quick "
             "brown fox jumps over lazy dog seven eleven hundred thousand").split()
    out, n, line = [], 0, 0
    while n < size:
        line += 1
        s = " ".join(r.choice(vocab) for _ in range(r.randint(6, 16)))
        if r.random() < 0.2:
            s = s.capitalize() + "."
        if r.random() < 0.1:
            s += " %d" % r.randint(0, 99999)
        s = "%05d %s\n" % (line, s)
        out.append(s)
        n += len(s)
    return "".join(out).encode()


def png(width=4, height=4):
    raw = b"".join(b"\0" + b"".join(bytes((x * 60, y * 60, 200)) for x in range(width))
                   for y in range(height))
    chunk = lambda kind, data: (struct.pack(">I", len(data)) + kind + data
                                + struct.pack(">I", zlib.crc32(kind + data)))
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))


LONG = ("deep/a-very-long-folder-name-that-goes-on-and-on/another-long-folder-name-for-the-tar-"
        "tests/file-with-a-long-name.txt")
TREE = {
    "hello.txt": b"Hello, archives!\n",
    "docs/readme.md": b"# Sample\n\nA small tree for the archives plugin's tests.\n",
    "docs/한글.txt": "안녕하세요\n".encode(),
    "data.bin": bytes(range(256)) * 16,
    "image.png": png(),
    "words.txt": words(7, 48_000),
    LONG: b"A long name.\n",
}


def run(*args, cwd=None, stdout=None):
    subprocess.run(args, cwd=cwd, check=True, stdout=stdout)


def sh(cmd, cwd):
    subprocess.run(cmd, cwd=cwd, shell=True, check=True, executable="/bin/bash")


def tree(root):
    root.mkdir(parents=True, exist_ok=True)
    for name, data in TREE.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
    os.symlink("hello.txt", root / "link")
    for path in sorted(root.rglob("*"), reverse=True):
        os.utime(path, (WHEN, WHEN), follow_symlinks=False)
    os.utime(root, (WHEN, WHEN))


def dos(t=WHEN):
    import time
    y, mo, d, h, mi, s = time.gmtime(t)[:6]
    return ((h << 11) | (mi << 5) | (s // 2), ((y - 1980) << 9) | (mo << 5) | d)


def zip_by_hand(entries):
    """A ZIP with exactly the methods and names given: (name bytes, method, data, packed, flags)."""
    out, central = bytearray(), bytearray()
    t, d = dos()
    for name, method, data, packed, flags in entries:
        offset = len(out)
        crc = zlib.crc32(data)
        head = struct.pack("<HHHHHIIIHH", 63, flags, method, t, d, crc, len(packed), len(data),
                           len(name), 0)
        out += b"PK\3\4" + head + name + packed
        central += (b"PK\1\2" + struct.pack("<H", 63) + head
                    + struct.pack("<HHHII", 0, 0, 0, 0o100644 << 16, offset) + name)
    end = struct.pack("<HHHHIIH", 0, 0, len(entries), len(entries), len(central), len(out), 0)
    return bytes(out + central + b"PK\5\6" + end)


def methods_zip(work):
    text = TREE["words.txt"]
    raw = zlib.compressobj(9, zlib.DEFLATED, -15)
    deflated = raw.compress(text) + raw.flush()
    props = lzma._encode_filter_properties({"id": lzma.FILTER_LZMA1, "dict_size": 1 << 16})
    alone = lzma.LZMACompressor(lzma.FORMAT_RAW, filters=[{"id": lzma.FILTER_LZMA1,
                                                           "dict_size": 1 << 16}])
    lz = struct.pack("<BBH", 9, 20, len(props)) + props + alone.compress(text) + alone.flush()
    src = work / "words.txt"
    src.write_bytes(text)
    zst = subprocess.run(["zstd", "-q", "-19", "-c", src], check=True, capture_output=True).stdout
    xz = subprocess.run(["xz", "-c", src], check=True, capture_output=True).stdout
    cp437 = b"CP437 names\n"
    return zip_by_hand([
        (b"stored.txt", 0, TREE["hello.txt"], TREE["hello.txt"], 0),
        (b"deflate.txt", 8, text, deflated, 0),
        (b"bzip2.txt", 12, text, bz2.compress(text, 9), 0),
        (b"lzma.txt", 14, text, lz, 2),
        (b"zstd.txt", 93, text, zst, 0),
        (b"xz.txt", 95, text, xz, 0),
        (b"caf\x82.txt", 0, cp437, cp437, 0),
    ])


def crx(zipped, version):
    if version == 2:
        key, sig = b"k" * 16, b"s" * 8
        return b"Cr24" + struct.pack("<III", 2, len(key), len(sig)) + key + sig + zipped
    header = b"\x12\x04head"  # a protobuf CrxFileHeader's bytes; readers skip it whole
    return b"Cr24" + struct.pack("<II", 3, len(header)) + header + zipped


def rar4(files):
    """RAR 4 with stored entries, as technote.txt lays it out (no rar version writes RAR 4 now)."""
    def block(kind, flags, body, extra=b""):
        head = struct.pack("<BHH", kind, flags, 7 + len(body)) + body
        return struct.pack("<H", zlib.crc32(head) & 0xFFFF) + head + extra
    out = b"Rar!\x1a\x07\x00" + block(0x73, 0, b"\0" * 6)
    t, d = dos()
    for name, data in files:
        is_dir = data is None
        body = struct.pack("<IIBIIBBHI", 0 if is_dir else len(data), 0 if is_dir else len(data), 3,
                           zlib.crc32(data or b""), (d << 16) | t, 20, 0x30, len(name),
                           0o40755 if is_dir else 0o100644) + name
        flags = 0x8000 | (0xE0 if is_dir else 0)
        out += block(0x74, flags, body, data or b"")
    return out + block(0x7B, 0x4000, b"")


def scrub_xar(path):
    """xar writes the builder's account into its table of contents: make every owner root:wheel and
    drop extended attributes, then fix the header's lengths and the TOC checksum at heap offset 0."""
    import re
    data = path.read_bytes()
    size, version, packed, unpacked, algorithm = struct.unpack(">HHQQI", data[4:28])
    toc = zlib.decompress(data[size:size + packed]).decode()
    toc = re.sub(r"<user>[^<]*</user>", "<user>root</user>", toc)
    toc = re.sub(r"<group>[^<]*</group>", "<group>wheel</group>", toc)
    toc = re.sub(r"<uid>[^<]*</uid>", "<uid>0</uid>", toc)
    toc = re.sub(r"<gid>[^<]*</gid>", "<gid>0</gid>", toc)
    toc = re.sub(r"\s*<ea\b[\s\S]*?</ea>", "", toc)
    raw = toc.encode()
    packed_toc = zlib.compress(raw, 9)
    heap = bytearray(data[size + packed:])
    digest = {1: hashlib.sha1, 2: hashlib.md5}.get(algorithm, hashlib.sha1)(packed_toc).digest()
    if algorithm in (1, 2):
        heap[:len(digest)] = digest
    head = data[:4] + struct.pack(">HHQQI", size, version, len(packed_toc), len(raw), algorithm)
    path.write_bytes(head + data[28:size] + packed_toc + bytes(heap))


def bencode_info_hash(data):
    """SHA-1 of the bencoded info dictionary, by its byte span in the file."""
    def end(i):
        c = data[i:i + 1]
        if c == b"i":
            return data.index(b"e", i) + 1
        if c in (b"l", b"d"):
            i += 1
            while data[i:i + 1] != b"e":
                i = end(i)
            return i + 1
        colon = data.index(b":", i)
        return colon + 1 + int(data[i:colon])
    i = 1
    while data[i:i + 1] != b"e":
        key_end = end(i)
        key = data[data.index(b":", i) + 1:key_end]
        value_end = end(key_end)
        if key == b"info":
            return hashlib.sha1(data[key_end:value_end]).hexdigest()
        i = value_end
    raise ValueError("no info dictionary")


def main():
    shutil.rmtree(OUT, ignore_errors=True)
    OUT.mkdir()
    work = Path(tempfile.mkdtemp(prefix="archives-fixtures-"))
    os.environ["COPYFILE_DISABLE"] = "1"
    tree(work / "tree")
    text = work / "text.txt"
    text.write_bytes(words(161, 210_000))
    expected = {"text": {"size": text.stat().st_size,
                         "sha256": hashlib.sha256(text.read_bytes()).hexdigest()}}

    # Codecs, by the real tools: several blocks each.
    pipe = lambda args, name: run(*args, text, stdout=open(OUT / name, "wb"))
    pipe(["bzip2", "-1", "-c"], "text.bz2")  # 100k blocks: three of them
    pipe(["xz", "-c", "--block-size=64KiB"], "text.xz")  # CRC64, four blocks
    pipe(["xz", "-c", "--check=crc32", "-e"], "text-crc32.xz")
    pipe(["lzma", "-c"], "text.lzma")
    pipe(["zstd", "-q", "-19", "-c"], "text.zst")  # with a checksum (the CLI's default)
    pipe(["zstd", "-q", "-19", "--long=27", "--no-check", "-c"], "text-long.zst")
    pipe(["zstd", "-q", "-1", "-c"], "text-fast.zst")
    pipe(["lz4", "-q", "-9", "-B4", "-BD", "-c"], "text.lz4")  # linked 64 KB blocks
    pipe(["lz4", "-q", "-1", "-B4", "-BX", "--content-size", "-c"], "text-blocks.lz4")
    pipe(["compress", "-c"], "text.Z")
    hello = work / "hello.txt"
    hello.write_bytes(TREE["hello.txt"])
    os.utime(hello, (WHEN, WHEN))
    run("gzip", "-k", "-9", hello)  # keeps the name and time in the header
    shutil.move(str(work / "hello.txt.gz"), OUT / "hello.txt.gz")

    # ZIP: Info-ZIP's own (deflate, stored, a symlink, extended times), ZIP64, encryption, by hand.
    t = work / "tree"
    sh(f"zip -q -r -y {OUT}/tree.zip hello.txt docs data.bin image.png words.txt link", t)
    sh(f"zip -q -X -fz {OUT}/zip64.zip hello.txt", t)
    sh(f"zip -q -X -P hunter2 {OUT}/encrypted.zip hello.txt docs/readme.md", t)
    (OUT / "methods.zip").write_bytes(methods_zip(work))
    sh(f"zip -q -X {work}/ext.zip hello.txt", t)
    (OUT / "sample-v2.crx").write_bytes(crx((work / "ext.zip").read_bytes(), 2))
    (OUT / "sample-v3.crx").write_bytes(crx((work / "ext.zip").read_bytes(), 3))
    sh(f"zip -q -X {work}/inner.zip hello.txt && cp {work}/inner.zip {work}/tree/inner.zip", t)

    # tar: ustar, GNU long names and PAX, then inside each stream.
    names = "hello.txt docs data.bin image.png deep link"
    # bsdtar would store the builder's account name: every owner is root:wheel instead.
    tar = "tar --no-mac-metadata --uid 0 --gid 0 --uname root --gname wheel"
    sh(f"{tar} --format ustar -cf {OUT}/ustar.tar hello.txt docs link", t)
    sh(f"{tar} --format gnutar -cf {OUT}/gnu.tar {names}", t)
    sh(f"{tar} --format pax -cf {work}/pax.tar {names} inner.zip", t)
    shutil.copy(work / "pax.tar", OUT / "pax.tar")
    for ext, tool in [("tar.gz", "gzip -9 -n"), ("tbz2", "bzip2 -9"), ("txz", "xz"),
                      ("tar.zst", "zstd -q -19"), ("tar.lz4", "lz4 -q -9")]:
        sh(f"{tool} -c {work}/pax.tar > {OUT}/tree.{ext}", t)

    # xar and a flat installer package.
    sh(f"xar -cf {OUT}/tree.xar hello.txt docs", t)
    sh(f"xar --compression=bzip2 -cf {OUT}/tree-bzip2.xar hello.txt words.txt", t)
    sh(f"mkdir -p {work}/pkgroot/opt/sample && cp hello.txt {work}/pkgroot/opt/sample/", t)
    run("pkgbuild", "--quiet", "--root", work / "pkgroot", "--identifier", "ai.endue.sample",
        "--version", "1.0", "--install-location", "/", "--ownership", "recommended",
        OUT / "sample.pkg")
    for name in ["tree.xar", "tree-bzip2.xar", "sample.pkg"]:
        scrub_xar(OUT / name)

    # Disk images on macOS: ISO 9660 with Joliet, and a compressed UDIF image.
    sh(f"hdiutil makehybrid -quiet -iso -joliet -default-volume-name SAMPLE "
       f"-o {work}/tree.iso {t}", work)
    sh(f"gzip -9 -n -c {work}/tree.iso > {OUT}/tree.iso.gz", work)
    sh(f"hdiutil create -quiet -srcfolder {t}/docs -volname Sample -format UDZO -fs HFS+ "
       f"-o {OUT}/sample.dmg", work)

    (OUT / "rar4.rar").write_bytes(rar4([(b"docs", None), (b"hello.txt", TREE["hello.txt"]),
                                               (b"docs\\readme.md", TREE["docs/readme.md"])]))

    # Linux tools in a container: 7z, deb, rpm, gem, cab, msi, rar 5, arj, lha, disk images.
    # FIXTURE_IMAGE names an image with the tools already installed, to skip apt-get while iterating.
    image = os.environ.get("FIXTURE_IMAGE", "debian:bookworm-slim")
    for platform, part, used in [("linux/arm64", "main", image), ("linux/amd64", "rar", "debian:bookworm-slim")]:
        sh(f"docker run --rm --platform {platform} -v {work}:/work -v {OUT}:/out "
           f"-v {HERE}/make-fixtures-linux.sh:/make.sh:ro {used} bash /make.sh {part}", work)

    expected["torrent"] = {"infoHash": bencode_info_hash((OUT / "tree.torrent").read_bytes())}
    expected["words"] = {"size": len(TREE["words.txt"]),
                         "sha256": hashlib.sha256(TREE["words.txt"]).hexdigest()}
    (OUT / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
    shutil.rmtree(work)
    total = sum(p.stat().st_size for p in OUT.iterdir())
    print(f"{len(list(OUT.iterdir()))} fixtures, {total // 1024} KB")


if __name__ == "__main__":
    main()
