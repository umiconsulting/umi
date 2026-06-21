import SwiftUI

@main
struct _75App: App {
    @StateObject private var environment = AppEnvironment.bootstrap()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(environment)
                .tint(KDSTheme.Brand.navy)
        }
    }
}
