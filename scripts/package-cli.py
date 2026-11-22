#!/usr/bin/env python3
"""Make a deterministic endue CLI archive from the Linux binary installed by the desktop build."""
import argparse
import gzip
import hashlib
import io
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts/package-cli-licenses"))
from notices import notices

TARGET = "linux-x86_64"


def validate_binary(binary):
    if len(binary) < 64 or binary[:6] != b"\x7fELF\x02\x01" or binary[18:20] != b"\x3e\x00":
        raise ValueError("expected a Linux x86_64 ELF executable")
    candidates = [str(ROOT), str(Path.home()), os.environ.get("GITHUB_WORKSPACE", "")]
    for path in candidates:
        if path and path not in {"/", "/src"} and os.fsencode(path.rstrip("/") + "/") in binary:
            raise ValueError("the binary includes a private build path. Rebuild with path remapping")
    if re.search(rb"(?:gh[pousr]_[a-zA-Z0-9]{25,}|github_pat_[a-zA-Z0-9_]{30,}|"
                 rb"-----BEGIN [A-Z ]*PRIVATE KEY-----\s+[A-Za-z0-9+/=]{48,})", binary):
        raise ValueError("the binary includes a credential marker")


def pack(binary_path, version, out):
    subprocess.run(["node", "scripts/release-assets.mjs", "version", "v" + version],
                   cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    binary = binary_path.read_bytes()
    validate_binary(binary)
    name = f"endue-cli_{version}_{TARGET}"
    os.chdir(ROOT)
    files = notices()
    files["LICENSE"] = (ROOT / "LICENSE").read_bytes()
    files["bin/activate"] = (ROOT / "apps/desk/shell/packager/cli/activate").read_bytes()
    files["bin/endue"] = binary
    out.mkdir(parents=True, exist_ok=True)
    archive = out / (name + ".tar.gz")
    with tempfile.TemporaryDirectory(dir=out) as work:
        temporary = Path(work) / archive.name
        with temporary.open("wb") as raw, gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as tar:
                for path, data in sorted(files.items()):
                    entry = tarfile.TarInfo(f"{name}/{path}")
                    entry.mode = 0o755 if path.startswith("bin/") else 0o644
                    entry.size = len(data)
                    tar.addfile(entry, io.BytesIO(data))
                alias = tarfile.TarInfo(f"{name}/bin/desk")
                alias.type = tarfile.SYMTYPE
                alias.linkname = "endue"
                alias.mode = 0o777
                tar.addfile(alias)
        digest = hashlib.sha256(temporary.read_bytes()).hexdigest()
        sums = Path(work) / "SHA256SUMS-cli"
        sums.write_text(f"{digest}  {archive.name}\n", encoding="ascii")
        temporary.replace(archive)
        sums.replace(out / sums.name)
    print(archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("version")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        pack(args.binary.resolve(), args.version, args.out.resolve())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
