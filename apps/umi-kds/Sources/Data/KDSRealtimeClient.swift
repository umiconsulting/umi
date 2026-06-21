import Foundation

enum KDSPollResult {
    case events([KitchenEvent])
    case failure(Error)
}

struct KDSRealtimeClient {
    private let apiClient: KDSAPIClient
    private let configuration: KDSBackendConfiguration?

    init(
        apiClient: KDSAPIClient = KDSAPIClient(),
        configuration: KDSBackendConfiguration? = .load()
    ) {
        self.apiClient = apiClient
        self.configuration = configuration
    }

    /// Yields successive poll results. Each element is either a batch of events (possibly
    /// empty on a quiet interval) or a failure. Callers see errors directly rather than
    /// having them swallowed — use this to drive connection health state.
    func pollStream(for session: DeviceSession, lastSeenSequence: Int?) -> AsyncStream<KDSPollResult> {
        return AsyncStream { continuation in
            guard let configuration else {
                continuation.finish()
                return
            }

            let task = Task {
                var nextSequence = lastSeenSequence ?? 0

                while !Task.isCancelled {
                    do {
                        let events = try await apiClient.fetchTicketEvents(for: session, after: nextSequence)
                        for event in events {
                            nextSequence = max(nextSequence, event.sequence)
                        }
                        continuation.yield(.events(events))
                    } catch {
                        continuation.yield(.failure(error))
                    }

                    try? await Task.sleep(for: configuration.pollingInterval)
                }

                continuation.finish()
            }

            continuation.onTermination = { _ in
                task.cancel()
            }
        }
    }
}
