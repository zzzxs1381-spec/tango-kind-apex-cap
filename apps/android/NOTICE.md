# XFreedom Android — Open Edition

XFreedom is an independent derivative of sing-box for Android by nekohasekai / SagerNet.
It is not affiliated with or endorsed by SagerNet, Evozi, or TLSVPN Services.

The client and linked sing-box library are distributed under their upstream
GPL-3.0-or-later terms and accompanying notices. All upstream copyright and
license files are preserved in the prepared source. Branding, package identity,
import scheme and updater behavior differ from upstream. This is not a closed-source
edition and does not reuse the TLSVPN proprietary protocol or HTTP Injector APK.

The `upstream.lock.json` file pins the complete source commits. `prepare.py` exports
those commits, applies the visible XFreedom changes and records source SHA-256 hashes.
Every APK distribution must include corresponding source and build instructions.
Do not distribute only an APK with a recipe link instead of satisfying the licenses.

The 0.1.0 artifact, if successfully built, is a debug-signed ARM64 development build.
It is not a Google Play release. A stable private signing key, verified upgrade path,
device testing and store declarations are required before production distribution.

Independent Control Center/server components are not relicensed by this notice.
