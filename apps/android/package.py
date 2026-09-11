#!/usr/bin/env python3
"""Package only built APKs and complete prepared source, with SHA-256 records."""
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tarfile
import zipfile

root = Path(__file__).resolve().parent
prepared = Path(sys.argv[1]).resolve()
apks = list((prepared / 'client/app/build/outputs/apk/other/debug').glob('*arm64-v8a*.apk'))
if len(apks) != 1:
    raise SystemExit('Expected exactly one ARM64 debug APK')
with zipfile.ZipFile(apks[0]) as apk:
    if not any(n.startswith('lib/arm64-v8a/') and n.endswith('.so') for n in apk.namelist()):
        raise SystemExit('APK does not contain the ARM64 native library')
dist = root / 'dist'
dist.mkdir(exist_ok=True)
shutil.copy2(apks[0], dist / 'XFreedom-0.1.0-arm64-debug.apk')
# Include all source and build files. Exclude caches, binaries and local machine paths.
def allowed(info):
    parts = Path(info.name).parts
    if any(p in {'.git', '.gradle', 'build', 'libs', 'dist'} for p in parts):
        return None
    if info.name.endswith(('.aar', '.apk', 'local.properties')):
        return None
    return info
with tarfile.open(dist / 'XFreedom-0.1.0-corresponding-source.tar.gz', 'w:gz') as archive:
    archive.add(prepared, arcname='source', filter=allowed)
    archive.add(root, arcname='recipe', filter=allowed)
for name in ['NOTICE.md', 'README.ru.md', 'upstream.lock.json']:
    shutil.copy2(root / name, dist / name)
checksums = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in dist.iterdir() if p.is_file() and p.name != 'SHA256SUMS.json'}
(dist / 'SHA256SUMS.json').write_text(json.dumps(checksums, indent=2) + '\n')
print('Packaged development APK, source and checksums. No device-test claim is made.')
