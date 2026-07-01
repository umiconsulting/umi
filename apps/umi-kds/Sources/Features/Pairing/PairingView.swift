import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct PairingView: View {
    @EnvironmentObject private var environment: AppEnvironment
    @State private var pin = ""
    @State private var phase: Phase = .entry
    @State private var message: String?
    @State private var pollingTask: Task<Void, Never>?

    enum Phase: Equatable {
        case entry
        case submitting
        case waiting(pairingID: String)
    }

    var body: some View {
        ZStack {
            KDSTheme.Colors.boardBackground.ignoresSafeArea()

            VStack(spacing: 34) {
                header
                pinDisplay
                keypad
                footer
            }
            .frame(maxWidth: 520)
            .padding(40)
        }
        .preferredColorScheme(.dark)
        .dynamicTypeSize(.xSmall ... .xLarge)
        .onAppear {
            message = environment.pairingMessage
        }
        .onDisappear {
            pollingTask?.cancel()
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            UMILogoView(markColor: KDSTheme.Brand.blue, textColor: .white, width: 92)
            Text("Kitchen Display")
                .font(.system(size: 28, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
            Text(phase == .entry ? "Ingresa el PIN de Dispositivos KDS" : "Esperando confirmacion del administrador")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.62))
                .multilineTextAlignment(.center)
        }
    }

    private var pinDisplay: some View {
        HStack(spacing: 12) {
            ForEach(0..<6, id: \.self) { index in
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(KDSTheme.Colors.cardBackground)
                    .overlay {
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(index < pin.count ? KDSTheme.Brand.blue : KDSTheme.Surfaces.separator, lineWidth: 1)
                    }
                    .overlay {
                        Text(character(at: index))
                            .font(.system(size: 30, weight: .semibold, design: .monospaced))
                            .foregroundStyle(.white)
                    }
                    .frame(width: 58, height: 68)
            }
        }
        .accessibilityLabel("Pairing PIN")
    }

    private var keypad: some View {
        VStack(spacing: 12) {
            ForEach([[1, 2, 3], [4, 5, 6], [7, 8, 9]], id: \.self) { row in
                HStack(spacing: 12) {
                    ForEach(row, id: \.self) { number in
                        key(String(number)) { append(String(number)) }
                    }
                }
            }
            HStack(spacing: 12) {
                key("Clear", compact: true) { resetEntry() }
                key("0") { append("0") }
                key("Del", compact: true) { removeLast() }
            }
        }
        .disabled(phase != .entry)
        .opacity(phase == .entry ? 1 : 0.45)
    }

    private var footer: some View {
        VStack(spacing: 14) {
            if case .waiting = phase {
                ProgressView()
                    .tint(KDSTheme.Brand.blue)
                Text("Esperando aprobacion. Aprueba este dispositivo en el panel (Dashboard \u{2192} KDS \u{2192} Dispositivos) para continuar.")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if let message {
                Text(message)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
            }

            Button {
                if case .waiting = phase {
                    cancelWaiting()
                } else {
                    Task { await submit() }
                }
            } label: {
                Text(actionTitle)
                    .font(.system(size: 18, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .frame(height: 58)
            }
            .buttonStyle(.borderedProminent)
            .tint(KDSTheme.Brand.blue)
            .disabled(phase == .submitting || (phase == .entry && pin.count != 6))
        }
    }

    private var actionTitle: String {
        switch phase {
        case .entry:
            "Conectar"
        case .submitting:
            "Conectando..."
        case .waiting:
            "Cancelar"
        }
    }

    private func key(_ label: String, compact: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: compact ? 16 : 28, weight: compact ? .semibold : .medium, design: compact ? .default : .rounded))
                .foregroundStyle(.white)
                .frame(width: 96, height: 72)
                .background(KDSTheme.Colors.cardBackground, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private func character(at index: Int) -> String {
        guard index < pin.count else { return "" }
        let stringIndex = pin.index(pin.startIndex, offsetBy: index)
        return String(pin[stringIndex])
    }

    private func append(_ digit: String) {
        guard pin.count < 6 else { return }
        pin.append(digit)
        message = nil
    }

    private func removeLast() {
        guard !pin.isEmpty else { return }
        pin.removeLast()
        message = nil
    }

    private func resetEntry() {
        pin = ""
        message = nil
        phase = .entry
    }

    private func cancelWaiting() {
        pollingTask?.cancel()
        pollingTask = nil
        phase = .entry
        message = nil
    }

    private func submit() async {
        guard pin.count == 6 else { return }
        phase = .submitting
        message = nil

        do {
            let submission = try await environment.apiClient.submitPairingPIN(pin: pin, deviceName: currentDeviceName)
            phase = .waiting(pairingID: submission.pairingID)
            startPolling(pairingID: submission.pairingID, interval: submission.pollAfterSeconds)
        } catch {
            phase = .entry
            message = "PIN invalido o expirado."
        }
    }

    private func startPolling(pairingID: String, interval: Int) {
        pollingTask?.cancel()
        pollingTask = Task {
            var delay = max(interval, 3)
            while !Task.isCancelled {
                do {
                    try await Task.sleep(for: .seconds(delay))
                    let status = try await environment.apiClient.fetchPairingStatus(pairingID: pairingID)
                    switch status.status {
                    case .pending:
                        delay = max(status.pollAfterSeconds ?? delay, 3)
                    case .approved:
                        guard let credential = status.deviceSession?.credential else {
                            await MainActor.run {
                                phase = .entry
                                message = "La aprobacion no incluyo credenciales."
                            }
                            return
                        }
                        await MainActor.run {
                            do {
                                try environment.completePairing(credential)
                            } catch {
                                phase = .entry
                                message = error.localizedDescription
                            }
                        }
                        return
                    case .denied:
                        await MainActor.run {
                            phase = .entry
                            message = "El administrador rechazo este pareo."
                        }
                        return
                    case .expired:
                        await MainActor.run {
                            phase = .entry
                            message = "El PIN expiro. Genera uno nuevo."
                        }
                        return
                    case .used:
                        await MainActor.run {
                            phase = .entry
                            message = "Este pareo ya fue usado."
                        }
                        return
                    }
                } catch is CancellationError {
                    return
                } catch {
                    if Task.isCancelled { return }
                    delay = min(delay + 2, 12)
                    await MainActor.run {
                        message = "Sin conexion. Reintentando..."
                    }
                }
            }
        }
    }

    private var currentDeviceName: String {
        #if canImport(UIKit)
        UIDevice.current.name
        #else
        "Kitchen Display"
        #endif
    }
}

#Preview {
    PairingView()
        .environmentObject(AppEnvironment.bootstrap())
}
