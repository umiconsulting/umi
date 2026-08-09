import SwiftUI

struct TicketDetailView: View {
    @EnvironmentObject private var repository: OrderRepository
    let orderID: KitchenOrder.ID?
    @State private var actionCount = 0

    private var order: KitchenOrder? {
        guard let orderID else { return nil }
        return repository.order(id: orderID)
    }

    var body: some View {
        Group {
            if let order {
                ScrollView {
                    VStack(alignment: .leading, spacing: KDSTheme.Spacing.large) {
                        header(order)
                        actions(order)
                        metrics(order)
                        itemList(order)
                        Label(
                            "Last event #\(order.lastEventSequence)",
                            systemImage: "dot.radiowaves.left.and.right"
                        )
                        .font(.footnote)
                        .foregroundStyle(KDSTheme.Brand.blue.opacity(0.5))
                    }
                    .padding(KDSTheme.Spacing.large)
                }
                .navigationTitle("Kitchen Order")
                .background(KDSTheme.Colors.detailBackground.ignoresSafeArea())
            } else {
                emptySelection
            }
        }
    }

    private var emptySelection: some View {
        VStack(spacing: KDSTheme.Spacing.large) {
            UMIMarkView(color: KDSTheme.Brand.blue.opacity(0.35), width: 56)
            Text("Select an order")
                .font(.system(.title3, design: .rounded).weight(.semibold))
                .foregroundStyle(.secondary)
            Text("Choose an order to review its preparation facts.")
                .font(.subheadline)
                .foregroundStyle(.tertiary)
        }
        .padding(KDSTheme.Spacing.large)
    }

    private func header(_ order: KitchenOrder) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            Text(order.displayName)
                .font(.system(.largeTitle, design: .rounded).weight(.bold))
            HStack(spacing: KDSTheme.Spacing.small) {
                detailChip(order.status.boardTitle, tint: order.status.tint)
                detailChip(order.station.name, tint: KDSTheme.Brand.blue)
                if order.priority != .normal {
                    detailChip(order.priority.rawValue.uppercased(), tint: .orange)
                }
            }
            Text(order.createdAt.formatted(date: .omitted, time: .shortened))
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
    }

    private func actions(_ order: KitchenOrder) -> some View {
        Group {
            if !order.nextActionStatuses.isEmpty {
                VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
                    sectionLabel("Actions")
                    HStack(spacing: KDSTheme.Spacing.small) {
                        ForEach(order.nextActionStatuses, id: \.self) { status in
                            Button {
                                actionCount += 1
                                Task { await repository.transition(orderID: order.id, to: status) }
                            } label: {
                                Text(status.actionLabel)
                                    .font(.system(.headline, design: .rounded).weight(.semibold))
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 56)
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(status.tint)
                            .disabled(repository.connectionState != .connected && !repository.isDemoMode)
                        }
                    }
                    .sensoryFeedback(.impact(weight: .medium), trigger: actionCount)
                }
            }
        }
    }

    private func metrics(_ order: KitchenOrder) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Details")
            HStack(spacing: KDSTheme.Spacing.medium) {
                TimelineView(.periodic(from: .now, by: 60)) { _ in
                    metricCard("Age", value: "\(order.ageInMinutes)m")
                }
                metricCard("Items", value: "\(order.items.count)")
                metricCard("Version", value: "\(order.version)")
            }
        }
    }

    private func itemList(_ order: KitchenOrder) -> some View {
        VStack(alignment: .leading, spacing: KDSTheme.Spacing.small) {
            sectionLabel("Items")
            VStack(alignment: .leading, spacing: 0) {
                ForEach(order.items) { item in
                    HStack(alignment: .top, spacing: 12) {
                        Text("\(item.quantity)×")
                            .font(.headline.monospacedDigit())
                            .foregroundStyle(KDSTheme.Brand.blue)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.name).font(.body.weight(.semibold))
                            if let variant = item.variantName { Text(variant).foregroundStyle(.secondary) }
                            ForEach(item.modifiers, id: \.self) { modifier in
                                Text(modifier).font(.subheadline).foregroundStyle(.secondary)
                            }
                            if let note = item.notes {
                                Text(note).font(.subheadline).foregroundStyle(.orange)
                            }
                        }
                        Spacer()
                        Text(item.status.rawValue.replacingOccurrences(of: "_", with: " "))
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    .padding(KDSTheme.Spacing.medium)
                }
            }
            .glassEffect(
                Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.panelTint)),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
        }
    }

    private func sectionLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.caption.weight(.bold))
            .foregroundStyle(.secondary)
    }

    private func metricCard(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title.uppercased()).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            Text(value).font(.system(.title3, design: .rounded).weight(.bold).monospacedDigit())
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
            .glassEffect(Glass.regular.tint(tint.opacity(KDSTheme.Glass.statusTint)), in: Capsule())
    }
}

#Preview {
    TicketDetailView(orderID: previewKitchenOrders.first?.id)
        .environmentObject(OrderRepository.preview)
}
