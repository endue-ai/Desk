#!/usr/bin/env python3
"""Measure the spike's memory: run it with N surfaces, wait until it settles, then read every
process of its tree with macOS `footprint` (physical footprint, the number Activity Monitor shows).

usage: measure.py <surfaces> <page> [settle-seconds]
"""
import json, os, re, subprocess, sys, tempfile, time

surfaces, page = int(sys.argv[1]), sys.argv[2]
settle = float(sys.argv[3]) if len(sys.argv) > 3 else 12.0
here = os.path.dirname(os.path.abspath(__file__))
app = os.path.join(here, "target/bundle/desk-spike.app/Contents/MacOS/desk-spike")
log = open(f"/tmp/compositor-track/poc/p3-{page}-{surfaces}.log", "w")
proc = subprocess.Popen([app, f"--spike-surfaces={surfaces}", f"--spike-page={page}", "--spike-headless",
                         f"--spike-exit-at={settle + 6}"], stdout=log, stderr=subprocess.STDOUT)
time.sleep(settle)

ps = subprocess.run(["ps", "-ax", "-o", "pid=,ppid=,command="], capture_output=True, text=True).stdout
tree, kinds = {proc.pid}, {proc.pid: "browser"}
rows = [line.split(None, 2) for line in ps.splitlines() if line.strip()]
changed = True
while changed:
    changed = False
    for pid, ppid, cmd in rows:
        pid, ppid = int(pid), int(ppid)
        if ppid in tree and pid not in tree:
            tree.add(pid)
            m = re.search(r"--type=([\w-]+)", cmd)
            kind = m.group(1) if m else "other"
            if kind == "utility":
                m = re.search(r"--utility-sub-type=([\w.]+)", cmd)
                kind = "utility:" + (m.group(1).split(".")[-1] if m else "?")
            kinds[pid] = kind
            changed = True

cpu_out = subprocess.run(["ps", "-o", "pid=,%cpu=", "-p", ",".join(str(p) for p in sorted(tree))], capture_output=True, text=True).stdout
cpu = {}
for line in cpu_out.splitlines():
    pid, pct = line.split()
    cpu.setdefault(kinds.get(int(pid), "?"), []).append(float(pct))
out = tempfile.mktemp(suffix=".json")
subprocess.run(["footprint", "-j", out] + [str(p) for p in sorted(tree)], capture_output=True)
data = json.load(open(out))
mib = lambda b: b / (1024 * 1024)
by_kind = {}
for p in data.get("processes", []):
    pid = p.get("pid")
    kind = kinds.get(pid, "?")
    by_kind.setdefault(kind, []).append(p.get("footprint", 0))
proc.wait(timeout=60)
log.close()
report = open(f"/tmp/compositor-track/poc/p3-{page}-{surfaces}.log").read()
firsts = [int(x) for x in re.findall(r"first_paint_ms=(\d+)", report)]
fps = re.search(r"\(([\d.]+) fps\)", report)
total = sum(sum(v) for v in by_kind.values())
renderers = sorted(by_kind.get("renderer", []))
print(f"surfaces={surfaces} page={page} processes={len(tree)} renderers={len(renderers)} "
      f"total={mib(total):.0f}MiB browser={mib(sum(by_kind.get('browser', []))):.0f}MiB "
      f"gpu={mib(sum(by_kind.get('gpu-process', []))):.0f}MiB "
      f"renderer_median={mib(renderers[len(renderers)//2]) if renderers else 0:.0f}MiB "
      f"renderer_max={mib(renderers[-1]) if renderers else 0:.0f}MiB "
      f"other={mib(sum(sum(v) for k, v in by_kind.items() if k not in ('browser', 'gpu-process', 'renderer'))):.0f}MiB "
      f"first_paint_median_ms={sorted(firsts)[len(firsts)//2] if firsts else '-'} first_paint_max_ms={max(firsts) if firsts else '-'} "
      f"compose_fps={fps.group(1) if fps else '-'}")
print("  by kind:", {k: f"{mib(sum(v)):.0f}MiB x{len(v)}" for k, v in sorted(by_kind.items())})
print("  cpu %:", {k: round(sum(v), 1) for k, v in sorted(cpu.items())})
