#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
manifest = json.loads((root / 'SOURCE-SHA256.json').read_text())
for relative, digest in manifest.items():
    path = root / relative
    if not path.resolve().is_relative_to(root) or not path.is_file() or path.is_symlink():
        raise SystemExit('Source manifest contains an invalid path')
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit(f'Source changed after preparation: {relative}')
print(f'Verified {len(manifest)} prepared source files')
