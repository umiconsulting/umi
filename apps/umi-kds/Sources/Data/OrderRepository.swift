import Foundation
import Combine

enum RealtimeConnectionState {
    case idle
    case connecting
    case connected

    var displayName: String {
        switch self {
        case .idle:
            return "Idle"
        case .connecting:
            return "Reconnecting"
        case .connected:
            return "Connected"
        }
    }
}

enum KDSDataError: Error {
    case notConfigured
    case invalidResponse
    case transportFailed(Int)
    case deviceRevoked
}

extension KDSDataError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .notConfigured:
            NSLocalizedString(
                "KDSDataError.notConfigured",
                value: "KDS backend is not configured.",
                comment: "KDS backend configuration missing error"
            )
        case .invalidResponse:
            NSLocalizedString(
                "KDSDataError.invalidResponse",
                value: "The KDS backend returned an invalid response.",
                comment: "Invalid KDS backend response error"
            )
        case .transportFailed(let status):
            String(
                format: NSLocalizedString(
                    "KDSDataError.transportFailed",
                    value: "KDS request failed with status %d.",
                    comment: "KDS HTTP transport error"
                ),
                status
            )
        case .deviceRevoked:
            NSLocalizedString(
                "KDSDataError.deviceRevoked",
                value: "This KDS device was revoked. Generate a new PIN in the dashboard.",
                comment: "KDS device revoked error"
            )
        }
    }
}

@MainActor
final class OrderRepository: ObservableObject {
    @Published private(set) var orders: [KitchenOrder]
    @Published private(set) var connectionState: RealtimeConnectionState = .idle
    /// Set when the initial snapshot fails against a configured backend (empty board; polling may still recover).
    @Published private(set) var snapshotError: String?
    /// Set when a polling cycle fails. Cleared on the next successful poll. Non-nil does not mean
    /// disconnected — polling retries on every interval and may recover.
    @Published private(set) var pollingError: String?

    private let apiClient: KDSAPIClient
    private let realtimeClient: KDSRealtimeClient
    private let deviceSession: DeviceSession
    private let onDeviceRevoked: @MainActor () -> Void
    private var hasStarted = false

    init(
        apiClient: KDSAPIClient,
        realtimeClient: KDSRealtimeClient,
        deviceSession: DeviceSession,
        orders: [KitchenOrder]? = nil,
        onDeviceRevoked: @escaping @MainActor () -> Void = {}
    ) {
        self.apiClient = apiClient
        self.realtimeClient = realtimeClient
        self.deviceSession = deviceSession
        self.onDeviceRevoked = onDeviceRevoked

        if let orders {
            self.orders = orders
        } else if KDSBackendConfiguration.load() != nil {
            self.orders = []
        } else {
            self.orders = previewKitchenOrders
        }
    }

    /// When the app is pointed at Supabase, we show live data only — not demo tickets mixed with real connection state.
    var isDemoMode: Bool {
        KDSBackendConfiguration.load() == nil
    }

