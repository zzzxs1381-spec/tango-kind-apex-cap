import Foundation
import NetworkExtension
import SwiftyXrayKit

final class PacketTunnelProvider: NEPacketTunnelProvider {
    private var tunnel: XRayTunnel?

    override func startTunnel(
        options: [String: NSObject]?,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
              let provider = proto.providerConfiguration,
              let shareURL = provider["shareURL"] as? String,
              let components = URLComponents(string: shareURL),
              components.scheme?.lowercased() == "vless",
              !shareURL.isEmpty
        else {
            completionHandler(TunnelError.missingProfile)
            return
        }

        setTunnelNetworkSettings(Self.makeSettings(remoteAddress: components.host ?? "xfreedom")) { [weak self] error in
            guard let self else {
                completionHandler(TunnelError.providerReleased)
                return
            }
            if let error {
                completionHandler(error)
                return
            }

            Task {
                do {
                    let runtimeDir = FileManager.default.temporaryDirectory
                        .appendingPathComponent("xfreedom-xray", isDirectory: true)
                    try FileManager.default.createDirectory(
                        at: runtimeDir,
                        withIntermediateDirectories: true
                    )
                    let finalConfig = runtimeDir.appendingPathComponent("resolved-xray.json")

                    let tunnel = XRayTunnel(packetFlow: self.packetFlow)
                    try await tunnel.run(
                        dataDir: runtimeDir,
                        config: .url(shareURL),
                        finalConfigPath: finalConfig
                    )
                    self.tunnel = tunnel
                    completionHandler(nil)
                } catch {
                    completionHandler(error)
                }
            }
        }
    }

    override func stopTunnel(
        with reason: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        let activeTunnel = tunnel
        tunnel = nil
        Task {
            if let activeTunnel {
                await activeTunnel.stop()
            }
            completionHandler()
        }
    }

    override func sleep(completionHandler: @escaping () -> Void) {
        completionHandler()
    }

    override func wake() {
        // Network handover recovery is added after the first on-device field run.
        // We deliberately do not claim self-healing until it is device-tested.
    }

    private static func makeSettings(remoteAddress: String) -> NEPacketTunnelNetworkSettings {
        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: remoteAddress)
        settings.mtu = 1280

        let ipv4 = NEIPv4Settings(
            addresses: ["198.18.0.1"],
            subnetMasks: ["255.255.0.0"]
        )
        ipv4.includedRoutes = [NEIPv4Route.default()]
        settings.ipv4Settings = ipv4

        let ipv6 = NEIPv6Settings(
            addresses: ["fd6e:a81b:704f:1211::1"],
            networkPrefixLengths: [64]
        )
        ipv6.includedRoutes = [NEIPv6Route.default()]
        settings.ipv6Settings = ipv6

        let dns = NEDNSSettings(servers: ["1.1.1.1", "8.8.8.8"])
        dns.matchDomains = [""]
        settings.dnsSettings = dns

        return settings
    }
}

enum TunnelError: LocalizedError {
    case missingProfile
    case providerReleased

    var errorDescription: String? {
        switch self {
        case .missingProfile:
            return "XFreedom PacketTunnel не получил VLESS/REALITY профиль"
        case .providerReleased:
            return "NetworkExtension завершился до запуска Xray"
        }
    }
}
