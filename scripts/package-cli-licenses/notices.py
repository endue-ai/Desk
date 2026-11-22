"""Redistribution notices for the locked Linux CLI's normal and build dependencies."""
import hashlib
import json
import re
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TARGET = "x86_64-unknown-linux-gnu"
LICENSE_NAME = re.compile(r"^(?:licen[cs]e|copyright|copying|unlicense|notice)s?(?:$|[-_.])", re.I)

# These monorepos publish some members without their common root license. The revision comes
# from each released crate's .cargo_vcs_info.json. Boa offers the Unlicense as one of two choices.
SIBLING = {
    "805a0f15320e8836cf2b9f001b53d884bf866c89": "wasmtime",
    "0b657fa991c9333908e8c51e8a582d602aac5391": "jsonschema",
}
UPSTREAM = {
    "337a3668a0dc86dd401ea20906e782249a64a228": ("boa-Unlicense.txt", "boa-dev/boa", "LICENSE-UNLICENSE"),
    "ad8739f5e0b51d20faf7a2cce98afa5c40121438": ("boa-Unlicense.txt", "boa-dev/boa", "LICENSE-UNLICENSE"),
    "d74c030d9dc4f3cae02146d1f497ff62726ef09a": ("simd-MIT.txt", "Nugine/simd", "LICENSE"),
}


def cargo(*args):
    return subprocess.check_output(["cargo", *args], text=True)


def revision(root):
    vcs = root / ".cargo_vcs_info.json"
    return json.loads(vcs.read_text())["git"]["sha1"] if vcs.is_file() else None


def crate_licenses(package, roots):
    root = Path(package["manifest_path"]).parent.resolve()
    declared = package["license_file"]
    paths = {p for p in root.rglob("*") if LICENSE_NAME.match(p.name) and p.is_file()}
    if declared:
        paths.add(root / declared)
    result = {}
    for path in sorted(paths):
        if not path.resolve().is_relative_to(root):
            raise ValueError(f"external license file for {package['name']}")
        data = path.read_bytes()
        if b"\0" not in data and path.suffix.lower() not in {".rs", ".js", ".toml", ".json"}:
            result[path.relative_to(root).as_posix()] = data
    if declared in result or any("/" not in name for name in result):
        return result
    rev = revision(root)
    if rev in SIBLING:
        donor = roots[SIBLING[rev]]
        if revision(donor) == rev:
            result["upstream LICENSE"] = (donor / "LICENSE").read_bytes()
    elif rev in UPSTREAM:
        filename, repo, original = UPSTREAM[rev]
        result[f"https://github.com/{repo}/blob/{rev}/{original}"] = (HERE / filename).read_bytes()
    if result:
        return result
    raise ValueError(f"missing redistribution notice for {package['name']} {package['version']}")


def notices():
    metadata = json.loads(cargo("metadata", "--format-version", "1", "--locked", "--filter-platform", TARGET))
    tree = cargo("tree", "--locked", "--target", TARGET, "-p", "desk-cli", "--edges", "normal,build",
                 "--prefix", "none", "--format", "{p}")
    closure = set(re.findall(r"^(\S+) v(\S+)", tree, re.MULTILINE))
    selected = [p for p in metadata["packages"] if (p["name"], p["version"]) in closure]
    if {(p["name"], p["version"]) for p in selected} != closure:
        raise ValueError("incomplete CLI dependency metadata")
    roots = {p["name"]: Path(p["manifest_path"]).parent for p in selected}
    index = ["Third-party notices for the endue CLI", "", "Original license texts are in licenses/.", ""]
    files = {}
    for package in sorted(selected, key=lambda p: (p["name"], p["version"])):
        if package["source"] is None:
            continue  # Workspace code is covered by the packaged project LICENSE.
        if package["source"] != "registry+https://github.com/rust-lang/crates.io-index":
            raise ValueError(f"review the distribution terms for {package['name']}")
        name, version = package["name"], package["version"]
        index.extend([f"{name} {version}  {package['license'] or 'see license file'}",
                      f"Source: https://crates.io/crates/{name}/{version}"])
        for source, data in crate_licenses(package, roots).items():
            dest = "licenses/" + hashlib.sha256(data).hexdigest() + ".txt"
            files[dest] = data
            index.append(f"  {source}: {dest}")
        index.append("")
    files["THIRD-PARTY-NOTICES.txt"] = "\n".join(index).encode()
    return files
