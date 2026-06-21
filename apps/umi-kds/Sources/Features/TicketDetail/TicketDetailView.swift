import SwiftUI

struct TicketDetailView: View {
    @EnvironmentObject private var repository: OrderRepository
    let orderID: KitchenOrder.ID?
    @State private var bumpCount = 0
    @State private var showingCancellationSheet = false
    @State private var showingPartialCancelSheet = false

    private var order: KitchenOrder? {
        guard let orderID else { return nil }
        return repository.order(id: orderID)
    }

    var body: some View {
        Group {
            if let order {
                ScrollView {
                    VStack(alignment: .leading, spacing: KDSTheme.Spacing.large) {
                        header(for: order)
                        actions(for: order)
                        metrics(for: order)
                        itemList(for: order)

                        if let customerNote = order.customerNote {
                            customerNoteSection(customerNote)
                        }

                        if let reason = order.cancellationReason {
                            cancellationReasonSection(reason)
                        }

                        if let reason = order.partialCancellationReason, order.status == .partialCancelled {
                            partialCancellationReasonSection(reason)
                        }

                        if let lastEventSequence = order.lastEventSequence {
                            Label("Last event #\(lastEventSequence)", systemImage: "dot.radiowaves.left.and.right")
                                .font(.footnote)
                                .foregroundStyle(KDSTheme.Brand.blue.opacity(0.5))
                        }
                    }
                    .padding(KDSTheme.Spacing.large)
                }
                .navigationTitle("Ticket")
                .background(KDSTheme.Colors.detailBackground.ignoresSafeArea())
            } else {
                emptySelection
            }
        }
        .sheet(isPresented: $showingPartialCancelSheet) {
            if let order {
                PartialCancellationSheet(order: order) { itemIDs, reasonCode, reasonNote in
                    showingPartialCancelSheet = false
                    bumpCount += 1
                    Task {
                        await repository.partialCancelItems(
                            orderID: order.id,
                            itemIDs: itemIDs,
                            reasonCode: reasonCode,
                            reasonNote: reasonNote
                        )
                    }
                }
            }
        }
        .sheet(isPresented: $showingCancellationSheet) {
            if let order {
                CancellationReasonSheet(
                    title: order.status == .partialCancelled ? "Escalar cancelación" : "Cancelar pedido",
                    confirmLabel: order.status == .partialCancelled ? "Escalar" : "Confirmar"
                ) { reasonCode, reasonNote in
                    showingCancellationSheet = false
                    bumpCount += 1
                    Task {
                        await repository.transition(
                            orderID: order.id,
                            to: .cancelled,
                            reasonCode: reasonCode,
                            reasonNote: reasonNote
                        )
                    }
                }
            }
        }
    }

    // MARK: Sections

    private var emptySelection: some View {
        VStack(spacing: KDSTheme.Spacing.large) {
            UMIMarkView(color: KDSTheme.Brand.blue.opacity(0.35), width: 56)
            VStack(spacing: 8) {
                Text("Select a Ticket")
                    .font(.system(.title3, design: .rounded).weight(.semibold))
                    .foregroundStyle(.secondary)
                Text("Choose an order from the board to review its items and notes.")
                    .font(.subheadline)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(KDSTheme.Spacing.large)
    }

    private func header(for order: KitchenOrder) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            Text(order.displayName)
                .font(.system(.largeTitle, design: .rounded).weight(.bold))
                .foregroundStyle(.primary)

            HStack(spacing: KDSTheme.Spacing.small) {
                detailChip(order.status.boardTitle, tint: order.status.tint)
                detailChip(order.source.displayName, tint: KDSTheme.Brand.blue)
                if let pickupPerson = order.pickupPerson {
                    detailChip(pickupPerson, tint: .secondary)
                }
            }

            Text(order.createdAt.formatted(date: .omitted, time: .shortened))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func actions(for order: KitchenOrder) -> some View {
        let canPartialCancel = availablePartialCancellationItems(for: order).count >= 2

        return Group {
            if !order.status.nextActionStatuses.isEmpty || canPartialCancel {
                VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
                    sectionLabel("Quick Actions")

                    HStack(spacing: KDSTheme.Spacing.small) {
                        ForEach(order.status.nextActionStatuses, id: \.self) { status in
                            Button {
                                if status == .cancelled {
                                    showingCancellationSheet = true
                                } else {
                                    bumpCount += 1
                                    Task {
                                        await repository.transition(orderID: order.id, to: status)
                                    }
                                }
                            } label: {
                                Text(actionLabel(for: status, from: order.status))
                                    .font(.system(.headline, design: .rounded).weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 56)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(status.tint)
                        }

                        if canPartialCancel {
                            Button {
                                showingPartialCancelSheet = true
                            } label: {
                                Text("Partial Cancel")
                                    .font(.system(.headline, design: .rounded).weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 56)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.orange)
                        }
                    }
                    .sensoryFeedback(.impact(weight: .medium), trigger: bumpCount)
                }
            }
        }
    }

    private func metrics(for order: KitchenOrder) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Details")

            HStack(spacing: KDSTheme.Spacing.medium) {
                TimelineView(.periodic(from: .now, by: 60)) { _ in
                    metricCard(title: "Age", value: "\(order.ageInMinutes)m")
                }
                metricCard(title: "Items", value: "\(order.items.count)")
                metricCard(title: "Channel", value: order.source.displayName)
                metricCard(title: "Sequence", value: order.lastEventSequence.map(String.init) ?? "—")
            }
        }
    }

