import Foundation
import os

/// Sends periodic heartbeats to the dashboard so it can track device liveness.
/// Only active when KDSHeartbeatURL is set in Info.plist. Safe to start without
/// a configured URL — it silently skips each interval.
actor KDSHeartbeatClient {
    private let configuration: KDSBackendConfiguration?
    private let session: URLSession
    private let logger = Logger(subsystem: "UmiKDS", category: "Heartbeat")

    init(
        configuration: KDSBackendConfiguration? = .load(),
        session: URLSession = .shared
    ) {
        self.configuration = configuration
        self.session = session
    }

    /// Loops forever, sending a heartbeat on each interval. Call from a Task in AppEnvironment.
    func run(deviceSession: DeviceSession) async {
        guard let configuration, let url = configuration.heartbeatURL else { return }

        while !Task.isCancelled {
            await send(to: url, deviceSession: deviceSession)
            do {
                try await Task.sleep(for: configuration.heartbeatInterval)
            } catch is CancellationError {
                break
            } catch {
                logger.error("Heartbeat sleep failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    private func send(to url: URL, deviceSession: DeviceSession) async {
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 5

        let body: [String: String?] = [
            "device_id":   deviceSession.deviceID,
            "device_name": deviceSession.deviceName,
            "station_id":  deviceSession.station.id,
            "station_name": deviceSession.station.name,
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body.compactMapValues { $0 })
        } catch {
            logger.error("Failed to serialize heartbeat body \(String(describing: body), privacy: .public): \(error.localizedDescription, privacy: .public)")
            return
        }

        do {
            _ = try await session.data(for: request)
        } catch {
            logger.error("Heartbeat request failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
