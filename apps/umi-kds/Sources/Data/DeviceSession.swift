import Foundation
#if canImport(UIKit)
import UIKit
#endif

struct DeviceSession: Sendable {
    let businessID: String
    let station: Station
    let deviceName: String
    let deviceID: String?
    let deviceToken: String?

    init(
        businessID: String,
        station: Station,
        deviceName: String,
        deviceID: String? = nil,
        deviceToken: String? = nil
    ) {
        self.businessID = businessID
        self.station = station
        self.deviceName = deviceName
        self.deviceID = deviceID
        self.deviceToken = deviceToken
    }

    /// Loads kitchen scope from `Info.plist` (`KDSBusinessID`, `KDSStationID`, `KDSStationName`, optional `KDSDeviceName`).
    static func load(bundle: Bundle = .main) -> DeviceSession? {
        guard
            let businessID = bundle.object(forInfoDictionaryKey: "KDSBusinessID") as? String,
            !businessID.isEmpty,
            let stationID = bundle.object(forInfoDictionaryKey: "KDSStationID") as? String,
            !stationID.isEmpty,
            let stationName = bundle.object(forInfoDictionaryKey: "KDSStationName") as? String,
            !stationName.isEmpty
        else {
            return nil
        }

        let fromPlist = (bundle.object(forInfoDictionaryKey: "KDSDeviceName") as? String).flatMap { $0.isEmpty ? nil : $0 }
        #if canImport(UIKit)
        let deviceName = fromPlist ?? UIDevice.current.name
        #else
        let deviceName = fromPlist ?? "Kitchen Display"
        #endif

        return DeviceSession(
            businessID: businessID,
            station: Station(id: stationID, name: stationName),
            deviceName: deviceName
        )
    }
}