    // Grouped item list with inset-style separators — readable at arm's length.
    private func itemList(for order: KitchenOrder) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Items")

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(order.items.enumerated()), id: \.offset) { index, item in
                    VStack(spacing: 0) {
                        if index > 0 {
                            KDSTheme.Surfaces.separator
                                .frame(maxWidth: .infinity, maxHeight: 1)
                                .padding(.leading, 52)
                        }

                        HStack(alignment: .top) {
                            Text("\(item.quantity)×")
                                .font(.system(.headline, design: .rounded).weight(.semibold))
                                .foregroundStyle(KDSTheme.Brand.blue)
                                .frame(width: 44, alignment: .leading)

                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.name)
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(item.isCancelled ? .tertiary : .primary)
                                    .strikethrough(item.isCancelled, color: .secondary)

                                if let variantName = item.variantName {
                                    Text(variantName)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                                if let notes = item.notes {
                                    Text(notes)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()
                        }
                        .padding(.horizontal, KDSTheme.Spacing.medium)
                        .padding(.vertical, 12)
                    }
                }
            }
            .glassEffect(
                Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.panelTint)),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
        }
    }

    private func cancellationReasonSection(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Motivo de cancelación")
            Text(reason)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KDSTheme.Spacing.medium)
                .glassEffect(
                    Glass.regular.tint(Color.red.opacity(KDSTheme.Glass.chromeTint)),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
        }
    }

    private func partialCancellationReasonSection(_ reason: String) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Items cancelados")
            Text("Esperando respuesta del cliente")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
            Text(reason)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KDSTheme.Spacing.medium)
                .glassEffect(
                    Glass.regular.tint(Color.orange.opacity(KDSTheme.Glass.chromeTint)),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
        }
    }

    private func customerNoteSection(_ note: String) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Customer Note")
            Text(note)
                .font(.body)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(KDSTheme.Spacing.medium)
                .glassEffect(
                    Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.chromeTint)),
                    in: RoundedRectangle(cornerRadius: 16, style: .continuous)
                )
        }
    }

    // MARK: Reusable components

    private func sectionLabel(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(KDSTheme.Brand.blue.opacity(0.75))
            .tracking(1.2)
    }

    private func metricCard(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title.uppercased())
                .font(.caption2.weight(.bold))
                .foregroundStyle(KDSTheme.Brand.blue.opacity(0.7))
                .tracking(0.8)
            Text(value)
                .font(.system(.title3, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(KDSTheme.Spacing.medium)
        .glassEffect(
            Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.panelTint)),
            in: RoundedRectangle(cornerRadius: 16, style: .continuous)
        )
    }

    private func detailChip(_ text: String, tint: Color) -> some View {
        Text(text)
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(tint)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .glassEffect(
                Glass.regular.tint(tint.opacity(KDSTheme.Glass.statusTint)),
                in: Capsule()
            )
    }

    private func availablePartialCancellationItems(for order: KitchenOrder) -> [KitchenItem] {
        guard
            order.status != .new,
            order.status != .ready,
            order.status != .completed,
            order.status != .cancelled,
            order.status != .partialCancelled
        else {
            return []
        }
        return order.items.filter { !$0.isCancelled }
    }

    private func actionLabel(for target: KitchenStatus, from current: KitchenStatus) -> String {
        if current == .partialCancelled && target == .cancelled {
            return "Escalate Full Cancel"
        }
        return target.actionLabel
    }
}

#Preview {
    TicketDetailView(orderID: previewKitchenOrders.first?.id)
        .environmentObject(OrderRepository.preview)
}
