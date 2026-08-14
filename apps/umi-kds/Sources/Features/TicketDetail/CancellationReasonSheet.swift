import SwiftUI

struct CancellationReasonSheet: View {
    let title: String
    let confirmLabel: String
    let onConfirm: (_ reasonCode: CancelReasonCode, _ reasonNote: String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var reasonCode: CancelReasonCode = .outOfStock
    @State private var reasonNote = ""

    private var trimmedReasonNote: String {
        reasonNote.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canConfirm: Bool {
        reasonCode != .other || trimmedReasonNote.count >= 3
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Motivo") {
                    Picker("Motivo", selection: $reasonCode) {
                        ForEach(CancelReasonCode.allCases) { code in
                            Text(code.displayName).tag(code)
                        }
                    }

                    TextField("Detalle interno", text: $reasonNote, axis: .vertical)
                        .lineLimit(2...4)
                        .disabled(reasonCode != .other)

                    if reasonCode == .other && trimmedReasonNote.count < 3 {
                        Text("El motivo \"Otro\" requiere al menos 3 caracteres.")
                            .font(.footnote)
                            .foregroundStyle(.orange)
                    }
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Volver") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .topBarTrailing) {
                    Button(confirmLabel, role: .destructive) {
                        guard canConfirm else { return }
                        onConfirm(reasonCode, reasonCode == .other ? trimmedReasonNote : nil)
                    }
                    .disabled(!canConfirm)
                }
            }
        }
    }
}

#Preview {
    CancellationReasonSheet(title: "Cancelar pedido", confirmLabel: "Confirmar") { _, _ in }
}
