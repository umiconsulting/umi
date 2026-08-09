import Combine
import Foundation

enum RealtimeConnectionState: Equatable {
    case idle
    case connecting
    case connected

    var displayName: String {
        switch self {
        case .idle: return "Idle"
        case .connecting: return "Reconnecting"
        case .connected: return "Connected"
        }
    }
}

enum KDSDataError: Error {
    case notConfigured
    case invalidCommand
    case invalidResponse
    case transportFailed(Int)
    case deviceRevoked
}

extension KDSDataError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .notConfigured: return "KDS backend is not configured."
        case .invalidCommand: return "This kitchen action is not available."
        case .invalidResponse: return "The KDS backend returned an invalid response."
        case .transportFailed(let status): return "KDS request failed with status \(status)."
        case .deviceRevoked: return "This KDS device is disabled. Pair the device again."
        }
    }
}

struct KDSCommandIdentity: Codable, Sendable {
    let commandID: UUID
    let idempotencyKey: String
    let correlationID: String
}

@MainActor
final class OrderRepository: ObservableObject {
    @Published private(set) var orders: [KitchenOrder]
    @Published private(set) var connectionState: RealtimeConnectionState = .idle
    @Published private(set) var snapshotError: String?
    @Published private(set) var pollingError: String?

    private let apiClient: KDSAPIClient
    private let realtimeClient: KDSRealtimeClient
    private let deviceSession: DeviceSession
    private let onDeviceRevoked: @MainActor () -> Void
    private let defaults: UserDefaults
    private let demoMode: Bool
    private var hasStarted = false
    private var needsReconcile = false
    private var seenSequences: Set<Int> = []
    private var snapshotGeneration = 0

    init(
        apiClient: KDSAPIClient,
        realtimeClient: KDSRealtimeClient,
        deviceSession: DeviceSession,
        orders: [KitchenOrder]? = nil,
        demoMode: Bool = KDSBackendConfiguration.demoModeEnabled(),
        defaults: UserDefaults = .standard,
        onDeviceRevoked: @escaping @MainActor () -> Void = {}
    ) {
        self.apiClient = apiClient
        self.realtimeClient = realtimeClient
        self.deviceSession = deviceSession
        self.defaults = defaults
        self.onDeviceRevoked = onDeviceRevoked
        self.demoMode = demoMode
        self.orders = orders ?? (demoMode ? previewKitchenOrders : [])
    }

    var isDemoMode: Bool { demoMode }

    func resetForRestart() {
        hasStarted = false
        connectionState = .idle
        snapshotError = nil
        pollingError = nil
        needsReconcile = true
    }

    func start() async {
        guard !hasStarted else { return }
        hasStarted = true
        connectionState = .connecting
        if !isDemoMode { _ = await refreshSnapshot() }

        let sequence = orders.map(\.lastEventSequence).max()
        for await result in realtimeClient.pollStream(for: deviceSession, lastSeenSequence: sequence) {
            switch result {
            case .events(let events):
                if needsReconcile, !(await refreshSnapshot()) { continue }
                connectionState = .connected
                pollingError = nil
                for event in events { apply(event) }
            case .failure(let error):
                if let dataError = error as? KDSDataError, case .deviceRevoked = dataError {
                    onDeviceRevoked()
                    return
                }
                connectionState = .connecting
                needsReconcile = true
                pollingError = error.localizedDescription
            }
        }
    }

    func orders(for status: KitchenStatus) -> [KitchenOrder] {
        orders.filter { $0.status == status }.sorted { $0.createdAt < $1.createdAt }
    }

    func order(id: KitchenOrder.ID) -> KitchenOrder? {
        orders.first { $0.id == id }
    }

    func transition(orderID: KitchenOrder.ID, to status: KitchenStatus) async {
        guard let order = order(id: orderID) else { return }
        if isDemoMode {
            replace(orderWithStatus(order, status: status))
            return
        }
        guard connectionState == .connected else {
            pollingError = "Reconnect before you change kitchen state."
            return
        }
        let identity = commandIdentity(order: order, status: status)
        do {
            let result = try await apiClient.transitionTicket(
                order: order,
                to: status,
                identity: identity,
                for: deviceSession
            )
            if result.status == .completed || result.status == .cancelled {
                orders.removeAll { $0.id == result.kitchenOrderId }
                clearCommandIdentity(order: order, status: status)
            } else if await refreshSnapshot() {
                clearCommandIdentity(order: order, status: status)
            }
        } catch KDSDataError.deviceRevoked {
            onDeviceRevoked()
        } catch {
            needsReconcile = true
            pollingError = error.localizedDescription
            let reconciled = await refreshSnapshot()
            if reconciled, self.order(id: order.id) == nil {
                clearCommandIdentity(order: order, status: status)
            } else if let current = self.order(id: order.id), current.version > order.version {
                clearCommandIdentity(order: order, status: status)
            }
        }
    }

