#!/usr/bin/env python3
"""Builds the Apple fixtures on macOS with the real tools: hdiutil makes the disk images (one HFS+
disk converted to UDRO, UDCO, UDZO, UDBZ, ULFO and ULMO, an Apple Partition Map disk, a bare
case-sensitive HFSX volume, APFS, an encrypted image, an APFS container whose volume is encrypted),
the kernel writes the files (hard links, symlinks, a fragmented file, decmpfs files through
compress.py and ditto --hfsCompression), and compression_tool and libcompression make the LZFSE and
LZVN streams. Every image is attached read-only afterwards and walked, so expected.json is what the
kernel sees. No personal data: the files are made here. Run on macOS, from anywhere:
python3 plugins/formats/tests/apple/make-fixtures.py"""
import gzip
import hashlib
import json
import os
import random
import shutil
import stat
import subprocess
import sys
import tempfile
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from compress import LZVN, compressed, encode  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "fixtures")
WORK = tempfile.mkdtemp(prefix="apple-fixtures-")
WHEN = 1790856000  # 2026-10-01T12:00:00Z
PASSWORD = b"hunter2"  # a throwaway password, for the encrypted fixtures
LOREM = "The quick brown fox jumps over the lazy dog. " * 100
FORMATS = ["UDRO", "UDCO", "UDZO", "UDBZ", "ULFO", "ULMO"]


def run(*args, input=None):
    done = subprocess.run(args, input=input, capture_output=True)
    if done.returncode:
        raise SystemExit(f"{' '.join(args)} failed: {done.stderr.decode().strip()}")
    return done.stdout.decode()


def blocks(count, tag):
    """`count` blocks of 4 KiB text, each starting with its own number: compresses well, and a
    block read from the wrong place changes the checksum."""
    return "".join((f"{tag} block {i:06d}\n" + LOREM)[:4095] + "\n" for i in range(count)).encode()


def words(size, seed):
    """`size` bytes of words drawn at random: text with short, scattered matches, so an LZFSE
    encoder writes several blocks of real tables."""
    pick = random.Random(seed)
    vocabulary = LOREM.split()[:9] + ["disk", "image", "volume", "catalog", "extent", "apple"]
    out = []
    while sum(map(len, out)) < size:
        out.append(pick.choice(vocabulary) + pick.choice([" ", " ", ", ", ".\n"]) + str(pick.randrange(999)))
    return "".join(out).encode()[:size]


def put(root, rel, data):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    return path


class Attached:
    """An image attached without Finder, mounted at a folder of our own."""

    def __init__(self, image, readonly=False, mount=True):
        self.mnt = tempfile.mkdtemp(dir=WORK, prefix="mnt-")
        args = ["hdiutil", "attach", "-nobrowse", "-noautoopen", "-noverify"]
        if readonly:
            args.append("-readonly")
        args += ["-mountpoint", self.mnt] if mount else ["-nomount"]
        out = run(*args, image)
        self.lines = [line.split("\t") for line in out.strip().splitlines()]
        self.dev = self.lines[0][0].strip()

    def device(self, kind):
        return next(line[0].strip() for line in self.lines if kind in line[1])

    def __enter__(self):
        return self

    def __exit__(self, *_):
        run("sync")
        run("hdiutil", "detach", self.dev)


def create(name, size, fs, volname, layout):
    image = os.path.join(WORK, f"{name}.rw.dmg")
    run("hdiutil", "create", "-size", size, "-fs", fs, "-volname", volname, "-layout", layout,
        "-type", "UDIF", image)
    return image


def convert(image, fmt, out, *extra, input=None):
    run("hdiutil", "convert", image, "-format", fmt, "-o", out, *extra, input=input)
    return out


def fragment(root):
    """A file in twenty-four holes of one block each: more than the eight extents a catalog
    record holds, so the rest go to the extents-overflow file."""
    fill = os.path.join(root, "fill")
    for i in range(24):
        for tag in ("a", "b"):
            put(fill, f"{tag}{i:02d}", bytes(4096))
    try:
        with open(os.path.join(fill, "rest"), "wb") as f:
            st = os.statvfs(root)
            f.write(bytes(st.f_bavail * st.f_frsize - 8192))
    except OSError:
        pass
    for i in range(24):
        os.remove(os.path.join(fill, f"a{i:02d}"))
    put(root, "data/fragmented.bin", blocks(16, "fragmented"))
    shutil.rmtree(fill)


