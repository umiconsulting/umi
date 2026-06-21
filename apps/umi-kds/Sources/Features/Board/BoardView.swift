import SwiftUI

struct BoardView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var repository: OrderRepository
    @Binding var selectedOrderID: KitchenOrder.ID?
    var onSettings: (() -> Void)? = nil

    private let visibleStatuses: [KitchenStatus] = [.new, .accepted, .preparing, .partialCancelled, .ready]

    var body: some View {
        VStack(spacing: 0) {
            boardHeader

            if let message = repository.snapshotError {
                snapshotBanner(message)
            }

            KDSTheme.Surfaces.separator
                .frame(maxWidth: .infinity, maxHeight: 1)

            GeometryReader { geometry in
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: KDSTheme.Spacing.medium) {
                        ForEach(visibleStatuses, id: \.self) { status in
                            BoardColumnView(
                                title: status.boardTitle,
                                statusTint: status.tint,
                                orders: repository.orders(for: status),
                                selectedOrderID: $selectedOrderID,
                                width: columnWidth(for: geometry.size.width)
                            )
                        }
                    }
                    .padding(.horizontal, KDSTheme.Spacing.large)
                    .padding(.vertical, KDSTheme.Spacing.large)
                }
            }
        }
        .background(KDSTheme.Colors.boardBackground.ignoresSafeArea())
        .navigationTitle("")
        .navigationBarTitleDisplayMode(.inline)
    }

    // MARK: Compact header — connection + status counts inline

    private var boardHeader: some View {
        HStack(spacing: KDSTheme.Spacing.large) {
            connectionPill

            Spacer()

            HStack(spacing: KDSTheme.Spacing.small) {
                ForEach(visibleStatuses, id: \.self) { status in
                    statusChip(for: status)
                }
            }

            if let onSettings {
                Button(action: onSettings) {
                    Image(systemName: "slider.horizontal.3")
                        .font(.body.weight(.medium))
                        .foregroundStyle(KDSTheme.Brand.blue)
                        .frame(width: 36, height: 36)
                        .glassEffect(
                            Glass.regular.tint(KDSTheme.Brand.blue.opacity(KDSTheme.Glass.chromeTint)),
                            in: Circle()
                        )
                }
                .frame(width: 44, height: 44)
            }
        }
        .padding(.horizontal, KDSTheme.Spacing.large)
        .padding(.vertical, 10)
    }

    private var connectionPill: some View {
        HStack(spacing: 6) {
            Image(systemName: "wifi", variableValue: connectionSignalValue)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(connectionTint)
                .animation(.easeInOut(duration: 0.4), value: connectionSignalValue)
            Text(repository.connectionState.displayName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassEffect(
            Glass.regular.tint(connectionTint.opacity(KDSTheme.Glass.chromeTint)),
            in: Capsule()
        )
    }

    private var connectionSignalValue: Double {
        switch repository.connectionState {
        case .connected: 1.0
        case .connecting: 0.5
        case .idle: 0.2
        }
    }

    private var connectionTint: Color {
        KDSTheme.Connection.tint(
            for: repository.connectionState,
            hasError: repository.snapshotError != nil || repository.pollingError != nil
        )
    }

    private func snapshotBanner(_ message: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.caption.weight(.semibold))
            Text(message)
                .font(.footnote)
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .foregroundStyle(.orange)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, KDSTheme.Spacing.large)
        .padding(.vertical, 10)
        .background(Color.orange.opacity(0.14))
    }

    private func statusChip(for status: KitchenStatus) -> some View {
        let count = repository.orders(for: status).count
        return HStack(spacing: 5) {
            Circle()
                .fill(status.tint)
                .frame(width: 6, height: 6)
            Text("\(count)")
                .font(.system(.callout, design: .rounded).weight(.bold).monospacedDigit())
                .foregroundStyle(.primary)
            Text(status.boardTitle)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .glassEffect(
            Glass.regular.tint(status.tint.opacity(KDSTheme.Glass.statusTint)),
            in: Capsule()
        )
    }

    // MARK: Layout

    private func columnWidth(for availableWidth: CGFloat) -> CGFloat {
        let outerPadding = KDSTheme.Spacing.large * 2
        let interColumnSpacing = KDSTheme.Spacing.medium * CGFloat(max(visibleStatuses.count - 1, 1))
        let usableWidth = max(availableWidth - outerPadding - interColumnSpacing, 0)
        let fittedWidth = usableWidth / CGFloat(visibleStatuses.count)

        if horizontalSizeClass == .compact {
            return KDSTheme.BoardDensity.compactColumnWidth
        }

        return min(
            max(fittedWidth, KDSTheme.BoardDensity.regularMinColumnWidth),
            KDSTheme.BoardDensity.regularMaxColumnWidth
        )
    }
}

#Preview {
    BoardView(selectedOrderID: .constant(previewKitchenOrders.first?.id))
        .environmentObject(OrderRepository.preview)
}
