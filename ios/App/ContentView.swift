import SwiftUI

struct ContentView: View {
    @StateObject private var tunnel = TunnelManager()
    @AppStorage("privacyAccepted") private var privacyAccepted = false

    @State private var profileName = "XFreedom REALITY"
    @State private var shareURL = ""
    @State private var validationMessage = "Вставьте VLESS/REALITY профиль"
    @State private var validProfile: XFreedomProfile?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    header
                    statusCard
                    privacyCard
                    profileCard
                    connectCard
                    evidenceCard
                }
                .padding(20)
            }
            .background(Color.black.ignoresSafeArea())
            .foregroundStyle(.white)
            .navigationTitle("XFreedom")
            .task { await tunnel.refresh() }
        }
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Один клиент. Одна кнопка.")
                .font(.title2.bold())
            Text("Диагностика → REALITY → системный Packet Tunnel → проверка. Без фиктивного состояния CONNECTED.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusCard: some View {
        card(title: "Состояние") {
            Text(tunnel.status.xfreedomText)
                .font(.headline)
            Text(tunnel.lastMessage)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private var privacyCard: some View {
        card(title: "Приватность") {
            Text("Field build не собирает историю браузинга, содержимое пакетов, сообщения, пароли или cookies. Профиль передаётся только системному NetworkExtension на устройстве. Публичная публикация сетевых измерений выключена.")
                .font(.footnote)
            Toggle("Я прочитал это перед использованием VPN", isOn: $privacyAccepted)
        }
    }

    private var profileCard: some View {
        card(title: "REALITY профиль") {
            TextField("Название", text: $profileName)
                .textFieldStyle(.roundedBorder)
            TextEditor(text: $shareURL)
                .frame(minHeight: 130)
                .scrollContentBackground(.hidden)
                .padding(8)
                .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
                .font(.system(.footnote, design: .monospaced))
                .onChange(of: shareURL) { _ in validateProfile() }
            Text(validationMessage)
                .font(.footnote)
                .foregroundStyle(validProfile == nil ? .orange : .green)
        }
    }

    private var connectCard: some View {
        card(title: "Подключение") {
            Button {
                Task {
                    if tunnel.status == .connected || tunnel.status == .connecting || tunnel.status == .reasserting {
                        tunnel.disconnect()
                    } else if let profile = validProfile, privacyAccepted {
                        await tunnel.connect(profile: profile)
                    }
                }
            } label: {
                Text(tunnel.status == .connected ? "ОТКЛЮЧИТЬ" : "ПОДКЛЮЧИТЬСЯ")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
            }
            .buttonStyle(.borderedProminent)
            .disabled(validProfile == nil || !privacyAccepted)

            Text("Для первого iPhone field release запускается VLESS/REALITY. Hysteria2/TUIC/AWG добавляются следующим transport-слоем после проверки реального packet forwarding на устройстве.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }

    private var evidenceCard: some View {
        card(title: "Что считается успехом") {
            Text("Статус NetworkExtension сам по себе не является доказательством рабочего интернета. После подключения production-версия обязана выполнить DNS/TCP/TLS/HTTP и app checks до показа подтверждённого CONNECTED.")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
    }

    private func validateProfile() {
        do {
            validProfile = try XFreedomProfile.validatedReality(name: profileName, shareURL: shareURL)
            validationMessage = "REALITY профиль валиден для запуска"
        } catch {
            validProfile = nil
            validationMessage = error.localizedDescription
        }
    }

    @ViewBuilder
    private func card<Content: View>(title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.caption.bold())
                .foregroundStyle(.mint)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.06), in: RoundedRectangle(cornerRadius: 18))
    }
}