def tree(root, many=0, compress=(), sparse=False):
    put(root, "hello.txt", b"Hello from the disk image!\n")
    put(root, "empty.txt", b"")
    put(root, "deep/one/two/three/four/five/six/seven/eight/deep.txt", b"deep\n")
    put(root, "docs/café naïve.txt", "café\n".encode())
    put(root, "docs/한글 이름.txt", "안녕하세요\n".encode())
    put(root, "data/pattern.bin", blocks(12, "pattern"))
    put(root, "data/noise.bin", random.Random(185).randbytes(9000))
    hard = put(root, "links/hard-a.txt", b"one file, two names\n")
    os.link(hard, os.path.join(root, "links/hard-b.txt"))
    os.symlink("../hello.txt", os.path.join(root, "links/to-hello"))
    os.symlink("/etc/hosts", os.path.join(root, "links/absolute"))
    for i in range(many):
        put(root, f"many/a-file-with-a-longer-name-to-fill-the-catalog-{i:03d}.txt", f"file {i}\n".encode())
    if compress:
        source = put(WORK, "ditto-source.txt", blocks(40, "ditto"))
        os.makedirs(os.path.join(root, "compressed"), exist_ok=True)
        run("ditto", "--hfsCompression", source, os.path.join(root, "compressed/ditto.txt"))
        if not os.lstat(os.path.join(root, "compressed/ditto.txt")).st_flags & stat.UF_COMPRESSED:
            raise SystemExit("ditto --hfsCompression did not compress the file")
        for kind in compress:
            small = kind in (3, 7, 11)
            data = blocks(1, f"type {kind}")[:2000] if small else blocks(36, f"type {kind}")
            compressed(os.path.join(root, f"compressed/type-{kind:02d}.txt"), data, kind)
    if sparse:
        with open(os.path.join(root, "data/sparse.bin"), "wb") as f:
            f.write(blocks(1, "sparse head"))
            f.seek(1024 * 1024)
            f.write(blocks(1, "sparse tail"))


def stamp(root):
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        for name in filenames + dirnames:
            os.utime(os.path.join(dirpath, name), (WHEN, WHEN), follow_symlinks=False)
    os.utime(root, (WHEN, WHEN))


def walk(root):
    """Every file, folder and link the kernel lists under a mounted volume."""
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in sorted(dirnames + filenames):
            full = os.path.join(dirpath, name)
            st = os.lstat(full)
            rel = unicodedata.normalize("NFC", os.path.relpath(full, root))
            entry = {"path": rel, "mtime": st.st_mtime}
            if not stat.S_ISDIR(st.st_mode) and st.st_nlink > 1:
                entry["inode"] = st.st_ino
            if stat.S_ISLNK(st.st_mode):
                entry.update(kind="link", size=st.st_size, link=os.readlink(full))
            elif stat.S_ISDIR(st.st_mode):
                entry.update(kind="folder", size=0)
            else:
                with open(full, "rb") as f:
                    data = f.read()
                entry.update(kind="file", size=len(data), sha256=hashlib.sha256(data).hexdigest()[:16])
                if st.st_flags & stat.UF_COMPRESSED:
                    entry["compressed"] = True
            entries.append(entry)
    return sorted(entries, key=lambda e: e["path"])


