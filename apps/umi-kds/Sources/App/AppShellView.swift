import SwiftUI

struct AppShellView: View {
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @EnvironmentObject private var environment: AppEnvironment
    @State private var selectedOrderID: KitchenOrder.ID?
    @State private var showingSettings = false

    var body: some View {
        Group {
            if horizontalSizeClass == .compact {
                compactLayout
            } else {
                regularLayout
            }
        }
        .task(id: environment.reconnectID) {
            guard let repository = environment.orderRepository else { return }
            await repository.start()
            if horizontalSizeClass != .compact, selectedOrderID == nil {
                selectedOrderID = repository.orders.first?.id
            }
        }
        .task(id: environment.reconnectID) {
            guard let session = environment.deviceSession else { return }
            await KDSHeartbeatClient().run(deviceSession: session)
        }
        .preferredColorScheme(.dark)
        .dynamicTypeSize(.xSmall ... .xLarge)
    }

    private var regularLayout: some View {
        Group {
            if let repository = environment.orderRepository {
                NavigationSplitView {
                    BoardView(selectedOrderID: $selectedOrderID, onSettings: { showingSettings = true })
                        .environmentObject(repository)
                        .navigationSplitViewColumnWidth(min: 500, ideal: 700, max: 900)
                } detail: {
                    NavigationStack {
                        TicketDetailView(orderID: selectedOrderID)
                            .environmentObject(repository)
                    }
                    .navigationSplitViewColumnWidth(min: 300, ideal: 360, max: 400)
                }
                .navigationSplitViewStyle(.balanced)
            } else {
                ProgressView()
            }
        }
        .sheet(isPresented: $showingSettings) {
            NavigationStack {
                SettingsView()
                    .environmentObject(environment)
                    .toolbar {
                        ToolbarItem(placement: .topBarTrailing) {
                            Button("Done") {
                                showingSettings = false
                            }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private var compactLayout: some View {
        Group {
            if let repository = environment.orderRepository {
                TabView {
                    Tab("Board", systemImage: "rectangle.grid.2x2") {
                        NavigationStack {
                            BoardView(selectedOrderID: $selectedOrderID)
                                .environmentObject(repository)
                                .navigationDestination(isPresented: boardDetailPresented) {
                                    TicketDetailView(orderID: selectedOrderID)
                                        .environmentObject(repository)
                                }
                        }
                    }

                    Tab("Settings", systemImage: "gearshape") {
                        NavigationStack {
                            SettingsView()
                                .environmentObject(environment)
                        }
                    }
                }
            } else {
                ProgressView()
            }
        }
    }

    private var boardDetailPresented: Binding<Bool> {
        Binding(
            get: { selectedOrderID != nil },
            set: { isPresented in
                if !isPresented { selectedOrderID = nil }
            }
        )
    }


}

#Preview {
    AppShellView()
        .environmentObject(AppEnvironment.bootstrap())
}
