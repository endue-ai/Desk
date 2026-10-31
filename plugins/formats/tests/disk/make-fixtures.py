#!/usr/bin/env python3
"""The container half of make-fixtures.sh: builds every disk fixture with the real tools, mounts each
file system read-only to write down what the kernel (or ntfs-3g) sees, and gzips the images into
the fixtures folder. Run only through make-fixtures.sh (it needs root, loop devices and FUSE)."""
import gzip
import hashlib
import json
import os
import random
import shutil
import stat
import struct
import subprocess
import sys

OUT = sys.argv[1]
WORK = "/tmp/disk"
WHEN = 1790856000  # 2026-10-01T12:00:00Z
MNT = "/mnt/fixture"
ENV = {**os.environ, "MTOOLS_SKIP_CHECK": "1", "LC_ALL": "C.UTF-8", "TZ": "UTC"}
LOREM = "The quick brown fox jumps over the lazy dog. " * 100


def run(*args, ok=(0,), **kw):
    done = subprocess.run(args, env=ENV, **kw)
    if done.returncode not in ok:
        raise SystemExit(f"{args[0]} failed with {done.returncode}")


def blocks(count, tag):
    """`count` blocks of 4 KiB text, each starting with its own number: compresses well, and a
    block read from the wrong place changes the checksum."""
    return "".join((f"{tag} block {i:06d}\n" + LOREM)[:4095] + "\n" for i in range(count)).encode()