def sha256(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def raw_disk(image):
    """The disk's bytes as hdiutil gives them: a DVD/CD master is the disk, sector by sector."""
    out = convert(image, "UDTO", os.path.join(WORK, os.path.basename(image) + ".cdr"))
    return {"size": os.path.getsize(out), "sha256": sha256(out)}


def volumes(image):
    """Each volume's entries, by its name, as the kernel lists them mounted read-only."""
    found = {}
    with Attached(image, readonly=True, mount=False) as disk:
        for line in disk.lines:
            dev = line[0].strip()
            info = dict(l.strip().split(":", 1) for l in run("diskutil", "info", dev).splitlines()
                        if ":" in l)
            name = info.get("Volume Name", "").strip()
            personality = info.get("File System Personality", "")
            if not name or not ("HFS" in personality or "APFS" in personality):
                continue
            mnt = tempfile.mkdtemp(dir=WORK, prefix="ro-")
            run("diskutil", "mount", "readOnly", "-mountPoint", mnt, dev)
            try:
                found[name] = walk(mnt)
            finally:
                run("diskutil", "unmount", mnt)
    return found


def hfs_disk(expected):
    image = create("hfs", "4m", "HFS+", "Apple HFS", "GPTSPUD")
    with Attached(image) as disk:
        fragment(disk.mnt)
        tree(disk.mnt, many=120, compress=(3, 4, 7, 8, 11, 12))
        stamp(disk.mnt)
    files = {}
    for fmt in FORMATS:
        name = f"hfs.{fmt.lower()}.dmg"
        convert(image, fmt, os.path.join(OUT, name))
        files[fmt] = name
    expected["hfs"] = {"formats": files, "disk": raw_disk(image),
                       "volumes": volumes(os.path.join(OUT, files["UDRO"]))}
    for fmt in ("UDRO", "UDCO"):  # the two that are not compressed well: kept gzipped
        path = os.path.join(OUT, files[fmt])
        with open(path, "rb") as f, open(path + ".gz", "wb") as out:
            out.write(gzip.compress(f.read(), mtime=0))
        os.remove(path)


def small_disk(expected, key, size, fs, volname, layout, fmt, populate):
    image = create(key, size, fs, volname, layout)
    with Attached(image) as disk:
        populate(disk.mnt)
        stamp(disk.mnt)
    name = f"{key}.dmg"
    convert(image, fmt, os.path.join(OUT, name))
    expected[key] = {"file": name, "disk": raw_disk(image), "volumes": volumes(os.path.join(OUT, name))}
    return image


def hfsx(root):
    put(root, "Readme.txt", b"mixed case\n")
    put(root, "README.txt", b"upper case\n")
    put(root, "readme.txt", b"lower case\n")
    put(root, "folder/inside.txt", b"inside\n")


def apm(root):
    put(root, "hello.txt", b"Hello from an Apple Partition Map!\n")
    put(root, "data/pattern.bin", blocks(3, "apm"))


def apfs_locked(expected):
    image = create("apfs-locked", "8m", "APFS", "Plain", "GPTSPUD")
    with Attached(image, mount=False) as disk:
        container = disk.device("EF57347C")
        volume = disk.device("41504653")
        run("diskutil", "apfs", "deleteVolume", volume)
        run("diskutil", "apfs", "addVolume", container, "APFS", "Locked", "-passphrase",
            PASSWORD.decode(), "-nomount")
    name = "apfs-locked.dmg"
    convert(image, "UDZO", os.path.join(OUT, name))
    expected["apfs-locked"] = {"file": name, "volume": "Locked"}


def streams(expected):
    """LZFSE streams from compression_tool, and raw LZVN from libcompression."""
    out = {}
    cases = {
        "text.lzfse": words(160 * 1024, 1),
        "small.lzfse": blocks(1, "small")[:3000],
        "noise.lzfse": random.Random(1185).randbytes(3000),
        "empty.lzfse": b"",
    }
    for name, data in cases.items():
        source = put(WORK, name + ".in", data)
        target = os.path.join(OUT, name)
        run("compression_tool", "-encode", "-a", "lzfse", "-i", source, "-o", target)
        out[name] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    for name, data in {"text.lzvn": words(64 * 1024, 2), "small.lzvn": b"lzvn " * 40}.items():
        with open(os.path.join(OUT, name), "wb") as f:
            f.write(encode(data, LZVN))
        out[name] = {"size": len(data), "sha256": hashlib.sha256(data).hexdigest()}
    expected["streams"] = out


def main():
    if sys.platform != "darwin":
        raise SystemExit("make-fixtures.py needs macOS: hdiutil, diskutil and ditto")
    shutil.rmtree(OUT, ignore_errors=True)
    os.makedirs(OUT)
    expected = {"when": WHEN}
    try:
        hfs_disk(expected)
        small_disk(expected, "hfsx", "1m", "Case-sensitive Journaled HFS+", "Apple HFSX", "NONE",
                   "UDZO", hfsx)
        image = small_disk(expected, "apm", "1m", "HFS+", "Apple APM", "SPUD", "UDZO", apm)
        convert(image, "UDZO", os.path.join(OUT, "encrypted.dmg"), "-encryption", "AES-128",
                "-stdinpass", input=PASSWORD)
        expected["encrypted"] = {"file": "encrypted.dmg"}
        small_disk(expected, "apfs", "8m", "APFS", "Apple APFS", "GPTSPUD", "UDZO",
                   lambda root: tree(root, many=60, compress=(3, 4, 7, 8, 11, 12), sparse=True))
        apfs_locked(expected)
        streams(expected)
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
    with open(os.path.join(OUT, "expected.json"), "w") as f:
        json.dump(expected, f, indent=1, sort_keys=True, ensure_ascii=False)
        f.write("\n")
    for name in sorted(os.listdir(OUT)):
        print(f"{os.path.getsize(os.path.join(OUT, name)):>9}  {name}")


if __name__ == "__main__":
    main()
