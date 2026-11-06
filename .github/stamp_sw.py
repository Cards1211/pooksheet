#!/usr/bin/env python3
"""Fill in the version and offline file list before publishing.

Usage: stamp_sw.py <app folder>. It edits that folder in place, so run it on a throwaway
copy (the publish job's checkout), never on the working files. The list comes from what is
actually there, so a new file can't be left out of the offline copy.
"""
import hashlib
import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
files = sorted(
    p.relative_to(root).as_posix()
    for p in root.rglob("*")
    if p.is_file() and p.name != "sw.js" and not any(part.startswith(".") for part in p.relative_to(root).parts)
)

digest = hashlib.sha256()
for name in files + ["sw.js"]:
    digest.update(name.encode())
    digest.update((root / name).read_bytes())
version = digest.hexdigest()[:10]


def fill(name, *pairs):
    path = root / name
    text = path.read_text(encoding="utf-8")
    for old, new in pairs:
        if text.count(old) != 1:
            sys.exit(f"{name}: expected exactly one {old!r}")
        text = text.replace(old, new)
    path.write_text(text, encoding="utf-8")


fill("sw.js", ("__VERSION__", version), ("/*__FILES__*/[]", json.dumps(["./"] + files)))
fill("index.html", ("__VERSION__", version))
print(f"PookSheet {version}: {len(files)} files")
