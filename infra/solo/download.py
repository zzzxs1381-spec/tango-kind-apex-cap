#!/usr/bin/env python3
"""Download pinned upstream binaries; reject every checksum mismatch."""
import hashlib
import io
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import zipfile


def install(destination):
    manifest = json.loads(Path(__file__).with_name('versions.json').read_text())
    arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    if not arch:
        raise SystemExit('Supported architectures: amd64, arm64')
    destination.mkdir(parents=True, exist_ok=True)
    destination.chmod(0o755)
    for name in ('xray', 'hysteria'):
        asset = manifest[name]['assets'][arch]
        with tempfile.TemporaryDirectory() as td:
            target = Path(td) / 'download'
            subprocess.run(['curl', '--fail', '--location', '--proto', '=https',
                            '--tlsv1.2', '--retry', '3', '--connect-timeout', '15',
                            '--max-time', '300', '--silent', '--show-error',
                            asset['url'], '-o', str(target)], check=True)
            data = target.read_bytes()
            if hashlib.sha256(data).hexdigest() != asset['sha256']:
                raise SystemExit(f'{name}: SHA256 mismatch; refusing to install')
            if asset['format'] == 'zip':
                # Extract only the executable, never arbitrary archive paths.
                with zipfile.ZipFile(io.BytesIO(data)) as archive:
                    data = archive.read('xray')
            staged = destination / (name + '.new')
            staged.write_bytes(data)
            staged.chmod(0o755)
            os.replace(staged, destination / name)
        print(f'{name}: {manifest[name]["version"]}, SHA256 verified')


if __name__ == '__main__':
    install(Path(sys.argv[1]))
