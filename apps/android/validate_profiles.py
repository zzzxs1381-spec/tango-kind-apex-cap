#!/usr/bin/env python3
"""Validate four transports and their combined profile against a real sing-box binary."""
import argparse
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'infra/solo'))
from android_profile import build_profile
from test_android_profile import AndroidProfile

parser = argparse.ArgumentParser()
parser.add_argument('--binary', type=Path, required=True)
args = parser.parse_args()
AndroidProfile.setUpClass()
fixture = AndroidProfile()
fixture.setUp()
native = copy.deepcopy(fixture.catalog['endpoints'][0])
native.update(id='native', kind='hy2-native', port=8443)
native.pop('obfs_password')
tuic = {**native, 'id': 'tuic', 'kind': 'tuic', 'port': 9443, 'uuid': fixture.state['uuid']}
endpoints = [*fixture.catalog['endpoints'], native, tuic]
with tempfile.TemporaryDirectory(prefix='xf-profile-check-') as temporary:
    for i, entries in enumerate([[e] for e in endpoints] + [endpoints]):
        path = Path(temporary) / f'{i}.json'
        path.write_text(json.dumps(build_profile({'schema': 1, 'endpoints': entries})))
        result = subprocess.run([str(args.binary.resolve()), 'check', '-c', str(path)], capture_output=True, text=True)
        if result.returncode:
            print(result.stderr, file=sys.stderr)
            raise SystemExit(result.returncode)
print('Five profiles accepted by sing-box. No network or Android device test implied.')
