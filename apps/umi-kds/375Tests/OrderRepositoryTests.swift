import Foundation
import Testing
@testable import _75

struct OrderRepositoryTests {
    @MainActor
    @Test
    func ordersAreFilteredAndSortedByStatus() async {
        let repository = OrderRepository(
            apiClient: KDSAPIClient(),
            realtimeClient: KDSRealtimeClient(),
            deviceSession: DeviceSession(
                businessID: "demo-business",
                station: Station(id: "expo", name: "Expo"),
                deviceName: "Kitchen iPad"
            ),
            orders: previewKitchenOrders
        )

        let newOrders = repository.orders(for: .new)

        #expect(newOrders.count == 1)
        #expect(newOrders.first?.id == "txn_1001")
    }

    @Test
    func kitchenOrderDisplayNamePrefersPickupPersonThenCustomerName() {
        let pickupOrder = KitchenOrder(
            id: "txn_pickup",
            businessID: "demo-business",
            source: .whatsapp,
            status: .new,
            station: nil,
            createdAt: .now,
            updatedAt: .now,
            customerName: "Ana Customer",
            pickupPerson: "Ana Pickup",
            customerNote: nil,
            cancellationReason: nil,
            partialCancellationReason: nil,
            totalAmount: nil,
            items: [],
            lastEventSequence: nil
        )

        let customerOrder = KitchenOrder(
            id: "txn_customer",
            businessID: "demo-business",
            source: .whatsapp,
            status: .new,
            station: nil,
            createdAt: .now,
            updatedAt: .now,
            customerName: "Carlos Customer",
            pickupPerson: nil,
            customerNote: nil,
            cancellationReason: nil,
            partialCancellationReason: nil,
            totalAmount: nil,
            items: [],
            lastEventSequence: nil
        )

        #expect(pickupOrder.displayName == "Ana Pickup")
        #expect(customerOrder.displayName == "Carlos Customer")
    }

    @Test
    func kitchenStatusOnlyExposesLegalNextActions() {
        #expect(KitchenStatus.new.nextActionStatuses == [.accepted, .cancelled])
        #expect(KitchenStatus.accepted.nextActionStatuses == [.preparing, .cancelled])
        #expect(KitchenStatus.preparing.nextActionStatuses == [.ready, .cancelled])
        #expect(KitchenStatus.partialCancelled.nextActionStatuses == [.accepted, .cancelled])
        #expect(KitchenStatus.ready.nextActionStatuses == [.completed])
        #expect(KitchenStatus.completed.nextActionStatuses.isEmpty)
        #expect(KitchenStatus.cancelled.nextActionStatuses.isEmpty)
    }
}
