import Foundation
import Combine
import NetworkExtension

@MainActor
final class TunnelManager: ObservableObject {
    @Published private(set) var status: NEVPNStatus = .invalid
    @Published private(set) var lastMessage = "Готово к настройке iPhone"

    private var manager: NETunnelProviderManager?

    func refresh() async {
        do {
            let managers = try await loadAll()
            manager = managers.first
            status = manager?.connection.status ?? .invalid
        } catch {
            lastMessage = "VPN status: \(error.localizedDescription)"
        }
    }

    func connect(profile: XFreedomProfile) async {
        do {
            let tunnelManager = try await configuredManager(for: profile)
            try tunnelManager.connection.startVPNTunnel()
            manager = tunnelManager
            status = tunnelManager.connection.status
            lastMessage = "Запрос на запуск REALITY передан NetworkExtension"
        } catch {
            status = manager?.connection.status ?? .invalid
            lastMessage = "Подключение: \(error.localizedDescription)"
        }
    }

    func disconnect() {
        manager?.connection.stopVPNTunnel()
        status = manager?.connection.status ?? .disconnected
        lastMessage = "Отключение запрошено"
    }

    private func configuredManager(for profile: XFreedomProfile) async throws -> NETunnelProviderManager {
        let managers = try await loadAll()
        let tunnelManager = managers.first ?? NETunnelProviderManager()

        let proto = NETunnelProviderProtocol()
        proto.providerBundleIdentifier = XFreedomBundleIDs.tunnel
        proto.serverAddress = profile.serverHost
        proto.providerConfiguration = [
            "profileName": profile.name,
            "shareURL": profile.shareURL,
        ]

        tunnelManager.protocolConfiguration = proto
        tunnelManager.localizedDescription = "XFreedom"
        tunnelManager.isEnabled = true

        try await save(tunnelManager)
        try await reload(tunnelManager)
        return tunnelManager
    }

    private func loadAll() async throws -> [NETunnelProviderManager] {
        try await withCheckedThrowingContinuation { continuation in
            NETunnelProviderManager.loadAllFromPreferences { managers, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: managers ?? [])
                }
            }
        }
    }

    private func save(_ manager: NETunnelProviderManager) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            manager.saveToPreferences { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }

    private func reload(_ manager: NETunnelProviderManager) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            manager.loadFromPreferences { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: ())
                }
            }
        }
    }
}

extension NEVPNStatus {
    var xfreedomText: String {
        switch self {
        case .invalid: return "не настроено"
        case .disconnected: return "отключено"
        case .connecting: return "подключение…"
        case .connected: return "подключено"
        case .reasserting: return "переподключение…"
        case .disconnecting: return "отключение…"
        @unknown default: return "неизвестно"
        }
    }
}
