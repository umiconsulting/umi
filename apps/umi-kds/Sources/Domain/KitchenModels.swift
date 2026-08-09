import Foundation
import SwiftUI

enum ChannelSource: String, Codable, CaseIterable, Sendable {
    case whatsapp
    case pos
    case web
    case dashboard

    var displayName: String { rawValue.uppercased() }
}

enum KitchenStatus: String, Codable, CaseIterable, Sendable {
    case queued
    case inPreparation = "in_preparation"
    case partiallyReady = "partially_ready"
    case ready
    case completed
    case cancelled
    case exception

    var boardTitle: String {
        switch self {
        case .queued: return "Queued"
        case .inPreparation: return "Preparing"
        case .partiallyReady: return "Partially Ready"
        case .ready: return "Ready"
        case .completed: return "Completed"
        case .cancelled: return "Cancelled"
        case .exception: return "Exception"
        }
    }

    var tint: Color {
        switch self {
        case .queued: return .orange
        case .inPreparation: return .indigo
        case .partiallyReady: return .blue
        case .ready: return .green
        case .completed: return .secondary
        case .cancelled: return .red
        case .exception: return .red
        }
    }

    var nextActionStatuses: [KitchenStatus] {
        switch self {
        case .queued: return [.inPreparation]
        case .inPreparation, .partiallyReady: return [.ready]
        case .ready: return [.completed]
        case .completed, .cancelled, .exception: return []
        }
    }

    var actionLabel: String {
        switch self {
        case .queued: return "Queue"
        case .inPreparation: return "Start Prep"
        case .partiallyReady: return "Partially Ready"
        case .ready: return "Mark Ready"
        case .completed: return "Complete"
        case .cancelled: return "Cancelled"
        case .exception: return "Route Required"
        }
    }
}

enum KitchenPriority: String, Codable, Sendable {
    case normal
    case high
    case urgent
}

enum KitchenItemStatus: String, Codable, Sendable {
    case queued
    case preparing
    case ready
    case cancelled
    case exception
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
    let modifiers: [String]
    let notes: String?
    let status: KitchenItemStatus
    let targetSeconds: Int?
    let version: Int

    var isCancelled: Bool { status == .cancelled }
}

struct KitchenOrder: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let sourceOrderID: String
    let publicReference: String
    let businessID: String
    let source: ChannelSource
    let status: KitchenStatus
    let priority: KitchenPriority
    let station: Station
    let businessDate: String
    let createdAt: Date
    let preparationStartedAt: Date?
    let updatedAt: Date
    let version: Int
    let items: [KitchenItem]
    let lastEventSequence: Int

    var displayName: String { "Order \(publicReference)" }

    var nextActionStatuses: [KitchenStatus] {
        let active = items.filter { $0.status != .cancelled }
        if active.allSatisfy({ $0.status == .ready }) {
            return status == .ready ? [.completed] : []
        }
        if active.contains(where: { $0.status == .preparing }) { return [.ready] }
        if active.contains(where: { $0.status == .queued }) { return [.inPreparation] }
        return []
    }

    var ageInMinutes: Int {
        max(Int(Date.now.timeIntervalSince(createdAt) / 60), 0)
    }
}

enum KitchenEventKind: String, Codable, Sendable {
    case orderCreated = "order_created"
    case orderUpdated = "order_updated"
    case itemUpdated = "item_updated"
    case orderCancelled = "order_cancelled"
    case priorityChanged = "priority_changed"
    case orderRecalled = "order_recalled"
    case recoveryRequired = "recovery_required"
}

struct KitchenEvent: Codable, Identifiable, Hashable, Sendable {
    let id: Int
    let sequence: Int
    let orderID: KitchenOrder.ID
    let kind: KitchenEventKind
    let aggregateVersion: Int
    let status: KitchenStatus?
    let occurredAt: Date
}
