import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        Form {
            Section {
                brandHeader
            }
            .listRowBackground(Color.clear)
            .listRowInsets(.init())

            Section("Device") {
                LabeledContent("Business") {
                    Text(environment.deviceSession?.businessID ?? "Not paired")
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
                LabeledContent("Station") {
                    Text(environment.deviceSession?.station.name ?? "Not paired")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Device") {
                    Text(environment.deviceSession?.deviceName ?? "Not paired")
                        .foregroundStyle(.secondary)
                }
                LabeledContent("Data") {
                    Text((environment.orderRepository?.isDemoMode ?? true) ? "Demo preview (no backend keys)" : "Live (Supabase kds RPCs)")
                        .foregroundStyle(.secondary)
                }
            }

            Section("Connection") {
                LabeledContent("Status") {
                    Text(environment.orderRepository?.connectionState.displayName ?? "Unpaired")
                        .foregroundStyle(connectionColor)
                }

                if let err = environment.orderRepository?.snapshotError {
                    Text(err)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }

                if let err = environment.orderRepository?.pollingError {
                    Text(err)
                        .font(.footnote)
                        .foregroundStyle(.orange)
                }

                Button {
                    environment.reconnect()
                } label: {
                    Label("Reconnect", systemImage: "arrow.clockwise")
                }
                .tint(reconnectTint)
            }
        }
        .navigationTitle("Settings")
    }

    private var connectionColor: Color {
        KDSTheme.Connection.tint(
            for: environment.orderRepository?.connectionState,
            hasError: environment.orderRepository?.snapshotError != nil
                || environment.orderRepository?.pollingError != nil
        )
    }

    private var reconnectTint: Color {
        guard let repo = environment.orderRepository else { return .secondary }
        let hasError = repo.snapshotError != nil || repo.pollingError != nil
        return (repo.connectionState != .connected || hasError) ? KDSTheme.Brand.blue : .secondary
    }

    private var brandHeader: some View {
        HStack {
            Spacer()
            VStack(spacing: 6) {
                UMILogoView(markColor: KDSTheme.Brand.blue, width: 80)
                Text("Kitchen Display System")
                    .font(.caption)
                    .foregroundStyle(KDSTheme.Brand.blue.opacity(0.7))
                    .tracking(0.5)
            }
            Spacer()
        }
        .padding(.vertical, KDSTheme.Spacing.large)
    }
}

#Preview {
    SettingsView()
        .environmentObject(AppEnvironment.bootstrap())
}
