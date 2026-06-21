import Foundation

struct KDSBackendConfiguration: Sendable {
    let projectURL: URL
    let anonKey: String
    let pollingInterval: Duration
    /// How often the device sends a heartbeat to the dashboard. Defaults to 5 s.
    let heartbeatInterval: Duration
    private let commandURLOverride: URL?
    private let boardURLOverride: URL?
    private let pairingURLOverride: URL?
    /// Heartbeat endpoint override — points at the local dashboard server during
    /// development. Set KDSLocalBaseURL or KDSHeartbeatURL in Info.plist to activate.
    let heartbeatURL: URL?

    init(
        projectURL: URL,
        anonKey: String,
        pollingInterval: Duration = .seconds(3),
        heartbeatInterval: Duration = .seconds(5),
        commandURLOverride: URL? = nil,
        boardURLOverride: URL? = nil,
        pairingURLOverride: URL? = nil,
        heartbeatURL: URL? = nil
    ) {
        self.projectURL = projectURL
        self.anonKey = anonKey
        self.pollingInterval = pollingInterval
        self.heartbeatInterval = heartbeatInterval
        self.commandURLOverride = commandURLOverride
        self.boardURLOverride = boardURLOverride
        self.pairingURLOverride = pairingURLOverride
        self.heartbeatURL = heartbeatURL
    }

    /// URL of the kds-command edge function.
    var commandURL: URL {
        commandURLOverride ?? projectURL.appending(path: "functions/v1/kds-command")
    }

    /// URL of the device-aware KDS board read endpoint.
    var boardURL: URL {
        boardURLOverride ?? projectURL.appending(path: "functions/v1/kds-board")
    }

    /// Pairing endpoint. Reads KDSLocalBaseURL or KDSPairingURL from Info.plist when set —
    /// used to point at the local dashboard server during development without Supabase.
    var pairingURL: URL {
        pairingURLOverride ?? projectURL.appending(path: "functions/v1/kds-pairing")
    }

    static func load(bundle: Bundle = .main) -> KDSBackendConfiguration? {
        guard
            let urlString = bundle.object(forInfoDictionaryKey: "KDSBackendURL") as? String,
            let projectURL = URL(string: urlString),
            let anonKey = bundle.object(forInfoDictionaryKey: "KDSAnonKey") as? String,
            !anonKey.isEmpty
        else {
            return nil
        }

        let pollingSeconds = bundle.object(forInfoDictionaryKey: "KDSPollingIntervalSeconds") as? Double ?? 3
        let heartbeatSeconds = bundle.object(forInfoDictionaryKey: "KDSHeartbeatIntervalSeconds") as? Double ?? 5

        func configuredURL(_ key: String) -> URL? {
            guard let value = bundle.object(forInfoDictionaryKey: key) as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !trimmed.contains("$(") else { return nil }
            return URL(string: trimmed)
        }

        let hasLocalBaseURLKey = bundle.object(forInfoDictionaryKey: "KDSLocalBaseURL") != nil
        let localBaseURL = configuredURL("KDSLocalBaseURL")
            ?? (hasLocalBaseURLKey ? URL(string: "http://127.0.0.1:4011") : nil)

        let commandURLOverride: URL? = configuredURL("KDSCommandURL")
            ?? localBaseURL?.appending(path: "api/kds/command")

        let boardURLOverride: URL? = configuredURL("KDSBoardURL")
            ?? localBaseURL?.appending(path: "api/kds/board")

        let pairingURLOverride: URL? = configuredURL("KDSPairingURL")
            ?? localBaseURL?.appending(path: "api/kds/pairing")

        let heartbeatURL: URL? = configuredURL("KDSHeartbeatURL")
            ?? localBaseURL?.appending(path: "api/kds/heartbeat")

        return KDSBackendConfiguration(
            projectURL: projectURL,
            anonKey: anonKey,
            pollingInterval: Duration.milliseconds(Int64(pollingSeconds * 1_000)),
            heartbeatInterval: Duration.milliseconds(Int64(heartbeatSeconds * 1_000)),
            commandURLOverride: commandURLOverride,
            boardURLOverride: boardURLOverride,
            pairingURLOverride: pairingURLOverride,
            heartbeatURL: heartbeatURL
        )
    }
}
