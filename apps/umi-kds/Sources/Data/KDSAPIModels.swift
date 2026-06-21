import Foundation

struct KDSSnapshotRow: Decodable, Sendable {
    let ticketID: String
    let sourceTransactionID: String
    let businessID: String
    let sourceChannel: String
    let status: String
    let stationID: String?
    let stationName: String?
    let customerName: String?
    let customerPhone: String?
    let pickupPerson: String?
    let customerNote: String?
    let cancellationReason: String?
    let partialCancellationReason: String?
    let totalAmount: Decimal?
    let createdAt: Date
    let updatedAt: Date
    let lastEventSequence: Int?
    let items: [KDSSnapshotItem]

    enum CodingKeys: String, CodingKey {
        case ticketID = "ticket_id"
        case sourceTransactionID = "source_transaction_id"
        case businessID = "business_id"
        case sourceChannel = "source_channel"
        case status
        case stationID = "station_id"
        case stationName = "station_name"
        case customerName = "customer_name"
        case customerPhone = "customer_phone"
        case pickupPerson = "pickup_person"
        case customerNote = "customer_note"
        case cancellationReason = "cancellation_reason"
        case partialCancellationReason = "partial_cancellation_reason"
        case totalAmount = "total_amount"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case lastEventSequence = "last_event_sequence"
        case items
    }
}

struct KDSSnapshotItem: Decodable, Sendable {
    let ticketItemID: UUID?
    let name: String
    let quantity: Int
    let variantName: String?
    let notes: String?
    let isCancelled: Bool
    let unitPrice: Decimal?
    let displayOrder: Int

    enum CodingKeys: String, CodingKey {
        case ticketItemID = "ticket_item_id"
        case name
        case quantity
        case variantName = "variant_name"
        case notes
        case isCancelled = "is_cancelled"
        case unitPrice = "unit_price"
        case displayOrder = "display_order"
    }
}

struct KDSEventRow: Decodable, Sendable {
    let sequence: Int
    let ticketID: String
    let businessID: String
    let sourceTransactionID: String
    let kind: String
    let status: String?
    let occurredAt: Date
    let source: String
    let payload: [String: StringValue]

    enum CodingKeys: String, CodingKey {
        case sequence
        case ticketID = "ticket_id"
        case businessID = "business_id"
        case sourceTransactionID = "source_transaction_id"
        case kind
        case status
        case occurredAt = "occurred_at"
        case source
        case payload
    }
}

struct StringValue: Decodable, Sendable {
    let string: String?

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        self.string = try? container.decode(String.self)
    }
}

extension KDSSnapshotRow {
    func asKitchenOrder() throws -> KitchenOrder {
        guard let source = ChannelSource(rawValue: sourceChannel) else {
            throw KDSDataError.invalidResponse
        }
        guard let kitchenStatus = KitchenStatus(kdsValue: status) else {
            throw KDSDataError.invalidResponse
        }

        return KitchenOrder(
            id: ticketID,
            businessID: businessID,
            source: source,
            status: kitchenStatus,
            station: {
                guard let stationID else { return nil }
                return Station(id: stationID, name: stationName ?? stationID)
            }(),
            createdAt: createdAt,
            updatedAt: updatedAt,
            customerName: customerName,
            pickupPerson: pickupPerson,
            customerNote: customerNote,
            cancellationReason: cancellationReason,
            partialCancellationReason: partialCancellationReason,
            totalAmount: totalAmount,
            items: items.map { item in
                KitchenItem(
                    id: item.ticketItemID ?? UUID(),
                    name: item.name,
                    quantity: item.quantity,
                    variantName: item.variantName,
                    notes: item.notes,
                    isCancelled: item.isCancelled
                )
            },
            lastEventSequence: lastEventSequence
        )
    }
}

extension KDSEventRow {
    func asKitchenEvent() throws -> KitchenEvent {
        guard let eventKind = KitchenEventKind(kdsValue: kind) else {
            throw KDSDataError.invalidResponse
        }

        return KitchenEvent(
            sequence: sequence,
            orderID: ticketID,
            kind: eventKind,
            status: status.flatMap(KitchenStatus.init(kdsValue:)),
            occurredAt: occurredAt,
            source: source
        )
    }
}

extension KitchenStatus {
    nonisolated init?(kdsValue: String) {
        switch kdsValue {
        case "partial_cancelled":
            self = .partialCancelled
        default:
            self.init(rawValue: kdsValue)
        }
    }
}

extension KitchenEventKind {
    init?(kdsValue: String) {
        switch kdsValue {
        case "snapshot_reconciled": self = .snapshotReconciled
        case "order_upserted": self = .orderUpserted
        case "status_changed": self = .statusChanged
        case "order_removed": self = .orderRemoved
        default: return nil
        }
    }
}
