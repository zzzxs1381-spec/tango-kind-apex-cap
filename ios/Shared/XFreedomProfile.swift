import Foundation

struct XFreedomProfile: Codable, Equatable {
    let name: String
    let shareURL: String

    var serverHost: String {
        URLComponents(string: shareURL)?.host ?? "xfreedom"
    }

    static func validatedReality(name: String, shareURL: String) throws -> XFreedomProfile {
        guard let components = URLComponents(string: shareURL),
              components.scheme?.lowercased() == "vless",
              let host = components.host,
              !host.isEmpty,
              let user = components.user,
              UUID(uuidString: user) != nil
        else {
            throw ProfileError.invalidVLESS
        }

        let query = Dictionary(uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name.lowercased(), $0.value ?? "") })
        guard query["security"]?.lowercased() == "reality",
              !(query["sni"] ?? "").isEmpty,
              !(query["pbk"] ?? "").isEmpty
        else {
            throw ProfileError.missingRealityFields
        }

        let port = components.port ?? 443
        guard (1...65535).contains(port) else {
            throw ProfileError.invalidPort
        }

        return XFreedomProfile(
            name: name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "XFreedom REALITY" : name,
            shareURL: shareURL.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }
}

enum ProfileError: LocalizedError {
    case invalidVLESS
    case missingRealityFields
    case invalidPort

    var errorDescription: String? {
        switch self {
        case .invalidVLESS:
            return "Нужна валидная ссылка vless://UUID@host:port"
        case .missingRealityFields:
            return "REALITY-профиль должен содержать security=reality, sni и pbk"
        case .invalidPort:
            return "Порт профиля должен быть в диапазоне 1…65535"
        }
    }
}

enum XFreedomBundleIDs {
    static let tunnel = "app.xservis.xfreedom.ios.PacketTunnel"
}
