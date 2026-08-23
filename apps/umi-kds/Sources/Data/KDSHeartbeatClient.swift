import Foundation
import os

/// Sends periodic heartbeats to the UMI API.
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
        guard let deviceToken = deviceSession.deviceToken, !deviceToken.isEmpty else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(deviceToken, forHTTPHeaderField: "X-KDS-Device-Token")
        request.timeoutInterval = 5

        let body = ["action": "heartbeat"]

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
