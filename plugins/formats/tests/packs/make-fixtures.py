#!/usr/bin/env python3
"""The Linux half of make-fixtures.sh: writes a small tree, packs it with mksquashfs and
wimlib-imagex into the folder given, and records what the tree holds in expected.json."""
import hashlib
import json
import os
import shutil
import subprocess
import sys

OUT = sys.argv[1]
TREE = "/tmp/pack-tree"
OTHER = "/tmp/pack-other"
WHEN = 1790856000


def lcg(seed):
    state = seed
    while True:
        state = (state * 1664525 + 1013904223) % 2**32
        yield state


def text(n, seed):
    words = b"pack image block chunk fragment inode folder file link table window tree".split()
    out = bytearray()
    for r in lcg(seed):
        out += words[r % len(words)] + (b".\n" if r % 9 == 0 else b" ")
        if len(out) >= n:
            return bytes(out[:n])


def noise(n, seed):
    out = bytearray()
    for r in lcg(seed):
        out.append(r >> 24)
        if len(out) >= n:
            return bytes(out)


FILES = {
    "docs/readme.md": b"# Sample\n\nA small tree for the pack tests.\n",
    "docs/한글.txt": "안녕하세요\n".encode(),
    "deep/a/b/c/d/e/f/deep.txt": text(5000, 9),
    "big.bin": text(20000, 4) + noise(6000, 4) + b"a" * 3000 + text(12000, 5),
    "exact.bin": text(8192, 6),
    "noise.bin": noise(6000, 7),
    "empty.txt": b"",
}
LINKS = {"link": "docs/readme.md", "up": "../outside"}
HARD = {"docs/again.md": "docs/readme.md"}
DEVICES = ["dev/null c 666 0 0 1 3", "dev/sda b 660 0 6 8 0", "dev/pipe i 644 0 0 p"]


def write_tree():
    for root in (TREE, OTHER):
        shutil.rmtree(root, ignore_errors=True)
    for path, data in FILES.items():
        full = os.path.join(TREE, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(data)
    os.makedirs(os.path.join(TREE, "empty"))
    for name, target in LINKS.items():
        os.symlink(target, os.path.join(TREE, name))
    for name, target in HARD.items():
        os.link(os.path.join(TREE, target), os.path.join(TREE, name))
    os.makedirs(os.path.join(OTHER, "notes"))
    with open(os.path.join(OTHER, "notes", "other.txt"), "wb") as f:
        f.write(text(3000, 11))
    for root in (TREE, OTHER):
        for folder, dirs, files in os.walk(root):
            for name in dirs + files + [""]:
                os.utime(os.path.join(folder, name), (WHEN, WHEN), follow_symlinks=False)


def listing(root):
    entries = []
    for folder, dirs, files in os.walk(root):
        for name in sorted(dirs + files):
            full = os.path.join(folder, name)
            path = os.path.relpath(full, root)
            if os.path.islink(full):
                entries.append({"path": path, "kind": "link", "link": os.readlink(full)})
            elif os.path.isdir(full):
                entries.append({"path": path, "kind": "folder"})
            else:
                data = open(full, "rb").read()
                entries.append({"path": path, "kind": "file", "size": len(data),
                                "sha256": hashlib.sha256(data).hexdigest()})
    return sorted(entries, key=lambda e: e["path"])


def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)


def main():
    os.makedirs(OUT, exist_ok=True)
    write_tree()
    squash = {"gzip": [], "xz": ["-Xbcj", "x86"], "lz4": ["-Xhc"], "zstd": [], "lzo": []}
    pseudo = [x for d in ["dev d 755 0 0"] + DEVICES for x in ("-p", d)]
    for comp, extra in squash.items():
        run("mksquashfs", TREE, f"{OUT}/tree-{comp}.sqfs", "-noappend", "-quiet", "-b", "4096",
            "-comp", comp, *extra, "-all-root", "-mkfs-time", str(WHEN), *pseudo)
    run("mksquashfs", TREE, f"{OUT}/tree-nofrag.sqfs", "-noappend", "-quiet", "-b", "4096",
        "-comp", "gzip", "-no-fragments", "-no-exports", "-all-root", "-mkfs-time", str(WHEN))
    for comp in ("none", "xpress", "lzx"):
        wim = f"{OUT}/tree-{comp}.wim"
        run("wimlib-imagex", "capture", TREE, wim, "Tree", "The pack tree", f"--compress={comp}")
        run("wimlib-imagex", "append", OTHER, wim, "Other")
    run("wimlib-imagex", "capture", OTHER, f"{OUT}/tree-lzms.wim", "Other", "--compress=lzms")
    run("wimlib-imagex", "capture", OTHER, f"{OUT}/tree.esd", "Other", "--solid")
    expected = {"tree": listing(TREE), "other": listing(OTHER), "devices": DEVICES, "when": WHEN}
    with open(f"{OUT}/expected.json", "w") as f:
        json.dump(expected, f, indent=1, ensure_ascii=False, sort_keys=True)
        f.write("\n")


main()