    func resetForRestart() {
        hasStarted = false
        connectionState = .idle
        snapshotError = nil
        pollingError = nil
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        connectionState = .connecting
        snapshotError = nil
        pollingError = nil

        if KDSBackendConfiguration.load() != nil {
            do {
                let snapshot = try await apiClient.fetchBoardSnapshot(for: deviceSession)
                orders = snapshot
                snapshotError = nil
            } catch KDSDataError.deviceRevoked {
                onDeviceRevoked()
                return
            } catch {
                orders = []
                snapshotError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }

        // connectionState advances to .connected only after the first successful poll cycle,
        // proving the event stream can actually reach the backend.
        let lastSeenSequence = orders.compactMap(\.lastEventSequence).max()
        for await result in realtimeClient.pollStream(for: deviceSession, lastSeenSequence: lastSeenSequence) {
            switch result {
            case .events(let events):
                connectionState = .connected
                pollingError = nil
                for event in events {
                    apply(event)
                }
            case .failure(let error):
                if case .deviceRevoked = error as? KDSDataError {
                    onDeviceRevoked()
                    return
                }
                connectionState = .connecting
                pollingError = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func orders(for status: KitchenStatus) -> [KitchenOrder] {
        orders
            .filter { $0.status == status }
            .sorted { $0.createdAt < $1.createdAt }
    }

    func order(id: KitchenOrder.ID) -> KitchenOrder? {
        orders.first(where: { $0.id == id })
    }

    func transition(
        orderID: KitchenOrder.ID,
        to status: KitchenStatus,
        reasonCode: CancelReasonCode? = nil,
        reasonNote: String? = nil
    ) async {
        guard let index = orders.firstIndex(where: { $0.id == orderID }) else { return }

        let originalOrder = orders[index]
        let reasonText = {
            guard let reasonCode else { return reasonNote }
            let trimmedReasonNote = reasonNote?.trimmingCharacters(in: .whitespacesAndNewlines)
            if let trimmedReasonNote, !trimmedReasonNote.isEmpty {
                return "\(reasonCode.displayName): \(trimmedReasonNote)"
            }
            return reasonCode.displayName
        }()
        orders[index] = KitchenOrder(
            id: originalOrder.id,
            businessID: originalOrder.businessID,
            source: originalOrder.source,
            status: status,
            station: originalOrder.station,
            createdAt: originalOrder.createdAt,
            updatedAt: .now,
            customerName: originalOrder.customerName,
            pickupPerson: originalOrder.pickupPerson,
            customerNote: originalOrder.customerNote,
            cancellationReason: status == .cancelled ? reasonText : originalOrder.cancellationReason,
            partialCancellationReason: status == .partialCancelled ? originalOrder.partialCancellationReason : nil,
            totalAmount: originalOrder.totalAmount,
            items: originalOrder.items,
            lastEventSequence: originalOrder.lastEventSequence
        )

        do {
            let updatedOrder = try await apiClient.transitionTicket(
                orderID: orderID,
                to: status,
                reasonCode: reasonCode,
                reasonNote: reasonNote,
                for: deviceSession
            )
            replace(updatedOrder)
        } catch KDSDataError.deviceRevoked {
            onDeviceRevoked()
        } catch KDSDataError.notConfigured {
            // Keep previews and scaffolds usable without a backend configuration.
        } catch {
            replace(originalOrder)
        }
    }

    func partialCancelItems(
        orderID: KitchenOrder.ID,
        itemIDs: [UUID],
        reasonCode: CancelReasonCode,
        reasonNote: String?
    ) async {
        guard let index = orders.firstIndex(where: { $0.id == orderID }) else { return }

        let originalOrder = orders[index]
        let trimmedReasonNote = reasonNote?.trimmingCharacters(in: .whitespacesAndNewlines)
        let partialReason = {
            if let trimmedReasonNote, !trimmedReasonNote.isEmpty {
                return "\(reasonCode.displayName): \(trimmedReasonNote)"
            }
            return reasonCode.displayName
        }()
        let updatedItems = originalOrder.items.map { item in
            guard itemIDs.contains(item.id) else { return item }
            return KitchenItem(
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                variantName: item.variantName,
                notes: item.notes,
                isCancelled: true
            )
        }

        orders[index] = KitchenOrder(
            id: originalOrder.id,
            businessID: originalOrder.businessID,
            source: originalOrder.source,
            status: .partialCancelled,
            station: originalOrder.station,
            createdAt: originalOrder.createdAt,
            updatedAt: .now,
            customerName: originalOrder.customerName,
            pickupPerson: originalOrder.pickupPerson,
            customerNote: originalOrder.customerNote,
            cancellationReason: originalOrder.cancellationReason,
            partialCancellationReason: partialReason,
            totalAmount: originalOrder.totalAmount,
            items: updatedItems,
            lastEventSequence: originalOrder.lastEventSequence
        )

        do {
            let updatedOrder = try await apiClient.partialCancelItems(
                ticketID: orderID,
                itemIDs: itemIDs,
                reasonCode: reasonCode,
                reasonNote: reasonNote,
                for: deviceSession
            )
            replace(updatedOrder)
        } catch KDSDataError.deviceRevoked {
            onDeviceRevoked()
        } catch KDSDataError.notConfigured {
            // Keep previews and scaffolds usable without a backend configuration.
        } catch {
            replace(originalOrder)
        }
    }

    private func apply(_ event: KitchenEvent) {
        switch event.kind {
        case .statusChanged:
            applyStatusChanged(event)
        case .orderUpserted, .orderRemoved, .snapshotReconciled:
            Task {
                await refreshSnapshot()
            }
        }
    }

    private func applyStatusChanged(_ event: KitchenEvent) {
        guard let index = orders.firstIndex(where: { $0.id == event.orderID }) else { return }
        guard let status = event.status else { return }

        orders[index] = KitchenOrder(
            id: orders[index].id,
            businessID: orders[index].businessID,
            source: orders[index].source,
            status: status,
            station: orders[index].station,
            createdAt: orders[index].createdAt,
            updatedAt: event.occurredAt,
            customerName: orders[index].customerName,
            pickupPerson: orders[index].pickupPerson,
            customerNote: orders[index].customerNote,
            cancellationReason: orders[index].cancellationReason,
            partialCancellationReason: status == .partialCancelled ? orders[index].partialCancellationReason : nil,
            totalAmount: orders[index].totalAmount,
            items: orders[index].items,
            lastEventSequence: event.sequence
        )
    }

    private func refreshSnapshot() async {
        do {
            let snapshot = try await apiClient.fetchBoardSnapshot(for: deviceSession)
            orders = snapshot
        } catch KDSDataError.deviceRevoked {
            onDeviceRevoked()
        } catch {
            // Keep the current local state if refresh fails.
        }
    }

    private func replace(_ order: KitchenOrder) {
        if let index = orders.firstIndex(where: { $0.id == order.id }) {
            orders[index] = order
        } else {
            orders.append(order)
        }
    }
}

extension OrderRepository {
    static let preview = OrderRepository(
        apiClient: KDSAPIClient(),
        realtimeClient: KDSRealtimeClient(),
        deviceSession: DeviceSession(
            businessID: "demo-business",
            station: Station(id: "expo", name: "Expo"),
            deviceName: "Kitchen iPad"
        )
    )
}

let previewKitchenOrders: [KitchenOrder] = [
    KitchenOrder(
        id: "txn_1001",
        businessID: "demo-business",
        source: .whatsapp,
        status: .new,
        station: Station(id: "expo", name: "Expo"),
        createdAt: .now.addingTimeInterval(-420),
        updatedAt: .now.addingTimeInterval(-420),
        customerName: "Ana",
        pickupPerson: "Ana",
        customerNote: "No onion, extra salsa.",
        cancellationReason: nil,
        partialCancellationReason: nil,
        totalAmount: 245,
        items: [
            KitchenItem(name: "Tacos al pastor", quantity: 2, notes: "Extra salsa"),
            KitchenItem(name: "Agua fresca", quantity: 1, variantName: "Horchata")
        ],
        lastEventSequence: 18
    ),
    KitchenOrder(
        id: "txn_1002",
        businessID: "demo-business",
        source: .whatsapp,
        status: .preparing,
        station: Station(id: "grill", name: "Grill"),
        createdAt: .now.addingTimeInterval(-900),
        updatedAt: .now.addingTimeInterval(-300),
        customerName: "Carlos",
        pickupPerson: "Carlos",
        customerNote: nil,
        cancellationReason: nil,
        partialCancellationReason: nil,
        totalAmount: 360,
        items: [
            KitchenItem(name: "Quesadilla", quantity: 1, variantName: "Arrachera"),
            KitchenItem(name: "Torta", quantity: 1, notes: "Cut in half")
        ],
        lastEventSequence: 21
    ),
    KitchenOrder(
        id: "txn_1003",
        businessID: "demo-business",
        source: .whatsapp,
        status: .ready,
        station: Station(id: "expo", name: "Expo"),
        createdAt: .now.addingTimeInterval(-1_200),
        updatedAt: .now.addingTimeInterval(-60),
        customerName: nil,
        pickupPerson: "Luisa",
        customerNote: "Pickup at side window.",
        cancellationReason: nil,
        partialCancellationReason: nil,
        totalAmount: 180,
        items: [
            KitchenItem(name: "Chilaquiles", quantity: 1, variantName: "Rojos")
        ],
        lastEventSequence: 24
    )
]
