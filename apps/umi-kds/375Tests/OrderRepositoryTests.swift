import Foundation
import Testing
@testable import _75

struct OrderRepositoryTests {
    @MainActor
    @Test
    func ordersAreFilteredByCanonicalStatus() {
        let repository = OrderRepository(
            apiClient: KDSAPIClient(),
            realtimeClient: KDSRealtimeClient(),
            deviceSession: DeviceSession(
                businessID: "demo-business",
                station: Station(id: "expo", name: "Expo"),
                deviceName: "Kitchen iPad"
            ),
            orders: previewKitchenOrders,
            demoMode: true
        )
        #expect(repository.orders(for: .queued).count == 1)
    }

    @Test
    func kitchenOrderUsesOnlySafePublicReference() {
        #expect(previewKitchenOrders[0].displayName == "Order 1024")
    }

    @Test
    func kitchenStatusExposesServerTransitions() {
        #expect(KitchenStatus.queued.nextActionStatuses == [.inPreparation])
        #expect(KitchenStatus.inPreparation.nextActionStatuses == [.ready])
        #expect(KitchenStatus.partiallyReady.nextActionStatuses == [.ready])
        #expect(KitchenStatus.ready.nextActionStatuses == [.completed])
        #expect(KitchenStatus.completed.nextActionStatuses.isEmpty)
        #expect(KitchenStatus.cancelled.nextActionStatuses.isEmpty)
        #expect(KitchenStatus.exception.nextActionStatuses.isEmpty)
    }

    @Test
    func duplicateAndStaleEventsCannotRegressState() {
        var seen: Set<Int> = []
        #expect(kdsEventNeedsSnapshot(
            sequence: 20,
            aggregateVersion: 3,
            currentVersion: 2,
            seenSequences: &seen
        ))
        #expect(!kdsEventNeedsSnapshot(
            sequence: 20,
            aggregateVersion: 3,
            currentVersion: 2,
            seenSequences: &seen
        ))
        #expect(!kdsEventNeedsSnapshot(
            sequence: 21,
            aggregateVersion: 2,
            currentVersion: 2,
            seenSequences: &seen
        ))
    }
}
