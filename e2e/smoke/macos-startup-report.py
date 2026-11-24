"""Describe an endue startup failure using public module names and numeric offsets only."""

import json
import re
import time
from pathlib import Path


def chromium_failure(stderr):
    for line in stderr.splitlines():
        match = re.search(r"\b(FATAL|ERROR):(?:[\w.+-]+/)*([\w.-]+\.(?:cc|cpp|mm|c|rs))[:(](\d+)", line)
        if match:
            print(f"{match[1]} in {match[2]} at line {match[3]}")
        for marker in ("Library not loaded", "Symbol not found", "code signature invalid",
                       "Library Validation", "no suitable image found", "wrong architecture",
                       "Operation not permitted", "failed to load", "Check failed",
                       "EXC_BREAKPOINT", "killed", "Metal", "SwiftShader", "Vulkan"):
            if marker.lower() in line.lower():
                print(marker)


def crash_frames(report):
    documents = report.read_text(errors="replace").split("\n", 1)
    if len(documents) != 2:
        return False
    try:
        data = json.loads(documents[1])
    except ValueError:
        return False
    if data.get("procName") not in ("endue", "endue-desk"):
        return False
    exception = data.get("exception", {})
    for label in ("type", "signal"):
        value = exception.get(label, "")
        if re.fullmatch(r"(?:EXC|SIG)[A-Z_]+", value):
            print(value)
    thread = next((thread for thread in data.get("threads", []) if thread.get("triggered")), {})
    images = data.get("usedImages", [])
    names = {"endue-desk", "Chromium Embedded Framework", "AppKit", "Foundation",
             "CoreFoundation", "Metal", "dyld", "libobjc.A.dylib", "libsystem_kernel.dylib",
             "libsystem_platform.dylib", "libsystem_c.dylib", "HIToolbox", "SkyLight",
             "QuartzCore", "libdispatch.dylib"}
    for frame in thread.get("frames", [])[:12]:
        idx = frame.get("imageIndex")
        offset = frame.get("imageOffset")
        if isinstance(idx, int) and 0 <= idx < len(images) and isinstance(offset, int):
            name = images[idx].get("name", "")
            print(f"{name if name in names else 'system image'} + 0x{offset:x}")
    return True


def main():
    stderr = Path("e2e/test-results/smoke.stderr.log")
    if stderr.is_file():
        chromium_failure(stderr.read_text(errors="replace"))
    directories = [Path.home() / "Library" / "Logs" / "DiagnosticReports",
                   Path("/Library/Logs/DiagnosticReports")]
    since = time.time() - 15 * 60
    for attempt in range(6):
        reports = sorted((p for directory in directories for p in directory.glob("endue*.ips")),
                         key=lambda p: p.stat().st_mtime, reverse=True)
        if any(crash_frames(report) for report in reports if report.stat().st_mtime >= since):
            return
        if attempt < 5:
            time.sleep(2)
    print("No recent endue crash report was available.")


if __name__ == "__main__":
    main()
