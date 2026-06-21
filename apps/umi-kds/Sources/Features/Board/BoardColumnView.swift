import SwiftUI

struct BoardColumnView: View {
    let title: String
    let statusTint: Color
    let orders: [KitchenOrder]
    @Binding var selectedOrderID: KitchenOrder.ID?
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Top status accent — clipped to column's corner radius.
            Rectangle()
                .fill(statusTint)
                .frame(maxWidth: .infinity, maxHeight: 3)

            // Header + cards
            VStack(alignment: .leading, spacing: KDSTheme.Spacing.medium) {
                columnHeader

                if orders.isEmpty {
                    emptyState
                    Spacer(minLength: 0)
                } else {
                    ScrollView(.vertical, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: KDSTheme.Spacing.medium) {
                            ForEach(orders) { order in
                                Button {
                                    selectedOrderID = order.id
                                } label: {
                                    KDSCard(order: order, isSelected: selectedOrderID == order.id)
                                }
                                .buttonStyle(.plain)
                                .transition(.asymmetric(
                                    insertion: .push(from: .top).combined(with: .opacity),
                                    removal: .opacity
                                ))
                            }
                        }
                        .animation(.spring(duration: 0.35, bounce: 0.0), value: orders)
                        .padding(.bottom, KDSTheme.Spacing.small)
                    }
                    .frame(maxHeight: .infinity)
                }
            }
            .padding(KDSTheme.Spacing.columnPadding)
            .frame(maxHeight: .infinity)
        }
        .frame(width: width, alignment: .topLeading)
        .background(KDSTheme.Colors.columnBackground)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .sensoryFeedback(.selection, trigger: selectedOrderID)
    }

    // MARK: Sub-views

    private var columnHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title.uppercased())
                .font(.system(.caption, design: .rounded).weight(.bold))
                .foregroundStyle(statusTint)
                .tracking(1.2)

            Spacer()

            Text("\(orders.count)")
                .font(.system(.headline, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(.primary)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(statusTint.opacity(0.15))
                .clipShape(Capsule())
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("All clear")
                .font(.system(.subheadline, design: .rounded).weight(.semibold))
                .foregroundStyle(.secondary)
            Text("No active tickets.")
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(KDSTheme.Spacing.medium)
        .glassEffect(
            Glass.regular.tint(statusTint.opacity(KDSTheme.Glass.panelTint)),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }
}
