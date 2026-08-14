import SwiftUI

struct KDSCard: View {
    let order: KitchenOrder
    let isSelected: Bool

    var body: some View {
        HStack(spacing: 0) {
            // Left status strip — communicates status at a glance without a chip.
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(order.status.tint)
                .frame(width: 4)
                .padding(.vertical, 3)

            // Card content
            VStack(alignment: .leading, spacing: 10) {
                // Row 1: Order name + age pill
                HStack(alignment: .top, spacing: KDSTheme.Spacing.small) {
                    Text(order.displayName)
                        .font(.system(.headline, design: .rounded).weight(.bold))
                        .foregroundStyle(.primary)
                        .lineLimit(2)
                    Spacer(minLength: 6)
                    agePill
                }

                // Row 2: Channel chip
                sourceChip

                // Divider separates header scan zone from items scan zone
                KDSTheme.Surfaces.separator
                    .frame(maxWidth: .infinity, maxHeight: 1)

                // Row 3: Items
                itemsSection

                if order.status == .partialCancelled {
                    partialCancelBadge
                }

                // Row 4: Footer (station + note) — only when either is present
                if order.customerNote != nil || order.station != nil {
                    footer
                }
            }
            .padding(.leading, 14)
            .padding(.trailing, KDSTheme.Spacing.cardPadding)
            .padding(.vertical, KDSTheme.Spacing.cardPadding)
        }
        .background(KDSTheme.Colors.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(
                    isSelected
                        ? KDSTheme.Colors.selectedCardBorder.opacity(0.55)
                        : KDSTheme.Surfaces.separator,
                    lineWidth: isSelected ? 1.5 : 1
                )
        }
        .shadow(
            color: isSelected ? KDSTheme.Brand.blue.opacity(0.18) : .black.opacity(0.22),
            radius: isSelected ? 18 : 6,
            x: 0,
            y: isSelected ? 8 : 2
        )
    }

    // MARK: Sub-views

    private var agePill: some View {
        TimelineView(.periodic(from: .now, by: 60)) { _ in
            Text("\(order.ageInMinutes)m")
                .font(.system(.subheadline, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(ageTint)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .glassEffect(Glass.regular.tint(ageTint.opacity(0.20)), in: Capsule())
                .animation(.easeInOut(duration: 0.6), value: ageTint)
        }
    }

    private var sourceChip: some View {
        Text(order.source.displayName)
            .font(.caption.weight(.semibold))
            .foregroundStyle(KDSTheme.Brand.blue)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .glassEffect(
                Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.chromeTint)),
                in: Capsule()
            )
    }

    private var itemsSection: some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(order.items.prefix(4)) { item in
                HStack(alignment: .top, spacing: 8) {
                    Text("\(item.quantity)×")
                        .font(.system(.subheadline, design: .rounded).weight(.semibold))
                        .foregroundStyle(KDSTheme.Brand.blue.opacity(0.8))
                        .frame(width: 32, alignment: .leading)
                    Text(item.name)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(item.isCancelled ? .tertiary : .primary)
                        .strikethrough(item.isCancelled, color: .secondary)
                }
            }
            if order.items.count > 4 {
                Text("+\(order.items.count - 4) more")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .padding(.leading, 40)
            }
        }
    }

    private var footer: some View {
        HStack {
            if let station = order.station?.name {
                Label(station, systemImage: "fork.knife")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.quaternary)
                    .lineLimit(1)
            }
            Spacer()
            if order.customerNote != nil {
                Image(systemName: "text.bubble.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(KDSTheme.Brand.blue.opacity(0.55))
            }
        }
    }

    private var partialCancelBadge: some View {
        Text("Partial cancel - awaiting reply")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.orange)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .glassEffect(
                Glass.regular.tint(Color.orange.opacity(KDSTheme.Glass.statusTint)),
                in: Capsule()
            )
    }

    private var ageTint: Color {
        switch order.ageInMinutes {
        case 0..<10: .green
        case 10..<20: .orange
        default: .red
        }
    }
}

#Preview {
    KDSCard(order: previewKitchenOrders[0], isSelected: true)
        .padding()
}
