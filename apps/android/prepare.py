#!/usr/bin/env python3
"""Prepare an inspectable GPL Android fork from immutable upstream source commits.

This builds source, never edits an APK. A prepared directory is never overwritten.
The existing Control Center and upstream working copies are not modified.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parent
LOCK = json.loads((ROOT / 'upstream.lock.json').read_text())


def run(*args, cwd=None):
    subprocess.run(args, cwd=cwd, check=True)


def git_output(source, *args):
    return subprocess.check_output(['git', '-C', str(source), *args], text=True).strip()


def export_source(spec, destination, source=None):
    """Archive the pinned Git object, not possibly modified checkout bytes."""
    if not re.fullmatch(r'[a-f0-9]{40}', spec['commit']):
        raise ValueError('A full immutable commit is required')
    with tempfile.TemporaryDirectory(prefix='xfreedom-upstream-') as temporary:
        temporary = Path(temporary)
        if source is None:
            source = temporary / 'checkout'
            run('git', 'init', '-q', str(source))
            run('git', '-C', str(source), 'remote', 'add', 'origin', spec['repository'])
            run('git', '-C', str(source), 'fetch', '--depth', '1', 'origin', spec['commit'])
        actual = git_output(source, 'rev-parse', spec['commit'] + '^{commit}')
        if actual != spec['commit']:
            raise ValueError('Upstream commit mismatch')
        archive = temporary / 'source.tar'
        run('git', '-C', str(source), 'archive', '--format=tar', '--output', str(archive), actual)
        destination.mkdir(parents=True)
        with tarfile.open(archive) as contents:
            contents.extractall(destination, filter='data')


def replace_exact(path, old, new, count=1):
    text = path.read_text()
    if text.count(old) != count:
        raise ValueError(f'Upstream contract changed: {path.name}')
    path.write_text(text.replace(old, new))


def customize(client):
    app = client / 'app'
    replace_exact(app / 'build.gradle.kts',
                  'applicationId = "io.nekohasekai.sfa"',
                  'applicationId = "app.xfreedom.android"')
    replace_exact(app / 'build.gradle.kts', '"SFA-${versionName}"', '"XFreedom-${versionName}"')
    # The first artifact is ARM64 only. Do not label it universal or emit empty ABI APKs.
    replace_exact(app / 'build.gradle.kts', 'isUniversalApk = true', 'isUniversalApk = false')
    replace_exact(app / 'build.gradle.kts',
                  'include("armeabi-v7a", "arm64-v8a", "x86", "x86_64")', 'include("arm64-v8a")')
    replace_exact(app / 'src/main/res/values/strings.xml',
                  '<string name="app_name" translatable="false">sing-box</string>',
                  '<string name="app_name" translatable="false">XFreedom</string>')
    # Preserve namespaces, credits and license statements; only app routing identity changes.
    main = app / 'src/main/java/io/nekohasekai/sfa/compose/MainActivity.kt'
    text = main.read_text()
    if text.count('"sing-box"') != 2 or '"sing-box://"' not in text:
        raise ValueError('Unexpected import-link implementation')
    main.write_text(text.replace('"sing-box"', '"xfreedom"').replace('"sing-box://"', '"xfreedom://"'))
    manifest = app / 'src/main/AndroidManifest.xml'
    replace_exact(manifest, 'android:scheme="sing-box"', 'android:scheme="xfreedom"')
    replace_exact(manifest, 'android:allowBackup="true"', 'android:allowBackup="false"')
    # Package action names must not collide with the upstream installed app.
    for rel in ['src/main/java/io/nekohasekai/sfa/constant/Action.kt',
                'src/github/java/io/nekohasekai/sfa/vendor/InstallResultReceiver.kt',
                'src/github/AndroidManifest.xml']:
        f = app / rel
        text = f.read_text()
        f.write_text(text.replace('"io.nekohasekai.sfa.', '"app.xfreedom.android.'))
    # The upstream updater installs upstream APKs. The XFreedom fork has no such updater.
    vendor = app / 'src/other/java/io/nekohasekai/sfa/vendor/Vendor.kt'
    vendor.write_text((ROOT / 'overlay/Vendor.kt').read_text())
    # Own geometric icon, no upstream product mark.
    for name in ['ic_launcher_foreground.xml', 'ic_launcher_monochrome.xml']:
        (app / 'src/main/res/drawable' / name).write_text((ROOT / 'overlay/xfreedom-icon.xml').read_text())
    (app / 'src/main/res/drawable/xfreedom_launcher.xml').write_text(
        (ROOT / 'overlay/xfreedom-icon.xml').read_text())
    for f in (app / 'src').rglob('AndroidManifest.xml'):
        f.write_text(f.read_text().replace('@mipmap/ic_launcher', '@drawable/xfreedom_launcher'))
    theme = app / 'src/main/java/io/nekohasekai/sfa/compose/theme/Theme.kt'
    replace_exact(theme, 'dynamicColor: Boolean = true', 'dynamicColor: Boolean = false')
    colors = app / 'src/main/java/io/nekohasekai/sfa/compose/theme/Color.kt'
    text = colors.read_text().replace('0xFFD81B60', '0xFF00BFA5').replace('0xFFA00037', '0xFF00796B').replace('0xFFFF5C8D', '0xFF64FFDA')
    colors.write_text(text)
    (client / 'version.properties').write_text('VERSION_CODE=1\nVERSION_NAME=0.1.0\nGO_VERSION=go1.26.7\n')
    (client / 'XFREEDOM-NOTICE.md').write_text((ROOT / 'NOTICE.md').read_text())
    assets = app / 'src/main/assets'
    assets.mkdir(exist_ok=True)
    (assets / 'XFREEDOM-NOTICE.md').write_text((ROOT / 'NOTICE.md').read_text())
    (app / 'libs').mkdir(exist_ok=True)


def prepare(output, client_source=None, core_source=None):
    output = output.resolve()
    if output.exists():
        raise ValueError('Output already exists; choose a new empty path')
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='xfreedom-prepare-', dir=output.parent) as temporary:
        staging = Path(temporary) / 'prepared'
        export_source(LOCK['client'], staging / 'client', client_source)
        export_source(LOCK['core'], staging / 'sing-box', core_source)
        customize(staging / 'client')
        # An exported source tree has no Git metadata; never read a parent's unrelated tag.
        builder = staging / 'sing-box/cmd/internal/build_libbox/main.go'
        old = 'currentTag, err := build_shared.ReadTag()\n\tif err != nil {\n\t\tcurrentTag = "unknown"\n\t}'
        replace_exact(builder, old, 'currentTag := "1.14.0-xfreedom"')
        (staging / 'upstream.lock.json').write_text(json.dumps(LOCK, indent=2) + '\n')
        files = {}
        for p in sorted(staging.rglob('*')):
            if p.is_file() and not p.is_symlink():
                files[str(p.relative_to(staging))] = hashlib.sha256(p.read_bytes()).hexdigest()
        (staging / 'SOURCE-SHA256.json').write_text(json.dumps(files, indent=2) + '\n')
        shutil.move(staging, output)
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--client-source', type=Path)
    parser.add_argument('--core-source', type=Path)
    args = parser.parse_args()
    print(prepare(args.output, args.client_source, args.core_source))
