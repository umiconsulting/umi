import Foundation
import Combine

@MainActor
final class AppEnvironment: ObservableObject {
    let apiClient: KDSAPIClient
    let realtimeClient: KDSRealtimeClient
    private let pairingStore: DevicePairingStore
    @Published private(set) var deviceSession: DeviceSession?
    @Published var orderRepository: OrderRepository?
    @Published private(set) var reconnectID: UUID = UUID()
    @Published var pairingMessage: String?

    var isPaired: Bool {
        deviceSession != nil && orderRepository != nil
    }

    func reconnect() {
        orderRepository?.resetForRestart()
        reconnectID = UUID()
    }

    func completePairing(_ credential: PairedDeviceCredential) throws {
        try pairingStore.save(credential)
        pairingMessage = nil
        configureSession(credential.deviceSession)
    }

    func resetPairing() {
        pairingStore.delete()
        orderRepository?.resetForRestart()
        orderRepository = nil
        deviceSession = nil
        pairingMessage = nil
        reconnectID = UUID()
    }

    func revokeLocalSession() {
        resetPairing()
        pairingMessage = "Este iPad fue revocado. Genera un nuevo PIN en el dashboard."
    }

    init(
        apiClient: KDSAPIClient,
        realtimeClient: KDSRealtimeClient,
        pairingStore: DevicePairingStore = DevicePairingStore(),
        deviceSession: DeviceSession? = nil
    ) {
        self.apiClient = apiClient
        self.realtimeClient = realtimeClient
        self.pairingStore = pairingStore
        if let deviceSession {
            configureSession(deviceSession)
        }
    }

    static func bootstrap() -> AppEnvironment {
        let apiClient = KDSAPIClient()
        let realtimeClient = KDSRealtimeClient(apiClient: apiClient)
        let pairingStore = DevicePairingStore()
        let storedSession = pairingStore.load()?.deviceSession

        return AppEnvironment(
            apiClient: apiClient,
            realtimeClient: realtimeClient,
            pairingStore: pairingStore,
            deviceSession: storedSession
        )
    }

    private func configureSession(_ session: DeviceSession) {
        deviceSession = session
        orderRepository = OrderRepository(
            apiClient: apiClient,
            realtimeClient: realtimeClient,
            deviceSession: session,
            onDeviceRevoked: { [weak self] in
                self?.revokeLocalSession()
            }
        )
        reconnectID = UUID()
    }
}
