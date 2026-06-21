import Foundation

struct KDSAPIClient {
    private let configuration: KDSBackendConfiguration?
    private let session: URLSession

    init(
        configuration: KDSBackendConfiguration? = .load(),
        session: URLSession = .shared
    ) {
        self.configuration = configuration
        self.session = session
    }

    func fetchBoardSnapshot(for session: DeviceSession) async throws -> [KitchenOrder] {
        let rows: [KDSSnapshotRow] = try await boardData(
            action: "snapshot",
            body: [:],
            deviceSession: session
        )
        return try rows.map { try $0.asKitchenOrder() }
    }

    func fetchTicketEvents(for session: DeviceSession, after sequence: Int?) async throws -> [KitchenEvent] {
        let rows: [KDSEventRow] = try await boardData(
            action: "events",
            body: [
                "after_sequence": sequence ?? 0,
                "limit": 200
            ],
            deviceSession: session
        )
        return try rows.map { try $0.asKitchenEvent() }
    }

    func transitionTicket(
        orderID: KitchenOrder.ID,
        to status: KitchenStatus,
        reasonCode: CancelReasonCode? = nil,
        reasonNote: String? = nil,
        for session: DeviceSession
    ) async throws -> KitchenOrder {
        let body: [String: Any] = [
            "action": "transition_ticket",
            "ticket_id": orderID,
            "target_status": status.rawValue,
            "actor_source": "kds_app",
            "actor_id": session.deviceName,
            "actor_channel": session.station.id,
            "cancellation_reason_code": reasonCode?.rawValue ?? NSNull(),
            "cancellation_reason_note": reasonNote ?? NSNull()
        ]
        _ = try await commandData(body: body, deviceSession: session)

        let snapshot = try await fetchBoardSnapshot(for: session)
        guard let order = snapshot.first(where: { $0.id == orderID }) else {
            throw KDSDataError.invalidResponse
        }
        return order
    }

    func partialCancelItems(
        ticketID: KitchenOrder.ID,
        itemIDs: [UUID],
        reasonCode: CancelReasonCode,
        reasonNote: String?,
        for session: DeviceSession
    ) async throws -> KitchenOrder {
        let body: [String: Any] = [
            "action": "partial_cancel_items",
            "ticket_id": ticketID,
            "item_ids": itemIDs.map(\.uuidString),
            "reason_code": reasonCode.rawValue,
            "reason_note": reasonNote ?? NSNull(),
            "actor_source": "kds_app",
            "actor_id": session.deviceName,
            "actor_channel": session.station.id
        ]
        _ = try await commandData(body: body, deviceSession: session)

        let snapshot = try await fetchBoardSnapshot(for: session)
        guard let order = snapshot.first(where: { $0.id == ticketID }) else {
            throw KDSDataError.invalidResponse
        }
        return order
    }

    func submitPairingPIN(pin: String, deviceName: String) async throws -> PairingSubmission {
        let data = try await pairingData(body: [
            "action": "kds_start",
            "pin": pin,
            "device_name": deviceName,
            "platform": "ipad"
        ])
        return try JSONDecoder.kdsDecoder.decode(PairingSubmission.self, from: data)
    }

    func fetchPairingStatus(pairingID: String) async throws -> PairingStatusResponse {
        let data = try await pairingData(body: [
            "action": "kds_status",
            "pairing_id": pairingID
        ])
        return try JSONDecoder.kdsDecoder.decode(PairingStatusResponse.self, from: data)
    }

    // MARK: - Private

    /// Sends a command to the device-aware KDS command endpoint.
    private func commandData(body: [String: Any], deviceSession: DeviceSession) async throws -> Data {
        guard let configuration else {
            throw KDSDataError.notConfigured
        }
        guard let deviceToken = deviceSession.deviceToken, !deviceToken.isEmpty else {
            throw KDSDataError.deviceRevoked
        }

        var request = URLRequest(url: configuration.commandURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(configuration.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(deviceToken, forHTTPHeaderField: "X-KDS-Device-Token")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await responseData(for: request)
    }

    /// Sends first-pairing requests to the backend-owned kds-pairing edge function.
    private func pairingData(body: [String: Any]) async throws -> Data {
        guard let configuration else {
            throw KDSDataError.notConfigured
        }

        var request = URLRequest(url: configuration.pairingURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(configuration.anonKey)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        return try await responseData(for: request)
    }

    private func boardData<Response: Decodable>(
        action: String,
        body: [String: Any],
        deviceSession: DeviceSession
    ) async throws -> Response {
        guard let configuration else {
            throw KDSDataError.notConfigured
        }
        guard let deviceToken = deviceSession.deviceToken, !deviceToken.isEmpty else {
            throw KDSDataError.deviceRevoked
        }

        var payload = body
        payload["action"] = action

        var request = URLRequest(url: configuration.boardURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(configuration.anonKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(configuration.anonKey)", forHTTPHeaderField: "Authorization")
        request.setValue(deviceToken, forHTTPHeaderField: "X-KDS-Device-Token")
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let data = try await responseData(for: request)
        let envelope = try JSONDecoder.kdsDecoder.decode(KDSEnvelope<Response>.self, from: data)
        return envelope.data
    }

    private func responseData(for request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw KDSDataError.invalidResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            if (httpResponse.statusCode == 401 || httpResponse.statusCode == 403),
               let error = try? JSONDecoder().decode(KDSErrorResponse.self, from: data),
               error.error == "device_revoked" {
                throw KDSDataError.deviceRevoked
            }
            throw KDSDataError.transportFailed(httpResponse.statusCode)
        }

        return data
    }
}

private struct KDSEnvelope<DataValue: Decodable>: Decodable {
    let data: DataValue
}

private struct KDSErrorResponse: Decodable {
    let error: String
    let message: String?
}

private extension JSONDecoder {
    static var kdsDecoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)

            if let date = Self.kdsFractionalDateFormatter.date(from: value) ?? Self.kdsDateFormatter.date(from: value) {
                return date
            }

            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid ISO-8601 date: \(value)")
        }
        return decoder
    }

    static let kdsDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let kdsFractionalDateFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
