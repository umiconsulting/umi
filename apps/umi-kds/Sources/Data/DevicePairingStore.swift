import Foundation
import Security

struct PairedDeviceCredential: Codable, Sendable {
    let deviceID: String
    let deviceToken: String
    let businessID: String
    let stationID: String
    let stationName: String
    let deviceName: String

    var deviceSession: DeviceSession {
        DeviceSession(
            businessID: businessID,
            station: Station(id: stationID, name: stationName),
            deviceName: deviceName,
            deviceID: deviceID,
            deviceToken: deviceToken
        )
    }
}

enum DevicePairingStoreError: LocalizedError {
    case encodeFailed
    case saveFailed(OSStatus)

    var errorDescription: String? {
        switch self {
        case .encodeFailed:
            "Could not encode paired KDS credential."
        case .saveFailed(let status):
            "Could not save paired KDS credential. Keychain status \(status)."
        }
    }
}

struct DevicePairingStore: Sendable {
    private let service = "co.umiconsulting.umi-kds.device-session"
    private let account = "current"

    nonisolated init() {}

    func load() -> PairedDeviceCredential? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return try? JSONDecoder().decode(PairedDeviceCredential.self, from: data)
    }

    func save(_ credential: PairedDeviceCredential) throws {
        guard let data = try? JSONEncoder().encode(credential) else {
            throw DevicePairingStoreError.encodeFailed
        }

        delete()

        var item = baseQuery
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw DevicePairingStoreError.saveFailed(status)
        }
    }

    func delete() {
        SecItemDelete(baseQuery as CFDictionary)
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
