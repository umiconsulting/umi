import Foundation
import SwiftUI

enum ChannelSource: String, Codable, CaseIterable, Sendable {
    case whatsapp

    var displayName: String {
        switch self {
        case .whatsapp:
            return "WhatsApp"
        }
    }
}

enum KitchenStatus: String, Codable, CaseIterable, Sendable {
    case new
    case accepted
    case preparing
    case partialCancelled
    case ready
    case completed
    case cancelled

    var boardTitle: String {
        switch self {
        case .new:
            return "New"
        case .accepted:
            return "Accepted"
        case .preparing:
            return "Preparing"
        case .partialCancelled:
            return "Partial Cancel"
        case .ready:
            return "Ready"
        case .completed:
            return "Completed"
        case .cancelled:
            return "Cancelled"
        }
    }

    var tint: Color {
        switch self {
        case .new:
            return .orange
        case .accepted:
            return .blue
        case .preparing:
            return .indigo
        case .partialCancelled:
            return .orange
        case .ready:
            return .green
        case .completed:
            return .secondary
        case .cancelled:
            return .red
        }
    }

    var nextActionStatuses: [KitchenStatus] {
        switch self {
        case .new:
            return [.accepted, .cancelled]
        case .accepted:
            return [.preparing, .cancelled]
        case .preparing:
            return [.ready, .cancelled]
        case .partialCancelled:
            return [.accepted, .cancelled]
        case .ready:
            return [.completed]
        case .completed, .cancelled:
            return []
        }
    }

    var actionLabel: String {
        switch self {
        case .new:
            return "Mark New"
        case .accepted:
            return "Accept"
        case .preparing:
            return "Start Prep"
        case .partialCancelled:
            return "Partial Cancel"
        case .ready:
            return "Mark Ready"
        case .completed:
            return "Complete"
        case .cancelled:
            return "Cancel"
        }
    }
}

enum CancelReasonCode: String, Codable, CaseIterable, Sendable, Identifiable {
    case outOfStock = "out_of_stock"
    case kitchenOverload = "kitchen_overload"
    case closingSoon = "closing_soon"
    case customerNoShow = "customer_no_show"
    case duplicateOrder = "duplicate_order"
    case other

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .outOfStock:
            return "Sin existencias"
        case .kitchenOverload:
            return "Alta demanda"
        case .closingSoon:
            return "Por cerrar"
        case .customerNoShow:
            return "Cliente no llegó"
        case .duplicateOrder:
            return "Pedido duplicado"
        case .other:
            return "Otro"
        }
    }
}

struct Station: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
}

struct KitchenItem: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let name: String
    let quantity: Int
    let variantName: String?
    let notes: String?
    let isCancelled: Bool

    init(
        id: UUID = UUID(),
        name: String,
        quantity: Int,
        variantName: String? = nil,
        notes: String? = nil,
        isCancelled: Bool = false
    ) {
        self.id = id
        self.name = name
        self.quantity = quantity
        self.variantName = variantName
        self.notes = notes
        self.isCancelled = isCancelled
    }
}

struct KitchenOrder: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let businessID: String
    let source: ChannelSource
    let status: KitchenStatus
    let station: Station?
    let createdAt: Date
    let updatedAt: Date
    let customerName: String?
    let pickupPerson: String?
    let customerNote: String?
    let cancellationReason: String?
    let partialCancellationReason: String?
    let totalAmount: Decimal?
    let items: [KitchenItem]
    let lastEventSequence: Int?

    var displayName: String {
        if let pickupPerson, !pickupPerson.isEmpty {
            return pickupPerson
        }
        if let customerName, !customerName.isEmpty {
            return customerName
        }
        return "Order \(id.prefix(6))"
    }

    var ageInMinutes: Int {
        max(Int(Date.now.timeIntervalSince(createdAt) / 60), 0)
    }
}

enum KitchenEventKind: String, Codable, Sendable {
    case snapshotReconciled
    case orderUpserted
    case statusChanged
    case orderRemoved
}

struct KitchenEvent: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let sequence: Int
    let orderID: KitchenOrder.ID
    let kind: KitchenEventKind
    let status: KitchenStatus?
    let occurredAt: Date
    /// Backend source of this event. Operator-intent transitions use actor-supplied
    /// values (e.g. "kds_app"). Projection-maintenance rows use "trigger".
    let source: String

    init(
        id: UUID = UUID(),
        sequence: Int,
        orderID: KitchenOrder.ID,
        kind: KitchenEventKind,
        status: KitchenStatus? = nil,
        occurredAt: Date = .now,
        source: String = "unknown"
    ) {
        self.id = id
        self.sequence = sequence
        self.orderID = orderID
        self.kind = kind
        self.status = status
        self.occurredAt = occurredAt
        self.source = source
    }
}