def put(root, rel, data):
    path = os.path.join(root, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def tree(root, many=300, big=False, links=False):
    """The tree the file-system fixtures hold."""
    shutil.rmtree(root, ignore_errors=True)
    os.makedirs(root)
    put(root, "hello.txt", b"Hello, disks!\n")
    put(root, "UPPER.TXT", b"upper\n")
    put(root, "lower.txt", b"lower\n")
    put(root, "empty.txt", b"")
    put(root, "docs/readme.md", b"# Disk fixtures\n\nA small tree for the disk readers' tests.\n")
    put(root, "docs/A long file name, with spaces and more than eight characters.txt", b"long\n")
    put(root, "docs/한글 이름.txt", "안녕하세요\n".encode())
    put(root, "deep/one/two/three/four/five/six/seven/deep.txt", b"deep\n")
    put(root, "data/pattern.bin", blocks(75, "pattern"))
    for i in range(many):
        put(root, f"many/a-file-with-a-longer-name-{i:03d}.txt", f"file {i}\n".encode())
    if big:
        put(root, "big/large.txt", blocks(384, "large"))
        with open(os.path.join(root, "big/islands.bin"), "wb") as f:
            for i in range(16):  # sixteen data runs with holes between: an extent tree of depth 1
                f.seek(i * 128 * 1024)
                f.write(blocks(1, f"island {i:02d}"))
            f.truncate(2 * 1024 * 1024)
    if links:
        os.symlink("docs/readme.md", os.path.join(root, "link-to-readme"))
        target = "deep/one/two/three/four/five/six/seven/../../../../../../../docs/readme.md"
        os.symlink(target, os.path.join(root, "long-link"))
    stamp(root)


def stamp(root):
    for dirpath, dirnames, filenames in os.walk(root, topdown=False):
        for name in filenames + dirnames:
            os.utime(os.path.join(dirpath, name), (WHEN, WHEN), follow_symlinks=False)
    os.utime(root, (WHEN, WHEN))


def walk(root):
    """Every file, folder and link under a mounted file system, as the tests expect them."""
    entries = []
    for dirpath, dirnames, filenames in os.walk(root):
        for name in sorted(dirnames + filenames):
            full = os.path.join(dirpath, name)
            st = os.lstat(full)
            mtime = int(st.st_mtime) if st.st_mtime == int(st.st_mtime) else st.st_mtime
            entry = {"path": os.path.relpath(full, root), "mtime": mtime}
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
            entries.append(entry)
    return sorted(entries, key=lambda e: e["path"])


def mounted(image, kind, offset=0, size=0):
    os.makedirs(MNT, exist_ok=True)
    if kind == "ntfs":
        run("ntfs-3g", "-o", "ro", image, MNT)
    else:
        options = {"vfat": "iocharset=utf8,tz=UTC,shortname=mixed", "ext": "noload"}.get(kind, "")
        opts = ",".join(o for o in ["ro", "loop", options] if o)
        if size:
            opts += f",offset={offset},sizelimit={size}"
        run("mount", "-t", {"ext": "ext4", "vfat": "vfat"}.get(kind, kind), "-o", opts, image, MNT)
    try:
        return walk(MNT)
    finally:
        run("umount", MNT)


def mcopy(image, root):
    names = sorted(os.listdir(root))
    run("mcopy", "-s", "-m", "-i", image, *names, "::/", cwd=root)


def fat(name, kib, fat_type, label, extra=(), many=300, fragment=False):
    image = f"{WORK}/{name}"
    run("mkfs.fat", "-C", "-F", str(fat_type), "-n", label, "-i", "1234ABCD", *extra, image, str(kib),
        stdout=subprocess.DEVNULL)
    root = f"{WORK}/tree-{name}"
    tree(root, many=many)
    mcopy(image, root)
    put(WORK, "gone.txt", b"deleted\n")
    os.utime(f"{WORK}/gone.txt", (WHEN, WHEN))
    run("mcopy", "-i", image, f"{WORK}/gone.txt", "::/gone.txt")
    run("mdel", "-i", image, "::/gone.txt")
    if fragment:
        # A file that fills a freed hole and goes on after the next file: a broken cluster chain.
        put(WORK, "frag-a.bin", blocks(2, "frag a"))
        put(WORK, "frag-b.bin", blocks(2, "frag b"))
        put(WORK, "frag-c.bin", blocks(5, "frag c"))
        for f in ("frag-a.bin", "frag-b.bin", "frag-c.bin"):
            os.utime(f"{WORK}/{f}", (WHEN, WHEN))
        for f in ("frag-a.bin", "frag-b.bin"):
            run("mcopy", "-m", "-i", image, f"{WORK}/{f}", f"::/{f}")
        run("mdel", "-i", image, "::/frag-a.bin")
        run("mcopy", "-m", "-i", image, f"{WORK}/frag-c.bin", "::/frag-c.bin")
    return image


def exfat():
    image = f"{WORK}/exfat.img"
    with open(image, "wb") as f:
        f.truncate(8 * 1024 * 1024)
    run("mkfs.exfat", "-L", "EXFATDISK", "-c", "4K", image, stdout=subprocess.DEVNULL)
    root = f"{WORK}/tree-exfat"
    tree(root, many=150)
    os.makedirs(MNT, exist_ok=True)
    run("mount", "-t", "exfat", "-o", "loop", image, MNT)
    run("cp", "-r", "--preserve=timestamps", *[f"{root}/{n}" for n in sorted(os.listdir(root))], MNT)
    # Two files grown by turns, each through a cluster chain in the FAT.
    for i in range(12):
        for tag in ("a", "b"):
            with open(f"{MNT}/turns-{tag}.bin", "ab") as f:
                f.write(blocks(1, f"turns {tag} {i:02d}"))
            run("sync")
    for tag in ("a", "b"):
        os.utime(f"{MNT}/turns-{tag}.bin", (WHEN, WHEN))
    run("umount", MNT)
    return image


def ext(name, fs, size, label, options):
    image = f"{WORK}/{name}"
    root = f"{WORK}/tree-{name}"
    tree(root, many=300 if fs == "ext4" else 100, big=fs == "ext4", links=True)
    os.link(f"{root}/hello.txt", f"{root}/docs/hello-again.txt")
    run("mke2fs", "-q", "-F", "-t", fs, *options, "-L", label, "-U", "6f6e6520-7477-6f20-7468-726565206578",
        "-E", "root_owner=0:0", "-d", root, image, size)
    run("e2fsck", "-fyD", image, ok=(0, 1), stdout=subprocess.DEVNULL)  # index the large folders
    return image


def ntfs():
    image = f"{WORK}/ntfs.img"
    with open(image, "wb") as f:
        f.truncate(16 * 1024 * 1024)
    run("mkntfs", "-F", "-Q", "-q", "-L", "NTFSDISK", "-c", "4096", "-p", "0", "-H", "0", "-S", "0", image)
    root = f"{WORK}/tree-ntfs"
    tree(root, many=150, links=True)
    os.makedirs(MNT, exist_ok=True)
    run("ntfs-3g", "-o", "compression,streams_interface=windows", image, MNT)
    run("cp", "-a", *[f"{root}/{n}" for n in sorted(os.listdir(root))], MNT)
    os.link(f"{MNT}/hello.txt", f"{MNT}/docs/hello-again.txt")
    with open(f"{MNT}/hello.txt:extra", "wb") as f:  # an alternate data stream, left out
        f.write(b"a stream beside the file\n")
    os.mkdir(f"{MNT}/compressed")
    flags = struct.unpack(">I", os.getxattr(f"{MNT}/compressed", "system.ntfs_attrib_be"))[0]
    os.setxattr(f"{MNT}/compressed", "system.ntfs_attrib_be", struct.pack(">I", flags | 0x800))
    with open(f"{MNT}/compressed/text.txt", "wb") as f:
        f.write(blocks(50, "compressed"))
    noise = random.Random(184).randbytes(64 * 1024)
    with open(f"{MNT}/compressed/mixed.bin", "wb") as f:  # one unit stored raw, one compressed
        f.write(noise + blocks(16, "mixed"))
    with open(f"{MNT}/sparse.bin", "wb") as f:
        f.write(b"the start of a sparse file\n")
        f.seek(2 * 1024 * 1024 + 100)
        f.write(b"the end of a sparse file\n")
        f.truncate(3 * 1024 * 1024)
    for rel in ("compressed/text.txt", "compressed/mixed.bin", "sparse.bin", "compressed", "docs"):
        os.utime(f"{MNT}/{rel}", (WHEN, WHEN))
    run("umount", MNT)
    return image


def partition_image(path, size, make):
    with open(path, "wb") as f:
        f.truncate(size)
    make(path)
    return path


def place(disk, part, start):
    with open(part, "rb") as src, open(disk, "r+b") as dst:
        dst.seek(start)
        dst.write(src.read())


def gpt():
    disk = f"{WORK}/gpt.img"
    with open(disk, "wb") as f:
        f.truncate(12 * 1024 * 1024)
    run("sgdisk", "-o", "-U", "5A1E5A1E-0000-4000-8000-000000000184",
        "-n", "1:2048:10239", "-t", "1:ef00", "-c", "1:EFI",
        "-n", "2:10240:22527", "-t", "2:8300", "-c", "2:root",
        "-n", "3:22528:24542", "-t", "3:8200", "-c", "3:swap", disk, stdout=subprocess.DEVNULL)
    small = f"{WORK}/tree-gpt"
    shutil.rmtree(small, ignore_errors=True)
    put(small, "hello.txt", b"Hello from the EFI partition!\n")
    put(small, "EFI/BOOT/BOOTX64.EFI", b"not a real loader\n")
    stamp(small)
    p1 = partition_image(f"{WORK}/p1.img", 4 * 1024 * 1024, lambda p: run(
        "mkfs.fat", "-F", "16", "-s", "1", "-n", "ESP", "-i", "0000E5E5", p, stdout=subprocess.DEVNULL))
    mcopy(p1, small)
    root = f"{WORK}/tree-root"
    shutil.rmtree(root, ignore_errors=True)
    put(root, "etc/hostname", b"fixture\n")
    put(root, "home/example/notes.txt", blocks(3, "notes"))
    stamp(root)
    p2 = f"{WORK}/p2.img"
    run("mke2fs", "-q", "-F", "-t", "ext4", "-b", "4096", "-L", "rootfs", "-d", root, p2, "6M")
    p3 = partition_image(f"{WORK}/p3.img", (24543 - 22528) * 512, lambda p: run(
        "mkswap", "-q", "-L", "swap", p))
    for part, start in ((p1, 2048), (p2, 10240), (p3, 22528)):
        place(disk, part, start * 512)
    return disk, [(1, 2048, 8192, "vfat"), (2, 10240, 12288, "ext"), (3, 22528, 24543 - 22528, None)]


def mbr():
    disk = f"{WORK}/mbr.img"
    with open(disk, "wb") as f:
        f.truncate(16 * 1024 * 1024)
    script = "\n".join([
        "label: dos", "label-id: 0x0184abcd",
        "start=2048, size=8192, type=6",
        "start=10240, size=22528, type=5",
        "start=12288, size=8192, type=83",
        "start=22528, size=8192, type=1", ""])
    run("sfdisk", "-q", disk, input=script.encode())
    root = f"{WORK}/tree-mbr"
    shutil.rmtree(root, ignore_errors=True)
    put(root, "hello.txt", b"Hello from a partition!\n")
    put(root, "docs/readme.md", b"# Partition\n")
    stamp(root)
    p1 = partition_image(f"{WORK}/m1.img", 4 * 1024 * 1024, lambda p: run(
        "mkfs.fat", "-F", "16", "-s", "1", "-n", "MBRONE", p, stdout=subprocess.DEVNULL))
    mcopy(p1, root)
    p5 = f"{WORK}/m5.img"
    run("mke2fs", "-q", "-F", "-t", "ext2", "-b", "1024", "-L", "logical-ext2", "-d", root, p5, "4M")
    p6 = partition_image(f"{WORK}/m6.img", 4 * 1024 * 1024, lambda p: run(
        "mkfs.fat", "-F", "12", "-s", "4", "-n", "MBRTHREE", p, stdout=subprocess.DEVNULL))
    mcopy(p6, root)
    for part, start in ((p1, 2048), (p5, 12288), (p6, 22528)):
        place(disk, part, start * 512)
    return disk, [(1, 2048, 8192, "vfat"), (5, 12288, 8192, "ext"), (6, 22528, 8192, "vfat")]


def vhd_checksum(footer):
    footer[64:68] = b"\0\0\0\0"
    footer[64:68] = struct.pack(">I", ~sum(footer) & 0xFFFFFFFF)


def differencing(dynamic, out):
    """A dynamic VHD retyped as a differencing one (qemu-img makes none): footer and its copy."""
    data = bytearray(open(dynamic, "rb").read())
    for at in (0, len(data) - 512):
        footer = data[at:at + 512]
        footer[60:64] = struct.pack(">I", 4)
        vhd_checksum(footer)
        data[at:at + 512] = footer
    open(out, "wb").write(data)


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def big():
    """A 6 GiB disk with data at its start, past 4 GiB and at its end, as each container."""
    raw = f"{WORK}/big.raw"
    size = 6 * 1024 ** 3
    markers = [(0, "start"), (4 * 1024 ** 3 + 1024 ** 2 + 512, "past four"), (size - 8192, "end")]
    with open(raw, "wb") as f:
        f.truncate(size)
        for offset, tag in markers:
            f.seek(offset)
            f.write(blocks(2, tag))
    expected = [{"offset": o, "length": 8192, "sha256": hashlib.sha256(blocks(2, t)).hexdigest()}
                for o, t in markers]
    for name, args in (("big.vhd", ["-O", "vpc", "-o", "subformat=dynamic,force_size=on"]),
                       ("big.vhdx", ["-O", "vhdx", "-o", "subformat=dynamic,block_size=1M"]),
                       ("big.vmdk", ["-O", "vmdk", "-o", "subformat=monolithicSparse"]),
                       ("big.qcow2", ["-O", "qcow2", "-o", "compat=1.1"])):
        run("qemu-img", "convert", "-f", "raw", *args, raw, f"{WORK}/{name}")
        save(name)
    return {"size": size, "markers": expected}


def save(name, path=None):
    with open(path or f"{WORK}/{name}", "rb") as src, gzip.GzipFile(f"{OUT}/{name}.gz", "wb", 9, mtime=0) as dst:
        shutil.copyfileobj(src, dst)


def main():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    os.makedirs(OUT, exist_ok=True)
    for old in os.listdir(OUT):
        os.remove(os.path.join(OUT, old))
    expected = {"when": WHEN, "filesystems": {}, "disks": {}}

    systems = {
        "fat12.img": (fat("fat12.img", 1440, 12, "FLOPPY", many=40), "vfat", "FAT12", "FLOPPY"),
        "fat16.img": (fat("fat16.img", 16384, 16, "FATSIXTEEN", ["-s", "4"], many=100), "vfat", "FAT16", "FATSIXTEEN"),
        "fat32.img": (fat("fat32.img", 34816, 32, "FAT32DISK", ["-s", "1"], many=100, fragment=True), "vfat", "FAT32", "FAT32DISK"),
        "exfat.img": (exfat(), "exfat", "exFAT", "EXFATDISK"),
        "ext4.img": (ext("ext4.img", "ext4", "12M", "ext4-disk", ["-b", "4096", "-I", "256", "-O", "inline_data,metadata_csum,64bit"]), "ext", "ext4", "ext4-disk"),
        "ext2.img": (ext("ext2.img", "ext2", "4M", "ext2-disk", ["-b", "1024", "-I", "128"]), "ext", "ext2", "ext2-disk"),
        "ntfs.img": (ntfs(), "ntfs", "NTFS", "NTFSDISK"),
    }
    for name, (image, kind, fs_type, label) in systems.items():
        expected["filesystems"][name] = {"type": fs_type, "label": label, "size": os.path.getsize(image),
                                         "entries": mounted(image, kind)}
        save(name)

    for name, (disk, parts) in (("gpt.img", gpt()), ("mbr.img", mbr())):
        expected["disks"][name] = {"size": os.path.getsize(disk), "sha256": sha(disk), "partitions": [
            {"number": n, "start": s * 512, "size": c * 512,
             "entries": mounted(disk, k, s * 512, c * 512) if k else []} for n, s, c, k in parts]}
        save(name)

    raw = f"{WORK}/gpt.img"
    conversions = {
        "gpt-fixed.vhd": ["-O", "vpc", "-o", "subformat=fixed,force_size=on"],
        "gpt-dynamic.vhd": ["-O", "vpc", "-o", "subformat=dynamic,force_size=on"],
        "gpt-dynamic.vhdx": ["-O", "vhdx", "-o", "subformat=dynamic,block_size=1M"],
        "gpt-fixed.vhdx": ["-O", "vhdx", "-o", "subformat=fixed"],
        "gpt-sparse.vmdk": ["-O", "vmdk", "-o", "subformat=monolithicSparse"],
        "gpt-stream.vmdk": ["-O", "vmdk", "-o", "subformat=streamOptimized"],
        "gpt-flat.vmdk": ["-O", "vmdk", "-o", "subformat=monolithicFlat"],
        "gpt-v2.qcow2": ["-O", "qcow2", "-o", "compat=0.10"],
        "gpt-v3.qcow2": ["-O", "qcow2", "-o", "compat=1.1,cluster_size=4096"],
        "gpt-deflate.qcow2": ["-c", "-O", "qcow2"],
        "gpt-zstd.qcow2": ["-c", "-O", "qcow2", "-o", "compression_type=zstd"],
    }
    for name, args in conversions.items():
        run("qemu-img", "convert", "-f", "raw", *args, raw, f"{WORK}/{name}")
        save(name)
    if sha(f"{WORK}/gpt-flat-flat.vmdk") != sha(raw):
        raise SystemExit("the flat extent differs from the raw image")
    differencing(f"{WORK}/gpt-dynamic.vhd", f"{WORK}/differencing.vhd")
    save("differencing.vhd")
    run("qemu-img", "create", "-q", "-f", "qcow2", "-b", "gpt-v3.qcow2", "-F", "qcow2", f"{WORK}/child.qcow2")
    save("child.qcow2")
    run("qemu-img", "create", "-q", "-f", "vmdk", "-o", "subformat=twoGbMaxExtentSparse", f"{WORK}/split.vmdk", "3G")
    save("split.vmdk")
    save("split-s001.vmdk")
    expected["big"] = big()

    with open(f"{OUT}/expected.json", "w") as f:
        f.write(dump(expected) + "\n")


def dump(value, depth=0):
    """JSON with one line per file entry, so a change to one file is a one-line diff."""
    pad = " " * depth
    if isinstance(value, dict) and "path" not in value:
        items = [f'{pad} {json.dumps(k)}: {dump(v, depth + 1)}' for k, v in sorted(value.items())]
        return "{\n" + ",\n".join(items) + f"\n{pad}}}"
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return "[\n" + ",\n".join(f"{pad} {dump(v, depth + 1)}" for v in value) + f"\n{pad}]"
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


main()