    private func apply(_ event: KitchenEvent) {
        guard let order = order(id: event.orderID) else {
            if seenSequences.insert(event.sequence).inserted {
                needsReconcile = true
                Task { _ = await refreshSnapshot() }
            }
            return
        }
        guard kdsEventNeedsSnapshot(
            sequence: event.sequence,
            aggregateVersion: event.aggregateVersion,
            currentVersion: order.version,
            seenSequences: &seenSequences
        ) else { return }
        if seenSequences.count > 1_000 {
            seenSequences = Set(seenSequences.sorted().suffix(500))
        }
        needsReconcile = true
        Task { _ = await refreshSnapshot() }
    }

    @discardableResult
    private func refreshSnapshot() async -> Bool {
        snapshotGeneration += 1
        let generation = snapshotGeneration
        do {
            let snapshot = try await apiClient.fetchBoardSnapshot(for: deviceSession)
            guard generation == snapshotGeneration else { return false }
            orders = snapshot
            snapshotError = nil
            needsReconcile = false
            return true
        } catch KDSDataError.deviceRevoked {
            onDeviceRevoked()
            return false
        } catch {
            needsReconcile = true
            connectionState = .connecting
            snapshotError = error.localizedDescription
            return false
        }
    }

    private func replace(_ order: KitchenOrder) {
        if let index = orders.firstIndex(where: { $0.id == order.id }) {
            orders[index] = order
        } else {
            orders.append(order)
        }
    }

    private func commandIdentity(order: KitchenOrder, status: KitchenStatus) -> KDSCommandIdentity {
        let key = commandKey(order: order, status: status)
        if let data = defaults.data(forKey: key),
           let value = try? JSONDecoder().decode(KDSCommandIdentity.self, from: data) {
            return value
        }
        let id = UUID()
        let value = KDSCommandIdentity(
            commandID: id,
            idempotencyKey: "kds-\(id.uuidString.lowercased())",
            correlationID: "kds-\(id.uuidString.lowercased())"
        )
        if let data = try? JSONEncoder().encode(value) {
            defaults.set(data, forKey: key)
        }
        return value
    }

    private func clearCommandIdentity(order: KitchenOrder, status: KitchenStatus) {
        defaults.removeObject(forKey: commandKey(order: order, status: status))
    }

    private func commandKey(order: KitchenOrder, status: KitchenStatus) -> String {
        "kds.command.\(order.id).\(order.version).\(status.rawValue)"
    }
}

func kdsEventNeedsSnapshot(
    sequence: Int,
    aggregateVersion: Int,
    currentVersion: Int,
    seenSequences: inout Set<Int>
) -> Bool {
    guard seenSequences.insert(sequence).inserted else { return false }
    return aggregateVersion > currentVersion
}

private func orderWithStatus(_ order: KitchenOrder, status: KitchenStatus) -> KitchenOrder {
    KitchenOrder(
        id: order.id,
        sourceOrderID: order.sourceOrderID,
        publicReference: order.publicReference,
        businessID: order.businessID,
        source: order.source,
        status: status,
        priority: order.priority,
        station: order.station,
        businessDate: order.businessDate,
        createdAt: order.createdAt,
        preparationStartedAt: order.preparationStartedAt,
        updatedAt: .now,
        version: order.version + 1,
        items: order.items,
        lastEventSequence: order.lastEventSequence
    )
}

extension OrderRepository {
    static let preview = OrderRepository(
        apiClient: KDSAPIClient(),
        realtimeClient: KDSRealtimeClient(),
        deviceSession: DeviceSession(
            businessID: "demo-business",
            station: Station(id: "expo", name: "Expo"),
            deviceName: "Kitchen iPad"
        ),
        demoMode: true
    )
}

let previewKitchenOrders: [KitchenOrder] = [
    KitchenOrder(
        id: "11111111-1111-4111-8111-111111111111",
        sourceOrderID: "21111111-1111-4111-8111-111111111111",
        publicReference: "1024",
        businessID: "demo-business",
        source: .pos,
        status: .queued,
        priority: .normal,
        station: Station(id: "expo", name: "Expo"),
        businessDate: "2026-08-09",
        createdAt: .now.addingTimeInterval(-420),
        preparationStartedAt: nil,
        updatedAt: .now.addingTimeInterval(-420),
        version: 1,
        items: [
            KitchenItem(
                id: UUID(), name: "Tacos al pastor", quantity: 2,
                variantName: nil, modifiers: ["Extra salsa"], notes: nil,
                status: .queued, targetSeconds: 600, version: 1
            )
        ],
        lastEventSequence: 18
    )
]
