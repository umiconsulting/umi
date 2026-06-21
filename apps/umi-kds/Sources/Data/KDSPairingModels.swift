import Foundation

struct PairingSubmission: Decodable, Sendable {
    let pairingID: String
    let status: PairingStatus
    let pollAfterSeconds: Int
    let expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case pairingID = "pairing_id"
        case status
        case pollAfterSeconds = "poll_after_seconds"
        case expiresAt = "expires_at"
    }
}

struct PairingStatusResponse: Decodable, Sendable {
    let status: PairingStatus
    let pollAfterSeconds: Int?
    let deviceSession: PairingDeviceSession?

    enum CodingKeys: String, CodingKey {
        case status
        case pollAfterSeconds = "poll_after_seconds"
        case deviceSession = "device_session"
    }
}

struct PairingDeviceSession: Decodable, Sendable {
    let deviceID: String
    let token: String
    let businessID: String
    let tenantID: String?
    let locationID: String?
    let stationID: String
    let stationName: String
    let deviceName: String

    enum CodingKeys: String, CodingKey {
        case deviceID = "device_id"
        case token
        case businessID = "business_id"
        case tenantID = "tenant_id"
        case locationID = "location_id"
        case stationID = "station_id"
        case stationName = "station_name"
        case deviceName = "device_name"
    }

    var credential: PairedDeviceCredential {
        PairedDeviceCredential(
            deviceID: deviceID,
            deviceToken: token,
            businessID: businessID,
            stationID: stationID,
            stationName: stationName,
            deviceName: deviceName
        )
    }
}

enum PairingStatus: String, Decodable, Sendable {
    case pending
    case approved
    case denied
    case expired
    case used
}
