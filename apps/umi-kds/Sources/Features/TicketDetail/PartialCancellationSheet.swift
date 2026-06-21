import SwiftUI

struct PartialCancellationSheet: View {
    let order: KitchenOrder
    let onConfirm: (_ itemIDs: [UUID], _ reasonCode: CancelReasonCode, _ reasonNote: String?) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var selectedItemIDs: Set<UUID> = []
    @State private var reasonCode: CancelReasonCode = .outOfStock
    @State private var reasonNote = ""
    @State private var showAllSelectedAlert = false

    private var activeItems: [KitchenItem] {
        order.items.filter { !$0.isCancelled }
    }

    private var trimmedReasonNote: String {
        reasonNote.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canConfirm: Bool {
        !selectedItemIDs.isEmpty && (reasonCode != .other || trimmedReasonNote.count >= 3)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: KDSTheme.Spacing.large) {
                    VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
                        Text("Select Items")
                            .font(.system(.title3, design: .rounded).weight(.bold))

                        VStack(alignment: .leading, spacing: 10) {
                            ForEach(activeItems) { item in
                                Toggle(isOn: binding(for: item.id)) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(item.quantity)x \(item.name)")
                                            .font(.body.weight(.semibold))
                                        if let variantName = item.variantName {
                                            Text(variantName)
                                                .font(.subheadline)
                                                .foregroundStyle(.secondary)
                                        }
                                    }
                                }
                                .toggleStyle(.switch)
                            }
                        }
                        .padding(KDSTheme.Spacing.medium)
                        .glassEffect(
                            Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.panelTint)),
                            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                        )
                    }

                    VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
                        Text("Reason")
                            .font(.system(.headline, design: .rounded).weight(.semibold))

                        Picker("Reason", selection: $reasonCode) {
                            ForEach(CancelReasonCode.allCases) { code in
                                Text(code.displayName).tag(code)
                            }
                        }
                        .pickerStyle(.menu)

                        TextField("Detalle interno", text: $reasonNote, axis: .vertical)
                            .textFieldStyle(.roundedBorder)
                            .lineLimit(2...4)
                            .disabled(reasonCode != .other)

                        if reasonCode == .other && trimmedReasonNote.count < 3 {
                            Text("El motivo \"Otro\" requiere al menos 3 caracteres.")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        }
                    }

                    Button {
                        guard canConfirm else { return }
                        if selectedItemIDs.count == activeItems.count {
                            showAllSelectedAlert = true
                            return
                        }
                        onConfirm(
                            Array(selectedItemIDs),
                            reasonCode,
                            reasonCode == .other ? trimmedReasonNote : nil
                        )
                    } label: {
                        Text("Confirm Partial Cancel")
                            .font(.system(.headline, design: .rounded).weight(.semibold))
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 56)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(.orange)
                    .disabled(!canConfirm)
                }
                .padding(KDSTheme.Spacing.large)
            }
            .navigationTitle("Partial Cancel")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                }
            }
        }
        .alert("Use full order cancellation instead", isPresented: $showAllSelectedAlert) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("At least one active item must remain on the order.")
        }
    }

    private func binding(for itemID: UUID) -> Binding<Bool> {
        Binding(
            get: { selectedItemIDs.contains(itemID) },
            set: { isSelected in
                if isSelected {
                    selectedItemIDs.insert(itemID)
                } else {
                    selectedItemIDs.remove(itemID)
                }
            }
        )
    }
}

#Preview {
    PartialCancellationSheet(order: previewKitchenOrders[0]) { _, _, _ in }
}
