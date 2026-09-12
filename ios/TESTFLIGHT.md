# XFreedom iOS: signed IPA and TestFlight

The unsigned iOS CI proves that the SwiftUI application and PacketTunnel extension compile. A physical iPhone VPN test additionally requires Apple signing and a provisioning profile carrying the Network Extension entitlement.

## Apple-side prerequisites

Create both identifiers in the same Apple Developer team:

- `app.xservis.xfreedom.ios`
- `app.xservis.xfreedom.ios.PacketTunnel`

Enable **Network Extensions -> Packet Tunnel Provider** for both identifiers, then create App Store distribution provisioning profiles for the application and extension.

For public App Store distribution of a VPN service, Apple App Review Guideline 5.4 requires the developer account offering the VPN to be enrolled as an organization. The app already presents a privacy disclosure before the VPN can be used; the final privacy policy and App Store privacy answers still have to match actual production telemetry.

## GitHub Secrets

Add these Actions secrets to the repository. Never commit their decoded values.

- `APPLE_TEAM_ID` — Apple Developer Team ID.
- `APPLE_CERTIFICATE_P12_BASE64` — base64 of the Apple Distribution `.p12` certificate and private key.
- `APPLE_CERTIFICATE_PASSWORD` — password protecting that `.p12`.
- `APPLE_PROVISIONING_PROFILE_APP_BASE64` — base64 App Store provisioning profile for the main app.
- `APPLE_PROVISIONING_PROFILE_TUNNEL_BASE64` — base64 App Store provisioning profile for the PacketTunnel extension.

Only when TestFlight upload is required, also add:

- `APP_STORE_CONNECT_KEY_ID`
- `APP_STORE_CONNECT_ISSUER_ID`
- `APP_STORE_CONNECT_PRIVATE_KEY_BASE64` — base64 of the App Store Connect `AuthKey_*.p8` file.

The workflow validates that the two provisioning profiles belong to `APPLE_TEAM_ID`, match the exact bundle identifiers, and contain `packet-tunnel-provider` before archiving.

## Run

GitHub -> Actions -> **XFreedom iOS Signed Field Build** -> Run workflow.

Choose a marketing version such as `0.1.0`.

- `upload_testflight=false`: create and validate a signed IPA and publish it as a short-lived GitHub Actions artifact.
- `upload_testflight=true`: additionally validate and upload the IPA to App Store Connect, where Apple processes it for TestFlight.

The build number is the GitHub Actions run number so repeated CI uploads do not reuse the same build number.

## What this still does not prove

A successful signed archive or TestFlight upload is not proof that REALITY actually forwards traffic on an iPhone. Field acceptance still requires a physical device and verifies:

1. iOS launches the PacketTunnel extension;
2. the REALITY connection reaches the XFreedom node;
3. TCP and UDP traverse the tunnel;
4. DNS is functional without a routing loop or leak;
5. Safari and priority application checks pass;
6. disconnect restores normal networking;
7. Wi-Fi/cellular handover is tested before auto-recovery is marked complete.
