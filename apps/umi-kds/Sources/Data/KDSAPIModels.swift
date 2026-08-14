import Foundation

struct KDSSnapshotRow: Decodable, Sendable {
    let id: String
    let sourceOrderId: String
    let publicReference: String
    let merchantId: String
    let locationId: String
    let stationId: String
    let source: String
    let status: String
    let priority: String
    let businessDate: String
    let queuedAt: Date
    let preparationStartedAt: Date?
    let updatedAt: Date
    let version: Int
    let lastEventSequence: Int
    let items: [KDSSnapshotItem]
}

struct KDSSnapshotItem: Decodable, Sendable {
    let id: UUID
    let productName: String
    let quantity: Int
    let variantName: String?
    let modifiers: [String]
    let preparationNote: String?
    let status: String
    let targetSeconds: Int?
    let version: Int
}

struct KDSEventRow: Decodable, Sendable {
    let sequence: Int
    let kitchenOrderId: String
    let kind: String
    let aggregateVersion: Int
    let status: String?
    let occurredAt: Date
}

struct KDSCommandResult: Decodable, Sendable {
    let kitchenOrderId: String
    let status: KitchenStatus
    let version: Int
    let sequence: Int
    let updatedAt: Date
}

extension KDSSnapshotRow {
    func asKitchenOrder(stationName: String) throws -> KitchenOrder {
        guard let channelSource = ChannelSource(rawValue: source),
              let kitchenStatus = KitchenStatus(rawValue: status),
              let kitchenPriority = KitchenPriority(rawValue: priority) else {
            throw KDSDataError.invalidResponse
        }
        return KitchenOrder(
            id: id,
            sourceOrderID: sourceOrderId,
            publicReference: publicReference,
            businessID: merchantId,
            source: channelSource,
            status: kitchenStatus,
            priority: kitchenPriority,
            station: Station(id: stationId, name: stationName),
            businessDate: businessDate,
            createdAt: queuedAt,
            preparationStartedAt: preparationStartedAt,
            updatedAt: updatedAt,
            version: version,
            items: try items.map { item in
                guard let itemStatus = KitchenItemStatus(rawValue: item.status) else {
                    throw KDSDataError.invalidResponse
                }
                return KitchenItem(
                    id: item.id,
                    name: item.productName,
                    quantity: item.quantity,
                    variantName: item.variantName,
                    modifiers: item.modifiers,
                    notes: item.preparationNote,
                    status: itemStatus,
                    targetSeconds: item.targetSeconds,
                    version: item.version
                )
            },
            lastEventSequence: lastEventSequence
        )
    }
}

extension KDSEventRow {
    func asKitchenEvent() throws -> KitchenEvent {
        guard let eventKind = KitchenEventKind(rawValue: kind) else {
            throw KDSDataError.invalidResponse
        }
        return KitchenEvent(
            id: sequence,
            sequence: sequence,
            orderID: kitchenOrderId,
            kind: eventKind,
            aggregateVersion: aggregateVersion,
            status: status.flatMap(KitchenStatus.init(rawValue:)),
            occurredAt: occurredAt
        )
    }
}
